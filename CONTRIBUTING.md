# Contributing

Thanks for helping. Bug reports, fixes and features are all welcome.

## Before you start

For anything bigger than a small fix, please open an issue first so we can agree on the approach before you spend
time on it.

## Development setup

Requires Node.js 22.

```bash
npm ci
cp .env.example .env    # set SESSION_SECRET and IP_HASH_SECRET (openssl rand -hex 32 each)
npm run dev             # http://localhost:8081
npm test
```

The first start prints a setup code for creating the first admin at `/setup`.

## How changes are made

- **Tests first.** Write the tests for a change, see them fail for the right reason, then make them pass.
  Change an existing test only when its expectation was wrong, and say why in the pull request.
- Tests use an in-memory database and a temporary `DATA_DIR` per test file (`tests/setup/`). New tables that come
  from a migration in `config/migrations.js` are created in tests by that same migration.
- **Database changes** go into the startup migrations (`config/database.js`, or a tested function in
  `config/migrations.js`). They must be idempotent and work on both fresh and existing databases.
- **New settings, permissions or limits** are added to `config/schema.js` (and `config/roles.default.json` for
  roles). Then run `npm run docs:config`; a test fails while `docs/CONFIGURATION.md` is out of date.
- Match the style of the code around your change. `CLAUDE.md` describes the architecture and conventions.

## Pull requests

- Keep a pull request to one topic.
- CI runs the tests and a Docker smoke test on every push. A label shows the state:
  - `work-in-progress`: a draft
  - `needs-fixes`: CI failed
  - `ready-to-test`: CI passed and ready for review
- Describe what changed and why, and how you tested it.

## Security issues

Please don't open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
