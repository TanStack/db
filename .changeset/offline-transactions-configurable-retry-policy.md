---
"@tanstack/offline-transactions": minor
---

Allow overriding the retry policy via `OfflineConfig.retryPolicy`.

`startOfflineExecutor` previously always used the built-in `DefaultRetryPolicy`, whose `shouldRetry` hard-codes which errors are treated as non-retryable (it drops any error whose message includes `400`/`401`/`403`/`422`), with no way to change it. You can now pass a `retryPolicy` to `OfflineConfig` to control retry classification and backoff — or subclass the exported `DefaultRetryPolicy` and override `shouldRetry`. When omitted, behavior is unchanged.
