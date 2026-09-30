# Deployment

Three ways to run LinkSnip:

1. [Docker Compose with the bundled Caddy](#1-docker-compose-with-the-bundled-caddy): the simplest, with HTTPS included.
2. [Docker Compose behind a proxy you already run](#2-docker-compose-behind-an-existing-reverse-proxy).
3. [Bare Node.js](#3-bare-nodejs-development): for development.

In every case, all data lives in one folder (`DATA_DIR`): `database.db`, `uploads/`, `backups/`, `settings.json` and
`roles.json`. Back up that folder and you have everything.

## Before you start

```bash
git clone https://github.com/D3m0nZOnFire/LinkSnip.git
cd LinkSnip
cp .env.example .env
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s/^IP_HASH_SECRET=.*/IP_HASH_SECRET=$(openssl rand -hex 32)/" .env
mkdir -p data
```

The container runs as the unprivileged `node` user (uid 1000). If `data/` belongs to another user, give it to uid 1000:

```bash
sudo chown -R 1000:1000 data
```

## 1. Docker Compose with the bundled Caddy

Point your domain's DNS (A/AAAA records) at the server and open ports 80 and 443. Then:

```bash
echo "DOMAIN=links.example.com" >> .env
docker compose --profile caddy up -d
```

Caddy gets and renews the certificate automatically. Its configuration is `docker/Caddyfile`.

Get the one-time setup code and create the first admin at `https://links.example.com/setup`:

```bash
docker compose logs linksnip | grep "setup code"
```

## 2. Docker Compose behind an existing reverse proxy

Start only LinkSnip:

```bash
docker compose up -d
```

It listens on `127.0.0.1:8081`, reachable only from the same machine. Point your proxy at it. With Caddy installed on
the host:

```caddyfile
links.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8081
}
```

The proxy must pass the client address in `X-Forwarded-For` and the scheme in `X-Forwarded-Proto` (Caddy does this
by default). LinkSnip trusts one proxy hop (`TRUST_PROXY=1`). If there are more proxies in front, for example a CDN
plus Caddy, set `TRUST_PROXY` in `.env` to their number. With the wrong value, rate limits and reports see the proxy's
address instead of the visitor's.

**Upload size:** Caddy has no request size limit by default. Other proxies do (nginx: `client_max_body_size`, 1 MB by
default); raise theirs to at least your largest `maxFileSizeMB`.

## 3. Bare Node.js (development)

Requires Node.js 22.

```bash
npm ci
npm run dev      # restarts on file changes; or: npm start
```

The app listens on `http://localhost:8081`. Without `DATA_DIR` in `.env`, data is stored in the project folder;
`DATA_DIR=./data` keeps it apart. The setup code is printed in the terminal.

## Operating

| Task | Command |
|---|---|
| Logs | `docker compose logs -f linksnip` |
| Health | `curl http://127.0.0.1:8081/healthz` (also used by the container's health check) |
| Admin accounts (create, promote, reset password) | `docker compose exec linksnip npm run admin` |
| Update | `git pull && docker compose up -d --build` (check `.env.example` for new required variables first) |
| Stop | `docker compose down` (data in `data/` is kept) |

**Backups:** the database is backed up online every night at 3:00 to `data/backups/`, keeping 30 days. Uploaded files
are in `data/uploads/` and are not part of that backup, so copy `data/` elsewhere as well.

**Restoring:** stop LinkSnip, delete `data/database.db-wal` and `data/database.db-shm`, copy the backup over
`data/database.db`, and start it again. Check a backup first with
`sqlite3 <backup> "PRAGMA integrity_check"`, which should print `ok`. Migrations bring an older backup up to date on
start. A restored database already has an admin, so the setup page won't appear.

**Upgrading to keyed IP hashes:** LinkSnip now needs `IP_HASH_SECRET` in `.env` and refuses to start without it.
Add it before updating:

```bash
echo "IP_HASH_SECRET=$(openssl rand -hex 32)" >> .env
```

On the first start, the stored IP hashes (plain SHA-256, which anyone with the database could reverse) are rewrapped
with the secret. Unique-visitor counts and the one-report-per-IP check carry on unchanged. Keep the secret: with a
different one, visits from then on no longer match earlier ones (startup logs a warning if it changes).

**Configuration:** see [CONFIGURATION.md](CONFIGURATION.md). Settings are also editable in Admin → Settings.
