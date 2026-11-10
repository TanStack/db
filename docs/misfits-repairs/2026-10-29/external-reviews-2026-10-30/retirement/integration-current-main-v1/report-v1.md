# PR #2302 current-main composition

The complete retirement candidate is prepared and checked against current main in a separate worktree. Main was not already in the published PR history. No merge conflict or new review finding remains. The optional P3 calibration cleanup is still unapplied and awaits the user's one-at-a-time decision.

## Exact composition

Worktree: `/Users/kyle.mathews/programs/tanstack-db/.worktrees/review-pr-2302-main-9cfa`.

The worktree starts at published head `5e3cb22a4c94c9c64889bc6537976a62b8341dcf`, detached. The verified main `9cfa11fc712866f8f276e85762865ebb8bd49cbe` is not its ancestor; their merge-base is `bea84cd4554b7bd49df50cb0c569a34d8b2cd915`. An ordinary `git merge --no-commit --no-ff` completed automatically and is deliberately still in progress. The complete reviewed oracle/coverage patch then applied cleanly. Existing checkouts were not reset, rebased, aborted or otherwise changed. The original candidate's complete tracked and untracked contents were frozen first; it had exactly two changed tracked files and no untracked files.

The prospective final Git tree is `cef0e1818bf510f0ee8ed1ee151e5486e42c3ad0`, computed from the merge index plus unstaged files without writing Git objects. That computation was calibrated against the actual published HEAD tree. The full binary diff against published HEAD has SHA256 `e674c1226b26cd212ee14b879bc1a151480f60e6654650d5b910cb041e53d43f`; all checks recorded that same identity before and after. These are candidate-tree identities, not a new commit or pushed head.

## Main preservation and quality

Independent byte comparisons confirm that 23 of main's 26 changed files retain exact main bytes. The three composed files are the existing oracle coverage map, oracle property registry and oracle replay manifest. Their changes preserve main content and add the retirement registrations/coverage. This retains main's sourceProgress code and types, issue #2281 work and release-policy documentation. The diff against main contains only six intended PR files: loader repair, primary oracle, two registries, existing coverage rows and existing changeset. No process artifacts are included.

The production loader remains SHA256 `1dfb9733f02c56807b1deb7904d24e6331b815a8b12386fef7bdbf691fe6ea2a`. The oracle remains SHA256 `fbbaef1c6a2c43740517ff075de7dd0bf3e33219b2fcba1895f0c81e2ce0964f`. The narrow source composition audit inspected all six PR-scope diffs against main and found no new findings; its raw output is retained. It independently confirmed main preservation and exact oracle/production hashes. This is a bounded composition audit, not a new full review of unrelated main features.

## Verification

Slot 4 ran one command at a time with one Vitest worker and no file parallelism:

- `combined-neighbors-v1`: four affected suites, 104 tests pass on this exact composition.
- `combined-scoped-types-v1`: scoped TypeScript passes.
- `combined-lint-v1`: lint:changed passes.
- `combined-format-v1`: all four composed test/coverage/registry files pass Prettier.
- `combined-diff-check-v1`: passes.

The combined receiving campaign reaches held answers in both consumers: fixed Collection 47 / Effect 55, random Collection 49 / Effect 53, all above minimum 20. Offline frozen dependency installation succeeded without overrides or tracked dependency changes. Slot 4 is released and has no active execution session.

The earlier original 104-test and 55-test results remain attributed to their earlier worktree/hash records. This new 104-test run supplies exact-composition evidence rather than relabeling those historical results. Original RED and hostile-mutant records are retained; composition introduces no new product law or production change beyond the already reviewed branch.

## Remaining gate and readiness

PREP-RET-R01 remains fixed-now. PREP-RET-S01 remains the sole optional P3 suggestion, not an accepted-law enforcement gap. Its concrete patch applies cleanly to this composed tree; it has not been applied. If the user accepts it, apply the explicit calibration records, rerun the focused checker and static checks, and freeze the resulting new tree identity before the final prep-pr gate.

No commit, push, PR edit, changeset phase or PR-body phase occurred. The existing changeset remains unchanged. The root coordinator owns the user decision and final documentation/publication gate. Whole-PR readiness remains unproven until the approved final candidate is committed/published and its final-head CI and any intended companion integration are verified.
