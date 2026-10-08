---
'@tanstack/db': patch
---

Production builds no longer include developer hints such as the on-demand `preload()` warning, missing-index warnings, index suggestions, and the infinite-query window warning. Console messages about runtime failures, such as LocalStorage save errors and Effect handler errors, now use the short coded form with a link to the error codes page. A console warning says `TanStack DB warning <code>` instead of `error`. Development builds keep every message unchanged. An environment without `process.env.NODE_ENV`, such as a browser loading the package without a bundler, gets the production behavior, as it already does for errors. Production bundles get about 2.7 KB smaller minified (1.3 KB gzip).
