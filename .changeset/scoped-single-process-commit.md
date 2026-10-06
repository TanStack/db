---
'@tanstack/db-sqlite-persistence-core': patch
---

Fix a hang when a sync commit lands while a persisted collection hydrates on a scheduled driver, such as browser OPFS, with the default `SingleProcessCoordinator`. The coordinator now persists the replayed commit through the hydration-scoped adapter instead of waiting on the hydrate that holds the shared scheduler. Before, the commit receipt never settled and no collection on the same persistence became ready.
