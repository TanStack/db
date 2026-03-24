# React Native Shopping List (Electric + Persistence + Offline Queue)

This example uses:

- `electricCollectionOptions` for realtime sync from Electric shape streams
- `persistedCollectionOptions` with React Native SQLite persistence
- `@tanstack/offline-transactions` for queued optimistic mutations and retry
- A local Express + Postgres API that returns `txid` values for Electric mutation matching
- Dedicated API shape proxy endpoints (`/api/shapes/*`) so Electric is not exposed directly to clients
- In-app `Simulate offline` toggle to demo offline queue + persistence behavior without disabling device network

## Run

From `examples/react-native/shopping-list`:

1. Start Docker Desktop (required for Postgres + Electric).
2. Start Postgres + Electric:
   - `pnpm db:up`
3. Start the API server in a separate terminal:
   - `pnpm server`
4. Start Expo in another terminal:
   - `pnpm start`
5. Launch iOS simulator:
   - `open -a Simulator`
   - then press `i` in the Expo terminal (or run `pnpm ios`)
6. Launch Android emulator:
   - start an AVD from Android Studio Device Manager
   - then press `a` in the Expo terminal (or run `pnpm android`)

## Troubleshooting

- If the server exits at startup, ensure Docker services are running and re-run `pnpm db:up`.
- Android emulator uses `10.0.2.2` for local host mapping.
- iOS simulator uses `localhost`.

## Verification checklist

- Add list and items while online: changes should sync and persist.
- Restart app: local data should load from SQLite immediately.
- Restart API/Electric: app should recover and continue syncing.
- Confirm there are no `Date value out of bounds` errors in shape sync logs.
