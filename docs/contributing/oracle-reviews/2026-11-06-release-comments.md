# Release notification selection: 2026-11-06

This is an author self-review. The source fingerprints below identify the
reviewed implementation and oracle in the commit that first adds this record.
No library package source or shipped JavaScript changes.

## Law and boundary

Each published package contributes PRs from its complete version's changelog
section only. A PR receives its contributed packages; a linked issue receives
the union of packages and PR references. Repeated references do not duplicate
notifications. Changelog links use the complete heading's GitHub anchor.

Authority: [the shared action README at the pinned revision](https://github.com/TanStack/config/blob/e4b48f16568324f76f467aa4c2aac2f05db632c3/.github/comment-on-release/README.md),
its documented Changesets integration, and the maintainer's 2026-11-06 decision
to use the repaired local copy. CONTRIBUTING.md records the local boundary.
The failed release selected `1.0.0` from a published `1.0.0-rc.1.4`; the complete
version could never match. Stable headings could also absorb neighboring RCs.

The new owner is `scripts/release-comments-oracle.property.test.js`.
The existing release-history owner judges version/publish planning, not
notification selection. A separate structured release ledger supplies the
independent notification judgment. It does not parse Markdown or import the
production parser. Its semantic version tokens also supply expected anchors.
The driver serializes that ledger, invokes the real script, supplies successful
GitHub API answers through a fake `gh`, and records every command. The comparison
checks comment targets, package/version/anchor links and issue PR references
at script exit. It preserves duplicate commands and ignores noncontractual
comment ordering and surrounding prose.

## Executed evidence

- **Reach:** All 67 finite histories ran. Stable 25; prerelease 42; build
  metadata 24; reversed sections 32; linked issues 35; no linked issues 32;
  no matching PRs 3. Every declared state has a failing minimum of one.
- **RED:** Before adding the local production copy or changing the workflow,
  the oracle ran against the exact script retrieved from pinned upstream
  `e4b48f16568324f76f467aa4c2aac2f05db632c3`. The Node campaign had 64 notification
  assertion failures and 3 passes. After moving unchanged semantics to the
  existing Vitest runner, the same source again had 64 assertion failures and
  3 passes. Both runs reached the intended comparison; neither was a setup RED.
- **GREEN:** `pnpm test:release` passed all 11 existing release tests and all
  67 notification histories. A final measured oracle run also passed all 67.
- **Mutant:** Self-generated prefix, section-leakage and anchor mutations each
  failed `checkNotifications` after successful script exit. These are value
  assertion failures, not crashes, timeouts or setup failures. All temporary
  mutants stayed outside the repository. The original parser is rejected too.
- **Limits:** Successful controlled API calls and no existing release comments
  are premises. This does not establish authentication, actual GitHub delivery,
  pagination, API errors/retries, cross-release duplicate suppression,
  concurrency, arbitrary Markdown or foreign-repository links. The coverage
  map assigns those extensions to this owner; real delivery needs a separately
  authorized host observation. No manual release comments were posted.

The pre-production RED used:

```sh
TANSTACK_DB_RELEASE_COMMENT_SCRIPT=/tmp/db-ci-2026-11-06/upstream-release-comments.ts \
  node --test scripts/release-comments-oracle.test.mjs
```

That filename was then moved to the repository's existing Vitest convention;
its judgment did not change. The current direct replay uses the same ledger,
driver and check as the full campaign:

```sh
TANSTACK_DB_RELEASE_COMMENT_CASE=9 pnpm exec vitest run \
  --config scripts/oracle-scripts.vitest.config.mjs \
  scripts/release-comments-oracle.property.test.js
```

`TANSTACK_DB_RELEASE_COMMENT_SCRIPT` selects an absolute temporary script for
RED or mutant runs. The original upstream source is available via
`git show` in TanStack/config at the pinned revision. Replay cases 0, 8, 9 and
21 cover stable section boundaries, prefix neighbors, the reported RC form
with linked issues, and build-metadata anchors with linked issues respectively.

| Mutant | Exact local edit | Replay | Result |
| --- | --- | --- | --- |
| Prefix | Replace `line.slice(3).trim() === version` with `line.slice(3).trim().startsWith(version)` | 8 | Extra neighboring PRs rejected |
| Section | Replace the next-section `break` with `continue` | 0 | Extra PRs, including Archive PR 999, rejected |
| Anchor | At both comment sites replace `/[.+]/g` with `/\./g` | 21 | Wrong package links rejected for PRs and issues |

## Oracle requirements

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Authority, scope and the script-exit checkpoint are stated above and in the executable owner. |
| ORC-002 | Expected notifications come from authored release records and sets; production scans Markdown. No semantic production helper is shared. |
| ORC-003 | Contract, model, grammar, driver and comparison each have adjacent explanatory prose. |
| ORC-004 | Reconstruction includes the reported RC and stable leakage. Eight version forms, two numeric cores, both section orders and linked/unlinked routing yield 64 histories; missing version, empty section and empty publication add three. Removing suffixes, neighbors, order, repeated links, shared packages or issue routing loses the corresponding witness. The numeric core 2.9.10 is the marginal multi-digit case. Unique plain version headings and same-repository PR links are constructed; duplicate headings and foreign links are excluded. |
| ORC-005 | The executable runs to exit against real temporary changelogs and a command recorder that retains duplicates. All needed release and issue facts are supplied by that cut; no concrete missing-input hypothesis remains within this boundary. |
| ORC-006 | Original parser plus three mutants fail the notification value comparison. |
| ORC-007 | No stochastic campaign applies: this finite grammar exhausts every case on each run and supports direct index replay. No random coverage is claimed. |
| ORC-008 | Not applicable: expected notifications are a stateless ledger recomputation, not a transition model. |
| ORC-009 | The ledger is model-only structured release input; serialization maps it to production changelogs and published-package environment variables. It does not model Collection lifecycle concepts. |
| ORC-010 | The primary comparison failure and secondary cleanup error remain distinguishable in AggregateError; temporary workspaces are removed. No shrinking changes the checkpoint. |
| ORC-011 | No independently motivated shared-fault hypothesis requires another formulation. Anchor normalization is independently derived from semantic tokens. Arbitrary GitHub heading rules remain outside the finite claim. |
| ORC-012 | This versioned self-review records evidence, scope and source fingerprints. |
| ORC-013 | Stable/RC neighbors, rc.1.4/rc.1.40, next-section Archive and plus/uppercase build forms distinguish nearby wrong rules. |
| ORC-014 | Claims stop at recorded gh arguments. Actual GitHub delivery is explicitly unresolved; no controlled-host result is credited as real delivery. |
| ORC-015 | A failing minimum guards all seven declared states; measured counts are above. |
| ORC-016 | All histories use one independent model, production driver and check. No separate expected answers or unit examples are in the owner. |

## Source fingerprints (SHA-256)

- `scripts/comment-on-release.ts`: `ff2f10019db887e05ad49b25b6a3149c0a5afc4db723912982aab38eb439fa62`
- `scripts/release-comments-oracle.property.test.js`: `17d0592e949bcd4acb52493f97b3150acabe8ca95e940c0bcb3ffbba8fb9b244`
- `.github/workflows/release.yml`: `197fbc9a86934f799e2982cc5be242b24486b36b8c73cdc8769dbdd756e19d5f`
- `package.json`: `2d495c2b15e37344aa5fd93f8ddece809f981b2a6847151ad03386f007522f0f`
