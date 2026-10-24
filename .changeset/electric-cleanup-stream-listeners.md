---
'@tanstack/electric-db-collection': patch
---

Release the shape stream's visibility listener when a sync run is cleaned up. The Electric client registers a `visibilitychange` listener (an `AppState` listener on React Native) for each `ShapeStream` and removes it only in `unsubscribeAll()`, so aborting the stream left the listener behind, and the listener kept the stream reachable. An app that cleans up and recreates collections, or whose on-demand cache rotates its provider session, gained one retained stream each time.
