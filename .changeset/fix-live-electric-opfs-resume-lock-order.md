---
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/browser-db-sqlite-persistence': patch
---

Schedule ordinary persisted source commits before acquiring the browser writer lock, so they cannot deadlock with another Collection's hydration on a shared SQLite database. Add a real two-tab OPFS and live Electric recovery test for distinct schema versions and a torn legacy resume baseline.
