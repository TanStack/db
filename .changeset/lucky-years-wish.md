---
"@tanstack/db": patch
---

Fix a bug where selecting a prop that used a built in object such as a Date would result in incorrect types in the result object.
