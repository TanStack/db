---
'@tanstack/electric-db-collection': patch
---

Report an extended Electric outage in `collection.health`. After the Collection is ready, five failed requests to the shape log in a row, retried by the client or by an `onError` that returns a retry, show as the source node's `failureReason` with the fifth attempt's error, and the next applied up-to-date clears it. Shorter outages, and retried subset snapshot requests, leave health unchanged. A restarted or reloaded Collection resolves `awaitTxId` for a txid the previous sync run delivered only once it is ready again, instead of at once. When the stream fails, pending `awaitTxId` and `awaitMatch` calls reject with the failure instead of waiting for their timeout. An `onError` handler that throws now gives up the stream with its own error, without an unhandled rejection.
