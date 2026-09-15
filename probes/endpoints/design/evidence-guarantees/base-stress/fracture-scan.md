# Fracture Scan: evidence base and check-authoring contract

Two candidate fractures survive the controls. Both have executable prototype
witnesses. Neither disproves the separation between a reusable base and
domain-owned rules. The failures occur where that separation must expose useful
arguments and apply freshness to repair evidence.

Status: completed bounded scan, September 15, 2026. No production or frozen
design files were changed. The [witnesses](fracture-witnesses.mjs) assert the
observed behavior against the [frozen source](manifest.json).

## Frozen position

**Core claim:** the base can validate and maintain arguments under registered
domain rules, explain missing premises and challenges, and support workflows
that establish and maintain evidence without turning an agent assertion into
proof.

**Explicit premises and scope:** finite proposed arguments; trusted local rule
and checker implementations; explicit context changes; exact claim identity;
in-memory prototype. Rule soundness, semantic equivalence, automatic context
capture, durable delivery and security against an agent controlling the host
are not promised. Domain packages own semantic acceptance. Consumer policy is
separate. The test concerns the declared mechanics, not PostgreSQL correctness.

**Success standard:** preserve conjunctive premises and alternative support
routes; admit only applicable observations; retain relevant counterexamples
until applicable repair; tell the consumer what is missing. Model references:
[C4/C5, E2/E4/E5, R3/R5/R6/R7/R8](base-contract.json).

**Protected insight:** a small base can check relationships among claims and
evidence without containing every domain's semantics. Workflows can help design
those domain rules without certifying them merely through completion.

**Promised consequence:** agents and humans can tell what was established and
what evidence or behavior remains necessary. The intended course of action is
to build claim/check packages over the reusable base.

The source and stated scope were frozen before testing. No new policy, hostile
host requirement or universal proof claim was introduced during the scan.

## F1 — A set of gaps cannot express the alternative ways to close them

**Target:** C4 retains alternative support routes and dependency paths; E2
distinguishes alternatives from conjunction; R8 derives investigation work from
uncovered premises. The authoring workflow also explicitly requires that
distinction in its evidence routes.

**Route:** internal extension, then a matched executable counterexample.

**Premise-to-consequence trace:**

1. A claim may have alternative arguments, each requiring all its own premises.
2. The assessment is the base's public explanation of support and missing work.
3. The prototype merges every failing route's gaps into one deduplicated array.
4. Distinct legal completion conditions therefore become the same explanation.

Source: [kernel.ts](snapshot/kernel.ts), lines 272–299, especially the merging
of child gaps; [design-check.md](snapshot/workflows/design-check.md), step 3.

**Minimal scene:** one goal can be established by `(A AND B) OR C`. A second
goal with the same visible identity in an independent base requires
`A AND B AND C`. With no premises established, their complete public assessments
are deeply equal, including reasons and gaps. After establishing C, the first
is supported and the second remains unresolved. The witness executes both.

**Admissibility:** all rules are registered, well-formed and deterministic. No
observation is stale, no input is malformed, no semantic plugin lies, and no
unsupported proof search is requested. Only the allowed argument structure
changes. Each evaluator computes the right support status; the failure is the
loss of consequential structure in the explanation.

**Exposed condition:** task derivation must retain the alternative route around
each set of jointly required premises. A set of distinct missing claims is not
enough to explain which work will establish the goal. Sharing the investigation
does not imply merging its different roles.

**Defeated consequence:** the public assessment alone cannot explain the legal
ways to finish the investigation. This is a representation/interface fracture,
not demonstrated false support and not a refutation of the inference engine.

**Preserved insight:** exact shared claims still support deduplicated work;
conjunctive and alternative evaluation already works internally.

**Repair condition:** preserve argument/route structure and link shared gaps to
their uses. The consumer need not receive every internal detail, but it must
distinguish these two completion conditions. This does not choose a task ranking
or require automatic proof search.

**Test gap:** the argument oracle checks supported/not-supported membership
only ([kernel.test.mjs](snapshot/kernel.test.mjs), lines 88–95). The shared-gap
test uses two identical routes (236–252). Neither checks whether the explanation
preserves alternative completion conditions. Extend a relational oracle to
compare the completion sets described by the report with those of the model;
keep this minimal pair as a replay.

**Weakening evidence:** a documented separate public route explanation consumed
by the workflow would weaken this finding. Consumers retaining and reconstructing
all proposed rules externally can recover the structure, but that work is not
part of the current base report. If the report were explicitly a flat inventory
only, its limited contract would survive while the promised workflow interface
would remain unimplemented.

## F2 — Repair evidence can expire while its authority does not

**Target:** E4 checks every evidence use against context; R5 forbids stale
observations regaining support; R6 requires an applicable resolution of a relevant
counterexample; R7 retains the original failing law and case.

**Route:** internal extension, then an executable history.

**Premise-to-consequence trace:**

1. A failing observation challenges a claim.
2. A current passing replay of the same law and case permits explicit resolution.
3. A relevant context change makes that replay observation stale.
4. Assessment checks freshness for ordinary support observations, but treats
   `challenge.resolution !== undefined` as permanently sufficient to ignore the
   challenge.
5. A current pass for an unrelated case can restore support, while the only
   original-case repair evidence is still stale.

Source: [kernel.ts](snapshot/kernel.ts), lines 166–185 (resolve), 209–216
(challenge eligibility), and 240–246 (ordinary observation freshness).

**Minimal scene:** observe failure in context 0; advance to context 1; run the
original case successfully and resolve; advance to context 2; run an unrelated
case successfully. The base reports supported. History shows the resolution
still points to the replay in context 1. The witness executes this history and
checks that the repair and current observations have different epochs.

**Admissibility:** every relevant change is explicitly signaled. Claim identity,
law and original case remain fixed; no cross-version matching or hidden change
is needed. The checker honestly reports each exercised case. The registered
admission rule admits campaign observations as the prototype's own fixture does;
the base independently promises to preserve relevant counterexamples. No host
tampering or unimplemented persistence is involved.

**Exposed condition:** a resolution is either an evidence-backed use that must
remain applicable, or a separately justified lasting decision. Recording a replay
ID does not establish permanent immunity from future context changes. The model
does not supply a rule for that exception.

**Defeated consequence:** freshness is not applied uniformly to the evidence
that removes a blocker. This is not a claim that every historical failure must
block every future version. The current prototype already chooses to retain
same-claim failures across epochs; its positive repair evidence gets different
treatment without a stated lifetime rule.

**Preserved insight:** explicit replay is meaningful and unrelated green results
cannot clear a never-resolved challenge. The witness includes that passing
control. Scoped resolution can still coexist with conservative failure handling.

**Repair condition:** give resolution applicability an explicit lifetime and
dependency relationship, or require a fresh original-case replay when its
support expires. Keep historical resolution distinct from present applicability.
Different-strategy and scope-based resolution remain separate open designs.

**Test gap:** the lifecycle model reduces failures to a counter. Resolution sets
it to zero; a context change only clears `hasFreshPass`
([kernel.test.mjs](snapshot/kernel.test.mjs), lines 134–162). Thus the supposed
independent oracle shares permanent-resolution semantics with the implementation.
It also uses the same sample for every pass and failure. Model historical
counterexamples and resolution applicability separately; generate original-case
and unrelated-case passes and context changes after resolution.

**Weakening evidence:** a source-backed rule that makes resolution permanent
despite stale replay, or a guaranteed execution protocol that always reruns all
known failures before any supporting campaign is accepted, would narrow or
remove this finding. Neither is enforced or stated in the frozen prototype.
The broader design leaves some version matching unresolved, so the observed
behavior proves a missing resolution-lifetime contract, not one universally
correct replacement policy.

## Controls and rejected candidates

| Candidate | Disposition | Reason |
| --- | --- | --- |
| The base cannot certify every registered checker as mathematically sound | Outside-standard control; rejected | The candidate explicitly trusts semantic extensions and disclaims universal soundness. |
| An agent rewrites the process or spoofs producer labels | Near-counterexample control; rejected | It violates the trusted-local-process premise; hostile-host enforcement is explicitly unimplemented. |
| A package supplies an unsound domain rule | Rejected as an internal fracture of generic mechanics | The documented trust boundary is precisely rule validity; the authoring workflow does not claim to prove it automatically. |
| Same-case replay is accepted after silently weakening the comparator | Not admitted here | Keeping law/comparator semantics is an explicit package obligation. A violating package is not an in-scope witness against the frozen base contract. |
| Coarse epochs invalidate unrelated evidence | Known cost limit, not a fracture | The prototype explicitly chooses global invalidation and does not promise minimal rechecking. |
| A failed argument premise leaves the goal unresolved rather than contradicted | Retained distinction, not a bug | Failure of one supporting route does not necessarily refute the conclusion; an independent route could still establish it. |
| One selected green argument hides rejected alternatives in the result | Adjacent explanatory concern, grouped under F1 | No false-support witness found; avoid inflating the count with the same projection loss. |

The two required controls reject both an external standard and a vivid case
outside explicit premises. The workflow's premise-checking, narrow-scope and
anti-self-certification requirements survive; this scan found no independent
workflow-wide self-defeat beyond its dependency on the two base contracts above.

## Limits

These are two executable prototype behaviors interpreted against a frozen design
contract. The witnesses do not establish a production Endpoints bug, missing
PostgreSQL effects, or general rule unsoundness. They do not independently measure
agent repair quality. The analyst authored the candidate and this scan; continuity
helps preserve its intended scope but can bias admissibility judgments. Constructed
minimal scenes may also make the loss look broader than the code establishes.

No implementation fix is included. The fresh Hostile Assay is a separate reading
and was not given these hypotheses before producing its result.
