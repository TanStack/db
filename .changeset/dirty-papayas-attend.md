---
'@tanstack/offline-transactions': minor
---

Add `isOnline()` method to `OnlineDetector` interface and skip transaction execution when offline

- `TransactionExecutor` now checks `isOnline()` before executing queued transactions, preventing unnecessary retry attempts when offline
- `notifyOnline()` now validates online status before notifying listeners, avoiding spurious execution when called while still offline
- Rename `DefaultOnlineDetector` to `WebOnlineDetector` (old name kept as deprecated alias)
- Custom `OnlineDetector` implementations (e.g., for React Native/Expo) can provide accurate network status to avoid futile server requests
