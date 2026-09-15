# Loss audit: language and framework boundaries

Instrument: `loss-audit`, 2026-09-15. Frozen reduction: [02-research-survey.md](../02-research-survey.md). SHA256 verified as `b31c3059af06b4afd40134577a60a50083c10f96b6088c4288eea35518e9e4b2`.

Scope: S4, S5, S20, S21, S19, S22, S27, each scanned separately in that order against the frozen catalog. No sibling audit or other track was consulted. The source records below preserve that order. This is an omission inventory, not a choice of guarantees, implementation, or items to restore. “Transfer” marks this scanner's inference about ordinary TypeScript endpoints; it is not a source guarantee or a claim that agents alone can supply facts.

The observed loss is the difference between the source and the named catalog cell. The proposed cause—compression, category mismatch, or low salience—is inferred from the reduction's structure. The scan cannot establish the reducer's historical decision process or infer explicit rejection.

## S4 — Ur/Web POPL paper

[Primary source](https://adam.chlipala.net/papers/UrWebPOPL15/UrWebPOPL15.pdf). Pointers use printed page numbers.

- **L4a — Injection safety.** §2.1, p. 3: typed SQL/XML syntax and literal insertion avoid interpreting input as code. C1 reduces this paper to transactions; no catalog row retains this guarantee. **Loss:** category mismatch. **Transfer:** inspect whether an opaque SQL/HTML helper keeps values separate from executable syntax; checking that fact does not provide escaping machinery.
- **L4b — Database encapsulation and its boundary.** §2.1.1, p. 4: modules hide tables and ID representations within Ur/Web; outside database access need not respect this. Applications check schema agreement at startup. C1 omits these modularity and environment conditions. **Loss:** compression. **Transfer:** facts about exclusive writer paths and actual schema agreement require application/deployment inspection; a TS module boundary alone cannot enforce them.
- **L4c — Route uniqueness.** §2.1, p. 3: generated URL schemes cannot collide between functions. Absent from C1 and the catalog. **Loss:** category mismatch. **Transfer:** compare an application's complete route registrations, including opaque plugins; framework generation remains a separate mechanism.

## S5 — Ur/Web manual

[Primary source](https://raw.githubusercontent.com/urweb/urweb/master/doc/manual.tex). Pointers are retrieved raw-file lines, with named directives/functions for relocation.

- **L5a — Client-value trust.** Lines 127–128, 2209, `clientToServer`: abstract FFI types are disallowed by default because serialization may not check their invariants. C2 keeps effect/tier declarations, E4 keeps round trips, but neither retains this admission obligation. **Loss:** compression. **Transfer:** inspect whether a custom decoder establishes the invariant downstream code assumes.
- **L5b — Hook ordering.** Lines 2262–2268, `uw_register_transactional`: rollback can follow a commit callback; irreversible callbacks run after SQL commit. C2 mentions hooks but drops these distinct obligations. **Loss:** compression. **Transfer:** inspect an existing adapter's compensation and post-commit behavior; no distributed atomicity follows.
- **L5c — Effect-sensitive HTTP policy.** Lines 179–183, `safeGet`, `sigfile`: GET-side effects require overrides; cookie-reading, effectful form handlers trigger CSRF protection. C2/E5 omit these effect consumers. **Loss:** category mismatch. **Transfer:** classify cookie reads and persistent effects of opaque helpers; enforcement still requires HTTP/runtime checks.
- **L5d — Audit closure.** Line 2320, `lessSafeFfi`: enabling inline FFI widens the files needing scrutiny. C2 omits that trust-boundary switch. **Loss:** low salience. **Transfer:** inventory local escape hatches alongside imported declarations.

## S20 — Links paper

[Primary source](https://www.pure.ed.ac.uk/ws/portalfiles/portal/18385225/Cooper_Lindley_ET_AL_2006_Links_Web_Programming_Without_Tiers.pdf). PDF page indices below include the repository cover sheet.

- **L20a — Message protocol typing.** §5, PDF pp. 24–26, Proposition 2: mailbox types enter function types and the translation preserves typing, supporting safety of the typed message-passing calculus. C14 retains cross-tier types/SQL but omits sender/receiver protocol compatibility. **Loss:** category mismatch. **Transfer:** compare message producers with consumers and runtime decoders at an endpoint boundary; TS annotations alone do not validate remote messages. This result says nothing about delivery or settlement.
- **L20b — Opaque query abstraction condition.** §6 “Database abstraction,” PDF p. 28: the illustrated unknown predicate prevents efficient SQL compilation; the described compiler fetches the dictionary before filtering and limiting. C14's “supported query subset” omits this concrete abstraction boundary. **Loss:** compression, a partial omission. **Transfer:** inspect a helper's predicate meaning and where filtering/limits execute. Supplying that meaning does not itself implement query lowering. The paper also excludes aggregates and nested queries from that historical fragment; this is not a claim about present Links.

## S21 — Eliom paper

[Primary source](https://www.irif.fr/_media/users/balat/2016aplas-eliom.pdf). Pointers use section and zero-based PDF page index.

- **L21a — Placement and opacity.** §1.3, PDF p. 2; §2.2, p. 3: tier distinctions reject using code on the wrong side; server-held client fragments cannot be inspected there. C14 reduces Eliom to converters. **Loss:** category mismatch. **Transfer:** inspect a helper's required execution environment and data crossing the boundary; this does not create the language's enforcement or prove secrecy against arbitrary clients.
- **L21b — Evaluation order and theorem premises.** §2.6, p. 5; §5, p. 14: deferred client fragments execute in server encounter order. Subject reduction and terminating-execution simulation assume primitive evaluations are defined on well-typed inputs and return correctly typed values. C14/E4 omit both ordering and the primitive obligation. **Loss:** compression. **Transfer:** an opaque library's domain, failure behavior, and effect ordering can be inspected separately from codec round trips. The formal model computes one page (§3, p. 5), omits network detail (§3.3), and excludes final machine-code/JavaScript compilation (§4); it does not certify arbitrary TS execution.

## S19 — tRPC validators

[Primary source](https://trpc.io/docs/server/validators), retrieved version 11.x.

- **L19a — Custom validation as ordinary code.** “The most basic validator: a function”: input/output validators may be TS functions that return accepted values and throw on rejection. C13 correctly requires runtime validation but its agent comparison only names supplying a schema. **Loss:** partial compression. **Transfer:** inspect whether an already-installed custom validator actually checks its claimed domain on every accepting path. This differs from certifying an unchecked cast; the evidence concerns existing runtime behavior.
- **L19b — Parser composition.** “Input Merging”: chained inputs merge objects; later properties replace earlier properties. C13 omits this composition condition. **Loss:** category mismatch. **Transfer:** recover the final accepted/transformed value and what each middleware sees, rather than treating parser declarations as an unordered conjunction.
- **L19c — Output exposure.** “Output Validators” names limiting excess returned data as a purpose. C13 keeps shape validation but drops field exposure. **Loss:** compression. **Transfer:** inspect whether the configured parser strips/rejects disallowed fields. This page does not establish that every validator strips fields, or specify the application's intended disclosure policy.

## S22 — Open RIA DomainService

[Primary source](https://raw.githubusercontent.com/OpenRIAServices/OpenRiaServices/main/src/OpenRiaServices.Server/Framework/Data/DomainService.cs). Pointers are retrieved raw-file lines and method names.

- **L22a — Validation/authorization conditions.** `IsAuthorized`, lines 149–187, allows calls with no authorization requirement; otherwise checks type and method attributes. `ValidateOperations`, lines 582–590, skips entity validation on deletes while retaining applicable method validation. C15's pipeline description omits these conditions. **Loss:** compression. **Transfer:** map operation kind and metadata to checks actually run; policy intent remains authored.
- **L22b — Persistence error channel.** `PersistChangeSetAsyncInternal`, lines 888–918, awaits the override but returns `!ChangeSet.HasError`, ignoring its Boolean result. C15 notes overridable persistence but omits how failure reaches the caller. **Loss:** compression. **Transfer:** inspect whether an adapter sets the expected error state; a returned `false` alone is insufficient in this base path. This is source behavior, not a newly validated bug report.
- **L22c — Whole-batch prevalidation.** `SubmitAsync`, lines 463–482, authorizes and validates the changeset before executing operations. C15 drops that ordering. **Loss:** compression. **Transfer:** check that an existing batch endpoint validates all items before invoking mutation handlers; validation hooks themselves are not proven effect-free.

## S27 — Unison Cloud core concepts

[Primary source](https://www.unison.cloud/docs/core-concepts/).

- **L27a — Named effect domains.** “Remote: the I/O of the Cloud” distinguishes HTTP, durable storage, ephemeral storage, and service calls; `toRemote` interprets the supported abilities in a common runtime. C19 keeps code identity alone. **Loss:** category mismatch. **Transfer:** summarize an opaque helper's relevant effect domains, including non-PG effects. An ability label does not enumerate precise relations, prove purity, or create a TS effect system.
- **L27b — Storage authority.** “Cloud access management” restricts database reads/writes to services in the same environment; configuration is separately loaded at runtime. C19 warns about configuration generally but omits this concrete authority boundary. **Loss:** partial compression. **Transfer:** record the environment/database binding behind an inspected helper; matching code hashes cannot establish it.
- **L27c — Creation idempotence.** “Storing data on the Cloud” states that storage-resource creation is idempotent so deployments can be rerun without recreating databases. C19 omits this scoped guarantee. **Loss:** category mismatch. **Transfer:** inspect whether a particular provisioning helper preserves resource identity on repeated calls. This is not a guarantee that arbitrary service requests or their effects are idempotent.

## Controls and limits

All seven assigned sources yielded at least one bounded omission; none has a null result in this pass. Existing claims about transactional execution, effect declarations, codec round trips, validation presence, base persistence not proving atomicity, and service hashes were treated as retained—not rediscovered omissions.

The original PDFs, official pages, and raw repository files all reopened successfully through the web tool. Text extraction and targeted section reads support the pointers; no executable examples, deployed services, generated artifacts, or adapters were tested. The raw files use moving branches and web results may be cached; these are retrieved-source observations, not immutable release or deployment attestations. No source beyond the assigned seven supports a finding here.

The scan was fresh relative to the parent comparison and hidden from sibling results, but all seven sources were read sequentially by one scanner. They were not isolated in seven independent contexts. The shared model and supplied reduction can preserve common blind spots; agreement with another model run would not establish independent confirmation. This is a bounded pass, not evidence of exhaustive recovery or empirical feasibility of agent certification.
