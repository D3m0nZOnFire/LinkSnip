# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**[Report a vulnerability](https://github.com/D3m0nZOnFire/LinkSnip/security/advisories/new)**
(repository → Security → Report a vulnerability).

Don't open a public issue or pull request for a security problem until a fix is released.

Include what you found, how to reproduce it, the version or commit you tested, and the impact you expect.
You'll get a reply as soon as possible. Once a fix is released, you'll be credited in the advisory unless you'd rather not be.

## Supported versions

Only the latest release gets security fixes. Update with `git pull && docker compose up -d --build`.

## Scope

In scope: the LinkSnip application and the Docker setup in this repository.

Out of scope:

- Content that users link to, paste or upload. Use the report button on a link, or an admin can block it.
- Instances that are misconfigured, for example running without HTTPS or with `TRUST_PROXY` set wrong.
- Denial of service through sheer request volume.

## Hardening notes for operators

- Keep `SESSION_SECRET` and `IP_HASH_SECRET` secret and unique per instance. LinkSnip refuses to start with the example
  values. Visitor IPs are stored only as hashes keyed with `IP_HASH_SECRET`, which is not in the database, so a copy of
  the database or a backup can't be matched against IP addresses. Keep the secret with your `.env`, not with the backups.
- Put LinkSnip behind HTTPS (the bundled Caddy does this). The published port is bound to `127.0.0.1` on purpose.
- Cross-site request forgery: every POST, PUT, PATCH and DELETE must come from a page on your instance. LinkSnip reads
  the browser's `Sec-Fetch-Site` header, or without it compares `Origin` with the `Host` header, and refuses the rest
  (403). The session cookie is `SameSite=Lax`. Requests without either header (curl, scripts) aren't browsers carrying
  a visitor's cookie and pass.
- Uploaded files are always served as downloads, with `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: sandbox`, so they can't run scripts on your domain. Any file type can still be uploaded.
  Limit who may upload with the `uploadFiles` permission in `roles.json`.
