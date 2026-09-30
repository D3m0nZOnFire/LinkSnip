# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LinkSnip is a self-hosted URL shortener built with Node.js (22), Express 5 and SQLite (better-sqlite3). Besides short
links it shares text (pastes), files and link bundles, has bio pages, analytics with read-only share links, QR codes,
tags, bulk import/export, role-based permissions and limits, report-driven moderation, and an admin panel with audit
logs. It ships as a Docker image; all state lives in one `DATA_DIR`.

## Development Commands

```bash
npm run dev            # nodemon, http://localhost:8081
npm start              # production-style start
npm test               # jest (in-memory DB, temporary DATA_DIR per test file)
npm run admin          # CLI: create admin / promote user / reset password
npm run docs:config    # regenerate docs/CONFIGURATION.md from config/schema.js
docker compose up -d   # run the image (see docs/DEPLOYMENT.md)
```

- **Tests first**: write the tests, watch them fail for the right reason, then implement.
- All database migrations run automatically on startup. No manual migration steps.
- `app.js` starts the server when required, so tests never load it; `tests/unit/app/appSyntax.test.js` compiles it.

## Configuration: three layers

| Layer | Where | Holds |
|---|---|---|
| Environment | `.env` / container env | Infrastructure only: `SESSION_SECRET` (required), `DATA_DIR`, `PORT` (8081), `NODE_ENV`, `TRUST_PROXY` (1) |
| Settings | `DATA_DIR/settings.json` | Instance behavior: `registration.open`, `geo.enabled`, `features.*`, `moderation.reportThreshold`, `anonymous.*ExpirationDays`, `pastes.maxSizeKB`, `files.globalMaxFileSizeMB`, `retention.*` |
| Roles | `DATA_DIR/roles.json` | Permissions and limits per role |

- **`config/schema.js` is the single source of truth** for every setting, permission and limit, and its
  description. It drives validation, Admin → Settings help text, and `docs/CONFIGURATION.md` (a test fails if that
  file is stale). Add new keys there first.
- **`services/configService.js`** (singleton) merges built-in defaults with the files, validates every key (errors
  name file/key/problem; an invalid file keeps the last good config), writes atomically (temp + rename), and polls both
  files with `fs.watchFile` (~2s) for hot reload. On first start (`load({ seed: true })` in `app.js`) it creates both
  files with every key, carrying over legacy env vars (`ANONYMOUS_URL_EXPIRATION_DAYS`, `MAX_PASTE_SIZE_KB`, …) once.
  Read settings live: `configService.get('pastes.maxSizeKB')`, never cache at module load.
- **`config/paths.js`**: every data path (`DB_PATH`, `UPLOADS_DIR`, `BACKUPS_DIR`, `SETTINGS_PATH`, `ROLES_PATH`)
  derives from `DATA_DIR` (default: project root). `ensureDataDir()` fails with a `chown` hint if it's not writable.
- **`config/env.js`**: `requireSessionSecret()` (the app refuses to start without it or with a public placeholder) and
  `parseTrustProxy()`.

## Roles and permissions

- Built-in roles: `anonymous` (visitors), `user` (default),
  `trusted`, `unlimited`. Defaults in `config/roles.default.json`; `DATA_DIR/roles.json` is deep-merged over them.
  Custom roles start from `user`. `defaultRole` (roles.json) is what NULL/unknown `users.role` resolves to; new
  accounts are stored with `role = NULL`.
- `isAdmin` is a separate flag: admins have every permission and every limit is `null` (unlimited).
- Limits: whole number, `null` = unlimited, `0` = none allowed.
- **`services/roleService.js`**: `getRole(user)`, `can(user, perm)`, `limit(user, name)`, `listRoles()`,
  `isAssignable(name)`. Pass `req.user || null` (null = anonymous).
- **`middleware/requirePermission.js`**: `requirePermission('uploadFiles')`. Denied: pages redirect (`/login` or `/`),
  `/api/` requests always get JSON 401/403 `{ error: 'permission_denied', permission }` (fetch sends `Accept: */*`).
- **`services/permissionGate.js`**: rule for optional features in create/update handlers (password, scheduling,
  tags). Setting a feature the role lacks → 403. Empty values are fine, removing a password is always allowed, and on
  update a value equal to the stored one doesn't count (`tagsChanged()` compares tag sets).
- **Feature switches** (`features.*` in settings.json) sit above roles: `middleware/requireFeature.js` provides
  `featureRoutes(feature, router)` (wraps a whole router in `app.js`) and `requireFeature(feature)` (single routes;
  falls through with `next('route')`). A switched-off feature 404s for everyone, admins included.
- Views get `can.<permission>` (false when its feature is off), `features.<name>`, `canUploadFiles` and
  `registrationOpen` from a middleware in `app.js`. Use `locals.can` in partials that may render without it.
- Users table: `role` (NULL = default). The legacy `tier` column is left in old databases but never read.

## Request flow

1. `express.static`, then `GET /healthz` (`SELECT 1`, before sessions)
2. Sessions (SQLite store, 7 days, cookie `secure: 'auto'`)
3. `requireSetupComplete`: while no admin exists every page redirects to `/setup` (API: 503 `setup_required`)
4. `attachUser` (sets `req.user`, updates `lastActive`), then the view-locals middleware (`can`, `features`)
5. Routers (feature routers wrapped in `featureRoutes`), then the home routes, 404 and error handlers

## First admin and the admin CLI

- **`services/setupService.js`**: while no admin exists, `start()` (called after `listen`) logs a one-time code
  (Crockford base32, `XXXX-XXXX-XXXX`). `/setup` (`routes/setupRoutes.js`, `views/setup.ejs`) takes the code, a
  username and a password (min 8) and creates the admin in a transaction that re-checks for an existing admin. After
  that `/setup` is a 404 for good; a restored backup with an admin never shows it.
- **`npm run admin`** (`scripts/admin.js`, logic in `services/adminCommands.js`): `create`, `promote`, `reset`,
  interactive or with arguments, works with piped input (`docker compose exec`). Audit-logged with `via: 'cli'`.

## Database

- `config/database.js` opens `DB_PATH`, applies `config/dbSetup.js` (WAL, `busy_timeout = 5000`, foreign keys), and
  runs all migrations. Migrations that need tests live in `config/migrations.js` (`migrateUserRoles`,
  `migrateAnalyticsShareLinks`, `migrateQuarantine`, `migrateDropNotifications`, `migrateReports`); they're idempotent
  and also build the matching tables in `tests/setup/testDatabase.js`. Everything else is mirrored by hand there.
- **Synchronous API**: `db.prepare(sql).get/all/run()`; only bcrypt is async.
- Migration pattern: `CREATE TABLE IF NOT EXISTS`, check `PRAGMA table_info` before `ALTER TABLE`,
  `CREATE INDEX IF NOT EXISTS`.
- Backups: `ScheduledTasks.backupDatabase()` uses `db.backup()` (consistent online copy) into `BACKUPS_DIR`, 30-day
  retention. It's async; callers await it or `.catch()` it.

### Key tables

- **users**: `isAdmin`, `isBanned`, `role`, `email`, `lastActive`
- **urls**: `slug`, `longUrl`, `creatorId` (→ users, SET NULL), `clicks`, `maxUses`, `expiresAt`, `activateAt`,
  `deactivateAt` (datetime-local + `:00.000Z`, no timezone conversion), `password` (bcrypt), `isBlocked`, `isQuarantined`
- **pastes**, **files**, **bundles** (+ `bundle_items`): same access fields as urls, `isQuarantined` included.
  Pastes use `userId`/`views`/`maxViews`, files `userId`/`downloads`/`maxDownloads`/`size`/`sharingMode`/
  `allowedUsers`
- **analytics**, **bundle_analytics**, **bundle_item_analytics**, **paste_analytics**: per-visit rows (`ipHash`
  SHA-256, never raw IPs)
- **tags** (user-scoped, lowercase) with `url_tags`, `paste_tags`, `file_tags`
- **reports** (every type): `targetType` + `targetId`, `reporterIpHash`, `reason`, `description`, `status` (`pending` /
  `reviewed` / `blocked` / `dismissed`), `reviewedBy`. A unique index allows one report per IP per item; triggers
  delete an item's reports when the item is deleted (no foreign key can point at four tables). Only **pending**
  reports are counted. (Replaced `url_reports` / `bundle_reports` in `migrateReports`.)
- **analytics_shares**: share links: `urlId`, `createdBy`, `tokenHash` (SHA-256, unique), `label`, `expiresAt`,
  `viewCount`, `lastViewedAt`
- **audit_logs**: append-only; `action`, `category` (`AUTH`, `ADMIN_ACTION`, `ACCOUNT_CHANGE`, `SECURITY`), target,
  IP, user agent, JSON `details`

## Features

### Access checks (every content type)
- `services/contentTypes.js`: registry of the types sharing the short-link machinery (`url`, `bundle`, `paste`,
  `file`): table, owner/used/limit columns, feature switch, quarantine/restricted/alwaysRemember flags, public/info
  paths. Shared services take a type name and look the rest up here.
- `services/accessService.js` is the one access check. Statuses in order: `blocked` → `scheduled` → `expired` →
  `limit_reached` → `quarantined` → `login_required` / `forbidden` (restricted files) → `password_required` → `active`.
  - Public routes: `checkAccess(req, type, record)` (reads the user, session unlocks and `?confirmed=1`), then
    `sendAccessDenied(req, res, type, record, result)`: blocked/forbidden 403, scheduled 404 (`views/scheduled.ejs`),
    expired/limit_reached 410, quarantined → `views/quarantine.ejs`, password → `/unlock/:type/:slug`,
    login_required → `/login?next=…`. Unlock pages call `sendIfUnavailable()` first.
  - `recordStatus(type, record)` is the record-only part (first five statuses); info pages and the bio page use it with
    `isLive(status)`. `statusSql(type)` computes the same in SQL for list filters; a test keeps the two identical.
  - List pages attach `accessStatus` with `withAccessStatus(type, rows)`; templates show it via
    `partials/status-badge.ejs`. Never recompute a status in a template.
  - Dates without a timezone are UTC (as SQLite reads them); SQL compares with `julianday()`.

### Password unlock (every content type)
- One page and route: `GET/POST /unlock/:type/:slug` (`controllers/unlockController.js`, `routes/unlockRoutes.js`,
  `views/unlock.ejs`). The old `/unlock/:slug`, `/unlock-bundle|paste|file/:slug` answer 308 to the new address.
- Session (`services/unlockService.js`): `session.unlocked[type]` (remembered IDs) and `session.unlockOnce`
  (`{ type, id }`, used up by the next visit). "Remember" is a checkbox, except bundles (`alwaysRemember`): their
  item links (`/bt/:itemId`) need the unlock to last.
- A wrong password answers **401**: the limiter counts only failed attempts (10 per visitor and item, 30 per visitor,
  15 min), separate from the login limiter. A lockout shows the unlock page (429) and logs one `UNLOCK_LOCKOUT`.

### Short links
- `POST /create` (form), `GET /s/:slug` redirect with analytics, `/info/:slug` public preview.
- Admin filter (`?status=`, `@status:`): active, blocked, expired, scheduled, max-uses (= `limit_reached`),
  quarantined, plus anonymous and password-protected.
- Anonymous links always expire within `anonymous.urlExpirationDays`; expired anonymous content is deleted nightly
  (4:00), registered users' after `retention.expiredGraceDays` (the "Deletes in Nd" badge on links and pastes:
  `services/retentionService.js` `deletesInDays`, shown by `partials/deletion-badge.ejs`).
- URL prefill: `/https://example.com` prefills the creation form.

### Pastes
- `/p/:slug`, `/p/:slug/raw`, `/p-info/:slug`, editor `/pastes/:id/edit`, analytics `/pastes/:id/analytics`,
  API `/api/pastes`. Model `models/Paste.js`, controller `controllers/pasteController.js`.
- EJS-escaped plain text (`<%= %>`, never `<%-`), `language` is only a label. Line-number gutters via
  `public/js/lineNumbers.js` on textareas with `data-line-numbers`.
- Size limit `pastes.maxSizeKB`; anonymous expiry `anonymous.pasteExpirationDays`.

### Files
- Upload `POST /api/files/upload` (permission `uploadFiles`, `uploadLimiter`), preview `/f/:slug`, download
  `/f/:slug/download`.
- `middleware/fileUpload.js` builds multer per request: byte limit = min(role `maxFileSizeMB` capped by
  `files.globalMaxFileSizeMB`, remaining `storageQuotaMB`). Oversized uploads are cut off while streaming (413);
  `unlimited`/admins bypass both.
- All `/f/*` responses send `X-Content-Type-Options: nosniff`; downloads also `Content-Security-Policy: sandbox`
  and are always attachments. Any file type is allowed.
- Admin → Files can block/unblock (blocked → 403).
- `sharingMode: 'restricted'` + `allowedUsers`: only the owner, listed users and admins (the `login_required` /
  `forbidden` access statuses).

### Bundles and bio pages
- Bundles: `/b/:slug` launcher, `/bt/:itemId` per-item tracking redirect, `/bundle-analytics/:id`.
- Bio pages: `/bio/:username` public, `/bio/settings`. Hidden (404) when the owner's role lacks `bioPage`.

### Analytics and share links
- `/analytics/:id` is owner/admin only (permission `analytics`). `AnalyticsController.buildSummary(url)` is shared
  with the public view.
- Share links (`controllers/analyticsShareController.js`): `POST/GET /api/urls/:id/share-links`,
  `DELETE /api/share-links/:id`, public `GET /stats/:token` (read-only `analytics.ejs` with `readOnly: true`,
  `noindex`). The token is shown once; only its hash is stored. Limited by `shareLinksPerUrl`. Admin → Analytics Shares.
- Country lookup uses ip-api.com unless `geo.enabled` is false.

### Reports and quarantine
- Every type is reportable: `POST /api/reports` `{ type, id, reason, description }` (`controllers/reportController.js`,
  model `models/Report.js`). Only live items (`isLive`), the type's feature must be on, one report per IP. Owners may
  report their own items. Pages add a button and `partials/report-modal.ejs` (`{ type, id, noun }`; the reasons come
  from `app.locals.reportReasons`).
- `services/moderationService.js`: after a report, `afterReport(type, id, req)` quarantines the item once
  its pending reports reach `moderation.reportThreshold` (0 = off). Owners who are admins or whose role has
  `skipAutoModeration` are exempt. `setBlockedFromReport` and `banOwnerFromReport` back the per-report admin
  actions; banning blocks everything the owner has (links, bundles, pastes, files).
- Quarantined items show visitors `views/quarantine.ejs` first (the `quarantined` access status); "Continue anyway"
  (`?confirmed=1`) is remembered in `req.session.quarantineAck`. The warning comes before the password prompt.
- Admin → Reports (`?type=all|url|bundle|paste|file&status=…`) lists quarantined items on top.
  `POST /api/admin/moderation/:type/:id/block` (hard block, reports → `blocked`) or `/clear` (reports → `dismissed`,
  warning lifted). Per report: `PUT /api/admin/reports/:id` (`{ action: 'block'|'unblock' }` or `{ status }`),
  `DELETE /api/admin/reports/:id`, `POST /api/admin/reports/:id/ban-user`.

### Rate limiting (`middleware/rateLimiter.js`)
- Creation limits come from the role and are read per request: `createRoleLimiter(limitName, { prefix, noun })` →
  `createUrlLimiter` (urlsPerHour), `createPasteLimiter`, `createBundleLimiter`, `bulkImportLimiter` (importsPerHour),
  `uploadLimiter`. Keyed per user ID, or per IP for visitors. `null` skips the limiter.
- Fixed infrastructure limiters: `redirectLimiter` (1000/15 min per IP), `authLimiter` (10/15 min, failed attempts
  only; also used for `/setup`), `apiLimiter` (200/15 min, admins skip), `createUnlockLimiter()` (see Password unlock).

### Admin
- `/admin` (links), `/admin/users` (role filter/select, **Create user** → `POST /api/admin/users`), `/admin/files`,
  `/admin/pastes`, `/admin/reports`, `/admin/analytics`, `/admin/analytics-shares`, `/admin/audit-logs` (also manual
  backup/cleanup), `/admin/settings` (form from the schema plus read-only role grids; `PUT /api/admin/settings`
  validates, writes and logs `UPDATE_SETTINGS` with the diff).

### Audit logging (`services/auditService.js`)
- `logAuth`, `logAdminAction`, `logAccountChange`, `logSecurity`. Add new action names to `ACTIONS`.
- Recent ones: `CREATE_USER`, `SETUP_ADMIN`, `UPDATE_SETTINGS`, `CREATE_SHARE_LINK`, `REVOKE_SHARE_LINK`, `BLOCK_FILE`,
  `UNBLOCK_FILE`, `QUARANTINE_URL` / `_BUNDLE` / `_PASTE` / `_FILE`, `CLEAR_QUARANTINE`, `UNLOCK_LOCKOUT`,
  `MIGRATE_REPORTS` (old → new bundle report IDs).

### Scheduled tasks (`services/scheduledTasks.js`, node-cron)
2:00 audit log cleanup (`retention.auditLogDays`) · 3:00 backup · 4:00 inactive content cleanup · 5:00 expired
share links · 5:30 expired files.

## Docker

- `Dockerfile`: multi-stage `node:22-bookworm-slim`, build tools only in the build stage, runs as `node` (uid 1000),
  `DATA_DIR=/data`, `HEALTHCHECK` on `/healthz`. Code is root-owned; only `/data` is writable.
- `docker-compose.yml`: `./data:/data`, `127.0.0.1:8081`, `restart: unless-stopped`; optional `caddy` profile with
  `docker/Caddyfile` and `DOMAIN`.
- CI (`.github/workflows/ci.yml`): tests + image smoke test. `pr-status.yml` + `.github/scripts/prStatus.js` label PRs
  (`work-in-progress` / `ready-to-test` / `needs-fixes`). `docker-publish.yml` pushes to GHCR on `vX.Y.Z` tags.

## UI patterns

- Every page includes `partials/header` (`<%- include('partials/header', { currentPage: '...' }) %>`, except
  standalone pages like login/setup/error) and **every** page includes `partials/footer` (a test checks this).
- `currentPage` values: 'home', 'dashboard', 'tags', 'settings', 'admin', 'admin-users', 'admin-analytics',
  'admin-reports', 'admin-audit-logs', 'admin-files', 'admin-pastes', 'admin-analytics-shares', 'admin-settings',
  'analytics', 'info'.
- `views/error.ejs` takes `{ title, message, code }` (it also tolerates `statusCode` / `error.status`).
- Modals: `public/css/modals.css`, `openModal(id)` / `closeModal(id)` in `public/js/main.js`; `showToast`,
  `apiRequest`, `setButtonLoading` there too.
- Password inputs with `data-toggle-password` get an eye toggle. Dark theme variables in `public/css/main.css`
  (`--primary: #34d399`). Dark buttons need light text (`var(--foreground)`), light buttons dark text
  (`var(--primary-foreground)`).
- Permission handling redirects rather than showing error pages (non-admin on admin routes → `/`).

## Common gotchas

1. better-sqlite3 is synchronous; don't `await` queries.
2. Specific routes before parameterized ones (e.g. `/api/analytics/top` before `/api/analytics/:id`,
   `/p/:slug/raw` before `/p/:slug`).
3. Routers are mounted at `/`: a `router.use()` without a path runs for every request passing through.
   Use `router.use('/f', …)` or per-route middleware.
4. Never read settings or roles at module load; call `configService` / `RoleService` per request.
5. `req.user` can be null (anonymous). Pass `req.user || null` to `RoleService`.
6. Only pending reports count toward quarantine and the report badges. Reports have no foreign key to their item;
   the `trg_reports_delete_*` triggers clean them up. A new reportable table needs its own trigger.
7. Analytics privacy: only `ipHash`, never raw IPs (audit logs are the exception, for security auditing).
8. CSV import uses `;` between tags, since `,` separates columns.
9. Tests stub `res.render`, so a template that crashes at render time only shows up in a real run. Smoke-test pages
   you change.
10. Use Node 22: better-sqlite3 is a native module and may not build on newer Node versions.
11. Don't check blocked/expiry/limits by hand, in JS, SQL or a template: use `accessService` (`checkAccess`,
    `recordStatus`, `statusSql`, `withAccessStatus`). Owners and admins get no bypass on public routes.

- Always kill what you are running. I want to run the service on my own
