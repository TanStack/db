---
'@tanstack/react-native-db-sqlite-persistence': patch
---

Decode op-sqlite row arrays and columnar results losslessly, and reject malformed or unknown result envelopes instead of treating them as empty results.
Custom wrappers that return a genuinely ambiguous bare array can set `arrayResultMode` to `rows` or `statement-results`; without that authoritative mode, the driver rejects instead of silently reshaping data.
