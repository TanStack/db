# Component endpoints and TodoMVC prototype

See [Taking stock](./IMPLEMENTATION.md) for the API, implemented layers,
verification, and remaining limits; [the audit](./TODOMVC-AUDIT.md) tracks
TodoMVC parity. [Earlier development notes](./HISTORY.md) preserve historical
experiments and receipts rather than describing the current app.

## Run

From this directory with the pinned package.json dependencies installed:

```sh
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4191
```

Open http://127.0.0.1:4191/. PGlite runs in this server process and stores data
in ignored `.data/todos`. Set `TODO_DB_PATH` for another location or `memory://`
for disposable storage. Do not share one data directory between processes.
The app has fixture users and a reset endpoint; keep it on loopback.

```sh
node node_modules/typescript/bin/tsc --noEmit
node --test tests/server-order.test.mjs
node tests/todomvc.mjs
node tests/todomvc-parity.mjs
node tests/todomvc-audit.mjs
node tests/persistence.mjs
node node_modules/vite/bin/vite.js build
TODO_DB_PATH=memory:// node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4194
```

Browser tests reset the fixture database. Run them against an isolated server
when keeping manual demo data. Set PROBE_URL for the server under test.

For endpoint lifecycle/identity tests, start an isolated instrumented server:

```sh
TODO_DB_PATH=memory:// node node_modules/vite/bin/vite.js --mode browser-test --host 127.0.0.1 --port 4193
node tests/browser.mjs
node tests/binding.mjs
node tests/callback-error.mjs
```

The normal component/build has no test globals. Vite and TypeScript resolve DB,
DB IVM, React DB, and Query Collection directly to this checkout's sources.
The cached dependency setup helper and its historical receipts are described
in HISTORY.md; they do not depend on ~/node_modules.
