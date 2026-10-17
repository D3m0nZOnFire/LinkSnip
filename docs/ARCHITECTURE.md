# Architecture

How LinkSnip is put together, and why. The README covers running it and [CLAUDE.md](../CLAUDE.md) is the file-by-file
reference; this page covers the decisions behind the code and what they cost.

## The shape

One Node.js 22 process running Express 5, server-rendered EJS pages and a small JSON API for the pages' scripts. Data
lives in one SQLite file. Everything the instance stores (database, uploads, settings, roles, backups, branding,
palettes) is in one `DATA_DIR`, and it ships as one Docker container.

```
routes/        which URL goes where, and which middleware guards it
controllers/   read the request, call services, render or answer JSON
services/      the rules (access, permissions, config, teams, moderation, ...)
models/        SQL, one file per table group
middleware/    cross-cutting checks: CSRF, login, permissions, feature switches, rate limits, headers
config/        database, migrations, settings schema, paths, environment
views/         EJS pages and partials; public/ holds the CSS and browser scripts
```

Controllers stay thin and the rules live in services, so the same rule is applied by the page, the API, the admin
panel and the CLI.

## SQLite, synchronously

**Decision:** SQLite through `better-sqlite3`, whose API is synchronous.

**Why:** A self-hosted shortener should be one container and one file to back up. There's no database server to run,
secure or upgrade. The synchronous API makes code simpler: a check and the write that follows run with nothing awaited
between them, so another request can't slip in between (`itemSettings` reads the slug last for exactly this reason).
WAL mode lets reads go on while a write runs, and `busy_timeout` covers the short waits.

**Cost:** All queries run on the one Node thread, so a slow query blocks every request. Only one process can write. That
fits a personal or small-team instance, which is the target, and it's what would change first under heavy load (see
below).

**Migrations** run on every start and are idempotent (`CREATE TABLE IF NOT EXISTS`, check `PRAGMA table_info` before
`ALTER TABLE`). Nobody self-hosting it has to run a migration step, and restoring an old backup simply upgrades it on the
next start. The ones with real logic are in `config/migrations.js` and have tests.

## Configuration in three layers

| Layer | Holds | Changed by |
|---|---|---|
| Environment | Secrets and infrastructure: `SESSION_SECRET`, `IP_HASH_SECRET`, `DATA_DIR`, `PORT`, `TRUST_PROXY` | Restart |
| `settings.json` | How the instance behaves: registration, feature switches, retention, size limits | Admin → Settings, or editing the file |
| `roles.json` | What each role may do, and how much | Admin → Settings → Roles, or editing the file |

**Why:** Secrets don't belong in a file the admin panel can rewrite. Behavior shouldn't need a restart. Limits like the
anonymous link expiry and the paste size used to be environment variables, so changing one meant redeploying (they're
carried over into `settings.json` once, on the first start).

`config/schema.js` is the one list of every setting, permission and limit with its description. Validation, the admin
form's help text and [CONFIGURATION.md](CONFIGURATION.md) all come from it, and a test fails if that doc is stale.
`configService` writes atomically (temporary file, then rename) and polls both files about every 2 seconds, so a hand
edit applies without a restart. A broken file is rejected with an error naming the key, and the last good config stays
in use. Code reads settings per request, never at module load, or hot reload would quietly not apply.

## One access check

Links, bundles, pastes and files all have the same controls: blocked, scheduled, expiry, usage limit, quarantine,
password, and for files restricted sharing. `services/contentTypes.js` describes the four types (table, columns,
feature switch), and `services/accessService.js` is the only place that decides whether something can be opened. It
returns one status in a fixed order: blocked, scheduled, expired, limit reached, quarantined, login required or
forbidden, password required, active.

**Why:** Separate checks per type drift apart. Before 1.1.0, a bundle's item links didn't check the bundle's own
access, and before 1.2.0 a demoted admin kept admin rights on links until logging out. With one check (and one
ownership check, `itemPermissions`), a rule is written once and every type gets it.

The admin lists and the dashboard need the same status for thousands of rows in SQL, so `statusSql()` is a SQL version
of the same check. Two versions of one rule can drift, so a test runs both over the same records and requires the same
answer.

## Requests, sessions and CSRF

In order, each request passes through: security headers, health check, static files, branding, the cross-site check,
the session, a redirect to `/setup` while no admin exists, the logged-in user, login-required mode, view variables,
then the routes.

**No CSRF tokens.** `middleware/sameOrigin.js` refuses a changing request (POST, PUT, PATCH, DELETE) unless the browser
says it comes from this site (`Sec-Fetch-Site`, or `Origin` matching `Host`). The session cookie is `SameSite=Lax` on
top of that. Current browsers send these headers, and there's no token to forget in a form or a `fetch`.
A request with neither header (curl, scripts) passes: it can't carry a victim's cookie, so it isn't a CSRF.

**Sessions** are stored in the same SQLite file. Logging in, registering and the first-admin setup start a new session
ID, so an ID someone planted before login never becomes a logged-in session (session fixation).

**Security headers** (`middleware/securityHeaders.js`) on every response: a Content-Security-Policy that runs scripts
only from LinkSnip itself, refuses framing (clickjacking) and blocks plugins, plus `Referrer-Policy`,
`X-Content-Type-Options` and `X-Frame-Options`. Views have no inline scripts (data goes into
`<script type="application/json">`) and a test checks every page. The bio pages are the one exception: they add the
icon CDNs they use. Uploaded files are served with `Content-Security-Policy: sandbox`, so an uploaded HTML file can't
run as LinkSnip. HSTS is set in the Caddyfile, because only the HTTPS proxy knows the site is HTTPS-only.

## Roles and permissions

Roles (`anonymous`, `user`, `trusted`, `unlimited`, plus custom ones) set permissions and limits. Admin is a separate
flag rather than a role: an admin can do everything, whatever their role. Feature switches sit above roles: a
switched-off feature is a 404 for everyone, admins included, so "off" really means off. Teams add a role per team
(owner, admin, member, viewer) for team items, all checked in `services/itemPermissions.js`. Code never compares
`creatorId` by hand.

## Privacy

Analytics store a keyed hash of the visitor's IP (HMAC with `IP_HASH_SECRET`), never the IP itself, so a leaked
database can't be reversed by hashing every IPv4 address (1.1.0; before that it was a plain SHA-256). Countries come
from a local DB-IP file instead of an online lookup, so no visitor IP is sent to a third party. Chat-app preview bots (WhatsApp, Slack, ...) don't count as visits. Chart.js is served by LinkSnip
rather than a CDN. [PRIVACY.md](PRIVACY.md) lists what's kept and for how long.

## Testing

Tests come first: each change starts with tests that fail for the right reason. Jest runs against an in-memory database
and a temporary `DATA_DIR` per test file. `createApp.js` builds the whole app without listening, so integration tests
run the real middleware chain (headers, CSRF check, sessions, setup, login, feature switches) with supertest. Besides
these there are tests that hold the project's rules in place:
every view renders and has no inline scripts, styles or handlers; the config doc matches the schema; the changelog has
an entry for the current version; every built-in palette meets contrast. The browser scripts are tested with jsdom.

## Deploying

A `vX.Y.Z` tag builds and publishes the Docker image (GHCR), then the deploy workflow connects to the server with an
SSH key that can run only one command. That command snapshots the database and settings, starts the new version,
waits up to 60 seconds for `/healthz`, and on failure restores the snapshot and the previous version. Nightly backups
use SQLite's online backup, and a separate script copies them off the server with rclone.

## At 100× the traffic

What I'd change, in order:

1. **Rate limits** are kept in process memory, so they reset on restart and wouldn't be shared between two instances.
   They'd move to a shared store.
2. **Analytics writes**, one row per visit, are the hottest writes. I'd batch them (buffer and insert every second)
   before anything else.
3. **The database.** With more than one app server, SQLite stops fitting, and I'd move to PostgreSQL. The SQL is mostly
   standard, but the synchronous model would become async, which touches every model and the check-then-write
   guarantees above.
4. **Uploads** would move from the local `uploads/` folder to object storage (S3-compatible).

Until then, one container on a small server is the simpler and cheaper answer.

## Bugs that shaped the design

- **Session fixation** (1.3.0): the session ID wasn't replaced at login. Every login path now goes through
  `loginSession.startSession()`.
- **Stored XSS** (1.3.0) on the link info page, bio pages, the audit log and the tag picker: user text reached HTML
  or inline JavaScript. Template values never go into inline handlers now, browser code builds the DOM with
  `textContent`, tests check every view, and the CSP stops a slip from running.
- **Enumerable QR codes** (1.1.0): `/qrcode/:id` let anyone count IDs and read every slug. QR codes now go by slug only, and the
  old addresses were removed rather than redirected (a redirect would reveal the slug).
- **One-time unlock used up too early** (1.5.3): opening a protected file's page used the unlock, so Download sent the
  visitor back to the password page. A file's unlock now lasts until the download.
