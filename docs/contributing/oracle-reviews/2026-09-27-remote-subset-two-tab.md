# Two-tab remote-subset browser oracle

- Reviewed oracle commit: `15301fd409fdebdc84eebbbf0ae9e1f095b3b26c`
- Comparison main: `d3c38c8f4e83cef4545e8011dc3419be1fcf527a`
- Owner: `packages/browser-db-sqlite-persistence/e2e/remote-subset-two-tab.opfs.spec.ts`
- Runtime: real Chromium, two same-origin pages, one OPFS database, QueryClient-backed on-demand source, filtered live-query Collection

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Pass within the stated scope. The browser coordinator's documented remote-subset contract keeps live `signal` and `subscription` references local while it transports clone-safe request data. Issue #1498 supplies the two-tab failure history. The test does not run React, Firefox/Zen, or a live backend. |
| ORC-002 | Pass. The fixed query input independently specifies the one expected public row and label. Neither the coordinator's transport projection nor its response computes that expectation. |
| ORC-003 | Pass for a fixed history. The test header states the law, model, history, driver, checkpoint, and limits. The adjacent fixture drives the real QueryClient, Collection, coordinator, BroadcastChannel, and OPFS path. |
| ORC-004 | Not applicable. This test executes one deterministic two-tab history. It makes no generated-history grammar claim. |
| ORC-005 | Pass. The follower's load carries `where`, `signal`, and a callback-bearing subscription. A remote-subset RPC post occurs, the follower makes no upstream Query call, and its public live-query row matches the fixed input after preload. An invalid nested function fails with its exact wire path before another post. |
| ORC-006 | Pass. A temporary mutant stored raw `options` instead of `transportedOptions` in the outbound acquisition. The focused test failed at follower readiness with four `DataCloneError` posts for the `AbortSignal`. This reached the intended browser path; it was not a setup failure or timeout. The mutant was removed, and the focused test passed again at the reviewed commit. |
| ORC-007 | Not applicable. This is not an important generated property. |
| ORC-008 | Not applicable. The fixed expected row adds no stateful reference model. |
| ORC-009 | Pass. The source and live-query Collection names follow the glossary. The follower post is a transport observation, not evidence that every provider request or browser host works. |
| ORC-010 | Pass. The test closes both pages and calls fixture cleanup. It keeps a primary mismatch separate from each cleanup error through an `AggregateError` cause and errors. It does not shrink or normalize a history. |
| ORC-011 | Not triggered. No plausible semantic fault shared by the fixed input model and transport implementation requires a second formulation. React rendering, Firefox/Zen, and a live backend remain unverified host boundaries. |
| ORC-012 | Pass. This versioned record accounts for ORC-001 through ORC-011 against the exact oracle commit above. |

At the reviewed commit, the complete Chromium OPFS suite passed 3/3 tests. The package TypeScript check, ESLint, Prettier, and `git diff --check` passed. The local pre-commit hook could not start `pnpm lint-staged` because pnpm tried to replace the worktree's linked dependency directory. Equivalent ESLint and formatting checks ran directly before the normal commit.
