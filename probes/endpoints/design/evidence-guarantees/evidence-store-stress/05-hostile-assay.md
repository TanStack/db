# Hostile assay of evidence lifecycle v0.1

Date: 2026-09-15. Fresh independent auditor. Research artifact; no production
changes or executed evidence-engine tests.

**The draft survives the strongest simple attacks. Its remaining failure paths
lie at two lifecycle transitions and four declared design choices.** The two
transition findings are incomplete contracts, not demonstrated contradictions
or production bugs. The open choices must be resolved for the uses that depend
on them; their presence does not invalidate useful scoped evidence today.

## Frozen input and independence

Candidate: [03-lifecycle-draft.md](03-lifecycle-draft.md), captured before audit.
SHA-256:

```text
5148174df0503857d2a0e2678e35c3e123762d74cf5e3dfbf182edea5ff935ad
```

The auditor read the [frozen brief](00-brief.md), this single candidate, the
[Hostile Assay instrument](/Users/kylemathews/programs/linux-config/skills/field-lab/reference/instruments/hostile-assay.md)
in full, and the following allowed source material:

- [RFC v0.18](/Users/kylemathews/programs/dialectics/field-trip-tanstack-db-endpoints-prototype/sources/tanstack-db-endpoints-rfc-v0.18.md):
  rules/checks/results, agent work, human review, mutation reconciliation and
  bounded optimization experiments.
- [Oracle guide](../../field-trip-optimistic-coherence/oracle-guidance-reaudit/GUIDE.md):
  scoped claims, actual paths and observations, fault controls, retained
  promises, and portfolio maintenance.
- [Categorization](../05-categorization.md): effect bounds, completion, authored
  authorization, disclosure, and evidence lifetime; these remain prior source
  observations rather than fresh runtime findings.

The auditor did not read Ground Condition, Fracture Scan, the parent's
Guide-word worksheet, sibling work, or later readouts. The parent supplied the
candidate, success standard and scope constraints, not preferred findings.

The perturbation was to assume the candidate had failed to give a later agent
an honest multidimensional assessment and useful ordered work. Each scene below
is a construction under that assumption. It is not evidence that a deployed
system followed the scene. Source lines refer to the frozen candidate.

Severity statements describe the consequence **if the scene occurs**. They are
not probabilities, a global ranking, or a verdict selecting this design.

## H1 — Retaining a contradiction does not specify the admission transition

**Disposition: candidate defect in the transition contract; not a proven
contradiction in the intended design.** N4 requires contradictory results to
remain visible and N8 says to reopen affected uses. Neither gives “reopened” an
explicit relationship to the consumer's admitted status.

**Attacked claim:** the consumer relies only on current support, and a report
can tell an agent what decision may rely on the evidence. Relevant locations:
N4, lines 100–109; N5, lines 113–121; N8, lines 165–167.

**Minimal scene:** a fixed rule admits an application-specific optimization on
bounded differential evidence. A new receipt supplies a reproduced mismatch
inside that admitted domain, on the same production code and relevant context.
The dashboard retains both receipts and opens an investigation. The consumer
continues using its earlier admitted decision while that investigation is open.
A later invocation takes the now-refuted optimized path.

This attack does not require an arbitrary test to have licensed arbitrary
scope. Start with a permitted, useful oracle and its chosen admission rule.
The issue is the later counterexample, not the original use of testing.

**Undercutting evidence:** visibility of a failed receipt and existence of a
new task do not themselves withdraw permission. The proposed model laws require
a counterexample to remain visible, but do not explicitly require a compatible,
unresolved counterexample to block the contradicted scope. A store-only model
could satisfy that visibility law while its consumer retains the earlier grant.

**What would establish the failure:** generate `admit → conflicting receipt →
consume`, without changing the code, law or domain. The failure observation is
continued admission of the contradicted scope, not merely the dashboard's
wording. A deliberate stale-decision consumer should fail the adapter check.

**Repair condition:** define the transition when a credible compatible
counterexample arrives. Withdraw or suspend the affected admitted scope until a
recorded disposition restores support; preserve unrelated scopes. If a receipt
is disputed, represent the dispute and the interim use policy explicitly. This
need not require a human approval for each failing test or a new runtime scan.
Add the transition to the proposed model laws and test its consumer adapter.

**Weakening evidence:** “reopen affected uses” and “current applicability” can
reasonably be read as already intending withdrawal. N4 also rejects support
whose premises do not match. An implementation that derives admission afresh
from those rules would avoid this scene. The finding therefore asks for one
explicit operational law; it does not establish that the design intends to
keep a refuted optimization enabled.

**Severity rationale:** potentially consequential for correctness when a
consumer still skips a required read. For an advisory report with no automatic
consumer, the consequence is misleading work and use guidance instead.

## H2 — Withdrawing a use does not account for its earlier consequences

**Disposition: candidate defect in assessment/recovery accounting.** The draft
can describe future fallback but does not require a separate account of effects
already produced under withdrawn support. This is a gap in its sufficiency
claim, not a demand to implement a sync engine or promise universal repair.

**Attacked claim:** assessments distinguish actual mitigation from remaining
risk and supply the next concrete action. Relevant locations: issue/task record,
line 29; N5, lines 113–117; N6, lines 129–145; N8, lines 162–167.

**Minimal scene:** selective refresh was admitted using a helper-effect fact.
An endpoint then changed a shopping table, but the admitted bound omitted that
table and its retained query was skipped. The write completed; the retained
shopping view is stale. Later evidence refutes the helper-effect fact. The
system properly disables future selective refresh and shows full refetch as its
fallback. No further mutation or normal refresh occurs in this scene, so the
already-retained view remains stale.

There are no unrelated writes, hidden new queues or background sync obligations
in this scene. The stale data came from this endpoint's own completed write.

**Broken link and reversibility failure:** changing the decision for future
invocations does not execute a reconciliation for an earlier invocation. Calling
the new fallback a current mitigation can conceal the remaining consequence.
Reopening the original “establish effect bound” task also does not identify the
separate “assess and reconcile already-exposed state” work. More generally,
withdrawing a disclosure claim cannot recall data already sent to a client.
That second example limits reversibility; it does not call for automatic auth
insertion or a new disclosure mechanism.

**What would establish the failure:** use the history above, withdraw the
admission, and inspect both the retained state and derived issue list before
another mutation. A report saying the consequence is mitigated without evidence
of reconciliation is the failure. A report saying “future optimization disabled;
prior exposure unknown or still open” is an honest result even when automatic
repair is unavailable.

**Repair condition:** distinguish future-use containment, assessment of prior
exposure, and repair evidence where repair is possible. A withdrawn use should
create or retain a bounded follow-up when previous consumption could matter.
Use existing refresh/reload paths where applicable; otherwise state the open
limit and an authorized next action. Do not claim knowledge of affected past
requests when no such evidence was retained. The smallest model improvement
adds an already-consumed-use state and checks that withdrawal alone cannot mark
its consequence repaired. Integration evidence is needed for actual refresh.

**Weakening evidence:** N6 already asks for current safeguards, and N8 separates
task closure from requirement support. A careful author could put recovery
into those fields without a new record type. The candidate also calls full
refetch conditional in its example. If the promised output is strictly a
future-use assessment and never makes a current-mitigation claim, this attack
shrinks to an explicit scope clarification. As written, its issue/risk language
is broader than that restriction.

**Severity rationale:** stale retained data can persist despite a correctly
withdrawn optimization. Prior disclosure can be irreversible. Severity depends
on the affected law and actual exposure; no exposure frequency was measured.

## Declared choices that can defeat a particular use

These are undercutters of a future implementation claim, not contradictions in
a draft that expressly leaves them open.

| ID / disposition | Minimal failure scene and source link | Evidence needed and repair condition | Weakening evidence and consequence |
| --- | --- | --- | --- |
| H3 — Open admission choice | A differential oracle tests `apply=false`; a use is admitted over `apply=true`, where a real helper follows a different path. Lines 43–48 require named scope; lines 63–66 and question 1 leave the sufficient admission contract open. | Instantiate one optimization rule with its permitted domain, app path, baseline relation and material controls. Demonstrate a within-scope wrong-result control is rejected. Keep untested provider premises open or obtain separate bounded evidence for them. | The draft explicitly rejects this scope upgrade and its example withholds selective refresh. The green oracle remains useful for `apply=false`. Consequence becomes serious only if a later rule actually licenses the unsupported path. No universal proof of TypeScript is required. |
| H4 — Open context-binding choice | Helper code and local hashes stay fixed while an unversioned remote deployment changes from completing writes to acknowledging queued work. Prior evidence still appears current locally. N5 acknowledges unobservable changes; question 2 leaves closure open. | Record the premise as conditional unless execution can be bound to a supported provider identity/contract. Choose the actual use rule for that limit. An unavailable identity must not be displayed as verified identity. Show the next task can establish a specific missing premise rather than “verify the provider.” | This is expressly acknowledged, so it is not a discovered hash bug. A pinned local helper or immutable deployment identity weakens the scene. The consequence is late writes escaping immediate refetch; hashes cannot repair that behavior. No runtime catalog check follows. |
| H5 — Open dependency-discovery choice | Two endpoints use an opaque shared helper, but only one dependency edge is found. A helper fact changes; the known endpoint becomes stale while the second keeps inherited support. N1 and N2 demand unresolved parts stay visible; question 4 expressly leaves incomplete discovery open. | Distinguish an established dependency closure from a known partial graph. For the unsupported call boundary, withhold only the use requiring a complete bound and emit the missing-edge/closure task. A model can test known edges; an adapter test must include an actually undiscovered call shape to test discovery. | The candidate's proposed law carefully says “all known dependent views.” It does not pretend graph traversal proves graph completeness. The failure occurs only if an incomplete graph receives complete-bound credit, which N2 forbids. Consequence is potentially wrong refresh selection, not mere duplicate agent work. |
| H6 — Open priority choice | Two live tasks concern a plausible cross-tenant disclosure and a demonstrated wrong aggregate. Product exposure and current safeguards are unknown. Repeated “ask for priorities” output leaves no chosen implementation action. N6 explicitly permits incomparability; question 3 leaves default priorities open. | Supply a bounded next investigation that can resolve a material unknown, or identify the exact product choice and its owner. Preserve prerequisites. Exercise the procedure with both an urgent unknown and a minor demonstrated defect, and explain which evidence would change their order. | The frozen brief does not require a fabricated total order, and N6 already permits investigations and ties. An honest request for a real value decision meets the standard when no technical observation resolves it. Consequence is stalled or misdirected work, not a measured increase in incident risk. |

## Rejected attacks and controls

| ID / disposition | Attack or proposed control | Why rejected; evidence that could reopen it |
| --- | --- | --- |
| H7 — Rejected attack | A green settled-row oracle makes every endpoint dimension green. | N4 allows useful support with an unresolved requirement; N6 renders dimensions; N8 preserves larger promises. The example retains a provider unknown beside the passing comparison. Reopen only if a renderer or rule actually collapses these distinctions. |
| H8 — Rejected control | Demand a formal proof of arbitrary TypeScript before accepting any optimization evidence. | This changes the user's standard and discards useful bounded tests. The draft names methods and expressly permits fixed rules admitting scoped oracle evidence. Challenge the particular domain, comparator or observation instead. |
| H9 — Rejected attack/control | Missing helper evidence always makes full refetch safe; repair with a hidden mutation queue or runtime catalog checks. | N2 forbids runtime catalog scans. N5 says full refetch does not fix unfinished writes or missing auth. The brief forbids new queues. A concrete helper-completion check or authored repair is in scope; inventing framework semantics is not. |
| H10 — Rejected attack | Rename or narrow a passing claim to silently retire the larger promise. | N1 preserves stable rule identity across renames, and N8 separates task closure from requirement support. The oracle guide reinforces this. Reopen against a generated rename/scope-change transition that actually loses the requirement. |
| H11 — Rejected attack/control | A comparator change is just another passing result; require human review for every ordinary test addition. | N7 invokes the RFC's review requirement for changed acceptance controls. That source includes comparison scripts and workloads that determine acceptance. It does not impose review on every test addition. Reopen if a comparator-only edit that changes admission bypasses this referenced rule. |
| H12 — Rejected attack | Source or test counts show a probability of correctness or measured risk reduction. | The candidate and brief expressly reject that inference. Prior categorization counts are source-record accounting, and its observations are bounded source inspections. No experiment in this assay measured a production incident rate. |

## Stop condition and limits

All twelve material attacks or controls have a disposition: H1–H2 are narrow
candidate contract gaps, H3–H6 are declared open choices, and H7–H12 are rejected
attacks or controls. H1 and H2 need an explicit lifecycle rule or a narrower
claimed scope before a later implementation can be judged against them. The
other scenes supply useful tests for chosen rules; they do not choose those
rules here.

The candidate is a design document. No engine, adapter, consumer or model was
implemented or tested in this audit, so no red/green claim is available. Its
existing protections are source evidence that weakens the attacks, not proof
that an eventual implementation will satisfy them. The assay stops with bounded
repair conditions rather than declaring the candidate selected or rejected.
