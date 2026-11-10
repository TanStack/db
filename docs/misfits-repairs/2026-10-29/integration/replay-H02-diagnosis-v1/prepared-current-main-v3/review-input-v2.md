# H02 v2 exact static re-review

Verdict: not yet accepted for receiver execution. One residual part of H02-PREP-R02 remains. No reviewer runtime ran.

Exact packet: `542c9fb3b60524dec5a551954a350983da916c3fcbede203a3b527bae43b9fbb` (36 members), source freeze `1a2eec782ebb27f824bf0877d2a775be5a8d0660d7f6ca072bace170cf0f4210`, recipe `08092091634b63f7179427252b1e33730ea66abbe84e6579b3d2a9f2c15972a9`, launcher `3d0fa61d486bfe424bf36a6555adb746fa88a76452b6919dbc6fe4a1a2283bd7`. Every packet member independently matches.

All production/receiving production maps, shared imported/config maps, package maps and selected Node identity equal v1. The complete oracle prefix through model/history definitions equals v1 after removing only the new node:util import. The six existing instrument changes and three pure calibration/config additions remain within R01–R03. The shared retained model is unchanged.

R01 source repair is sound within this preparation: exact current-root production and instrument/shared allowlists receive separate original-byte and loader/V8 binding checks. Outside/stale/unapproved paths fail closed. Required paths need positive evaluated evidence; optional in-progress nodes gain no execution credit. Authored verifier source and output show 12/12 controls passing, including intended failures. This is fixture evidence, not an actual loaded-source witness.

R03 source repair moves the immediate observation to subscriber return before preload, checks its cut tag, and preserves the final result. Pure checker source and output show sensitivity to wrong immediate rows and a displaced cut. No real synchronous control has run.

R02 now judges all reload callback snapshots and folds event payloads, but compares eventRows only inside a public-change receipt. If the entire final callback is omitted and final-publication still reports valid final rows, eventRows remains prior and nothing compares it at that final cut. The current 8 pure checker tests do not include this omission. This is a source-level observation gap, not a production defect or executed false-GREEN.

Required narrow repair: at the final semantic cut, compare the accumulated event projection to final-publication.rows through the shared exact comparison, and require the reload-start boundary. Add a pure authored fixture omitting all final callbacks while preserving valid final rows; it must reject at the terminal event comparison. Preserve raw payloads and existing transient/payload/duplicate/regression controls. This remains R02, not a new product law or relational model.

The selector and launcher remain the one canonical fixed history, with the same receiving containment (384 MiB heap / 1 GiB sampled group RSS / 20s wall), outer 60s test and sequential offline verifier. Launcher identity/output paths are explicit. No property registration, campaigns, source repair, or production runtime occurred. Return the repaired exact successor before conditional one-history admission.
