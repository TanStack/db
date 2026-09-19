# v5 repair and ESLint transfer ledger

This ledger separates semantic repairs, ecosystem transfers, API-profile
choices, implementation backlog, and rejected transfers. “Incorporated” means
present in the v5 normative design, not implemented in the prototype.

## Incorporated semantic repairs

| Area | v4 evidence | v5 destination |
|---|---|---|
| Active versus historical conditions | FS-01, S-11, T-27, T-33 | `ConditionOccurrence`, activation intervals, separate active/history queries |
| Editor source transition | FS-02, T-31 | versioned transient contexts through `command.contexts.put/drop` |
| Rule lowering and identity | FS-03, S-01, A-25 | deterministic `LoweringManifest`, typed component edges, atomic registration |
| Definition history | H-02 | definition-only immutable envelope; later append-only edges |
| Authority anchor | H-01, T-21, A-37 | external authenticated actor session and capability verification |
| Cross-version identity and repair | H-05, S-07, T-19/T-20 | admitted identity relations and fresh cause-linked repair |
| Adequacy versus policy | H-06, T-39, A-02 | admitted domain adequacy; action remains consumer policy |
| Run completeness | H-08, T-16 | run plan commits universe/cardinality/stopping rule; submit requires ticket |
| Retry and transaction state | H-10, T-18, T-45, A-69 | idempotency, expected versions, staged atomic commit, reconciliation |
| Evidence provenance | S-04, S-06, A-16/A-18 | expanded observations, typed operation/cleanup failures, applicability decisions |
| Condition taxonomy | S-10 | distinct missing/inconclusive/unreachable/inapplicable/expired/operation/cleanup states |
| Config and policy separation | S-02, T-22/T-30 | rule activation/options separate from profiles and overrides |
| Config bootstrap and explanation | T-10 | invalid-config report independent of a valid project snapshot |
| Stable refs and use identity | T-03/T-11/T-13/T-14 | canonical refs, exact resolved definitions, explicit premise/route/use edges |
| Diagnostic/error contracts | T-29, T-46/T-49/T-50 | canonical diagnostics, actions, operation errors, and adapter schemas |
| Policy/override races | A-03/A-06/A-31/A-39 | explicit evaluation instant, strict aggregation, scoped override, decision token |
| Work races and resilience | T-28, A-29 | fenced leases, dedupe, backoff, objection and no-progress state |
| Counterfactual policy/config preview | S-22 | sealed candidate bundle and nonpersistent projected work |

## ESLint transfers incorporated

| ESLint mechanism | Fit | Trust adaptation |
|---|---|---|
| Plugin metadata and capability maps | solid | content-addressed `TrustModuleManifest`; discovery is not activation/admission |
| Ordered config resolution and inspection | solid | named fragments, fixed matching/merge, resolved provenance and layer trace |
| Rule option and message schemas | solid | runtime options plus versioned semantic message/action catalogs |
| `RuleTester` | solid | `TrustRuleTester` covers semantics, lifecycle, messages, actions, adapters, and hostile cases |
| Language/processor source mapping | plausible | domain `SourceProvider`, virtual subjects, editor overlays, safe action remapping |
| Fix/suggestion/application separation | solid | diagnose → preview → authorize → apply → re-evaluate; edit is not evidence |
| Stable lint results and formatters | solid | shared `TrustReport`, human/agent/JSON formatters, explicit exit classes |
| Suppression hygiene | solid operations | explicit override lifecycle; condition remains visible and authority is stronger |
| Cache, stats, and concurrency | plausible | explainable operational metadata and scheduler inputs; never evidence weight |
| Public/unstable API and deprecation policy | solid | independent authoring/service/wire versions and machine replacement paths |
| Small official MCP surface | solid principle | five task tools over the service; no arbitrary mutation tunnel |

## Selected API-profile decisions

| Previously open | v5 selection | Why this candidate is testable |
|---|---|---|
| F01/F02/F03 relationship | authoring → service → protocol layers | preserves idiomatic TS and one transport algebra |
| Executable hooks during reads | prohibited | pure queries read persisted decisions; methods/contexts run hooks with frozen inputs |
| Rule versus policy tuple | split | `enabled/options/level` activate obligations; profiles choose severity/action |
| Project-local admission | same admission protocol as packages | distribution convenience does not alter authority |
| Source-local suppression | presentation policy | it may change visibility, never deployment permission or evidence |
| Endpoint deployment exception | scoped policy override | matches the stated operational use case and retains condition history |
| Policy aggregation | strictest action; conflicts invalid | deterministic and fail-closed without order magic |
| CI behavior | pure gate plus explicit optional composite command | no hidden checks in `trust ci` unless a different command says so |
| MCP shape | five task tools | small enough to discover while covering the six workflows |
| Claim reuse | claims independent of rule presentation | allows shared propositions without overloading the stable rule code |
| Loader security placement | separate prerequisite contract | v5 requires inert discovery/capabilities but does not claim sandboxing |

## Deferred from the design candidate

- concrete signature, delegation, and hostile-code sandbox implementation;
- persistence engine and multi-process storage protocol;
- transport paging, cursor retention, subscription, and remote execution;
- an implemented probabilistic evaluator and independent calibration program;
- second-domain validation;
- final public package names and semantic-version support windows.

## Explicit non-transfers

- package installation or execution does not confer admission;
- severity does not control evidence generation or erase obligations;
- inline/count suppression cannot authorize deployment;
- a lint report is not durable evidence;
- autofix convergence is not causal repair;
- file-content cache validity is not evidence applicability;
- AST visitors are not the universal rule API; and
- warning/error counts are not confidence.
