# Kitchen test audit

The former `tests/kitchen-port.mjs` combined framework checks with application
rules. The application test now lives in Kitchen's `tests/endpoints/compiled.mjs`
and runs with `pnpm test:endpoints:compiled`. Framework tests no longer require
a Kitchen checkout, its schema, Docker, or its local PostgreSQL server.

## Assertion inventory and disposition

| Former check                                                                                      | Owner and destination                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every handler receives input without `user_id`/timestamps                                         | Replaced with generated schema semantics in `oracles/compiled-dependencies.mjs`. The framework must obey the declared schema, not forbid particular names.                                                                                      |
| Nested tag/link fields are stripped; tag text is trimmed                                          | Shared generator now varies root/object/array extras, strip/passthrough/strict policies, trimming, defaults, and a numeric transform. Kitchen retains assertions that its own tags are trimmed and have the authenticated owner.                |
| Immediate inserts have timestamps and the current owner                                           | Kitchen application rule, already covered by its browser smoke test. Removed the generic loop from the compiled companion. Shared compiled/SQL/E2E oracles already compare immediate optimistic rows against independent expectations.          |
| All eight collections equal PostgreSQL after actions                                              | General reconciliation remains in generated compiled, SQL, concurrent, and E2E oracles. Kitchen retains a small integration comparison against its actual tables, including Drizzle's camelCase user fields.                                    |
| Exact affected/unaffected snapshot counts                                                         | Removed from Kitchen. Shared compiled oracle's independent `read-obligation` law checks selective reads across generated tables, FKs, triggers, helper writes, and SQL functions.                                                               |
| No request-time catalog queries                                                                   | Removed from Kitchen; already checked in shared compiled Node and browser runners, plus compiled output.                                                                                                                                        |
| Blank tag yields `INVALID_INPUT`, exact issue path, no SQL, then rollback                         | Generic error/rollback/no-SQL checks already exist in shared compiled and browser oracles. Added proof of zero handler entries, including strict nested-input rejection. Kitchen retains only its blank-name rejection and resulting app state. |
| All 18 Kitchen endpoints have known build-time dependencies                                       | Retained as application/compiler integration coverage of the actual declarations. General dependency correctness belongs to shared compiled and SQL-effect oracles.                                                                             |
| Ingredient counter increases after the shopping workflow                                          | Retained in Kitchen; external Trello remains stubbed.                                                                                                                                                                                           |
| Recipe result is finished data, one INSERT and no placeholder UPDATE                              | Retained in Kitchen; these are application workflow and return-value rules.                                                                                                                                                                     |
| Extraction precedes the write transaction; extraction failure executes no writes                  | Retained in Kitchen; this transaction boundary is authored application behavior.                                                                                                                                                                |
| Related-row failure rolls back the whole recipe transaction                                       | Retained in Kitchen to guard its authored transaction. Shared SQL/concurrent oracles cover framework reconciliation after SQL failures.                                                                                                         |
| Comment/tag ownership and timestamps resist caller values; comment creation time survives editing | Retained in Kitchen to guard its chosen schema and auth rules. The shared schema-policy cases deliberately also allow these names under passthrough.                                                                                            |
| Wrong actor rejects the write; delete paths and cascades reconcile                                | Retained as application integration smoke coverage. Kitchen browser uses real sessions; compiled smoke uses a scope-checking stub. Shared generators cover rejection and FK effects independently.                                              |

## Shared input coverage

`compiled-input.mjs` renders schemas and supplies a small independent model using
ordinary object construction, integer checks, and string trimming. Expected data
does not come from Zod or the compiler. Generated programs vary schema policy,
transform offset, default value, and extra-field names. Histories vary operation,
values, supplied/omitted defaults, strings, array size, and extra-field location.

The compiled runner observes actual handler arguments after dependency analysis,
so observation itself cannot change dependency proofs. It requires exactly one
entry for valid input and none for rejected input. A separate PGlite database
executes writes using the modeled parsed value; immediate optimism uses the raw
caller value. The nonzero transform distinguishes raw input, one parse, and
repeated parsing. Browser fixtures exercise the same policies through Start RPC,
compare optimism and settled rows with reference PostgreSQL, and retain the
production client/server separation checks.

The `raw-handler-input` compiler mutant deliberately validates but passes the raw
request to application code. It must fail `parsed-handler-input`; the normal
runner must pass. Reports include replay inputs and the shared evidence ledger.

```sh
node tests/oracles/compiled-dependencies.mjs
node tests/oracles/compiled-browser.mjs
ENDPOINT_COMPILED_MUTANT=raw-handler-input \
  node tests/oracles/compiled-dependencies.mjs --controls-only
```

This is bounded Zod coverage, not coverage of every schema type, async transform,
or custom refinement. No application rule is promoted to a universal framework
rule, and no new framework production behavior is introduced by this move.

Exploratory combinations found a conservative optimization boundary: raw SQL
parameter analysis cannot prove the type returned by a schema transform, and
the helper analyzer does not recognize every object policy method. The generated
schema-policy cases therefore exercise direct Drizzle writes; the original
helper/function dependency generator remains unchanged. A fixed transformed
raw-SQL case also checks correct rows and the full-refresh fallback. Expanding
those dependency proofs is separate work, not a correctness failure hidden by
accepting compiler-produced expectations.

## Verification

Receipts are in [`evidence/kitchen-oracle-audit`](../evidence/kitchen-oracle-audit).

- Generated run: seed 9122602, 20 scenarios × 3 histories plus fixed controls;
  30 compilations, 313 operations, 187 parsed-handler checks, 126 rejected inputs,
  and 510 settled collection comparisons.
- Browser run: six programs, 42 operations, 90 settled collection comparisons,
  and 24 scanned production client artifacts. Same-turn and rejected-input checks
  are additional to the settled comparison count.
- The raw-input mutant was applied, reached, and rejected by the intended
  `parsed-handler-input` assertion. Its replay packet is retained beside the report.
- All 18 evidence/boundary harness tests pass. A browser replay using the previous
  literal fractional-input format also passes.
- The relocated Kitchen smoke test passes 104 reported collection comparisons;
  Kitchen lint and formatting pass. External services remain stubbed.
