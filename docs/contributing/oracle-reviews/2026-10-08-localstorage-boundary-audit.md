# LocalStorage boundary audit: native writer values and peer publication

This self-review challenged the intersection of the LocalStorage guide's two
promises: an active same-tab Collection receives a peer's successful write at
the persistence receipt, and a default-JSON writer retains its authored JavaScript
value until that Collection restores. The primary executable owner is
`packages/db/tests/local-storage-peer-oracle.test.ts`; the mutation-order owner
remains `local-storage-order-oracle.test.ts`.

## Confirmed defect and repair

An active Collection authored a row containing `Date`. A same-tab peer then
inserted a disjoint row. The first Collection received that new row, but its own
`Date` became an ISO string without restoring. The previous Date witness stopped
at the first writer receipt; the peer histories used JSON-native values. Neither
crossed these two legal operations.

The peer oracle now compares the writer, peer, durable bytes, and fresh restore
at the second write's receipt. It also edits the Date row through the peer to
prove that a real same-key change still reaches the original writer. On
`256fbd0d9b258ee60ec489c1d171c8b89abb4f16`, the new disjoint-write witness
failed at the writer's public Date observation: it saw the ISO string. After the
repair, it passes. The repair keeps a same-token default-JSON row in its
authored representation when its serialized content is unchanged; it still
publishes changed content and every new-version row. Custom-parser comparisons
retain their previous behavior.

The violated law is bounded here to an active default-JSON writer, two
Collections sharing one Storage object and key, an authored Date field, a
disjoint successful peer write, and the second persistence receipt. The
same-key control and existing parser-normalization histories reject the
plausible overcorrection of ignoring all peer content changes. Other native
values, arbitrary `toJSON` side effects, many-operation histories, native
browser scheduling, distinct Storage wrappers, and simultaneous cross-tab
read-modify-write races are not established by this controlled host.

## Negative control

A separate peer-oracle witness installs a writer subscriber that throws only
after Storage contains the accepted row. The callback ran, and the persistence
receipt still fulfilled. The writer, peer, durable bytes, and fresh restore
contained the row. This experiment did not reveal a product defect; it checks
that application observation cannot revoke an accepted Storage write.

## Verification and code weight

The focused LocalStorage owners and examples passed 141 tests with no type
errors. The full database runtime suite passed 235 files and 11,393 tests.
Standalone source and test TypeScript checks, changed-file lint, package build,
and formatting passed. The production repair adds eight lines and removes one;
the oracle and contract record are counted separately.
