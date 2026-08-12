---
'@tanstack/react-db': patch
---

fix(react-db): Avoid using refs to track changes in React hooks.

Using refs to track previous versions of variables, and reading those refs
during render, is an anti-pattern that breaks the Rules of Hooks and may lead to
subtle bugs, especially in concurrent mode.

Using state instead is more idiomatic and ensures there will be no state
tearing, even during concurrent mode updates.
