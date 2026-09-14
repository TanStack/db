# Hostile assay reproductions

Run from the repository root with the existing probe dependencies installed:

```sh
node probes/endpoints/design/representation/audit/repros/run.mjs
```

The runner imports the actual compiler and server refresh helper. It bundles the
actual runtime, TanStack DB, and Query Collection adapter using the probe's
TypeScript aliases. It does not change implementation or existing oracle files.
Temporary bundles are removed. Node 22.13.1 was used for this audit.

The assertions describe the observed counterexamples, so the reproduction runner
exits successfully when it confirms the faults. This is an audit witness, not a
regression suite whose green result certifies correctness.

- `compiler-cases.mjs`: distinct declarations in separate lexical scopes receive
  one identity. Saves both authored input and generated output.
- `pg-postcommit.mjs`: a real first PGlite INSERT commits, a second fails, and the
  actual refresh helper performs no authoritative reads.
- `runtime-cases.ts`: checks lost confirmed authority after a post-write handler
  error, runtime behavior of colliding query IDs, and Unicode result ordering.
  Includes a passing source-excluded insert control.
- `pg-order.mjs`: independent SQL evidence for the fixture's default ordering.
- `contracts.tap`: the existing 13 compiler/server checks, unchanged, pass.

The runtime error fixture uses an in-memory row array to make the client state
transition explicit; `pg-postcommit.mjs` independently proves the same server
failure boundary against real SQL. These are bounded boundary tests, not a new
full-stack browser oracle campaign.
