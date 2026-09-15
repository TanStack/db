---
instrument: research-survey
title: "Full-stack guarantees and agent-supplied evidence"
question: "Which full-stack framework guarantees could Endpoints recover with agent-supplied facts, and which require compiler work or runtime mechanisms?"
scope: "Existing framework list; accessible English primary sources and selected implementations through 2026-09-15"
intended_use: "Ground the evidence-system and linter design, without selecting an implementation"
depth: broad
researched_at: 2026-09-15
source_cutoff: 2026-09-15
status: bounded
---

# Full-stack guarantees and agent-supplied evidence

## Survey brief

- **Question:** Which full-stack framework guarantees could Endpoints recover
  with agent-supplied facts, and which require compiler work or runtime mechanisms?
- **Intended use:** Describe concrete missing facts and useful agent tasks for
  the evidence system. Keep checks, certifications, tests, and enforcement distinct.
- **Included:** The earlier framework inventory, revisited by guarantee rather
  than architecture family. Current official contracts plus historical papers.
- **Excluded:** Performance rankings, product recommendations, auth generation,
  production changes, and proposing a sync engine. No universal claim that every
  JavaScript program can be certified.
- **Starting sources:** Earlier survey [S1], RFC [S2], current implementation
  [S3], and the completed [fracture scan](01-fracture-scan.md).
- **Available source languages:** English.
- **Access limits:** Public documentation and source. No deployed service audits,
  private implementation access, or vendor guarantees independently verified.
- **Frozen budget and coverage frame:** [BRIEF.md](BRIEF.md). Selected passages
  were inspected in 27 distinct accessible primary documents/pages. Three URLs
  failed, bringing the pass to 30 new primary URL attempts. The complete
  old inventory remains below, including systems not rechecked in this pass.

## Orientation

The inspected sources expose several ways to establish a guarantee: a restricted
language, explicit declarations at an extension boundary, runtime mediation,
and requirements imposed on application adapters. These are descriptive groups,
not alternatives selected for Endpoints. Ur/Web's FFI is direct prior art for
external effect declarations [S5]; Wasp uses authored entity dependencies for
invalidation [S6]; Convex couples restricted functions with transactional runtime
execution [S7–S9].

Some seemingly missing guarantees are not supplied universally by the source
framework either. Relay documents mutation-impact cases needing invalidation;
Replicache permits server outcomes to differ from optimism; Hasura documents a
  rollback boundary around external operations [S11–S13].

The Endpoints comparisons below are **inferences about transfer**, not source
authors' claims or proofs of an implemented integration. “Agent evidence” means
new knowledge available through additional work, not a claim that an agent is
the only possible producer of that knowledge.

## Terms and distinctions

- **Guarantee:** A stated property over specified executions, with assumptions
  and a mechanism that establishes it. A feature name alone is insufficient.
- **Effect footprint:** A set containing all relevant possible reads/writes;
  for refresh it can safely overestimate. It must name the database authority
  and relations, including inspected indirect effects [S3, S5, S6].
- **Completion:** The point after which a claimed effect is settled. An API
  response, committed transaction, delivered stream checkpoint, and completed
  background job can be different events [S9, S16, S17].
- **Evidence consumer:** The check or optimization using a fact. Evidence about
  PG writes is not evidence that replay cannot duplicate an external effect.
- **Bounded test:** A result for generated or enumerated cases. It establishes
  universal behavior only when the domain is finite, exhaustively covered, and
  the check/model faithfully represents that domain.

## Evidence landscape

The labels describe the missing work: **provided**, **compiler**, **agent fact**,
**runtime/app**, **outside scope**, or **unknown**. A row may have several parts.

| ID | Guarantee and source boundary | How it is established there | Endpoints comparison and missing fact |
| --- | --- | --- | --- |
| C1 | Ur/Web calls have transactional semantics; channel sends wait for commit [S4] | Transaction runtime and controlled effects | **Runtime/app + compiler.** Checking that existing code uses one transaction is ordinary analysis; a certificate cannot roll back an unrelated HTTP effect. |
| C2 | Ur/Web foreign calls carry effect and tier declarations [S5] | Trusted FFI declarations constrain optimization; custom effects have commit/rollback hooks | **Agent fact.** Inspection can justify the effect summary of an unsupported library entry. Runtime participation remains a separate requirement. |
| C3 | Wasp invalidates queries sharing declared entities with an action; scope is entities [S6] | Authored dependency declarations plus cache invalidation | **Provided for supported SQL; agent fact for opaque calls.** A complete upper bound on indirect writes can feed existing relation matching. Conditional bounds can improve precision. |
| C4 | Convex query calls read one logical snapshot and exclude third-party fetches [S7] | Database context plus restricted execution | **Compiler + runtime/app.** A helper's read set/purity can be inspected; that does not create a snapshot across separate PG statements or HTTP services. |
| C5 | Convex mutations commit together; actions may have external effects and are not automatically retried [S8, S9] | Transaction executor; an explicit external-action boundary | **Agent fact + runtime/app.** A particular prefix may be proven effect-free, or an adapter may preserve an existing transaction. No general replay of arbitrary endpoint handlers follows. |
| C6 | Relay fragments constrain which data each component sees [S10] | Query compiler and masked data access | **Compiler/runtime feature**, not a missing certificate. Inspecting a component is possible, but a new field-ownership API would still be required for the same encapsulation. |
| C7 | Relay merges mutation data and manages optimistic rollback, but application code may need broad invalidation [S11] | Normalized store, response/updater protocol | **Provided in part; agent fact for app intent.** Test custom `onMutate` predictions under stated assumptions; do not call exact prediction a guarantee Relay already provides. |
| C8 | Replicache permits differing client/server outcomes; replay/rebase restores authority [S12]. Zero likewise permits divergent implementations and uses a sync protocol [S24] | Runtime protocol and server authority | **Framework oracle for settlement; bounded app tests for optimism.** Rebase and logical replication are outside current scope. |
| C9 | Hasura's PG multi-mutation rollback guarantee has an external-action/remote-schema exception [S13] | Transaction over supported local operations | **Runtime/app.** Agent evidence can describe an existing participant, not create distributed atomicity. |
| C10 | Hasura applies configured row/column rules; Instant applies configured permission expressions [S14, S15] | Runtime enforcement of authored policy | **Authored app checks + possible agent facts.** Trace an opaque authorization helper's conditions/dependencies; neither “authenticated” nor “no writes” establishes authorization correctness. |
| C11 | PowerSync publishes complete checkpoints; Electric's write examples match arriving writes [S16, S17] | Sync mechanism and a completion signal | **Outside scope for replication; agent fact for an existing adapter contract.** A response must identify what completion/visibility it proves before an overlay can be retired. |
| C12 | Meteor distinguishes method-result arrival from cache settlement and warns of retries after disconnect [S18] | DDP/cache coordination plus app obligations | **Runtime/app.** A successful return is not itself proof of client settlement or once-only execution. |
| C13 | tRPC can validate output at runtime; typed transport alone is insufficient [S19] | Configured validator before response | **Compiler/runtime feature.** An agent can supply a schema as code. Certifying an unchecked type cast does not implement validation. |
| C14 | Links compiles a supported query subset and unifies cross-tier types; Eliom models explicit converters between tier types [S20, S21] | Language/compiler discipline and conversion boundary | **Compiler for standard shapes; agent fact/check for a custom codec or result transform.** Type signatures do not establish lossless identity or ordering preservation. |
| C15 | Open RIA validates/authorizes change-set operations, then calls overridable persistence [S22] | Framework pipeline plus data-source implementation | **Compiler + app adapter evidence.** The base persistence hook does not prove atomic storage for every subclass. |
| C16 | RxDB's replication contract requires deterministic checkpoint order, retained deletions, and reconnect resync [S23] | Adapter obligations plus replication protocol | **Compiler/catalog for ordinary ordering; adapter checks for opaque implementations; replication outside scope.** A passing read sample does not establish completeness. |
| C17 | LiveStore orders events through a sync backend and detects backend identity changes [S25] | Runtime authority and identity protocol | **Outside scope as an engine; relevant boundary for evidence invalidation.** Equal source code does not imply equal backend state/identity. |
| C18 | LiveView requires checks on mount and privileged events [S26] | Authored checks at lifecycle boundaries | **App/static lint.** Useful precedent for naming every relevant entry path; server-driven UI does not itself establish domain permissions. |
| C19 | Unison Cloud identifies a deployed service by code hash; a name can refer to a later deployment [S27] | Content identity plus deployment routing | **Agent/deployment fact.** Distinguish inspected implementation identity from a mutable address; do not infer unchanged configuration or external state from the hash. |
| C20 | Falcor permits callers to request post-call paths and functions to report invalidated paths [S28] | Graph response and cache protocol | **Provided in broad form by retained-query refresh; agent fact for complete impact.** A return payload need not enumerate every change made by a function. |

## Positions and mechanisms

### Restricted execution and runtime control

Sources C1/C4/C5 describe guarantees whose enforcement includes the executor.
The transfer question is whether equivalent machinery already exists in the
application. Merely recognizing a transaction boundary cannot add one; ordinary
code changes can add an appropriate transaction without compiler rewriting.

### Trusted extension declarations

C2/C3 describe supplied facts consumed by a compiler/framework. The relevant
Endpoints hypothesis is to retain the inspection, assumptions, and dependencies
behind such facts. This resembles enriching an extension contract, rather than
certifying the entire app as correct.

### Protocol obligations on ordinary application code

C11/C12/C15/C16/C20 expose obligations at adapters and completion boundaries.
An agent can inspect whether an existing implementation fulfills an obligation,
or write a reusable conformance check. The consumer still needs the protocol.

## Concrete candidate agent tasks

All snippets below are constructed TypeScript examples, **not proposed public
evidence syntax**, executed demonstrations, or facts certified about Kitchen AI.

### E1 — Bound a library/API's conditional writes (C2, C3)

```ts
await db.update(recipes).set({ title: input.title }).where(eq(recipes.id, input.id))
await shoppingApi.apply({ recipeId: input.id, apply: input.apply })
```

Claim: for the inspected API version/configuration, its possible PG writes are
within `shopping_items`; for `apply === false`, none. Include exception paths
and triggered/routine effects. An unconditional union is sufficient for a safe
first optimization. The call must settle its relevant writes before the refresh
boundary; if it returns while writes may still occur, that fact stays unresolved.

Work: trace API implementation, imported helpers, configured hooks, database
bindings, and return/error paths. The compiler can add already-analyzed SQL and
catalog effects. An enum/boolean branch can be exhaustively tested, but the test
does not prove arbitrary hidden library behavior.

Consumer: server-side affected-collection matching. Failure: a true branch or
catch path also writes tags, but evidence lists only shopping items. Invalidate
on implementation, hooks, config, API deployment contract, or effect-relevant
schema changes. General HTTP clients reveal transport, not remote behavior.

### E2 — Establish reads hidden by a helper (C3, C4)

```ts
const visibleIds = await accessApi.allowedRecipeIds(user.id)
return await db.select().from(recipes).where(inArray(recipes.id, visibleIds))
```

Claim: for the inspected implementation, result dependencies include the
membership relation as well as recipes. “No writes” would say nothing about
this read dependency. Work: inspect the helper/API implementation and map its
reads to the same database authority, including configured policy hooks.

Consumer: refreshing a recipe collection after an endpoint mutates memberships.
Failure: a membership removal changes the query result without touching recipes.
Invalidate on policy, helper/config, query, or relevant schema changes. If the
API's authoritative state is elsewhere, an external-state invalidation mechanism
is separate; this claim cannot manufacture one.

### E3 — Verify participation in an existing transaction (C1, C5, C15)

```ts
await db.transaction(async (tx) => {
  await tx.update(recipes).set({ title: input.title })
  await library.recordChange(tx, input)
})
```

Claim: the library uses the supplied transaction for every relevant PG effect
and completes those effects before returning. Work: inspect the library's handle
flow and callbacks; test a forced failure after the call against an independent
database observation. Failure: it uses a module-global connection or returns
before an async write. The test is a regression witness; the transitive source
inspection supports the broader bounded contract.

Consumer: a transaction-participation lint rule, not an automatic transaction
rewrite. Invalidate on library/config/driver changes. Where the compiler can
follow the handles itself, this is compiler work, not a separate evidence request.

### E4 — Verify identity and value preservation through custom code (C14)

```ts
const rows = await db.select().from(recipes)
return res.json(decorateRows(rows))
```

Claim: an inspected transformation produces one output for each input, preserves
`id` unchanged, and only adds specified fields. Work: inspect the transform and
its dependencies, then test empty inputs, duplicate-looking values, and unusual
keys. Failure: filtering, expansion, or replacing the key with an array index.
Consumer: a collection-key/query-model check, once its grammar supports consuming
this fact. It does not automatically certify a patch or an optimistic model.

A separate custom codec can be checked for `decode(encode(x)) ≡ x` over a
declared domain, especially exact integers/dates. Equality, key injectivity,
and order preservation are separate claims. Compiler-generated standard codecs
belong in framework tests. Invalidate custom evidence when encoder, decoder,
domain/schema, or relevant library changes.

### E5 — Inspect the no-effects prefix for a specific retry outcome (C2, C5)

```ts
const session = await authLibrary.readSession(request)
if (session.kind === 'stale') return staleBeforeEffects()
await chargeAndSave(input)
```

Claim: every path returning the designated stale result has caused no effects
in the domains required by the retry rule. Work: inspect session renewal,
deletion, callbacks, network calls, and failure paths; preserve any premises.
Failure: the helper renews/deletes sessions or sends a notification first.
Consumer: the RFC's replay-admission check, which is future runtime work. A
PG-only purity result cannot satisfy it. Invalidate on helper, hooks, config,
prefix control flow, or the meaning of the outcome. Never infer this fact merely
from the helper's name or from a generic 401 response.

### E6 — Check authored optimism against intended server semantics (C7, C8)

```ts
onMutate({ input }) {
  recipes.update(input.id, draft => { draft.title = input.title })
}
// Server path validates/transforms input, then updates the row.
```

Claim: under the declared common initial state and inputs, optimism predicts
selected intended fields/relations. Work: a built-in runner can invoke the real
client action and server endpoint on isolated state and compare affected query
results. The agent supplies missing domain generators, controlled API behavior,
and explicit intended approximations when required.

Failure: raw optimistic input retains whitespace while parsed server input trims
it, or an update changes a filter membership that the authored prediction omits.
Different server state, server-generated fields, or AI output can legitimately
differ. Keep the comparison law explicit; do not suppress all mismatches.
Consumer: app-quality check. Never use a green sampled run as proof of effect
completeness. Invalidate on either action/handler, input/row schemas, query
meaning, generator, oracle, comparison law, or controlled dependency changes.

## Disputes and conflicting evidence

- **Restricted framework does not mean universal effects proof:** C2 exposes
  explicit trusted extension declarations; C5/C9 delimit external operations.
  This limits the claim we are trying to recover, rather than refuting it. [S5, S9, S13]
- **Framework-owned optimism does not promise exact prediction:** C7/C8 retain
  authored predictions and legitimate divergence. E6 is a useful additional
  application check, not necessarily parity with a missing source guarantee. [S11, S12, S24]
- **“Changes submitted” does not establish transactional persistence:** C15's
  implementation separates the pipeline from the persistence override. No
  assertion about every Open RIA adapter follows from its base class. [S22]
- **Permission features do not choose the correct policy:** C10/C18 require
  application decisions/checks. Evidence can analyze those decisions' code; it
  cannot infer the desired policy merely from a feature name. [S14, S15, S26]
- No comparative empirical study of agent certifications was found in the
  inspected routes. The feasibility of the proposed evidence workflow remains
  a hypothesis; these sources establish mechanisms and extension obligations.

## Cases and timeline

Links (2006), Ur/Web (2015), and Eliom (2016) are historical research designs.
Web docs describe their retrieved revisions on 2026-09-15, not a controlled
deployment. LiveStore labels the inspected documentation 0.4.0; Hasura pages
are v2.x. No source status or publication date is treated as adoption evidence.

## Coverage and gaps

| Coverage cell | Status | Sources | Gap or limit |
| --- | --- | --- | --- |
| Effects and transaction boundaries | supported | S4–S9, S13, S18, S22 | No external service implementation certified |
| Invalidation and reads | supported | S3, S6, S7, S11, S28 | Conditional API footprint consumption not implemented |
| Placement, type, conversion, composition | supported | S10, S19–S21 | No complete arbitrary-JS soundness claim |
| Permissions and entry paths | supported | S14, S15, S26 | User policy remains an input; no Kitchen auth audit in this run |
| Optimism and settlement | supported | S11, S12, S16–S18, S24 | Custom onMutate runner not built in this run |
| Adapter completeness and identity | supported | S23, S25, S27 | No deployed contract/version binding tested |
| Agent evidence admission/invalidation | thin | S2, S5, S27 | No audited general certification system in this sample |
| Entire original framework inventory | thin | S1 | Mechanism-focused recheck, not every source or guarantee |

Inventory accounting: **freshly inspected** Links, Ur/Web, Eliom, Open RIA,
tRPC, Wasp, Convex, Instant, Relay, Falcor, Hasura, Meteor, Firestore, Replicache,
Zero, ElectricSQL, PowerSync, RxDB, LiveStore, LiveView, Unison Cloud.
**Local baseline inspected:** TanStack DB/Start via the Endpoints compiler/runtime.
**Inherited only, not freshly verified:** Opa, Hop, Electric Clojure, Blitz,
RedwoodJS/SDK, React RSC, RethinkDB/Horizon, Gatsby, Fulcro/EQL, Parse, Asana,
Figma LiveGraph, Yjs, Automerge, Ditto, Blazor, Turbo, Vaadin, Jakarta Faces,
Derby/Racer, Skip, Eve, and MongoDB Device Sync. These are not negative findings.
The old survey's secondary leads (ML5, Haste, WebSharper, ScalaLoci, Mobl, Volta,
GWT) remain unsearched here. This accounting prevents “same list” from becoming
an unsupported claim that every listed system received equal scrutiny.

## Claim-to-source ledger

| Claim | Kind | Support | Confidence | Limit |
| --- | --- | --- | --- | --- |
| C1 | original research description | S4 | solid | Controlled effects, historical design |
| C2 | primary manual | S5 | solid | Trusted declarations, not proof of arbitrary foreign code |
| C3 | official contract | S6 | solid | Authored entities |
| C4 | official contract | S7 | solid | Restricted query runtime |
| C5 | official contract | S8, S9 | solid | External-action exception |
| C6 | official contract | S10 | solid | Fragment interface, not server authorization |
| C7 | official contract | S11 | solid | Invalidation/updaters can remain authored |
| C8 | official contract | S12, S24 | solid | Prediction may differ |
| C9 | official contract | S13 | solid | PG path versus external path |
| C10 | official contract | S14, S15 | solid | Configured rules only |
| C11 | official contract/example | S16, S17 | solid | No universal adapter proof |
| C12 | official contract | S18 | solid | Result/settlement and retry limits |
| C13 | official contract | S19 | solid | Validator must be configured |
| C14 | original papers | S20, S21 | solid | Stated language/type/converter domains |
| C15 | inspected implementation | S22 | solid | Base class; no all-adapter conclusion |
| C16 | official adapter requirements | S23 | solid | Protocol prerequisites |
| C17 | official contract | S25 | solid | Inspected version and stated limitations |
| C18 | official guidance | S26 | solid | App must author checks |
| C19 | official contract | S27 | solid | Code identity, not all environment inputs |
| C20 | official contract | S28 | solid | Declared graph paths |
| E1–E6 | transfer hypotheses / constructed examples | C1–C20, S2, S3 | plausible | No integration or certificate executed |

## Sources

### Primary and official

- <a id="s1"></a>**S1** — [Earlier survey](/Users/kylemathews/programs/dialectics/expedition-databricks-neon-product-fieldwork/expeditions/expedition-databricks-neon-product-fieldwork/field-trips/full-stack-data-frameworks-tanstack-db/artifacts/full-stack-data-frameworks-research-survey.md), 2026-09-01. Starting inventory and prior scope; inherited claims are not fresh verification.
- <a id="s2"></a>**S2** — [Endpoints RFC v0.18](/Users/kylemathews/programs/dialectics/field-trip-tanstack-db-endpoints-prototype/sources/tanstack-db-endpoints-rfc-v0.18.md). User project proposal; evidence semantics and intended scope, not implemented guarantees.
- <a id="s3"></a>**S3** — Prototype at `9189b4f34`: [inline analysis](../../integrated-todo/inline-dependencies.mjs), [registry](../../integrated-todo/src/registry.server.ts), [refresh](../../integrated-todo/src/refresh.server.ts). Skipped calls at lines 210–217 and 315–324; selection at registry 149–166; refresh after handler completion at refresh 21–66. Source inspection, not a new runtime experiment.
- <a id="s5"></a>**S5** — [Ur/Web manual source](https://raw.githubusercontent.com/urweb/urweb/master/doc/manual.tex), retrieved 2026-09-15. C2: project directives `benignEffectful`, `effectful`, and FFI custom transaction hooks. Moving branch; audited excerpt locations 125–132 and 2250–2270, not a deployed version.
- <a id="s6"></a>**S6** — [Wasp Actions](https://wasp.sh/docs/data-model/operations/actions), retrieved 2026-09-15. C3: Using Entities / cache invalidation; entity-only limit. [Queries](https://wasp.sh/docs/data-model/operations/queries) inspected as companion; no additional guarantee claimed.
- <a id="s7"></a>**S7** — [Convex Queries](https://docs.convex.dev/functions/query-functions), retrieved 2026-09-15. C4: Caching, reactivity, consistency. One-query snapshot, deterministic context, no external fetch.
- <a id="s8"></a>**S8** — [Convex Mutations](https://docs.convex.dev/functions/mutation-functions), retrieved 2026-09-15. C5: Transactions. Database guarantees do not include arbitrary third-party calls.
- <a id="s9"></a>**S9** — [Convex Actions](https://docs.convex.dev/functions/actions), retrieved 2026-09-15. C5: Error handling, dangling promises, separate transaction calls. External effects limit retry.
- <a id="s10"></a>**S10** — [Thinking in Relay](https://relay.dev/docs/principles-and-architecture/thinking-in-relay/), retrieved 2026-09-15. C6: Data Masking. Component visibility contract.
- <a id="s11"></a>**S11** — [Relay GraphQL mutations](https://relay.dev/docs/guided-tour/updating-data/graphql-mutations/), retrieved 2026-09-15. C7: optimistic update ordering, pitfalls, invalidation. Authored optimism is not certified intent.
- <a id="s12"></a>**S12** — [How Replicache Works](https://doc.replicache.dev/concepts/how-it-works), retrieved 2026-09-15. C8: Push and Rebase. Server authority, legitimate divergence.
- <a id="s13"></a>**S13** — [Hasura multiple mutations](https://hasura.io/docs/2.0/mutations/postgres/multiple-mutations/), v2.x, retrieved 2026-09-15. C9: Execution and explicit external-operation rollback exception.
- <a id="s14"></a>**S14** — [Hasura permission rules](https://hasura.io/docs/2.0/auth/authorization/permissions/), v2.x, retrieved 2026-09-15. C10: Role/operation/row/column enforcement.
- <a id="s15"></a>**S15** — [Instant permissions](https://www.instantdb.com/docs/permissions), retrieved 2026-09-15. C10: Configured expressions and defaults; no guarantee the selected policy is intended.
- <a id="s16"></a>**S16** — [PowerSync consistency](https://docs.powersync.com/architecture/consistency), retrieved 2026-09-15. C11: Checkpoints and client mutation acknowledgment; priority caveat and application upload responsibilities. Vendor contract, not an independently rerun consistency test.
- <a id="s17"></a>**S17** — [Electric writes](https://electric.ax/docs/sync/guides/writes), retrieved 2026-09-15. C11: Example's `matchWrite` waits for the write to arrive before deleting optimistic state. Example, not a blanket API completion guarantee.
- <a id="s18"></a>**S18** — [Meteor API](https://docs.meteor.com/api/meteor.html), retrieved 2026-09-15. C12: reconnect retry warning and `onResultReceived` distinction.
- <a id="s19"></a>**S19** — [tRPC validators](https://trpc.io/docs/server/validators), retrieved 2026-09-15. C13: Output validators; failure response. [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions) also inspected as a counter-check: callbacks may rerun; application state mutation is discouraged. This companion does not establish external exactly-once effects.
- <a id="s22"></a>**S22** — [Open RIA DomainService source](https://raw.githubusercontent.com/OpenRIAServices/OpenRiaServices/main/src/OpenRiaServices.Server/Framework/Data/DomainService.cs), retrieved 2026-09-15. C15: authorization/validation/execute pipeline and default `PersistChangeSetAsync` implementation, lines 660–725. Moving branch, base implementation only.
- <a id="s23"></a>**S23** — [RxDB replication](https://rxdb.info/replication.html), retrieved 2026-09-15. C16: server layout and reconnect requirements.
- <a id="s24"></a>**S24** — [Zero mutators](https://zero.rocicorp.dev/docs/mutators), retrieved 2026-09-15. C8: Life of a Mutation, client/server divergence and cached-only client reads. No requirement that mutators be pure.
- <a id="s25"></a>**S25** — [LiveStore syncing](https://docs.livestore.dev/building-with-livestore/syncing/), docs 0.4.0, retrieved 2026-09-15. C17: total order and Backend Reset Detection. Page contains explicit unfinished areas; no comprehensive production guarantee inferred.
- <a id="s26"></a>**S26** — [LiveView security](https://phoenix-live-view.hexdocs.pm/security-model.html), retrieved 2026-09-15. C18: mounting and events need authored checks.
- <a id="s27"></a>**S27** — [Unison Cloud core concepts](https://www.unison.cloud/docs/core-concepts/), retrieved 2026-09-15. C19: ServiceHash versus ServiceName. No arbitrary remote-state fingerprint guarantee.
- <a id="s28"></a>**S28** — [Falcor Model](https://netflix.github.io/falcor/documentation/model.html), retrieved 2026-09-15. C20: Calling Functions, extra paths, invalidated paths. Graph contract does not establish atomic execution of arbitrary backend code.

### Scholarly and technical

- <a id="s4"></a>**S4** — [Ur/Web: A Simple Model for Programming the Web](https://adam.chlipala.net/papers/UrWebPOPL15/UrWebPOPL15.pdf), Adam Chlipala, POPL 2015. C1: sections 3.1–3.2, transaction restart and delayed channel sends. Historical original paper.
- <a id="s20"></a>**S20** — [Links: Web Programming Without Tiers](https://www.pure.ed.ac.uk/ws/portalfiles/portal/18385225/Cooper_Lindley_ET_AL_2006_Links_Web_Programming_Without_Tiers.pdf), Cooper et al., FMCO 2006. C14: typed cross-tier programming and supported SQL compilation subset; not unrestricted JavaScript.
- <a id="s21"></a>**S21** — [Eliom: A core ML language for tierless Web programming](https://www.irif.fr/_media/users/balat/2016aplas-eliom.pdf), Radanne, Vouillon, Balat, 2016. C14: converters and separate type universes, section 3. No arbitrary codec round-trip law follows merely from a converter's type.

### Field, critical, and secondary

No secondary commentary supports a new material framework claim. S1 is a local
secondary research record used for scope and inventory. Source authors' own
limitations provide the principal contrary-evidence control.

## Search and control record

- **Search routes:** Opened original survey links, followed relevant official
  docs, searched FFI effects, transaction/submit semantics, Relay masking, and
  Hasura external-action rollback. Search snippets were leads only.
- **Prominence counter-search:** Historical Ur/Web, Links, Eliom, Open RIA,
  Falcor, and Unison were included alongside current mainstream TypeScript
  systems. FFI manual source was inspected when the hosted manual failed.
- **Contrary-evidence search:** Restricted mutation versus external action;
  declarative invalidation versus opaque calls; optimistic prediction versus
  server authority; permission features versus authored policy; submission
  versus persistence; code hash versus deployed address.
- **Source-class coverage:** Official reference contracts, original papers, and
  two source documents. No private runtime traces or independent vendor tests.
- **Recency check:** Historical papers dated separately; web sources retrieved
  on 2026-09-15. Moving repository branches are not immutable evidence inputs.
- **Access failures:** Hosted Ur/Web manual PDF and tutorial URL failed; raw
  manual source worked. A legacy WCF RIA documentation URL failed; current Open
  RIA source was used with the explicit narrower scope.
- **Saturation check:** Stopped at the declared document budget boundary, not
  claimed saturation. Last targeted passes added FFI assumptions, Falcor's
  post-call path contract, and service identity. Thin original-inventory cells
  remain; another pass could add materially different guarantees.

## Limits and unmeasured

- **Main artifact risk:** Classifying by “agent fact” can make ordinary compiler
  work look like an agent-only capability. Labels deliberately retain both routes.
- **Additional distortion:** The API demo favors effects and completion; type,
  identity, policy, and adapter cases were included as a control. Public docs
  may overstate runtime guarantees; the survey records contracts, not audits.
- **Unmeasured:** Whole-source soundness, production behavior, remote deployment
  binding, certification accuracy, and the effectiveness of proposed tests.
- **Coverage claim:** Twenty-one named frameworks have fresh primary material,
  with uneven depth. The remainder is accounted for, not declared equivalent
  or uninteresting. Source type/age and narrower guarantees remain visible.

## Handoff index

- **Fracture questions:** completion, effect domain, consumer, dependency scope.
- **Candidate tasks:** E1–E6 supply examples for matched boundary tests.
- **Ground-condition input:** C1–C20 and their transfer labels.
- **Loss-audit input:** freeze this file and compare individual sources against
  it, retaining omitted claims without silently selecting their implementation.

This index describes available material. It does not select or run another instrument.
