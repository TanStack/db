---
'@tanstack/electric-db-collection': patch
---

Report an extended Electric outage in `collection.health`. After the Collection is ready, five failed attempts in a row, retried by the client or by an `onError` that returns a retry, show as the source node's `failureReason`, and the next applied up-to-date clears it; shorter outages leave health unchanged. A restarted Collection no longer resolves `awaitTxId` from a txid the previous sync run delivered. An `onError` handler that throws now gives up the stream without an unhandled rejection.
