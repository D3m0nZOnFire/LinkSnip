# Changelog

Every release of LinkSnip, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html): a new major version (2.0.0) is the
only one that may need more than "pull and restart", and its Upgrading section says what.

## [1.8.0] - 2026-10-29

### Upgrading

- `docker compose pull && docker compose up -d`. The database is updated on the first start.
- Files shared with "Only the people listed below" become **private**: only the owner, the file's team and admins can
  open them. The people on those lists lose access; the log names the files that had any (`… were shared with other
  people`). Move such a file into a team to share it with several people.

### Added

- **Private items**: links, pastes, bundles and files can be made private, on the create page (the Public / Private
  chip) or in their edit form. A private item opens only for people who see it in their dashboard: the owner, the
  members of its team, and admins. No password to type: a visitor who isn't logged in is sent to the login page and
  comes back, and anyone else gets the same "page not found" as an address that doesn't exist. Its info page, QR code,
  unlock page and item clicks follow the same rule; private links stay off the bio page and get no chat preview.
- Admin → Items and the dashboard show a "Private" badge; `@private` (or the "Private" status) lists them.
- Bulk import and export carry it: an `isPrivate` column (CSV and text, `yes` / `no`) or field (JSON) on import, and a
  `Private` column (CSV) or `isPrivate` field (JSON) in exports. The CSV template has the column.

### Changed

- Unknown slugs on public pages (`/s/…`, `/b/…`, `/p/…`, `/f/…`, `/info/…`, `/p-info/…`, `/unlock/…`, `/bt/…`) get
  the site's 404 page, so a private item and a missing one look the same.

### Removed

- The files' per-person sharing list ("Only the people listed below") and the username lookup behind it
  (`/api/users/lookup`), replaced by private items for every type.

## [1.7.2] - 2026-10-22

### Upgrading

- `docker compose pull && docker compose up -d`. Nothing else to do.

### Fixed

- File names in the address (`/xmlrpc.php`, `/wp-login.php`, `/index.html`, …) get the 404 page. They were taken for a
  link typed without `https://` and opened the create page with a 200, so scanners probing for WordPress or PHP seemed
  to find something.

## [1.7.1] - 2026-10-18

### Upgrading

- `docker compose pull && docker compose up -d`. Nothing else to do.

### Added

- **`/abuse`**: a short link to hand out for abuse reports. It redirects to the "Reporting abuse" section of `/terms`
  (`/terms#abuse`), and is open on a private instance too.

## [1.7.0] - 2026-10-17

### Upgrading

- `docker compose pull && docker compose up -d`. Then set **`legal.contact`** (Admin → Settings → General) to where
  abuse reports and privacy requests should go; until then the new pages say to contact the administrator.
- The image no longer contains npm. The admin tool is now
  `docker compose exec linksnip node scripts/admin.js` (it was `... npm run admin`).

### Added

- **`/privacy` and `/terms`** for your users and visitors, linked from every footer and the register page, and open on
  a private instance too. Built from your live settings (analytics, countries, retention, expiry of anonymous content,
  bio page icons, reports). New setting `legal.contact`: an e-mail address or an `https://` page, shown on both.
- Admin → Settings shows text settings as text fields.

### Changed

- `createApp.js` builds the app; `app.js` only starts it. Integration tests run the real middleware chain.
- `docker-compose.yml` pins Caddy to 2.11.7 (Dependabot proposes updates).
- dotenv 18.0.8.

### Security

- The image installs Debian's security updates (perl had critical fixes) and drops npm, whose bundled packages had
  known vulnerabilities.
- Fixes from the first CodeQL scan:
  - Logo and favicon uploads: an SVG with many comments could freeze the server while its type was checked.
  - A content type taken from the address or the request (unlock, QR codes, analytics, reports, admin actions) is
    only looked up among the real ones: names like `constructor` crashed with a 500 instead of a 404.
  - Changing your username or password and deleting your account check the current password: wrong guesses now
    count like failed logins (10 per 15 minutes).
  - A ceiling of 1000 requests per 5 minutes per address for everything except the health check and static files.
  - Random slugs come from `crypto` (`Math.random` can be predicted from earlier slugs).
  - Stored upload names keep only plain extensions (letters and digits).
- GitHub Actions are pinned to commit SHAs. Published images carry an SBOM and provenance, and CI scans the image
  with Trivy (fixable critical and high vulnerabilities fail the build).

## [1.6.0] - 2026-10-17

### Upgrading

- `docker compose pull && docker compose up -d`. With the bundled Caddy, HSTS is now on: browsers will refuse plain
  HTTP for your domain for a year. Behind your own proxy, add `Strict-Transport-Security: max-age=31536000` there once
  HTTPS works.

### Security

- Every page sends a Content-Security-Policy: scripts only from LinkSnip itself (the bio page also allows the icon
  CDNs it uses), no framing by other sites, no plugins. Plus `X-Frame-Options`, `Referrer-Policy` and
  `X-Content-Type-Options` everywhere, and no `X-Powered-By`.
- The team invite banner's script moved out of the page into `/js/team-invites.js`.

### Added

- `docs/ARCHITECTURE.md`: the design decisions and their trade-offs. The README says how LinkSnip was built with AI.

## [1.5.4] - 2026-10-17

### Upgrading

- `docker compose pull && docker compose up -d`. Nothing else to do.

### Changed

- Dependency updates: ejs 7 (the templates needed no change), Express 5.3, dotenv 18.0.7, express-rate-limit 8.7.1,
  smol-toml 1.9.1.

## [1.5.3] - 2026-10-12

### Upgrading

- `docker compose pull && docker compose up -d`. Nothing else to do.

### Fixed

- **Password-protected files download again without "Remember".** Unlocking a file without ticking "Remember" sent the
  visitor back to the password page when they clicked Download: opening the file's page used up the one-time unlock
  before the download. The file's page now leaves it for the download.

### Changed

- Dependency updates: Chart.js 4.5, dotenv 18.0.5, supertest 7.3.1.

## [1.5.2] - 2026-10-06

### Upgrading

- `docker compose pull && docker compose up -d`. Nothing else to do.

### Security

- **proxy-addr 2.0.8** (fixes CVE-2026-90711). It is the library Express uses to read the visitor's address behind a
  reverse proxy (`TRUST_PROXY`), which rate limits, analytics IP hashes and the audit log rely on.

## [1.5.1] - 2026-10-06

### Upgrading

- `docker compose pull && docker compose up -d`. Nothing else to do.

### Fixed

- **Sharing a link in a chat app no longer counts as a visit.** WhatsApp, Telegram, Slack, Discord, iMessage and
  other apps fetch a link once to build its preview. That fetch counted a click, view or download, recorded an
  analytics event and used up the usage limit: a paste limited to one view was gone before the recipient opened it.
  Now it counts nothing, gets no paste content (a download link sends it to the file's page), and the page it gets
  has no logo or favicon, so the preview no longer shows the site's icon as a big picture.

### Changed

- **Link previews describe what was shared**: a paste, file, bundle, link info page or bio page shared in a chat app
  shows a text card with its title and what it is ("Paste · 42 lines · markdown", "File · 2.5 MB",
  "Bundle · 3 links · …", "Short link to example.com", the bio), never its content. Password-protected, restricted,
  reported or unavailable items show only the site's name and tagline.

## [1.5.0] - 2026-10-05

### Upgrading

- `docker compose pull && docker compose up -d`. Nothing else to do.

### Added

- **Open button** after creating something: next to Copy, it opens the new item in a new tab. A link opens its info
  page (`/info/…`), a paste, bundle or file its own page. Opening a bundle launches its links, and like any visit it
  counts toward the item's analytics and usage limit.
- **Filter the dashboard by several tags**: tick any number of tags and choose **Any** (items with one of them) or
  **All** (items with every one). Each tag shows its color and how many items carry it, and a field filters the list.
  The address keeps the choice (`?tag=work&tag=travel&match=all`); old `?tag=work` links still work.

### Changed

- **Every dropdown is new**: styled lists with a check on the chosen option, keyboard support (arrows, Enter, Escape,
  typing to jump) and the same look in light and dark, on phones too.

## [1.4.1] - 2026-10-05

### Upgrading

- `docker compose pull && docker compose up -d`. The first start adds a case-insensitive slug index to each content
  table. If two items of one type have slugs that differ only in case (`Promo` and `promo`), the log names them and
  that table goes without the index until all but one are renamed; new look-alikes are refused either way.
- New role permission `customSlugs`: on for `user`, `trusted` and `unlimited`, **off for visitors** (`anonymous`).
  Visitors could choose a link's slug before; to keep that, switch it on for Anonymous in Admin → Settings → Roles.

### Added

- **Choose the short link of every type**: links, bundles, pastes and files get a "Short link" field on the create
  page and in their edit forms (dashboard, paste editor). Changing it is logged (`CHANGE_SLUG`). The old address
  and its QR code stop working.
- Bulk import of slugs needs `customSlugs` too.

### Changed

- Slugs ignore case: `/s/Promo` and `/s/promo` are the same link. Each type has its own slugs, so `/s/thing` and
  `/b/thing` can both exist.

## [1.4.0] - 2026-10-03

### Upgrading

- `docker compose pull && docker compose up -d` (or `git pull && docker compose up -d --build`). No database changes.
- `docker-compose.yml` now uses the image `ghcr.io/d3m0nzonfire/linksnip:1` instead of `:latest`: `docker compose pull`
  brings every 1.x release, never a 2.0. To stay on one version, set `LINKSNIP_VERSION=1.4.0` (or `1.4`) in `.env`.
- Behind your own reverse proxy, keep the original `Host` header (nginx: `proxy_set_header Host $host;`; Caddy does
  this by default). Otherwise older browsers and plain-http setups get "Request Refused" (403) when they send a form.
- Log out is now a button that sends a POST. A bookmark or link to `/logout` shows a "Log out?" page instead of
  logging out straight away.

### Added

- **Private instance:** `access.loginRequired`. Visitors only see the login page; every short link, paste, file,
  bundle, info page, QR code, bio page and analytics share link needs an account. Recipe in
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- **Analytics can be switched off:** `features.analytics`. Nothing new is recorded, no country database is downloaded,
  and analytics pages, share links and tag analytics are gone. Visits already recorded are kept until
  `retention.analyticsDays` removes them; clicks, views and downloads still count for usage limits.
- [docs/PRIVACY.md](docs/PRIVACY.md): what an instance stores about users and visitors, for how long, and which
  settings keep less.
- This changelog. The image is also tagged `:1.4` and `:1`.

### Security

- Cross-site request forgery: every POST, PUT, PATCH and DELETE must come from a page on your instance (checked with
  the browser's `Sec-Fetch-Site` header, or `Origin` against `Host`); others get 403.
- The session cookie is `SameSite=Lax`.
- Logging out needs a POST, so another site can't log anyone out.

## [1.3.0] - 2026-10-03

A redesign: a calmer look on every page, a sidebar for signed-in work, a separate admin mode with an overview, and
your own name, logo and colors.

### Upgrading

- Nothing by hand. The first start updates the database (the `files` table is rebuilt so a file's owner can be
  removed; bio page links get a label column). Keep the nightly backup from before the update.
- If you use `docker/backup/linksnip-backup`, install the new version: it also copies `data/branding/` and
  `data/palettes/`.

### Added

- **Admin → Appearance:** site name, tagline, logo, favicon, and a dark and a light palette (built-in ones inspired by
  [Omarchy](https://github.com/omacom/omarchy), or your own in the editor or as `colors.toml` in `data/palettes/`).
- **Admin mode:** an Overview, and Admin → Items with every link, bundle, paste and file in one list, search
  shortcuts (`@user:alice`, `@status:expired`, `@uses:>100`, `|` for or) and bulk block/unblock/delete.
- Labels for links on bio pages (without one, the destination's domain shows).
- Typing `yoursite/https://example.com/…` opens the create page with the link filled in.

### Changed

- Geist fonts and Chart.js are served by LinkSnip: no page loads a font or script from a CDN (bio page icons aside).
- Light and dark mode, following the device, with a toggle. Every page works at 320 px and meets WCAG AA contrast.
- A sidebar for signed-in pages (a drawer on phones); one create page for links, text, bundles and files; one
  dashboard list with live search, type pills, tags and sort.
- Login returns to the page that asked for it. Passwords need at least 8 characters everywhere (existing shorter
  ones keep working). Deleting an account deletes its personal items; team items stay with the team.
- Audit log times in your own time zone, with real category counts; logins name the account.

### Security

- Logging in, registering and the first-admin setup start a new session (session fixation).
- Fixed stored cross-site scripting on the link info page, bio pages (social icon names), Admin → Audit logs and the
  tag picker.

## [1.2.0] - 2026-10-01

Teams, a roles editor in the admin panel, and every page usable on a phone.

### Upgrading

- Nothing by hand. The first start adds the team tables and columns. Keep the nightly backup from before the update.

### Added

- **Teams:** owners, admins, members and viewers manage the same links, bundles, pastes and files. Invites by
  username, a Personal / team switcher on the dashboard, tags per team, moving items in and out. Creating teams needs
  the new `createTeams` permission; `features.teams` switches it all off. Admin → Teams lists every team.
- **Roles editor** in Admin → Settings → Roles: permissions, limits, names, the default role; add, reset and delete
  roles. A hand edit of `roles.json` while the page is open blocks saving until you reload.

### Changed

- Header links fold into a menu below 1024 px; no page scrolls sideways; dashboard filters wrap.
- Ownership checks live in one place. A demoted admin no longer keeps admin rights on links until logging out.

### Fixed

- Role names `constructor` and `__proto__` in `roles.json` are refused instead of breaking the file.

## [1.1.0] - 2026-09-30

Links, bundles, pastes and files work the same way everywhere, and visitor data is handled more carefully.

### Upgrading

- **Action required:** add `IP_HASH_SECRET` to `.env` before updating, or the container won't start:
  `echo "IP_HASH_SECRET=$(openssl rand -hex 32)" >> .env`. Keep it: with another one, unique-visitor counts start
  over. The first start migrates the database (one-way; keep the nightly backup).

### Added

- Analytics, share links, tags, QR codes, password unlock, reports and quarantine for every type, and admin block,
  unblock and delete (also in bulk) for every type.
- `retention.analyticsDays`: delete visits older than this many days, nightly.

### Changed

- Item settings (expiry, schedule, usage limit, password) are read the same way on create and edit; edits no longer
  drop settings they don't send. Two users can use the same tag name.

### Security

- Visitor IPs are stored as hashes keyed with `IP_HASH_SECRET` (plain SHA-256 before; existing hashes are converted).
- Countries come from a local DB-IP Lite database instead of ip-api.com, so no visitor IP leaves the server.
- QR codes are found by slug only: the old `/qrcode/:id` addresses let anyone list every slug.
- The visitor IP follows `TRUST_PROXY` instead of a client-written `X-Forwarded-For`.
- Banned users are logged out right away; a bundle's item links check the bundle's own access.

## [1.0.0] - 2026-09-29

The first public release: a self-hosted URL shortener that also shares text, files and groups of links, in one
Docker container with SQLite and one data folder.

### Added

- Short links with custom slugs, expiry, click limits, passwords and activation/deactivation times.
- Pastes (`/p/…`), files (`/f/…`), bundles and bio pages.
- Analytics with read-only share links; visitor IPs stored only as hashes.
- Roles (`anonymous`, `user`, `trusted`, `unlimited`, or your own) in `roles.json`; settings in the UI or
  `settings.json`, applied without a restart, with feature switches.
- A first-run setup page with a one-time code, and `npm run admin` for admins from the command line.
- Reports and quarantine; nightly online backups, `/healthz`, a non-root container, optional HTTPS with Caddy.

[1.8.0]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.7.2...v1.8.0
[1.7.2]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.5.4...v1.6.0
[1.5.4]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/D3m0nZOnFire/LinkSnip/releases/tag/v1.0.0
