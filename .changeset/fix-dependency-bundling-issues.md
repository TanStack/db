---
"@tanstack/offline-transactions": patch
"@tanstack/react-db": patch
"@tanstack/query-db-collection": patch
---

Fix dependency bundling issues by moving @tanstack/db to peerDependencies

**What Changed:**

Moved `@tanstack/db` from regular dependencies to peerDependencies in:
- `@tanstack/offline-transactions`
- `@tanstack/react-db`
- `@tanstack/query-db-collection`

Removed `@opentelemetry/api` dependency from `@tanstack/offline-transactions`.

**Why:**

Having `@tanstack/db` as both a regular dependency and a peerDependency caused bundling conflicts where multiple versions of the package would be installed. This led to errors like "multiple instances of @tanstack/db detected" in consuming applications.

By declaring `@tanstack/db` only as a peerDependency (and keeping it in devDependencies for local development), we ensure:
- Only one version of `@tanstack/db` is installed across the application
- No bundling conflicts or duplicate installations
- Consumers have full control over which version of `@tanstack/db` they use
- The temporary pnpm override workaround is no longer needed

This follows the standard pattern for library packages that depend on a core package - they should declare it as a peer dependency rather than bundling their own copy.
