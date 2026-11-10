# Combined v1 cleanup and invocation source findings

Combined v1 remains unaccepted; its immutable source and packet are preserved. These are source gate findings, not executed counterexamples or product results. All candidate twenty states remain UNREACHED.

## H02-CAND-INDEP-COMB-V1-02: positive fixture cleanup is not required

The frozen baseline driver emits `worker-cleaned` only after final optimistic rollback/fixture cleanup, at lines658–681 (`queued-answer-completion-baseline-driver.ts`, SHA256 `d0a1e76c56b86d49d8abd55e9d26bf53be392ac6fdf530af7a48d189eaf4c96c`). The parent runner (`queued-answer-completion-baseline.test.ts`, SHA256 `1ee4156048a0e61c2efd73378433d3e99a99fa7e0aa0b8801eef1b94078b9992`) checks actions, cuts, initial view, worker/host errors, binding and process cleanup at lines116–147. It does not require a `worker-cleaned` receipt. It permits exit1 when an exact expected injected uncaught host error was observed, provided the authored actions/cuts completed (lines134–143). Therefore authored semantic completion and process-group absence do not positively establish completed fixture cleanup.

A direct thrown cleanup failure normally creates `worker-error`, which the parent already rejects. The missing check is positive cleanup completion, including premature expected-uncaught termination after the last semantic cut. Require exactly one `worker-cleaned` receipt and reject any fixture/worker cleanup-failed event. Keep process cleanup and fixture cleanup as separate evidence. The native author confirmed this source gap and intends the successor correction. No runtime witness was run.

## H02-CAND-INDEP-COMB-V1-03: invocation inputs are not sealed across execution

The outer launcher (`completion-parent.mjs`, SHA256 `405d762f1bbd6c492e4d30913b7fc5ad47fbc58909b008e0a87145dc783eb9f7`) parses the recipe and verifies the source-freeze hash before spawn (lines288–294). It writes evidence copies (lines318–329) but passes the original program/freeze paths in the environment (lines516–519). Postflight verifies the captured disk-source closure and program hash (lines608–611), without rehashing the selected recipe or source-freeze file against their captured preflight identities. The receiving supervisor rereads the freeze path (lines78–89 of `queued-answer-completion-supervisor.ts`, SHA256 `a27eb990a1cb9dbcca9280d07067e7e50c6464817a8fc55820499d78bf591a5a`). Thus the exact intended invocation record is not checked to remain the one consumed across the run.

Required correction: capture exact recipe/freeze/program bytes once; run from the private immutable evidence snapshots where applicable; verify original and snapshot identities at postflight against captured digests. Do not reread a changed input to define the expected postflight identity. The native author confirmed this source gap and intends that correction. Source acceptance will still require an exact separately reviewed invocation; no runtime is authorized by this report.

The twelve-source receiving closure and combined packet were independently read or rehashed within the authorized source-only scope. No production, test, oracle, canonical accounting/status/cutoff changes, runtime, test collection, production imports, generated histories or process probes occurred.
