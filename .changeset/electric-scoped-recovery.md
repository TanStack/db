---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
'@tanstack/browser-db-sqlite-persistence': patch
'@tanstack/node-db-sqlite-persistence': patch
'@tanstack/expo-db-sqlite-persistence': patch
'@tanstack/react-native-db-sqlite-persistence': patch
'@tanstack/electron-db-sqlite-persistence': patch
---

Recover on-demand Electric collections with uncertified persisted state by rotating their SQLite cache and reloading only demanded subsets. Fence retired provider sessions and expired cache claims, preserve warm runs on their claimed cache generation, and forward claim lifetime options through SQLite host factories. Forward managed cache operations and claim checks through Electron IPC protocol v3.
