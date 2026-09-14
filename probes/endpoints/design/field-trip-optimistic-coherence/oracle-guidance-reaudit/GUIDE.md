# Writing reliable oracle tests

An oracle is the part of a test that decides whether the behavior is right. A generator chooses what to try. Keeping those jobs separate lets us test many executions without writing an expected answer for each one.

The hard part is not making more cases. It is making cases whose answers mean something.

Suppose a query promises IDs in rank order. We expect `[1, 2]`; production returns `[2, 1]`. A length check passes. A membership check passes. An ordered comparison fails. We exercised the query in all three tests, but only one observed the difference we cared about.

That distinction runs through this guide: **decide which behavior matters, then build a test that can both reach and reject its violation.**

Start with [one small oracle](#build-one-small-oracle). Follow the later sections when your contract needs [richer state](#keep-only-state-that-can-matter), [controlled timing](#generate-histories-that-reach-the-problem), or [more observations](#observe-what-the-contract-promises). The [review card](#a-review-card) is a short way to apply the guide to an existing test. Historical cases and research are collected in the [companion notes](oracle-guide-notes-v1.md).

## A quick start

For a simple stateful test, repeat this loop: choose a legal action, apply it to production and a small reference, and compare the promised result at the agreed point. “After the action returns” may be the right point for one API; a callback during that action may matter for another.

Before writing the loop, answer six questions:

| Question | What to write down |
| --- | --- |
| What is promised? | The rule, its source and its limits. |
| What can happen? | Values, actions and relevant action orders. |
| How will we know the answer? | A simpler reference, another implementation, or a relation that must hold. |
| What are we actually exercising? | The production entry point and what the fixture supplies. |
| What will we compare, and when? | Rows, order, events or other promised behavior, at a named checkpoint. |
| Why should we trust this check? | Evidence the path ran, the comparison rejects the relevant wrong answer, and failures can be replayed. |

These are responsibilities, not six required classes. A small property may answer them in a comment and twenty lines of code. A lifecycle suite may need a separate model and driver. Do not build a framework just to fill the table.

A useful test card is equally small:

```text
Law and source:
Domain and legal histories:
Reference or relation:
Production path and checkpoint:
Observed result and known omissions:
Reach witness, fault control and replay command:
```

An intentionally partial oracle is still useful. A rule that rejects duplicate completion cannot prove the rows are correct, but it can protect a real promise. A fixed regression can preserve a valuable history. Prefer an oracle that generalizes a bug's missing distinction where practical; keep the fixed witness when it adds clarity or reach. Randomness is not what makes either test trustworthy.

Some concurrent contracts allow several results. In those cases, the reference must allow that freedom rather than invent one required order. We will return to that after establishing how to record an execution.

## Build one small oracle

Use a deliberately narrow example first. The following is an **illustrative contract**, not a specification for every TanStack query:

- Rows have unique integer `id` values and finite numeric `rank` values.
- Rows sort by ascending rank, then ascending ID.
- A nonnegative integer width chooses the first rows; width zero returns none.
- Each action inserts an absent ID, changes the rank of a present ID, or deletes a present ID.
- After an action has been applied, the ordered visible IDs must match a full recomputation.

This test checks membership and order. It does not check projected row values, notification counts, locale ordering or asynchronous loading. Adding those claims would require adding the corresponding model and observations.

### Start with agreement, then the model

Our expected answer is an ordered list of IDs. We may ignore internal tree nodes. We may not sort the actual IDs before comparison: doing so would erase the ordering bug.

The reference can store all rows in a `Map` and sort from scratch. It does not need production's tree, incremental caches or rank maintenance:

```js
function expectedIds(rows, width) {
  return [...rows.values()]
    .sort((a, b) => a.rank - b.rank || a.id - b.id)
    .slice(0, width)
    .map((row) => row.id)
}
```

Keep the reference's records separate from production's records. If production mutates a shared object and thereby changes the expected answer too, the two sides can agree for the wrong reason. Here, copying the two numeric fields is enough. Richer values need a copying or identity policy suited to their contract—not an automatic appeal to JSON serialization.

Independent code also needs independent reasoning. Calling production's comparator from this reference would make comparator defects invisible to this particular comparison. Reuse mundane test mechanics when useful, but name any semantic helper both sides trust. A small model is easier to inspect; it is not correct merely because it is small.

### Turn examples into histories

Take two rows: `(id: 1, rank: 2)` and `(id: 2, rank: 1)`, with width two. The expected IDs are `[2, 1]`. Change row 1's rank to zero and they become `[1, 2]`. Delete row 1 and the answer becomes `[2]`.

That is a history: a starting state followed by actions. The generator can produce many such histories while the same reference computes each answer.

The integration loop below is pseudocode; the named driver operations are not TanStack APIs:

```text
create independent model and production fixture
for each generated action:
    require action to be legal in the model
    apply action through the production driver
    apply action to the model
    reach the contract's applied checkpoint
    compare production's visible IDs with expectedIds(model, width)
finally:
    clean up the fixture without hiding the original failure
```

For this settled-result law, no intermediate publication claim follows. If atomic publication is also promised, record callbacks during the action; a read afterward cannot recover a transient tear.

Generate actions from legal choices: insert a new ID, update an existing one, or delete an existing one. Keep a witness that actions actually execute; a long list of rejected or skipped commands may do little work. Constructive generation and state-aware command checks are useful options, not reasons to disable shrinking. The [fast-check model guide](https://fast-check.dev/docs/advanced/model-based-testing/) describes commands and replay; check the installed version before copying an API recipe.

Pin the structural cases that matter: no rows, width zero, a boundary tie, and repeated changes to one key. Exhaust a small domain where that is cheap. Then randomize values and longer legal histories. Fixed cases, bounded enumeration and random exploration do different jobs; overlap between them is not a defect.

### Make the comparison prove its usefulness

Suppose the update test only asserts that the result changed. Returning `[]` passes that assertion. Keep the update—it is a useful cause—but compare against `[1, 2]`.

Now test the check. Feed it a deliberately reversed expected result in the tied or reordered cell and establish that it rejects it. Separately, confirm that the integration test reached the production boundary it names. Checker sensitivity and path reach are different claims: a perfect comparison on an unused code path protects nothing there.

When production fails, keep the original history and the first mismatching checkpoint. Reduce the history while requiring that same violation, then retain the small witness with the broader property. That gives us both a readable explanation and more ways to encounter the class of failure.

### When a full reference is not the best fit

The `Map` works because the answer is cheap to compute independently. Other promises support other judgments:

| Method | Useful judgment | Important limit |
| --- | --- | --- |
| Simple model | Recompute the allowed result or step a small abstract state. | The model can omit a meaningful distinction or encode the wrong rule. |
| Differential comparison | Run equivalent work through another implementation or formulation. | Both paths can share a bug; their semantics must actually agree. |
| Metamorphic relation | Transform an execution and check a relation between the answers. | The transformation's premises must hold. |
| Partial invariant | Check a specific promise such as no duplicate completion. | Passing says nothing about unobserved properties. |
| Recorded regression or snapshot | Preserve a known execution and expected result. | The stored result needs justification; recording it does not make it right. |

Choose the smallest authority that answers the question. Combining complementary checks can help; making every test compute every possible observation usually does not.

## Keep only state that can matter

A reference becomes suspicious when it starts to look like production. But removing fields until it looks simple is not a sound design method either. Which distinctions can we safely discard?

Consider this **illustrative support model**. An acquisition handle supports a row. Replacing handle `a` with `b` transfers that support. Releasing a retired handle is a legal no-op. We observe support, not whether a provider physically deletes a source row.

| History | Current supported rows | Live support count |
| --- | --- | --- |
| Acquire `a` supporting `x` | `{x}` | 1 |
| Acquire `a`, then replace it with `b` supporting `x` | `{x}` | 1 |

The rows and count look identical. Now release `a`. The first history loses support for `x`; the second retains it through `b`. A model containing only rows and counts cannot answer both correctly.

This gives a practical simplification test: **find two states the model treats as equal, then try a legal next action that could distinguish them.** If their promised observations diverge—or an action is legal in only one—the model erased something relevant.

The witness tells us to retain the ownership distinction here. It does not prove the revised model handles every retry, pending completion or replacement race. Nor does it require every real API to accept retired handles: if the actual contract rejects them, model that rule instead.

### Know where the expected answer comes from

There are two questions behind “the model says so.” Who established the behavior? And which state determines the observable?

Our history contains an ordering accusation withdrawn because the model sorted visible optimistic values while the relevant contract used source-owned position. Another finite model represented scores only up to three, turning `score > 3` into an empty predicate. The model had lost permitted values; that was not a reason to change production semantics. These are historical corrections, not current operator documentation. See the [case notes](oracle-guide-notes-v1.md#historical-cases).

Before changing production to satisfy a red test, check the contract, representation and comparison. A genuinely unresolved product choice belongs with its owner. A missing value in a finite model belongs in the model. References—including newly written specifications—can be wrong.

Review the accusation and suggested fix separately. In one recorded adapter episode, returning a Promise transferred a lease even when it later rejected. Clearing ownership on rejection looked like cleanup but reportedly leaked the release obligation. The concern was useful; that repair did not follow from it. Other adapters may use different acquisition rules.

Projection deserves the same care. Removing internal metadata from a public-value comparison can be valid. Removing a contractual virtual field because it is called “metadata” cannot. Write down one difference the comparison may ignore and one it must retain.

## Generate histories that reach the problem

Once the reference can distinguish relevant states, the generator must put production into them. Random payloads alone do not create ownership reuse, failed startup or work after recovery.

Look for relationships and transitions: same key versus fresh key; one owner versus a surviving sibling; reject before versus after acquisition; release before versus after completion; recover, then perform another operation. Keep healthy peers alive where isolation is part of the promise. A test that ends at “recovery succeeded” may never reveal broken next-use state.

Fresh disjoint rows can simplify a fixture while excluding the retired-key interaction it needs. Repeated `true` leadership reports do not cover `true → false → true` while earlier work is pending. These are different histories, not merely different random values.

### Control the event, not just its returned Promise

Async operations can have several boundaries:

```text
request invoked → response delivered → writes applied → view published
                                      ↘ returned Promise settles
```

That diagram names possible events, not a universal required order. The API contract must say which events precede which others. The test must control and observe the ones its claim depends on.

If `setWindow` applies work eagerly, delaying its returned Promise does not delay that work. In an earlier harness, an unconditional `await` let a queued microtask repair a same-turn mismatch before the assertion ran. A test that reads only settled state could not expose the earlier observation. Likewise, an equal initial window change can repair startup before startup is checked.

Put an explicit hold or release at the event you need to control. Record publications during the held interval if the promise concerns what users can see then. A scheduler is helpful only within the boundaries it controls; a seed cannot schedule arbitrary external I/O. The [fast-check scheduler documentation](https://fast-check.dev/docs/advanced/race-conditions/) explains the distinction between an operation's lifecycle and delivery of its result.

### One matrix can need two schedules

The historical four-receipt settlement fixture shows why enumerating more positions is not enough. A receipt here is a completion obligation for a portion of applied work. The tested contract required success to await the relevant receipts and failure not to wait for unrelated later work.

For each selected receipt, two schedules asked different questions:

| Question | Hold and release pattern | Observation |
| --- | --- | --- |
| Can settlement ignore this receipt? | Keep it pending; apply every peer. | The request must still await this obligation. |
| Does its rejection wait for a later peer? | Apply earlier receipts; leave later ones pending; reject this one. | Observe rejection while later work remains pending. |

Resolving every peer first isolates omission but removes the pending sibling needed to expose delayed rejection. At the terminal receipt there is no later peer, so that cell cannot distinguish this delay. An empty expected prefix at the first receipt is valid; do not require nonempty rows just to prove the test ran.

The archive reports that an `allSettled` mutant failed by timeout in this fixture. That is evidence about delayed rejection, not proof that every row or error assertion rejected a wrong value. Keep the two claims separate.

Widening a generator can lose reach in two ways. A rewrite may remove a previously possible complete history, even while adding a dimension. Or a larger domain may make a useful history rarer at the same run budget. Neither means a true superset contains fewer cases; it means possibility and sampling frequency need separate checks.

### Make the fixture respect the responsibility boundary

A test provider can accidentally fix the consumer. One reported pagination fixture removed already-delivered rows before applying the requested limit. That supplied progress the consumer had not requested and hid repeated-page behavior.

Contrast a provider whose job is to gather several backend pages to satisfy one requested offset and limit. Its internal draining loop may be legitimate. The location of code in a test helper does not decide which case it is. State what the request asks, what the provider promises, and which progress production must arrange.

The same discipline applies to reentry. If a callback conditionally triggers the second operation, assert that the callback and trigger occurred. “If reached, check it” is a useful conditional claim, but it is not evidence that reentry was tested.

## Observe what the contract promises

Reaching the right state still leaves a choice: what evidence survives the test harness?

Select observations from the actual promise. Membership, values, order, multiplicity, callback boundaries, downstream views, error identity, settlement timing, durable storage and resource ownership are not interchangeable. No suite needs all of them merely because they exist.

If an unprojected sort field changes, compare the expected new ordering, not just whether the array changed. If a callback count matters, assert the count before looping through callbacks; a loop over no callbacks checks nothing. If a failed write must not reach storage later, reconstruct persisted data after a later successful operation. The assertion should separate the specific wrong behavior from the allowed one.

### Let the recorder represent violations

It is useful to make generated inputs legal. It is dangerous to make recorded outputs incapable of being illegal.

Suppose production completes the same request twice. A request-keyed map that stores only the last completion collapses the violation. Record both events, then assert the promised count. Keeping the raw list alone is not enough if the final report folds it back into a map and loses the duplicate.

Similarly, do not reset a delta tracker before checking unchanged anchors, discard negative weights merely because the final relation should be nonnegative, or normalize away contractual order. Normalize only what the chosen comparison permits.

### Check incremental results and publication separately

An incremental engine emits changes. A reference often computes a whole result. Compare compatible objects: accumulate the changes, then compare that state with full recomputation at the promised logical point. Inspect individual batches too when the contract makes their boundaries visible.

DBSP formalizes the computational relation as `QΔ = D ◦ Q ◦ I`: accumulate input changes, run the ordinary query, then take output differences. Equivalently, accumulating the incremental output should agree with querying the accumulated input. This is a useful source of laws for db-ivm. It does not choose whether a client may see a partial publication, when readiness changes, or what cancellation means. [DBSP paper](https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf).

A final correct snapshot cannot establish that every earlier callback was coherent. The recorded graph-history case used asymmetric changes to expose an old-left/new-right publication that a later settled check would miss. Choose observation points that can distinguish the promised failure, rather than adding delays until the result is stable.

When scheduling legitimately allows several results, check for **one permitted explanation of the observed history**. Do not approve each field against a different allowed execution: those individually permitted pieces may never coexist. In specification terms, refinement means implementation-visible behaviors are permitted by the specification. A bounded test checks sampled histories; it is not a refinement proof. Nor can an accepted finite prefix prove eventual completion. [Refinement mappings](https://lamport.azurewebsites.net/pubs/abadi-existence.pdf).

### Compare formulations when a model might share the bug

Even a plain reference can copy an incorrect semantic assumption. A second formulation gives another way to disagree.

For a suitably scoped includes query, compare nested results with per-parent standalone queries or a flat join regrouped by parent. First state how empty parents, duplicates, ordering and projection match. A transformation that changes the answer is not an oracle for equivalence.

Ternary logic partitioning, or TLP, provides a related SQL example. For a predicate that can be true, false or unknown, partition the same input into those three cases and recombine them with the original multiplicities. Under those premises, the union should recover the unpartitioned input. NULL behavior, aggregation and ordering need explicit treatment before turning this into a library recipe. It is not a license to split an arbitrary limited query into independently limited pieces. [SQLancer's oracle inventory](https://github.com/sqlancer/sqlancer).

Metamorphic testing is the broader idea: transform an execution and check a known relation between the answers. Incremental-versus-recompute checks and legal history transformations can serve similar roles. They need not know one answer in advance, but they still need a justified relation.

Agreement across two paths is not proof of independence. NoREC's database experiments report shared operator faults and a copied join path that concealed a bug; count comparison also missed wrong rows with the right count. Use differing formulations for the faults they can separate, not as an automatic second vote. [NoREC paper](https://arxiv.org/pdf/2007.08292).

## Test the test—and keep the same failure

“The suite passed” compresses several claims. Was the property selected? Did it run? Did it reach the intended path? Did its comparison execute? Would that comparison reject the fault under discussion?

Treat those as separate evidence. A replay registry can contain a property nobody invokes. A multiplier can be parsed without changing the run count. A no-op assertion can leave a campaign green. Use a positive execution witness and a deliberate wrong-result control where those claims matter.

Mutation testing changes production code deliberately to challenge tests. Record what happened, not just whether a mutant was “killed”:

- A value assertion rejected the intended wrong answer.
- A timeout exposed a missing progress obligation.
- Setup failed before reaching the comparison.
- The changed code never ran.
- The mutant survived, or the change was equivalent within the tested domain.

These results call for different conclusions. If deleting one clause leaves the same obligation enforced elsewhere, survival does not show the obligation unnecessary. If the test kills a compound change, it may not distinguish each part. Research on mutation testing does not supply a conversion from a score to the probability that this library is correct; the [reading notes](oracle-guide-notes-v1.md#research-and-further-reading) preserve those limits.

### Preserve the violation, not merely a red exit

Shrinking makes failures explainable by removing irrelevant values and actions. A smaller legal history that fails during setup is not a reproduction of an original torn publication. Require the original failure predicate: the violated law, the relevant observation point, and the distinguishing evidence.

Keep the original trace beside the reduction. Record which property ran and which checkpoint replay reached. “Ran, but did not reproduce the original mismatch” and “failed before reaching the comparison” are useful outcomes; neither should be labeled successful reproduction.

Capture evidence before cleanup can change it. The historical publication fix copied the batch list before rollback; that preserved the needed local evidence, not universal deep immutability. An outer copy may still hold mutable values. A serializer may lose object identity or reorder arrays. Choose capture rules for the law and retain an original representation when normalization would erase the disputed distinction.

Cleanup also has three separate jobs: preserve the primary failure, retain secondary cleanup diagnostics, and release resources. Reporting the first error does not prove the other two happened. Avoid letting a cleanup exception replace the mismatch that started the investigation.

A useful failure report contains:

```text
Law and source; property and production path
Code/dependency version; relevant environment
Seed/path and explicit action or schedule trace
Reached checkpoint; expected versus actual observation
Original trace; reduced trace; reproduction result
Primary failure; separate cleanup diagnostics
```

Check replay commands against the installed tool. A seed is not a recording of the network, operating system or every Promise. If a challenge influenced the design, keep it as a regression or tuning case; it is no longer a held-out test of that design.

## Review and maintain the portfolio

When a reviewer finds a bug beside a green oracle, ask why the test missed it before adding another isolated example. Was the expected answer wrong? Was the history absent? Did the fixture drive another path or supply the missing work? Did the observation admit the wrong answer? Did capture or replay erase the failure?

These categories overlap. They are prompts for a concrete explanation, not an exhaustive taxonomy or a grade.

Begin a portfolio audit with known product promises as well as existing test claims. Otherwise ten honest settled-row tests can hide that nobody claimed startup rejection in the first place. Credit a witness at **contract × history × production path × observation**. A green component tested under a mock assumption does not establish that its real provider satisfies that assumption.

The historical React tie-group test illustrates precise credit. It exercised a real QueryClient/Query DB path with a finite test provider and checked visible prefixes and exhaustion. That could fill a portfolio-level gap without improving another test's weak assertion. It did not establish page-array contents, every framework or arbitrary server ordering. Preserve useful partial tests without lending them their neighbors' scope.

### Simplify machinery without changing the question

Before removing or combining tests, identify the valid history, expected outcome, production path and observation that will remain. Name the receiving test. “Retry the parent” becoming “delete the parent” changes the behavior, even if the replacement is shorter and green. The archive records exactly that kind of loss during reduction.

Other reductions are legitimate: an expectation can contradict the adapter contract, or two branches can enforce the same established law. Removing a redundant branch need not remove its law. Keep valuable fixtures and semantic assertions even when their old helper or duplicate implementation goes away.

Share stable mechanics such as replay parsing or resource cleanup where they are genuinely interchangeable. Keep domain truth small and separately reviewable. Several independent models should not grow into a universal miniature implementation merely to reduce duplication.

### Report evidence and open work separately

Sometimes the right correction is to narrow a claim. A reachable-object count is not a construction count: traversal may itself construct objects, and discarded objects are unseen. The historical repair both renamed that metric and checked source delivery before and after traversal. Renaming alone would omit part of the repair.

Narrowing evidence does not retire the larger promise. Keep two lines when necessary:

```text
Observed: 100 irrelevant payload reads versus zero in the recorded probe.
Open: elapsed slowdown is unverified; the extra-work finding remains open
      in that historical ledger.
```

Likewise, “assertions passed; process exited nonzero” is neither a clean green run nor an absence of passing assertions. An observed compatibility failure and an unresolved support policy can coexist. State both rather than squeezing them into one status.

A weak observer, a missing protocol signal, and a measurement not yet taken are different limits. None alone grants permission to drop a valid product obligation. The guide does not prescribe a universal run count, fault rate or stopping score.

### A review card

For a new oracle or a claimed repair, ask:

1. What exact promise authorizes this expected result?
2. Which legal history distinguishes the proposed model from a weaker one?
3. Does the fixture make production do the work being tested?
4. Which concrete wrong answer can the comparison reject—and which can it miss?
5. What proves the path and assertion ran? What did the fault control actually show?
6. Can capture, cleanup or shrinking turn this into a different failure?
7. Which larger promises remain outside this test, and where are they tracked?

The payoff is not a bigger test framework. It is a smaller distance between “this test is green” and a precise account of what that green result protects.
