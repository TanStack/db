# Combined v1 answer-settlement source finding

Verdict: combined v1 is not accepted. This is a source contradiction, not a runtime product failure. All candidate twenty states remain UNREACHED.

The exact combined freeze is `candidate-controls-combined-source-v1/source-freeze-v1.json`, SHA256 `1f3d40799d7d0eba6b6c9755bcbde3c1c581ab8a858c5e1aa9a6bbdb6a0d7de2`. Its packet, SHA256 `4e99eb94ebca470fd2ed039703102b3b8470b97fe353d7271ba26be8be1fb299`, has 139 entries; independent Python standard-library rehash found zero mismatches. The receiving own-v1 packet has 44 entries with zero mismatches, and its manifest's twelve frozen sources and 43 frozen records also independently match. Original packets remain unchanged.

## Finding H02-CAND-INDEP-COMB-V1-01

The frozen model (`queued-answer-completion-oracle.ts`, SHA256 `3bb328d2b6b1285fff88674c558188b88254789ba7f6abe9f3d94cb910858d05`) states at lines89–92 that `source-answer` combines authored response with the exact establishing demand's applied settlement. The receiver must observe that settlement before stepping this action. The model then changes facts and fulfills the source prerequisite at lines480–482.

The frozen baseline driver (`queued-answer-completion-baseline-driver.ts`, SHA256 `d0a1e76c56b86d49d8abd55e9d26bf53be392ac6fdf530af7a48d189eaf4c96c`) steps and emits every non-cleanup semantic action before physical execution at lines636–644. Its source-answer execution at lines383–390 releases answers only afterward. The parent therefore receives a semantic applied-settlement claim before that physical event can have occurred. This contradicts the frozen model's declared observation boundary and can compare callbacks against a future model state.

The same physical branch waits for all recorded public operations to be non-pending rather than observing the selected establishing demand's actual applied receipt. The frozen model itself permits early public operation termination on terminal graph or accepted retryable-tail paths (lines84–86). An operation-settled proxy therefore does not establish the promised applied-demand event. Empty observation arrays also satisfy `every`; this does not establish a missing exact demand.

Required repair: bind the authored source prerequisite to the actual establishing source demand, observe its original applied settlement, and sequence model transition/emission only after the required physical checkpoint. Keep callbacks checked at the correct authored cuts; do not cure this by silently postponing all comparisons to a final drain. Source acquisition, application and public-operation settlement remain distinct. Preserve combined v1 and prepare an additive successor.

No production, tests, oracle sources, status, cutoff or canonical accounting were changed by this review. No runtime, test collection, production imports, generated histories or process probes ran.
