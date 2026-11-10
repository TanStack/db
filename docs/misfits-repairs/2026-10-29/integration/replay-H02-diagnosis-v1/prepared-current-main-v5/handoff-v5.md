# H02 receipt transport successor v5

Status: source-only, pending exact independent acceptance. No new receiving invocation.

The v4 receiving attempt bound 318 source entries with zero provenance failures, then failed instrument I/O with EAGAIN before the conditional queued premise. Its 1933 raw files and original manifest remain frozen. It supplies no progress RED, semantic product RED, product GREEN, or closure.

The new receipt-transport.mjs opens one exclusive regular file (wx, 0600) under the existing supervisor temp directory. Driver and receiving worker-error logging share its sequence and synchronous full-write loop. A sticky writer failure forbids corrupt appends and records a fault where possible. The receiving runner keeps the original error through report and close failures. Parent stdout and stderr are separate diagnostic files and cannot supply receipts.

The parent reads only the file size captured at each drain, preserves byte offsets, decodes complete UTF-8 JSON lines, and checks contiguous sequences. It observes each completed receipt once and finally drains after exit. A complete killed-worker prefix needs no terminal marker. Empty, malformed, or truncated streams, changed file identities, reader/writer faults, missing metadata, or unexplained nonzero exits fail as instrumentation through the existing primaryObservationError. The offline verifier consumes the identical raw file and requires actual evaluated plus loader/V8 binding for the new module.

Pure evidence: 30 transport tests, 17 verifier controls, 10 unchanged checker controls and 2 root-setup controls pass. The high-volume fixture writes 4096 receipts (>1 MiB), then a 280000-byte multibyte receipt and a final receipt through the actual writer/reader. It compares all decoded payloads and exact raw bytes. These controls establish instrument sensitivity only.

TypeScript, all unchanged ESLint rules (partitioned by files at 1536 MiB after one whole-batch heap failure), and exact changed-file lint pass. The failed no-env setup invocation and broad-lint OOM remain retained. 511 production files, 11 shared files, the immutable retained-publication helper, seven material package maps and selected Node remain identical. No production/model/grammar/budget/registry/coverage edits, install, commit, push or PR.

After explicit exact reviewer acceptance, root conditionally admits one canonical run only in slot 2/worker 1 under the unchanged 384 MiB receiving heap, 1 GiB sampled group RSS, 20 s wall, 60 s outer test, and 20 s/384 MiB sequential verifier. Exact selector and launcher are in recipes-v5.json. Freeze actual outputs and STOP after that one run. Send outer/receiving PID/PGIDs for root's independent check; no retry.
