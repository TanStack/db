# Independent review: Preact schema receiver conversion

Reviewed draft on branch `codex/oracle-convert-frameworks`, base
`8160dc1ee350020eb3eeb67a876505a2c2d151ee`, 2026-11-10.
Initial checker SHA-256: `eef617a36e08caabe804704a29cbd7e08adb8d99fe5c0a016968e49c3beaf014`.
Read-only source review; the only files this reviewer wrote are ignored review
notes and the isolated reproduction below. No production or oracle source edits.

## Finding S1: a missing later cut hides an earlier recorded binding violation

Law and authority: the existing schema receiving law compares retained binding
identity before the next mutation. ORC-010 and the framework's error-precedence
contract preserve a violation at a recorded checkpoint before a later driver
error, with the error retained as cause.

The new check first loops over all twelve raw/held/settled cuts, then checks
binding relations and handler holds. A prefix that already records
`retained binding` with `collection: false`, followed by a later driver error,
returns a missing `retained-held` violation first. That checkpoint was not
recorded, so pinned `oracleProperty` rethrows the driver error. The old driver
asserted retained binding before it attempted that next update.

The smallest general gap is comparison ordering on partial traces, rather than
the complete-case schema model. Recorded binding and hold violations must be
checked in chronological order before reporting absent later observations.

Executed RED uses the real native Preact recorder, the shared schema model and
check, and a framework calibration driver. Its observation adapter records the
false retained-binding relation, then throws `later retained update failure`.
The clean calibration candidate passes. The calibration fails with that raw
Error rather than the expected named `bound schema binding` law.

Command:

```sh
./node_modules/.bin/vitest run --config packages/preact-db/.cache/schema-fidelity/config.mjs -t calibration
```

Durable isolated probe, configuration and RED log:
`packages/preact-db/.cache/schema-fidelity/{probe.test.ts,config.mjs,red.log}`.
Result: one failed calibration, two unselected tests; 3.59 seconds, one worker.
No shipped source was modified by the probe. Author and root were notified.
Repair and final-source GREEN remain pending at this entry.

## Preserved laws and review boundaries

Source inspection reconstructs the expected retained phase independently:
initial schema and key govern a same-identity rerender; changing query identity
admits the proposed schema/key. A held client update exposes transformed rows
and handler payloads, settlement exposes the source rows again, and subsequent
sync source publications remain raw. The later followup mutation checks next use.

The conversion retains all 72 finite schema/key/identity/input cases and all
twelve cuts per case (864 reach cells). Immediate Collection entries are copied
in the update call stack; Collection entries, host state/data, and handler
original/modified/changes are captured separately. Expected values come from
the existing independent schema model. The new recorder contains no expected
schema output. The old React driver is byte-identical; its 148-line additive
recorder is a separate receiving path.

Strict row/value/payload comparisons reuse the prior `toStrictEqual` helpers.
Only unspecified row order is normalized. Extra own `undefined` fields, wrong
keys, duplicate/omitted rows, peer mutations, wrong payloads, and missing/extra
public cuts remain representable. Reference relations retain the exact old
Collection/getKey/schema checks.

| Rubric | Result |
| --- | --- |
| ORC-001 | Law authority follows the schema guide, optimistic-history contract and inline-option decision. Existing scalar/synchronous/explicit-key limits retained. |
| ORC-002 | Model uses authored inputs and independent binding/schema rules; driver uses real parser and hooks. |
| ORC-003 | Opening law/limits and adjacent model, recorder and comparison prose distinguish responsibilities. |
| ORC-004 | Same complete finite 72-case grammar; no dropped axis or newly admitted invalid history observed. |
| ORC-005 | Actual Preact hook and native act/commit probe retained; synchronous immediate read and each host cut captured. |
| ORC-006 | Four complete-trace calibrations retained; executed S1 shows missing partial-trace calibration. |
| ORC-007 | Fixed/random generation requirement does not apply to this bounded finite enumeration; direct case replay must remain registered. |
| ORC-008 | Stateless phase recomputation; no new state machine or collapsed lifecycle state. |
| ORC-009 | Existing initial/retained/rebound phase mapping retained; source rows are explicit history inputs. |
| ORC-010 | S1 confirmed open on initial draft. Cleanup retains driver errors, but checker ordering hides earlier recorded relation failures. |
| ORC-011 | No additional shared semantic-fault hypothesis identified within unchanged law/grammar; no second formulation required for conversion alone. |
| ORC-012 | This exact-draft review records applicable requirements and S1 rather than claiming comprehensive readiness. |
| ORC-013 | Existing first/next schema and query/queryKey crossings distinguish retention from immediate replacement and next-use failure. |
| ORC-014 | Real Preact scheduling receives the controlled Collection premise; no browser/provider/SSR transfer claimed. |
| ORC-015 | Finite enumeration retains twelve explicit checked reach entries per case; no generated constructed-builder association is used. |
| ORC-016 | Finite inputs use the reusable independent model/check; no standalone expected-answer examples added. |

The author reported 146 Preact and 216 unchanged React tests passing; this
reviewer did not repeat those suites. The frozen first AFTER census reported
all 48 outcomes and 18 prior kills preserved. Those results predate the S1
repair, so final-source mutation preservation remains a separate gate.

Limits: no typed-schema, invalid/async schema, default getKey, mutations spanning
replacement, SSR/concurrent-render or real provider claim. The complete raw
earlier reports were lost after restart; baseline use relies on the retained
committed complete key comparison and reconstructed tracked-tree provenance.
Whole-environment byte identity is not claimed.

## S1 repair verification

The author repaired the checker after the frozen initial AFTER census completed.
It now judges every recorded row/mutation, binding relation, handler hold and
reach entry in trace order. It checks missing/duplicate cuts and aggregate
completeness afterward. This preserves complete-trace strictness and makes an
earlier recorded violation decide before a later driver error. Model, grammar,
source recorder and existing receiving schedules remain unchanged.

Repaired checker SHA-256:
`5f4f916b04c9070f35e13d8369eaa661d7ee801700af9d21f24172d07e3c7fe6`.
Repaired registration SHA-256:
`aa87b3344af7334270952ea89fd4e5aabf1930056eebca0617b4b229794f952b`.
The registration permanently adds binding/handler-hold fault-driver calibrations.

Independent GREEN reran the exact isolated binding control and added adjacent
raw-source and held-mutation controls. Each records its wrong public observation
through the real native recorder, then throws a later driver error. The same
shared check and framework must report `bound schema binding`, `bound schema
rows`, and `bound schema mutation`, respectively.

The command above passed all three calibrations (two unselected tests), exit 0,
3.08 seconds, one worker. Log: `packages/preact-db/.cache/schema-fidelity/green.log`.
The raw-source control drops Collection rows; the held-mutation control drops
the immediate Collection rows. Neither tests a different model or replaces the
public receiving path with hand-written expected answers.

S1 is fixed within the recorded-prefix/receiving-error boundary. No further
supported source defect was found in the reviewed conversion. Final ordinary
receiving-suite, lint, manifest/replay and mutation-parity checks on the repaired
source remain the author's integration gate; the first AFTER census predates
this repair and must not be presented as final-source evidence.

## Final integration evidence

The final source commit is `8318e90be49507bd11faf68dc3fb01c05db4e60e`. The independent checker hash above is unchanged. The later bound-options edit adds only a callback parameter type annotation and does not change its runtime model, histories, driver or check.

Final repaired-source native Preact148 checks, unchanged React216 checks, explicit full-project TypeScript compiler and70 replay-manifest checks pass. The final complete48-key seed2291 census preserves all18 prior kills through named laws, with no classification changes or nondeterministic tests. That AFTER run used TANSTACK_DB_ORACLE and reused zero cached evidence units. The final conversion JSON preserves every stable key, classification, law attribution, provenance, source hash and isolated prefix calibration source/log.

The one independent finding is fixed-now; none remain confirmed-open. This review and finite mutation comparison establish the stated conversion boundary, not universal schema/provider/framework correctness.
