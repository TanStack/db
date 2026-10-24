# Auth fixture dependency update

Reviewed dependency commit: `bae01f788134aa421a9018278ec6d2867519dae3`.
This is an addendum to the [public application receiving review](2026-10-24-convex-public-apps.md).
That earlier record remains an accurate account of its historical source and
runtime versions. This update reviews the new dependency resolution and receiving
evidence, it does not repeat the full oracle audit or claim new oracle behavior.

The private auth fixture now uses `@convex-dev/auth` 0.0.96 and `@auth/core`
0.41.3, replacing 0.0.90 and 0.37.4. Only its package manifest and corresponding
lockfile entries changed in the reviewed commit. The pinned upstream business
functions, provider substitution, models, assertions, and setup code are unchanged.
No dependency override, security exemption, or shipped production code change was
introduced.

## Independent checks

The reviewer inspected the complete dependency diff and queried published npm
metadata for `@convex-dev/auth` 0.0.96. Its declared peers are:

| Peer | Declared range | Resolved fixture version |
| --- | --- | --- |
| `@auth/core` | `^0.41.1` | `0.41.3` |
| `convex` | `^1.17.0` | `1.47.0` |
| `react` | `^18.2.0 || ^19.0.0-0` | `19.2.4` |

All three resolutions satisfy the published peer ranges. The old Auth.js and
Convex Auth resolutions are absent from the lockfile. Auth.js now resolves its
own `jose` 6.2.12 dependency, while Convex Auth and the fixture's signing-key
setup retain their separate `jose` 5.10.0 resolution. These are ordinary package
resolutions, not a forced shared version. CI runs Node 22.13.

The reviewer also queried both official GitHub advisory APIs:

- [GHSA-7rqj-j65f-68wh](https://github.com/advisories/GHSA-7rqj-j65f-68wh)
  identifies the Auth.js email-normalization issue and lists 0.41.3 as the first
  patched `@auth/core` version.
- [GHSA-xmf8-cvqr-rfgj](https://github.com/advisories/GHSA-xmf8-cvqr-rfgj)
  identifies malformed Bearer-header handling and likewise lists 0.41.3 as the
  first patched version.

The selected Auth.js version is the published patched version for both reported
advisories, and its companion Convex Auth version explicitly supports that peer
range. This establishes the dependency remediation for those alerts, not an
independent reproduction of either security exploit or an absence of other
vulnerabilities.

## Receiving evidence and scope

The root agent reports the complete 17-test backend suite passing after the
upgrade, including the final full auth permission matrix and equal-body message
multiplicity checks, with 34.02 seconds of test execution. Package typecheck also
passed. The reviewer inspected the dependency resolution independently, but did
not rerun this suite or the prior mutants.

This fresh run receives the existing application laws with the updated auth
runtime: genuine Anonymous sign-in and JWT use, unauthenticated rejection,
invalid-token rejection, read/write/admin permission transitions, demotion, and
public Collection rows after source acceptance. The six public pagination
histories and existing nine backend tests also passed in that combined run.
The earlier record's mutant calibrations remain attributed to their original
runs, they are not presented as new controls executed against these versions.

The upgrade does not change the models or their legal histories, so their
independence, bounded observations, and cleanup judgments remain as described in
the earlier record. The changed receiving premise is the installed auth runtime;
the new complete backend run supplies compatibility evidence for that premise.
This does not test email-provider normalization or every malformed Bearer-header
case, the patched-version claim comes from the official advisories.

The fixture still adapts a pinned public app rather than installing its original
lockfile. The local Rust backend remains selected by the installed Convex CLI,
its binary version was not recorded. Cloud infrastructure, third-party OAuth,
email delivery, browser components, token refresh/revocation, authenticated
reconnect, and arbitrary network schedules remain outside these receiving tests.
