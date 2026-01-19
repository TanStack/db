# Offline Transactions - React Native Demo

This example demonstrates offline-first transactions using TanStack DB on React Native / Expo.

<video width="400" controls>
  <source src="https://github.com/user-attachments/assets/c73450c6-27e1-49a7-9174-413177f5e37e" type="video/mp4">
  Your browser does not support the video tag.
</video>

## Features

- Offline transaction queuing with AsyncStorage
- Automatic sync when coming back online
- Network status detection using `@react-native-community/netinfo`
- App state detection (foreground/background)

## Prerequisites

- Node.js 18+
- pnpm
- Xcode (for iOS simulator) or Android Studio (for Android emulator)
- Expo Go app on a physical device (optional)

## Setup

From the monorepo root:

```bash
# Install dependencies
pnpm install

# Build the packages
pnpm build
```

## Running the App

```bash
# Navigate to this example
cd examples/react-native/offline-transactions

# Install dependencies (if not already done)
pnpm install

# Start the backend server (in one terminal)
npx tsx server/index.ts

# Start the Expo dev server (in another terminal)
pnpm start

# Or run directly on iOS simulator
pnpm ios

# Or run directly on Android emulator
pnpm android
```

The backend server runs on port 3001 and is shared by all emulators/devices. This allows you to test real syncing between multiple devices.

## Testing Sync Between Devices

1. **Start the server** with `pnpm server`
2. **Run the app on two emulators** (e.g., iOS + Android, or two Android emulators)
3. **Add a todo on one device** - It syncs to the server
4. **Pull to refresh on the other device** - You'll see the new todo

## Testing Offline Mode

1. **Add todos while online** - They sync immediately to the backend server
2. **Enable airplane mode** on your device/simulator
3. **Add more todos** - They're queued locally in AsyncStorage
4. **Disable airplane mode** - Queued transactions sync automatically

## Architecture

- **AsyncStorageAdapter**: Implements `StorageAdapter` for React Native using `@react-native-async-storage/async-storage`
- **ReactNativeOnlineDetector**: Uses `NetInfo` and `AppState` to detect connectivity changes (imported from `@tanstack/offline-transactions/react-native`)
- **todoCollection**: TanStack DB collection with live queries
- **Offline actions**: Create, toggle, delete todos with optimistic updates

## Key Differences from Web

| Web | React Native |
|-----|-------------|
| IndexedDB / localStorage | AsyncStorage |
| `window.addEventListener('online')` | NetInfo.addEventListener |
| `document.visibilitychange` | AppState.addEventListener |
| Import from `@tanstack/offline-transactions` | Import from `@tanstack/offline-transactions/react-native` |
