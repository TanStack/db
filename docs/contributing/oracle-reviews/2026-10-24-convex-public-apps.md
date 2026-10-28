# Public Convex application receiving review

Reviewed source and test commit: `4223c39a6d5c2b2e2fedb1a7eee3c0052b5e5013`.
This independent review covers the new public pagination and authenticated app
receiving tests, their pinned-source setup, `local-backend.ts`, and
`network-gate.ts`. It found no adapter defect. This commit changes test and
integration setup, dependencies, and documentation, with no shipped production
code change.

The reviewer inspected the committed test and setup files and fetched the pinned
upstream message functions, schema, auth functions, and permission implementation
through GitHub's API. The execution results below are attributed to the authors
and root agent. The reviewer did not rerun the backend suites or the production
mutants for this review.

## Sources and observed evidence

The pagination source is [get-convex/convex-demos at
2fac21e360bfcceae6065096f1b81480bd8c6fd5](https://github.com/get-convex/convex-demos/tree/2fac21e360bfcceae6065096f1b81480bd8c6fd5/pagination).
The actual functions are deployed unchanged from `git archive` of that commit.
The optional local checkout must have that HEAD, and archive reads the pinned
object rather than dirty worktree files. The local app shell and SDK dependency
are supplied by the test. Upstream declares Convex 1.48, while this fixture
intentionally deploys with the package's installed Convex 1.47 SDK/CLI and the
CLI-selected local Rust backend release. The binary version was not recorded,
so this record does not assign it the SDK's version.

The auth source is [get-convex/convex-auth-with-role-based-permissions at
45f08008e1257758560948db4280cc4e7d64e84a](https://github.com/get-convex/convex-auth-with-role-based-permissions/tree/45f08008e1257758560948db4280cc4e7d64e84a).
Setup verifies the fetched HEAD and copies the message functions, schema, auth
routes, and permission library into an ignored runtime. The one deliberate
application adaptation replaces GitHub/Resend providers with Convex Auth's
Anonymous provider. The replacement checks the expected pinned source text.
Server permission checks and role updates retain upstream behavior. The fixture
uses `@convex-dev/auth` 0.0.90 and `@auth/core` 0.37.4, rather than the upstream
app's older declared 0.0.71 and ^0.34.1. It does not install the upstream lockfile.
Fresh signing keys allow a genuine sign-in and JWT without third-party
credentials.

Reported execution evidence:

- All 17 combined backend tests passed before the final auth history extension.
  That run included the existing nine backend tests and all eight new public-app
  histories, six pagination and two authentication.
- After the last extension, both auth client histories passed with every
  role/operation pair, two successful equal-body sends, and two deletions. This
  is targeted evidence for the final auth changes, not a claim that the reviewer
  reran the full combined suite at the reviewed commit.
- The root agent reported 62 adapter checks, package typecheck, and lint passing
  for the final source. The author reported all six public pagination histories
  passing after the continuation control was restored, using default fresh
  GitHub fetch/archive setup rather than the local-source override.
- A stale runtime sentinel was removed by actual auth preparation. This checks
  the fresh-runtime prerequisite rather than assuming a previous teardown ran.

Calibration evidence is distinguished from successful execution:

| Control | Reported result and checkpoint |
| --- | --- |
| Disable automatic continuation | With the proper selector `mirrors list through`, both actual SDK histories failed the immediate ordered `select` comparison after preload. JavaScript exposed three rows instead of the ledger's 17, React three instead of 34, because successful writes from the earlier selected history remained in the shared backend. These were assertion failures at the named checkpoint, not timeouts or setup errors. |
| Initial selector containing a literal `>` | It matched no tests. This was an unreached path and is not counted as a mutant kill. |
| Bypass upstream role checks in a temporary prototype | The author changed the pinned permission function's final numeric comparison to `return true`, preserving user/role existence checks, and let the real backend redeploy. The first read/send denial assertion received a resolved `null` instead of rejection, one failed/one skipped test, with no timeout or setup failure. The original source was restored and both SDK histories passed through their own pinned-source setup. This control used the earlier five-step history; the final expanded history retains that first read/send cell. It was not rerun as a mutant at the frozen commit. |

## Requirement outcomes

| Requirement | Outcome and evidence |
| --- | --- |
| ORC-001, authority and limits | Satisfied for these receiving claims. Upstream pagination functions establish newest-first order, indexed author membership, and uppercase body/author-initial transformation. The upstream permission function and message endpoints establish read/write/admin access. The adapter's existing source snapshot and complete eager pagination contracts establish the Collection observations. The tests do not authorize a new provider or adapter behavior. Pins and adaptations are explicit. |
| ORC-002, independent judgment | Satisfied. Pagination's expected rows come from an authored ledger of successful sends, reversed and optionally filtered/transformed according to the upstream query contract. Expected rows do not come from the adapter, a paged query, or SDK cache. Auth uses a set-valued role policy rather than copying upstream's numeric role comparison, and a body multiset rather than server-generated IDs. Actual IDs are used only to target deletion, not to compute the expected message count. |
| ORC-003, literate responsibilities | Satisfied. Both files explain the upstream authority, reference computation, authored histories, real SDK/Collection path, public observations, and limitations before mechanics. Comments identify the shared-backend ledger prerequisite, stable keys for transformed rows, role-update adaptation, denied operations, and reconnect cut. Setup and README describe which upstream code is deployed and which authentication provider is substituted. |
| ORC-004, generated grammar controls | Not applicable, these are fixed authored receiving histories rather than generated properties. Their finite scope is still explicit: both SDKs cross all three pagination query forms at page size three; the auth history crosses all six role/operation cells, demotion, two equal-body successful sends, and deletion of one occurrence at a time. Unique pagination bodies remain unique after uppercase conversion, excluding the transformed-key ambiguity that would make those histories invalid. Arbitrary operation sequences, page sizes, role values, token lifetimes, and malformed protocols are not generated or claimed. |
| ORC-005, production path and observation | Satisfied. Both drivers use actual SDK clients, actual deployed upstream functions, and real Collections. Pagination compares ordered input to `select` immediately after initial preload, then compares keyed public rows after source acceptance. Later checkpoints poll for the expected source revision before checking the public Collection. Auth waits for each real mutation outcome, then source acceptance, and compares marker multiplicity after both permitted and denied operations. Unauthenticated Collection preload and invalid-token HTTP query are distinct controls. No concrete missing-input hypothesis remains for the stated cuts. |
| ORC-006, calibration | Satisfied with the attributed controls above. Disabled continuation fails immediate source-order comparison on both clients. Bypassed server permission checks fail denial observations. The skipped initial selector is excluded from calibration. These controls target two specific wrong designs, they are not an exhaustive mutation campaign. |
| ORC-007, generated campaigns and replay | Not applicable, there is no generated property or `fc.commands` history in these new receiving files. Each named query/client history is directly selectable. Pinned source commits and fresh local deployments support reconstruction, but they are not seed/path replay or random campaigns. Existing primary pagination and offline owners retain those generated campaigns. |
| ORC-008, state minimality | Satisfied for the reference histories. Pagination retains successful messages in insertion order because later queries need their values, author membership, and reverse order, including writes from earlier histories against the shared backend. Counts alone cannot predict those observations. Auth's multiset must retain multiplicity because two identical sends create two rows and deleting one leaves one. Collapsing them to a set predicts the wrong intermediate public snapshot. Server IDs and timestamps are deliberately omitted from the model because the compared projection and legal deletion targets do not require predicting them. |
| ORC-009, vocabulary and abstraction | Satisfied. Collection rows, source acceptance, public snapshot, and cleanup retain the glossary meanings. The pagination ledger models successful application sends, not provider subscriptions or core sync transactions. Auth bodies abstract away server IDs while preserving the multiplicity that the observations need. TCP gate state is transport availability, not Collection readiness. The invalid-token HTTP control does not establish invalid-token WebSocket behavior. |
| ORC-010, failure fidelity and cleanup | Satisfied for the exercised harness. Registered Collection, SDK, TCP gate, backend, checkout, and runtime cleanup uses the existing calibrated withTestCleanup instrument. It preserves a primary comparison or setup error while reporting secondary release failures and attempts subsequent releases. The local backend startup catch now preserves the startup cause if stopping fails. Auth records its runtime path before preparation, clears stale contents before copying, and can clean a partial preparation. The runtime is scoped and ignored. This review inspected those paths; it does not claim fault injection at every construction instruction or process-kill cleanup. |
| ORC-011, independent second formulation | Satisfied for the concrete shared-fault concern motivating these witnesses. Adapter-authored backend functions could reproduce the same assumptions as the adapter and primary numeric range fixture. These tests instead deploy independently maintained public application functions at verified pins and compare them with an authored operation ledger or permission table. Auth's permission table differs structurally from upstream numeric hierarchy. No additional concrete shared semantic fault was identified that requires another model. This is not an exhaustive absence claim. |
| ORC-012, review evidence | Satisfied by this versioned record tied to the exact source/test commit. It distinguishes independent inspection from author/root execution, records the unreached control, reports the harness/provenance repairs, and retains scope limits. No adapter bug-class closure is claimed by these test-only changes. They receive existing laws at additional application and transport boundaries. |
| ORC-013, distinguishing boundary witnesses | Satisfied within the fixed cases. Authentication distinguishes no identity, an invalid token, and a genuine signed token accepted by server functions. The role history distinguishes read from write for send, write from admin for delete, and demotion after a successful write; every role/operation cell is exercised. Two equal-body sends followed by single deletions distinguish multiplicity from set membership. Pagination crosses one page into several with 17 initial appends at page size three, and includes another author to distinguish indexed membership from an unfiltered mirror. These fixed witnesses do not establish arbitrary thresholds or workloads. |
| ORC-014, controlled-premise handoff | Satisfied for the named receiving premises. Both actual SDK clients and a real local backend now supply cursor pagination, query transformation, successful/denied authenticated mutations, and subscribed source updates. A real auth action issues the tested JWT, neither setAdminAuth nor a fabricated identity supplies the tested user. The TCP gate forwards uninterpreted bytes, destroys live connections, and refuses new ones while closed. The test waits for the adapter client's public connection state to become disconnected before an independent direct writer commits. Old rows remain public; later ledger rows must arrive after reopening the gate. This receives real SDK reconnection, without protocol-message simulation. These app-specific ledgers and histories do not literally reuse the primary numeric fixture grammar, they require different expected application fields and auth policy. Their relationship is source snapshot refinement and complete finite acquisition; shared-law drift remains a reason to keep the primary owners and pinned-source review. |

## Repairs and remaining limits

Review identified setup and evidence gaps, with no adapter defect:

- Auth runtime contents needed an ignore rule and a fresh-copy prerequisite.
  Both are present at the reviewed commit, and the known runtime path is
  registered before copying so partial setup can be removed.
- Local backend startup could lose its original error if stopping also failed.
  It now uses the existing failure-preserving cleanup instrument.
- The first auth model was a set and the history admitted only one successful
  send. The final history covers the full role/operation table and uses a
  multiset, so repeated equal-body sends and one-at-a-time deletion are explicit.

The upstream auth demo deliberately lets an authenticated user choose a role.
This is its documented demo behavior, not evidence of secure role administration.
The test does not establish tenant isolation, sign-out or token revocation,
refresh-token rotation, browser auth components, OAuth redirects, email delivery,
or production identity infrastructure. Token corruption is tested through HTTP;
unauthenticated preload and genuine token use are tested through both WebSocket
SDKs. Authenticated reconnect is not exercised. The reconnect witness uses the
separate unauthenticated public pagination app.

The pagination observations project `author` and `body`; they deliberately omit
upstream `_id` and `_creationTime`, which the transformed query does not return.
Auth compares marked body multiplicity, not complete raw message records or
user/author fields. These are business-ledger observations, not full raw-row
fidelity. The existing backend owner checks IDs and application fields separately.

Pagination observes complete finite results and live appends, not arbitrary
updates/deletes, continuous growth, transport work bounds, bounded lifetime
subscriptions, or browser rendering. Transformed rows have stable keys only
because the authored bodies are unique, including after case conversion. The
ledger assumes a fresh deployment and sequential execution, both supplied by
setup and test configuration. Auth compares test-marked messages within the
upstream query's latest-100 window, not every application row in an arbitrary
large database.

The public applications are deployed locally with the package's installed SDK
and backend, with an independently supplied app shell. They are not unchanged
full frontend deployments or evidence for their originally declared dependency
matrix. GitHub availability, local backend download, and operating-system TCP
behavior remain test prerequisites. No production cloud service, third-party
OAuth system, power-loss atomicity, or arbitrary network scheduling is proved.
