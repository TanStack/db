# Guide-word content review

Status: in progress. Kyle supplies the design judgments; Codex records them.
The original [worksheet](04-guide-word-worksheet.md) remains a frozen preparation
artifact. These answers qualify individual cases; they do not close whole rows
or establish production facts without further review.

## R1 — Authorization not visible in the endpoint

Related node: N1, requirement discovery. Related worksheet questions: W01-1,
W01-4 and W01-6. This is one concrete applicability case within those questions.

Question: “Suppose an endpoint has no authorization checks and no declaration
that it is public. What should its assessment report: intentionally public, or
unresolved whether access should be restricted?”

Kyle's answer:

> unresolved — we don't know if it's wrapped w/ auth somewhere else

Recorded judgment: missing local authorization checks leave authorization
unresolved. They do not establish intentional public access or absent enforcement;
a wrapper or another entry layer may supply it. The question of what evidence
closes that uncertainty remains open. No wrapper has been inspected or certified
by this answer, and no code change has been authorized or made by it.

## R2 — Proposed scope: identity consistency rather than auth implementation

Kyle's clarification/question:

> exactly how auth happens is outside of our scope I think — the main thing we
> want to ensure is perhaps if auth is consistent across calls so we can trace
> client identity consistently — that seem right?

Working scope, supported by the assistant's response: check consistent identity
context across query calls, mutation calls, mutation-triggered reads and collection
lifetimes. Do not make this check an audit of how authentication works or whether
the application's permission policy is correct. R1's absence of local auth code
therefore leaves identity derivation/propagation unresolved; it does not itself
create a task to add authorization.

Assistant-proposed refinement: the context may include a tenant or impersonation
scope when it changes the meaning or ownership of cached results. A client-supplied
scope string alone does not establish the server-resolved identity. Token renewal
need not change logical identity; a real context change must not reuse collections
under an incompatible context. Exact context fields and checks remain to be designed.

This is a scope refinement during review, not a certificate that any current app
meets the consistency rule or a silent change to the frozen lifecycle candidate.

## R3 — Identity consistency is an application prerequisite

Kyle accepted the identity-consistency scope, then clarified:

> I think we can assume it is there — this is API 101 — no app could ship w/o
> identity consistency

Recorded decision: assume standard application identity consistency; do not
require routine evidence or block normal collection use until an agent proves
it. This supersedes the proposed default identity-investigation task in R1/R2.
Endpoints still owns correct propagation of supplied identity context and its
own collection isolation. This is a declared prerequisite, not inspected evidence
about every application. No full application auth audit is added.

## R4 — Preserve partial SQL knowledge

Question: “when a helper’s effects are unknown, should the report keep the SQL
effects we can establish while clearly marking the overall effect set incomplete?”

Kyle's answer: “yes”.

Recorded decision: retain known SQL effects and explicitly mark the complete
handler effect set unresolved. Known partial effects do not become a complete
bound for excluding potentially affected collections. The assistant described
conservative refresh selection as the consequence; no production change was made.
Related cases: W03-3 and W03-4. This answer establishes intended behavior, not a
full credibility/consequence/action disposition for those rows.

## R5 — Reuse compatible shared-helper evidence

Question: “should one piece of evidence about a shared helper be reusable across
every endpoint that calls it, provided its version, configuration and input
conditions match?”

Kyle's answer: “yes”.

Recorded decision: shared-helper evidence can support multiple endpoint callers
when those applicability conditions match. Each use retains the actual claim's
scope; this does not transfer support to unrelated endpoint requirements.
Related cases: N1 subject identity and N4 support composition. Invalidation and
contradictory-result behavior still need their own review.

## R6 — Helper evidence validity and direct oracle failure reporting

Kyle's refinement:

> I think helper evidence should be time bound too? Or perhaps better the compiler
> can extract it (though that's not necessarily easy?) and hash it and force new
> evidence when its changed.

Recorded proposal: prefer change-bound validity when the compiler can identify
and hash the relevant helper implementation/dependencies. Time bounds remain a
possible way to require rechecking dependencies whose changes cannot be detected.
The exact captured dependency closure and expiry policy are not decided. A hash
of a call site alone does not establish unchanged remote or configured behavior.

Question: “if an oracle finds a mismatch that contradicts a previously accepted
optimization, should we immediately fall back while the agent investigates
whether the bug is in the optimization or the test?”

Kyle's answer:

> yes oracles should immediately report to the system when something breaks
> (w/o the coding agent being able to control it so automatic) — this report can
> be superseded of course once it's fixed or a different safer optimization is
> picked

Recorded decision: a failing oracle directly and automatically reports to the
system, independently of the coding agent's choice to disclose it. A contradiction
to an admitted optimization triggers fallback for the affected use while the
issue is investigated. A later fix or different safer optimization can supersede
the report; the original result remains part of history. The exact evidence for
restoring admission and the handling of already-affected client state remain open.
Related cases: N3 result capture, N4 contradictory support, N5 consumer authority,
N7 invalidation, and hostile finding H1. No reporting mechanism is implemented by
this review answer.

## R7 — Restoration must exercise the original failure

Question: “should restoring the affected optimization require a passing rerun
that includes the original failing case?”

Kyle's answer: “yes”.

Recorded decision: restoring the affected optimization requires a passing rerun
that includes the original failing case. An unrelated green run or an agent's
assertion that the issue is fixed does not meet that criterion. The original
case, violated law and observation must remain identifiable in the new result;
the broader check retains its scope. This supplies a restoration condition for
R6, not evidence that a particular optimization has been repaired. Treatment of
already-affected retained collections remains the next review question.

## R8 — No connection to live clients

After clarification of the proposed recovery of previously stale client data,
Kyle answered:

> yeah there's no way to connect to live clients

Recorded scope: this evidence system affects subsequent executions/deployments;
it does not contact already-open clients or perform retrospective client recovery.
Disabling an optimization must not be described as repairing those clients.
This narrows hostile finding H2 to honest scope/reporting, rather than introducing
a live-client repair mechanism or task. No new sync or push channel is proposed.

## R9 — A check that cannot run is a CI error, not evidence

Question: “if an oracle cannot finish because its test environment is unavailable,
should we record ‘check error’ separately from a correctness failure and retain
any prior evidence that is still valid?”

Kyle's answer:

> if a test can't run the CI check reports an error. We don't need to record that
> in the evidence log though

Recorded decision: test execution/environment failures are reported by CI and
do not need entries in the evidence log. This supersedes the draft's proposal
to retain check-error receipts there. Such a failure is not a semantic
counterexample or a new passing result. Existing evidence applicability remains
subject to its own version/expiry rules; the answer does not renew stale evidence.
CI diagnostic storage remains CI's concern, not a second evidence history.

## R10 — External evidence expiry and application-supplied checks

Question: “For an external API whose implementation we can’t fingerprint, should
its evidence expire after a set interval and require a fresh check?”

Kyle's answer:

> yes — perhaps also the user could supply their own check

Recorded decision: evidence about such external behavior has time-based expiry
and requires rechecking. Applications may supply their own check. The check's
interface and which result permits renewing evidence remain open: detecting an
unchanged relevant version/contract and rerunning a behavioral assertion are
different methods. Neither a generic availability check nor an unspecified
successful response has been accepted here as evidence of unchanged behavior.
Related cases: R6, N3 check methods and N7 external dependency revalidation.

## R11 — Custom checks use the common claim/evidence model

The assistant asked whether a custom check should support returning a
version/fingerprint and running a behavioral test as separate modes.

Kyle's correction:

> well those are both types of evidence that could settle the claim

Recorded decision: both methods fit the common model of evidence supporting a
claim. Do not introduce a separate custom-check taxonomy or interface decision
just to accommodate them. The claim and its acceptance conditions determine
whether the supplied evidence settles it. Preserve the method and what it
establishes without confusing that distinction with separate product modes.

## R12 — One shared task for a shared unresolved claim

Question: “if an unresolved claim about one helper affects ten endpoints, should
we show one shared todo, listing all ten affected endpoints?”

Kyle's answer: “Yes”.

Recorded decision: show one task for the shared unresolved claim and link all
affected endpoints. Each endpoint assessment can point to that task. This follows
R5's reuse of compatible evidence; resolving the shared claim does not resolve
unrelated requirements on its callers. Related node: N6, assessment and work order.

## R13 — Investigate consequential completion uncertainty first

Question: “a helper might return before its database writes finish, risking stale
client data. Another endpoint definitely performs an unnecessary refetch. Should
investigating the possible correctness bug come first, even though only the
performance issue is confirmed?”

Kyle's answer:

> yeah this is a big potential correctness issue — ideally we can statically
> follow it ourselves & when not agents need to provide proof

Recorded decision: prioritize this potential correctness failure over the
confirmed unnecessary refetch. Establish write completion through static tracing
where possible; otherwise require agent-provided evidence that settles the
completion claim. Uncertainty about completion remains distinct from a confirmed
early return. The exact acceptance checks and diagnostic severity remain open.
Related nodes: N2, N4 and N6.

## R14 — Diagnostic severity follows configured check strictness

Question: “Until that completion claim is established, should the linter report
an error, requiring code changes or evidence before CI passes?”

Kyle's correction:

> well remember it's not necessarily an error — it depends on the level of
> strictness of checks that are set — but yes, emit something

Recorded decision: emit a diagnostic for the unresolved completion claim. Its
severity and effect on CI follow the configured check strictness; do not impose
an unconditional error. An unresolved claim remains distinct from a demonstrated
bug. Related nodes: N5 diagnostic policy and N6 assessment.

## R15 — Missing evidence does not unconditionally disable optimization

Question: “For an optional optimization, should lowering that severity leave its
evidence requirement unchanged—so accepting a warning doesn't enable an
unsupported optimization?”

Kyle's correction:

> a warning wouldn't necessarily disable an optimization e.g. a human might know
> a call is safe but not want to take time to provide evidence at that moment

Recorded decision: a warning about missing evidence need not disable an
optimization. The system must allow a human to proceed without supplying evidence
at that moment. This supersedes the assistant's proposed unconditional veto in
the question and qualifies the frozen draft's missing-support fallback rule.
Permission to use the optimization does not itself supply the missing evidence;
the claim can remain unresolved while the optimization is enabled. Whether
configured strictness alone grants that permission or a specific override is
needed remains open. This answer concerns missing evidence, not a fresh oracle
counterexample governed by R6. Related nodes: N4 and N5.

## R16 — Defer the permission mechanism to check-level design

Question: “Should choosing a permissive check level be enough to allow that, or
should the human explicitly override the particular claim?”

Kyle's answer:

> we haven't figured out exactly how check levels work so I'll defer this question

Recorded disposition: deferred. Neither permissive-level authorization nor a
claim-specific override has been selected. Preserve R14/R15 without choosing a
permission mechanism or treating this question as closed. Revisit when designing
check levels.

## R17 — Claim-specific rubrics distinguish evidence strength

Question: “an agent traces a library's source and concludes that its promise
covers all database writes. What should validate that analysis before the system
treats the claim as established?”

Kyle's answer:

> it should probably have a rubric it scores against for specific claims —
> ideally there's e2e oracle tests which establish things much more conclusively —
> so weaker -> stronger evidence

Recorded direction: assess evidence against a rubric for the specific claim and
represent weaker-to-stronger support. Prefer end-to-end oracle tests that establish
the relevant behavior more conclusively where practical. Do not flatten source
analysis and direct behavioral checks into an undifferentiated passing result.
This is a proposed assessment approach, not a selected rubric, scoring algorithm,
or universal guarantee from an end-to-end test. Who applies the rubric and how
its assessment feeds the deferred check-level policy remain open. Related nodes:
N3 evidence production and N4 support evaluation.

## R18 — The producing agent may assess its own evidence

Question: “Should a separate agent apply that rubric to source-analysis evidence,
or may the agent that produced the analysis also score it?”

Kyle's answer:

> yeah same agent — we can't enforce that anyways (though we could suggest a
> specific audit by a fresh agent if that we can show that raises certainty)

Recorded decision: the agent producing evidence may score it against the
claim-specific rubric. Do not require or claim to enforce separate-agent review.
A specific fresh-agent audit may be suggested if we can demonstrate that it
improves confidence; no such improvement has been measured in this review.
This does not replace R6's automatic runner reporting with agent-controlled
disclosure. Related nodes: N3 and N4.

## R19 — Reassess stored evidence when a rubric changes

Question: “when a rubric changes, should we reassess stored evidence first and
request new work only where that evidence no longer suffices?”

Kyle's answer: “yes”.

Recorded decision: reassess existing evidence against the changed rubric before
requesting new evidence. Request additional work only for the remaining gaps;
a rubric change does not automatically require rerunning every check. This does
not renew evidence invalidated by source changes or expiry. Related nodes: N4
and N7.

## R20 — An inconclusive investigation can receive a note

Question: “if an agent completes an investigation but cannot settle the claim,
should that investigation task close while the claim remains unresolved, or
should the task stay open until the claim is settled?”

Kyle's answer:

> yeah, it can add a note which doesn't change the investigation

Recorded decision: the agent can add a note without changing the investigation.
Do not infer closure or claim settlement from an inconclusive attempt. Kyle also
supplied [Beads](https://github.com/gastownhall/beads) as a possible API fit or
inspiration. The bounded [source reading](09-beads-api-reading.md) records the
relevant interfaces and open fit questions; it does not select a dependency.

## R21 — Borrow API ideas, not Beads itself

Kyle's clarification:

> yeah we wouldn't use Bead itself

Recorded decision: use Beads only as API inspiration. Do not adopt Beads or its
backend. This resolves the adoption-versus-inspiration question in the source
reading; the specific interface ideas to borrow remain to be designed.

## R22 — Code reversion does not reactivate old test evidence

Question: “if code returns to an exact previously checked version, all other
relevant bindings still match, and the evidence hasn't expired, should that
evidence become usable again without rerunning the check?”

Kyle's answer:

> no — code isn't the only thing used in tests

Recorded decision: do not automatically reactivate old test evidence on code
reversion. Require a fresh check to establish current support; matching code
does not establish the test's other conditions. Retain the old result as history.
This answers Process Grammar Q1. It does not reverse R19's reuse of stored
evidence when only a rubric changes, or select a new check-level policy.
