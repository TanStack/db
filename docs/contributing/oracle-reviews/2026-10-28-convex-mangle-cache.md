# Convex integration minifier cache, October 28

Source parent: `48a6c492a6e00439467ee8b0ec9dfafe8ea95aa6`.
PR workflow 40622732106, job 122600360701, failed `pnpm check:mangle`:
`failQuery` was also used by the Convex backend fixture's public control field.
Main's new private method was therefore unsafe under the existing cache policy.

The authority is `scripts/mangle-private-members.mjs`: every cache key must be
private-only, with no matching property use in another package. Its supported
`--write` generator preserves safe assignments and removes unsafe names.
Running it removed exactly `failQuery: gZ`, added no names, and changed no
source behavior, model, grammar, comparison, fixture schema or public API.
Renaming the fixture or excluding it from the checker would hide the collision.

RED: `pnpm check:mangle` reproduced the same unsafe-entry failure locally.
GREEN: the regenerated 439-name cache passes that command. A fresh minified DB
build passes `pnpm test:minified-db`, checking 114 exported error names, index
metadata, query rows and live updates. The rest of that CI job's checks also
pass locally: client-only query bundle checks, production error text checks
(263 literals, including 22 shared), and all 318 built-dist cases in five files.
Changed lint passes. Existing minified and dist oracles supply unchanged public
behavior checks; this cache repair adds no new law or generated-history claim.
Fresh remote CI is required before declaring the new head ready.

`pnpm size:compare --base HEAD --exact-base --packages db --no-scenarios`
measures DB at 108498 to 108501 gzip bytes (+3) and +26 brotli bytes. The
private method keeps its full name to meet the existing public-property safety
policy; no extra recovery machinery or runtime branch was added.
