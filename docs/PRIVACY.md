# Privacy

What a LinkSnip instance stores about the people who use it and visit it, why, for how long, and which settings
keep less. It's written for the people who run an instance. It can help with a privacy or GDPR review, but it isn't
legal advice: what you have to tell your users depends on where you are and what you use LinkSnip for.

Everything lives in one place, `DATA_DIR` (the database, uploads, settings, backups). LinkSnip sends nothing about your
users or visitors anywhere: there is no telemetry, no analytics service and no update check.

## What is stored

| Data | What | Why | How long |
|---|---|---|---|
| **Accounts** | Username, e-mail address (optional), password (bcrypt hash), role, sign-up date, last activity | Logging in, permissions and limits | Until the account is deleted |
| **Content** | Links, pastes, uploaded files (with their original file names), bundles, bio pages, tags, teams | What users share | Until it's deleted, or it expires (see below) |
| **Sessions** | A session ID in a cookie (`connect.sid`, HttpOnly, SameSite=Lax); in the database: who is logged in, which password-protected items were unlocked | Staying logged in | 7 days after the last visit |
| **Visits (analytics)** | Per visit of a link, bundle, paste or file: time, a keyed hash of the IP address, referrer, user agent (browser, OS and device read from it), country | Analytics for the item's owner | Forever, unless `retention.analyticsDays` is set; deleted with the item |
| **Reports** | Reason, the reporter's description, a keyed hash of the reporter's IP (one report per IP and item) | Moderation | Until an admin deletes it, or the item is deleted |
| **Audit log** | Security and admin events (logins, failed logins, admin actions, setting changes) with the **IP address in plain text** and the user agent | Finding out who did what after an incident | `retention.auditLogDays` (90 days by default) |
| **Rate limits** | Request counts per IP address or user | Stopping abuse and password guessing | In memory only, 15 minutes to 1 hour; gone on restart |
| **Backups** | A full copy of the database every night (`DATA_DIR/backups`) | Recovery | 30 days |

**IP addresses.** Outside the audit log, IPs are never stored. Visits and reports keep
HMAC(`IP_HASH_SECRET`, SHA-256(IP)): enough to count unique visitors and allow one report per person, but a copy of
the database can't be turned back into addresses without the secret, which lives in `.env`, not in the database or
the backups. The audit log keeps real addresses on purpose, to investigate break-ins.

**Countries** are looked up on the server in a local copy of the DB-IP Lite database. The visitor's IP isn't sent
anywhere; only the monthly download of that file contacts db-ip.com, and it carries no visitor data.

## What visitors' browsers load from elsewhere

Every page, font and script comes from your instance, except on **bio pages** (`/bio/…` and its settings page): their
icons come from unpkg.com (Ionicons) and cdn.jsdelivr.net (dashboard icons), and the settings page also asks
api.github.com for the list of icons. Those servers see the visitor's IP address and the page they came from. Turn bio pages off
(`features.bioPages`) if that matters to you.

## Keeping less

| Setting (Admin → Settings) | Effect |
|---|---|
| `features.analytics` off | No visits are recorded and no country database is downloaded. Analytics pages, share links and tag analytics disappear. Visits already recorded stay (and come back if you switch it on again) until `retention.analyticsDays` deletes them. Clicks, views and downloads still count, for usage limits. |
| `geo.enabled` off | Visits are recorded without a country. |
| `retention.analyticsDays` | Deletes visits older than this, every night. |
| `retention.auditLogDays` | Deletes audit entries older than this, every night. |
| `retention.expiredGraceDays` | How long an expired link or paste of a registered user is kept before it's deleted. |
| `anonymous.urlExpirationDays`, `anonymous.pasteExpirationDays` | Content made without an account always expires and is deleted. |
| `features.reports` off | Nobody can report anything, so no reporter hashes are stored. |

Off-site copies of the backups (for example `docker/backup/linksnip-backup`) are yours to configure, and their
retention is yours too.

## Deleting data

- **A user** deletes their account in Settings → Delete account. That removes their personal links, bundles, pastes,
  files (the uploads too), tags and bio page, and with the items their visits, share links and reports. Items in a
  team stay with the team, without a creator.
- **An admin** can delete any account (Admin → Users) or item (Admin → Items).
- **Not deleted with the account:** audit log entries (they expire with `retention.auditLogDays`) and the nightly
  backups (30 days).
