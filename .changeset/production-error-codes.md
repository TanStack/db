---
'@tanstack/db': patch
---

Shorten error messages in production builds to a code, the inputs that the error can show (as JSON), and a link to the new error codes page, for example `TanStack DB error 17 (key=1, collectionId="todos"): https://tanstack.com/db/latest/docs/errors#error-17`. Development builds keep the full messages, and `SchemaValidationError` keeps its full message in production too. Error classes, `name` values, `instanceof`, and error fields do not change. Production bundles get about 8.1 KB smaller minified (3.2 KB gzip).
