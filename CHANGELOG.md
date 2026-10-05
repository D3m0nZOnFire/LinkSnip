# Changelog

Every release of LinkSnip, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html): a new major version (2.0.0) is the
only one that may need more than "pull and restart", and its Upgrading section says what.

## [1.4.2] - 2026-10-05

### Upgrading

- `docker compose pull && docker compose up -d`. Nothing else to do.

### Added

- **Open button** after creating something: next to Copy, it opens the new item in a new tab. A link opens its info
  page (`/info/…`), a paste, bundle or file its own page. Opening a bundle launches its links, and like any visit it
  counts toward the item's analytics and usage limit.

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

[1.4.2]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/D3m0nZOnFire/LinkSnip/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/D3m0nZOnFire/LinkSnip/releases/tag/v1.0.0
