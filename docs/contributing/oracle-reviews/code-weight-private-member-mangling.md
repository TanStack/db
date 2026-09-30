# Code weight: rename private members in the `@tanstack/db` build

Reviewed executable revision: `9c422842` (base `c0d123b8`, the fetched
`origin/main` at review time). This record follows in a documentation-only
commit. The rename landed in `6dbf3982` on base `9125dab6`. Later commits fix
two review findings, merge `origin/main`, and add the dist smoke lane.

## Change

Consumer minifiers rename local variables but never rename properties. Long
TypeScript-private member names, such as `authoritativeRequestState` or
`truncateReplayState`, therefore reach every production bundle in full. The
`@tanstack/db` build now renames 368 of those members to short names. The
renaming happens in a `renderChunk` step of `packages/db/vite.config.ts`, which
runs esbuild `mangleProps` on each emitted ESM and CJS module.

- `packages/db/mangle-cache.json` is the committed map from each original
  name to its short name. It makes the renaming reversible and keeps the short
  names stable across releases.
- The build step fails if esbuild renames any name that is not in the cache.
- `scripts/mangle-private-members.mjs` checks the cache (`pnpm check:mangle`)
  and updates it (`--write`). `--write` keeps existing assignments, drops names
  that are no longer safe, and gives new safe names the next free short names.
- `scripts/test-minified-db.mjs` now bundles the built `dist`, not `src`, and
  rejects a `dist` that is older than `src`, the cache, or the package's build
  configuration (`vite.config.ts`, `package.json`, `tsconfig.json`). CI builds db-ivm and
  db before this lane and runs `check:mangle` first.

The published declarations, the public API, and the source maps do not
change. Each source map still points at the original TypeScript, which the
package also publishes in `src`. `@tanstack/db-ivm` is not renamed: it already
uses native `#private` members, and a probe showed a gain under 0.5% gzip.

## Bytes

Each row bundles the built `dist` as a consumer would, with esbuild at target
`es2020`, and both builds sit under the same `package.json`, so both apply
`"sideEffects": false`.

| Consumer entry | min | gzip | brotli |
| --- | ---: | ---: | ---: |
| full public API | −30,083 (−8.0%) | −2,917 (−2.7%) | −2,077 (−2.3%) |
| local-only collection with one insert | −10,951 (−8.4%) | −1,059 (−3.0%) | −718 (−2.3%) |
| collection with a filtered live query | −20,606 (−7.3%) | −1,901 (−2.4%) | −1,431 (−2.1%) |
| full public API, minified with terser | −30,074 (−7.9%) | −2,886 (−2.8%) | −1,869 (−2.2%) |

The minified saving is large because each long name repeats in every bundle.
Gzip and brotli already encode most repeats as short back-references, so the
compressed saving is smaller.

An earlier measurement of the minimal entry showed a gzip saving of 13%. That
was a harness fault: the unrenamed copy sat outside the package, so esbuild did
not apply `"sideEffects": false` to it and kept nine modules that have
top-level registration statements. With both builds under the same
`package.json`, the minimal entry saves 2.9% gzip.

## Why the rename is safe

esbuild renames every property with a cached name, anywhere in the output,
without regard to types. So `map.size` on a native `Map` would also change if
`size` were a cached name. The safety rule therefore covers every use of each
name, not only the uses on the private member.

A name is safe when all of these hold:

1. Every property-name use of it in `packages/db/src` resolves, through the
   TypeScript checker, to a `private` class member declared in
   `packages/db/src`. The uses include property access, object literal keys,
   class members, constructor parameter properties, interface members,
   destructuring, and shorthand properties.
   An unresolved use (an `any` receiver) or a use that resolves to another
   declaration (a lib type, db-ivm, an internal interface) makes the name
   unsafe.
2. It never appears as a string literal in `packages/db/src`. esbuild does not
   rename quoted keys.
3. No other package's `src` or tests read `.name` or a quoted `'name'`. Those
   packages consume the renamed `dist`, so an untyped read would break.

Each short name must also be unique and must not be an identifier anywhere in
db or db-ivm `src`, so a renamed member cannot collide with a real property.

Of 470 private member names, 368 pass. The first text-based probe for this
change used public `.d.ts` output as a fourth filter. Every name that filter
alone removed appeared in `.d.ts` only in a comment, in a `private`
declaration, or as a function or constructor parameter name. None of those is
a property. The type-checked rule covers public
types directly, because a name in a public type has a non-private declaration.

## Guard calibration

Each row plants one hostile use of the cached name `authoritativeRequestState`
(short name `l`) and runs `pnpm check:mangle`. Every row exits with status 1
and names the file and line.

| Planted use | Guard result |
| --- | --- |
| C1: public object literal key in db src | `PropertyAssignment ... used at src/SortedMap.ts` |
| C2: untyped read `(globalThis as any).name` in db src | `unresolved use` |
| C3: string literal of the name in db src | `string literal` |
| C4: untyped read in `packages/react-db/src` | `used in packages/react-db/src/index.ts` |
| C5: an identifier equal to the short name `l` in db src | `l is an identifier in src` |
| C6: an interface member with the same name | `PropertySignature ... used at src/SortedMap.ts` |
| C7: a `public`, `readonly`, or `protected` constructor parameter property | `Parameter in packages/db/src/SortedMap.ts` |
| Control: a `private` constructor parameter property | passes (status 0) |

CodeRabbit review of `3799ffa4` found that the first guard never visited
constructor parameters. A non-private parameter property with a cached name
passed the check in all three modifier forms. The guard now checks every
parameter property as a property declaration. No current source had such a
property, so the cache did not change.

The minified lane keeps its three hostile controls. With the lane bundling
`dist`, the `new.target.name` control first passed silently, because its mutant
plugin matched `src/errors.ts`, which the bundle no longer loads. The plugin
now matches `dist/esm/errors.js`, and all three controls fail at their intended
assertions:

| Control | Result |
| --- | --- |
| `--calibrate-error-name` | assertion failure: `CollectionConfigurationError.name` |
| `--calibrate-public-member` | assertion failure: `public index metadata method` |
| `--calibrate-output-shape` | assertion failure: query rows differ |
| a source file newer than `dist` | error: `packages/db/dist is older than packages/db/src/SortedMap.ts` |
| `vite.config.ts`, `package.json`, `tsconfig.json`, or the cache newer than `dist` | error naming that file |

An external review of `a1d2b85b` found that the freshness check did not
include the build configuration. With only `vite.config.ts` touched after a
build, the lane passed against output from the older pipeline. The check now
includes the configuration files. Each input was touched alone after a fresh
build, and each one fails the check with its own path.

## Behavior evidence

The rename changes no source, so the db suite, which runs against `src`,
cannot observe it. Every package that depends on `@tanstack/db` resolves it
through the workspace to the built `dist`, so their suites run against the
renamed output. On `6dbf3982`, with the 368-name cache:

| Package | Files | Tests |
| --- | ---: | ---: |
| `@tanstack/angular-db` | 2 | 57 passed, 1 todo |
| `@tanstack/db-sqlite-persistence-core` | 9 | 369 passed, 1 todo |
| `@tanstack/electric-db-collection` | 13 | 585 |
| `@tanstack/offline-transactions` | 17 | 202 |
| `@tanstack/powersync-db-collection` | 9 | 173 |
| `@tanstack/query-db-collection` | 15 | 532 |
| `@tanstack/react-db` | 13 | 286 |
| `@tanstack/rxdb-db-collection` | 1 | 12 |
| `@tanstack/solid-db` | 2 | 81 |
| `@tanstack/svelte-db` | 6 | 107 |
| `@tanstack/trailbase-db-collection` | 3 | 67 |
| `@tanstack/vue-db` | 5 | 109 |

These 2,580 tests pass. `test:minified-db` also passes against the renamed
`dist`. The run used the working tree just before `6dbf3982`. That commit
changes only formatting and one lint fix in `vite.config.ts`, and its built
`dist` is byte-identical to the verified build. After the merge of
`origin/main` at `7b8142fc`, CI's Test job ran every consumer suite against
the rebuilt, renamed `dist` and passed.

### db tests against the renamed dist

The consumer suites reach db only through other packages. `pnpm --filter
@tanstack/db test:dist` also runs five of db's own test files against the
built `dist`. `packages/db/vitest.dist.config.ts` maps each `src` import to the
matching built module, which exists because the build emits one module per
source module. Modules without runtime code (re-export barrels and type-only
files) are not emitted, so those load from `src`, and their imports then
resolve to `dist`. Any other unbuilt module throws. A planted `throw` in the
built `collection/index.js` showed that the lane loads `dist`.

The five files were chosen for coverage of the 14 modules that hold about 90%
of the renamed members. Coverage is measured on the built modules and mapped
back to source. Files that read renamed members directly were excluded,
because they would test the rename map instead of behavior.

| File | New key-module statements | Cumulative |
| --- | ---: | ---: |
| `query/ordered-source-loader-state.test.ts` | 1,951 | 37.4% |
| `live-query-observer.test.ts` | 641 | 49.8% |
| `query/includes-publication-oracle.test.ts` | 479 | 58.9% |
| `query/bucket-facade-adapter.test.ts` | 178 | 62.4% |
| `collection-subscription.test.ts` | 179 | 65.8% |

The five files run 254 tests in about 3 seconds. All 14 measured candidates
together reached only 72.6%. `live-query-window-controller` has no coverage
from db tests that avoid its internals. The framework adapters' infinite-query
suites exercise it, and they run against `dist` in CI's Test job.

Calibration: in the built `ordered-source-loader.js`, the first of 26 `.l`
accesses was restored to `.authoritativeRequestState`, which is an inconsistent
rename. The lane then failed 48 of 254 tests in 2 of 5 files. With the file
restored, all 254 tests pass. A source file newer than `dist` makes the lane
throw the freshness error before any test runs.

## Costs

- `dist` JavaScript is harder to read directly (`this.ay`). Source maps and the
  cache decode it. Stack traces that are not source-mapped show short method
  names for renamed private methods.
- esbuild reprints each emitted module. The reprint keeps `@__PURE__`
  annotations (299 before and after) and legal comments, and drops other
  JavaScript comments. The `.d.ts` documentation does not change.
- The db build takes about one second longer.

## Limits

- The rule is static. Reflection that enumerates instance properties (for
  example `Object.keys(collection)` or `JSON.stringify` of a class instance)
  would see short names. No such use exists in the checked packages, and the
  consumer suites pass, but a user who inspects internal instances this way
  would see different keys.
- A private member added later is not renamed until someone runs `--write`.
  That costs bytes but is never unsafe.
- `check:mangle` reads other packages in this repository only. Code outside
  the repository that reads `@tanstack/db` internals through `any` is
  unsupported and can break.

## Verification

On `9c422842`:

- `pnpm check:mangle`: 368 names.
- `pnpm --filter @tanstack/db test:dist`: 5 files, 254 tests.
- `pnpm test:minified-db` against the built `dist`: error names, index
  metadata, query rows, and live updates.
- `packages/db` Vitest, typecheck off: 193 files, 7,164 tests.
- `pnpm test:oracles`: 49 `@tanstack/db` files with 2,847 tests, and 16
  `@tanstack/query-db-collection` files with 454 tests and 1 todo.
- The consumer suites in the table above ran on `6dbf3982`. On `7b8142fc`,
  CI's Test job ran them again against the merged, renamed `dist`.

The environment was Node `v24.19.0` and Vitest `3.2.4` on Darwin arm64.
