---
'@tanstack/db': patch
---

Shorten error messages in production builds to a code, the inputs that the error can show (as JSON), and a link to the new error codes page, for example `TanStack DB error 17 (key=1, collectionId="todos"): https://tanstack.com/db/latest/docs/errors#error-17`. This covers the exported error classes and the plain `Error`, `TypeError`, and `AggregateError` values the library throws. An unbundled environment without `process` also gets the short form. Development builds keep the full messages, and `SchemaValidationError` keeps its full message in production too. Error classes, `name` values, `instanceof`, and error fields do not change. Production bundles get about 14.4 KB smaller minified (5.7 KB gzip).
