# PR CI

The PR workflow runs eleven test jobs independently. Each job builds its
selected packages and their workspace dependencies before running tests.
Builds retain pnpm's dependency order; package tests run without that
ordering. The DB jobs run one Vitest process with two workers. A package job
runs its entries as Vitest processes of one worker each, at most four at a
time, in the order that `scripts/ci-tests.mjs` lists them, with each output
line prefixed by its entry.

| Group | Scope |
| --- | --- |
| `db-1`, `db-2` | Two Vitest file shards of DB, excluding the replay process suite and the type oracles |
| `db-3` | The DB type oracles |
| `db-replay` | The complete `oracle-replay.test.ts` suite |
| `ivm-offline` | IVM and offline transactions; explicit test-source typechecks and dependency version checks |
| `sqlite-core` | SQLite persistence core |
| `sqlite-adapters` | Browser, Node, Electron, Cloudflare, React Native, Expo, Capacitor, and Tauri persistence |
| `frameworks` | React, React Router, Preact, Solid, Vue, Svelte, and Angular |
| `collections-1` to `collections-3` | Electric, Query, PowerSync, RxDB, TrailBase, Convex, the adapter conformance package, and the shared E2E suite container |

`scripts/ci-tests.mjs` owns the package assignments. An entry runs a package's
remaining test files, one named file, or one part of a named oracle file: its
fixed-seed units, its random-seed units, or every other test. Each package
with a test script has exactly one remaining-files entry, so a new test file
runs without an edit, and a named file runs whole once or in all three parts.
The script rejects an assignment that breaks these rules. When adding a
package with tests, assign it to a group and keep the workflow matrices in
`pr.yml` and `release.yml` in sync if adding a new group.

Every job stays under 10 minutes, and jobs are packed to about 9 minutes.
Pack by measured file and part times from a recent run: each entry's end line
gives its time, and the job's last lines list every entry with its time.
Split an oracle file into its parts when one file outlasts a job's budget, and
list the longest entries first.

Run a group locally after installing the locked dependencies:

```sh
node scripts/ci-tests.mjs check
node scripts/ci-tests.mjs build collections-1
node scripts/ci-tests.mjs test collections-1
```

The DB jobs retain coverage and typechecking. They write distinct Vitest blob
reports, which the final `Test` job merges into the full DB coverage and test
report. That job first requires both test matrices to succeed. Failure,
cancellation, or a skipped matrix cannot produce a successful aggregate check.
Other packages retain their existing coverage and typecheck configurations.
Oracle campaigns and their run budgets are unchanged.

The E2E workflow has three groups: browser/SSR/Query (including the optional
Electric suites), Node/Electron persistence, and Cloudflare/mobile persistence.
Each builds its dependencies once. Individual suites retain their serial
execution where a shared database requires it. The final `Run E2E Tests` check
requires all groups to succeed. Superseded runs are cancelled per PR. Existing
Electric and mobile-runtime enablement conditions still apply.

Preview publication and compressed-size comparison run independently. The size
job compares DB and React DB in one pass, building the required dependencies
at both the PR head and base. Its commands must exist on the base revision too;
a build script introduced only by a PR cannot be used for this comparison.

The target is completion within five minutes, including setup, builds, and
report aggregation. Measure job execution and queue delay separately, and track
both workflow creation-to-completion time and total runner minutes. Before this
split, 30 successful PR runs from October 2–5, 2026 had a Test median of 12:39
and P95 of 13:25, excluding queueing. These baseline measurements do not prove
the new workflow meets the target; use hosted runs to tune the slowest group.
