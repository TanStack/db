# CI type integration follow-up

Parent: `23a097ca6716384c4e8b29bc68b032b9152dded3`.

PR workflow 40569615912 failed at two type boundaries. The React receiving witness accessed an optional Collection during cleanup without narrowing it. The documentation checker rejected five Electric examples whose untyped key callbacks returned `unknown`.

The React cleanup callback now checks for a missing Collection, throws if absent, and otherwise performs the same cleanup. Its independent model, page histories, publication recorder, and comparisons remain unchanged. This is a test typing repair, not a product behavior change or new oracle closure claim. Earlier law, reach and mutant evidence retains its original source binding.

The Electric examples declare the string ID expected by their key callbacks. The schema/parser example imports Zod so its output type includes Date and Electric can infer the matching parser extension. No casts, suppression, baseline additions, or runtime changes were introduced.

Validation: rebuilt DB; all four React receiving cases passed with Vitest typechecking reporting no errors. The full documentation check passed all 769 examples against the existing baseline: zero new failures, 276 known failures, including 61 parse failures. Changed-file oracle lint and targeted React ESLint passed. The RED evidence is the parent CI log, including React TS18048 at cleanup and five Electric TS2769 diagnostics. These checks establish type integration and the existing four React page-size histories, not a new product law or cloud-provider guarantee.
