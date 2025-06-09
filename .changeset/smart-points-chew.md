---
"@tanstack/db-collections": patch
"@tanstack/db-example-react-todo": patch
"@tanstack/db": patch
---

Switch to Collection options factories instead of extending the Collection class

This refactors `ElectricCollection` and `QueryCollection` into factory functions (`electricCollectionOptions` and `queryCollectionOptions`) that return standard `CollectionConfig` objects and utility functions. Also adds a `createCollection` function to standardize collection instantiation.
