---
'@tanstack/offline-transactions': minor
---

Add `isOnline()` method to `OnlineDetector` interface and skip transaction execution when offline

This prevents unnecessary retry attempts when the device is known to be offline. The `TransactionExecutor` now checks `isOnline()` before attempting to execute queued transactions. Custom `OnlineDetector` implementations (e.g., for React Native/Expo) can provide accurate network status to avoid futile server requests.
