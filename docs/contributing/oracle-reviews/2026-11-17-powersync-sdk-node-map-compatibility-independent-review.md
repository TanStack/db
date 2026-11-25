# Independent SDK Map compatibility review

Reviewed patch SHA-256:
`2b6561c2b2ba6865bd0cb989fc11e358e38cd7edca289134a87a960d8070f93e`.
SDK base: `3601c03398e34639632101fd22c6247e9495b3ae`.
The [proposal](2026-11-17-powersync-sdk-node-map-compatibility.md) and all five
source/test fingerprints match the isolated compatibility checkout.

**Verdict: approved for the four internal call sites and demonstrated native
Node 24/26 compatibility. No actionable source finding remains in that scope.**
This does not close validation of all maintained Node versions: Node 22 remains
unexecuted, as the proposal explicitly records. It is an upstream portability
proposal, not a finding against the SDK's existing Node-26 standalone policy.

## Independent semantic checks

The four maps are ordinary internal Maps with string or bucket-object keys.
Their factories construct a Bucket, RowState, BucketRowState or table Map;
none invokes user code or reenters its owning map. The replacement preserves
existing-entry identity, invokes the factory only for an absent key, and stores
the returned value. Using `has` preserves the difference between a missing key
and a present `undefined`.

A separate native experiment exercised eight cases on Node 24.19.0 and
Node 26.13.1. Node 26 compared the helper directly with its native
`getOrInsertComputed`; every compared result and final Map matched:

- Existing object identity, existing `undefined`, and computed `undefined`.
- A throwing factory with no map side effects.
- A factory inserting the same key before returning.
- A factory clearing the Map and reinserting before returning.
- Nested insertion for the same key.
- A factory mutating the same key and then throwing.

Reentrant insertion does not cause the callback's temporary value to win: both
implementations store the outer computed result after the callback returns.
Both propagate an exact thrown error and retain callback side effects. Thus
“a throwing factory inserts nothing” means no computed result is inserted by
the helper; it does not imply transactional rollback of the callback.

The experiment also confirmed a deliberately excluded native difference:
a missing numeric `-0` key reaches the helper's callback as `-0`, while native
Node 26 canonicalizes it to `+0`. None of the four call sites uses numeric
keys or observes that distinction. Subclass/overridden-method behavior and
invalid callbacks are also outside this internal helper's claim. This is not
a general polyfill.

## Independent execution

The proposal's full selected campaign passed independently on both native
launchers: **57 tests in five files on Node 24.19.0 and 57 on Node 26.13.1**.
A separate Vitest worker probe confirmed the workers actually ran those
respective versions. Node 24 has no native `getOrInsertComputed`; Node 26 does.
Both measured workers have the nearby iterator helpers and `Map.groupBy`.
No polyfill was installed.

Targeted strict TypeScript, `git diff --check`, reverse application on the
compatibility checkout and application checking on the separate checkout
holding the checkpoint patch all passed. No SDK source, installed dependency,
lockfile, built-in prototype, runtime declaration or production file was edited
by this reviewer.

The [immutable evidence](2026-11-17-powersync-sdk-node-map-compatibility-independent-evidence.json)
retains runtime facts, semantic results and independent log fingerprints.
Author-provided original-source RED logs match their declared fingerprints and
show the missing-method failure. This reviewer inspected them but did not
reproduce RED through a production-source edit.

## Remaining limits

Node 22 must execute the same native campaign before the downstream task claims
all maintained Node versions are validated. HTTP 403 during acquisition is a
setup blocker, not evidence of Node 22 semantic failure. Node 24's direct
evidence stands independently of Node 26's success.

The selected campaign uses the available downstream Vitest 5.1.0 dependency
installation and temporary source aliases/configuration. It does not certify
the upstream declared Vitest 4.1.10 installation, Node 20, all SDK tests,
browser bundles, an installed SDK release or the downstream Collection adapter.
The proposal correctly leaves those separate from this small compatibility
change and does not change the existing upstream runtime policy.
