# Writing reliable oracle tests

A test needs two things: something to try, and a way to tell whether it worked.

In an ordinary example-based test, we supply both: these inputs should produce this result. That works well for individual cases. But as operations interact—insert, update, delete, retry, reconnect—the combinations grow beyond the examples we can reasonably write.

**What if we could generate those combinations and still know the right answer?**

That is the practical value of oracle-based testing. An oracle supplies the judgment independently of how we choose the test cases. It might be another implementation whose behavior should match, an executable specification, a simple reference that recomputes the answer, or a rule relating several executions.

For an incremental query engine, production might maintain complex indexes while the reference simply filters and sorts an array. Or we might compare compatible queries against another database. Either way, we can explore many histories without hand-calculating every expected result.

The payoff is broader bug detection and a stable check during refactoring. The challenge is making sure the reference, generated cases, and observations actually represent the behavior we promise.

Start with [one small oracle](#build-one-small-oracle). Follow the later sections when your contract needs [richer state](#keep-only-state-that-can-matter), [controlled timing](#generate-histories-that-reach-the-problem), or [more observations](#observe-what-the-contract-promises). The [review card](#a-review-card) is a short way to apply the guide to an existing test. Historical cases and research are collected in the [companion notes](oracle-test-notes.md). Use the [project glossary](glossary.md) for terms shared with production code.

## A quick start

One way to supply that judgment is a small reference model. For a simple stateful test, choose a legal action, apply it to production and the reference, and compare the promised result at the agreed point. “After the action returns” may be the right point for one API; a callback during that action may matter for another.

For example, suppose a query promises IDs in rank order. We expect `[1, 2]`; production returns `[2, 1]`. A length check passes. A membership check passes. An ordered comparison fails. We exercised the query in all three tests, but only one observed the difference we cared about.

An **oracle** is the rule that judges that behavior. The **generator** chooses what to try. Keep those jobs separate: more executions cannot repair a comparison that ignores the promised order.

Before writing the loop, answer six questions:

| Question                         | What to write down                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| What is promised?                | The rule, its source and its limits.                                                                   |
| What can happen?                 | Values, actions and relevant action orders.                                                            |
| How will we know the answer?     | A simpler reference, another implementation, or a relation that must hold.                             |
| What are we actually exercising? | The production entry point and what the fixture supplies.                                              |
| What will we compare, and when?  | Rows, order, events or other promised behavior, at a named checkpoint.                                 |
| Why should we trust this check?  | Evidence the path ran, the comparison rejects the relevant wrong answer, and failures can be replayed. |

These are responsibilities, not six required classes. A small property may answer them in a comment and twenty lines of code. A lifecycle suite may need a separate model and driver. Do not build a framework just to fill the table.

A useful test card is equally small:

```text
Law and source:
Domain and legal histories:
Reference or relation:
Production path and checkpoint:
Observed result and known omissions:
How to prove it ran and rejects a wrong answer; how to rerun:
```

An intentionally partial oracle is still useful. A rule that rejects duplicate completion cannot prove the rows are correct, but it can protect a real promise. A fixed regression can preserve a valuable history. Prefer an oracle that generalizes a bug's missing distinction where practical; keep the fixed witness when it adds clarity or reach. Randomness is not what makes either test trustworthy.

Some concurrent contracts allow several results. In those cases, the reference must allow that freedom rather than invent one required order. We will return to that after establishing how to record an execution.

## Write the oracle as executable subsystem documentation

A good oracle can do more than catch regressions. Its model can give humans and
agents a short, executable theory of the subsystem. Production code shows how
the system works. The oracle should state what the system promises and why each
observable result follows.

This does not make the model the source of product policy. Derive the contract
from an approved API, architecture document, established behavior, or design
decision. The file then keeps that contract, its model, and its production
evidence together.

Two small examples show the form:

- [`load-subset-transaction-refinement-oracle.test.ts`](https://github.com/TanStack/db/blob/main/packages/db/tests/query/load-subset-transaction-refinement-oracle.test.ts)
  explains when an abort can still cancel an on-demand load.
- [`fifo-retry.property.test.ts`](https://github.com/TanStack/db/blob/main/packages/offline-transactions/tests/fifo-retry.property.test.ts)
  explains why a ready transaction waits behind a delayed FIFO head.

### Use five visible layers

Keep these layers distinct even when they share one file:

| Layer | What it must answer |
| --- | --- |
| Contract | What does the subsystem promise, and where is the boundary? |
| Model | What is the smallest independent rule that predicts public results? |
| History grammar | Which values, actions, relationships, and schedules can occur? |
| Production driver | Which real entry point and event boundary does the test exercise? |
| Refinement check | Which public observations must agree with the model, and when? |

Do not create five classes merely to match this table. A short file can use one
opening comment, one pure model function, a generated input, a production
fixture, and assertions. A large state machine can split these layers into
separate modules when that makes each layer easier to review.

### Lead with the law

Start with a question or a direct statement of the problem. Explain why a
normal example can miss the failure. State the contract before introducing test
mechanics.

Put the central law beside the model too. The opening comment supplies context.
The local comment lets a reader check the model without searching the file.
These comments are not duplicates when they serve those separate jobs.

For example:

```ts
// Publication is the boundary. An abort before publication rejects the load
// and discards the row. An abort after publication starts resolves the load
// and keeps the row visible.
function expectedOutcome(phase: AbortPhase): ExpectedOutcome {
  // ...
}
```

### Make the model easy to distrust

Prefer a pure function or a small state transition. Keep production queues,
caches, classifiers, and helpers out of the expected result. A reader should be
able to challenge the model without first learning the implementation.

Name partial models honestly. If a model predicts rows but not callback counts,
say so. If several outcomes are legal, return the permitted set or relation. Do
not hide policy in scattered assertions outside the model.

Check every modeled public fact at each relevant boundary. During the FIFO
rewrite, prose exposed that the first draft modeled calls but checked outbox
ownership only at the end. Moving both observations into one state model made
the test and the documentation agree.

### Decompose the model by law

A reference model can become as hard to trust as production. Do not keep adding
state until it becomes a second implementation of the subsystem.

Treat the oracle as a small graph when the contract has independent laws:

- A node owns one coherent rule and the least state needed to predict it.
- An edge records a real dependency between two rules.
- The production driver can feed the same action to several nodes.
- The refinement check composes their observations at the named checkpoint.

For example, demand generations, facade identity, and callback coherence can
use separate models. They share actions, but they do not need one controller
that reproduces every production queue and cache. A failure then names the law
that diverged. A reviewer can also inspect each rule without learning the rest
of the subsystem.

Do not split state that a legal next action can observe only as a whole. Use the
distinguishing-history test: if two states look equal to the proposed nodes,
can one legal next action produce different promised results? If yes, add the
missing edge or keep that state in one model.

Decomposition does not mean one model per assertion. Group facts that form one
state machine. Keep independent policies separate. When an integrated promise
spans several nodes, add a relational check across their outputs instead of
merging their internal machinery.

This graph is a reasoning tool, not a required test framework. Plain functions
and Maps are often enough.

### Treat the input domain as a grammar

Before choosing arbitraries, describe the language of legal cases. A useful
grammar separates three kinds of fact:

- **Dynamics:** actions and transformations that move the system.
- **Constraints:** invariants, interfaces, and forbidden combinations.
- **Boundary conditions:** starting state, scale, provider behavior, and value
  domains that limit where the rules apply.

Freeze the contract first. Mark which rules come from an API or architecture
document and which rules the test author inferred. Then map containment,
overlap, and dependency. Do not force overlapping concerns into a tree merely
to make the generator neat.

Use four controls before trusting the grammar:

1. **Reconstruction:** Can the grammar rebuild every known valid witness?
2. **Ablation:** Does removing each axis, rule, or overlap lose a promised case
   or admit a forbidden one?
3. **Range:** Does an independent marginal case require only new parameter
   values, or does it expose a missing rule?
4. **Exclusion:** Can the grammar reject a nearby invalid history or state?

Generate adjacent valid forms from this grammar. Do not take a flat Cartesian
product of unrelated axes merely because the tool makes that easy. When the
contract does require a product, add a calibration assertion that proves every
declared cell appears once.

This approach exposes two common false greens. A grammar that cannot reconstruct
a known bug omits a path. A grammar that generates valid and invalid histories
without distinction makes skips and classifiers carry hidden policy.

### Use controlled technical English

Write prose that another agent can parse without asking what a term means:

- Use active voice and short sentences.
- Give one state or event one name. Do not rotate synonyms.
- Define necessary domain terms when they first appear.
- Keep `must`, `may`, and `does not` exact. They state different contracts.
- Use a list for three or more phases, actions, or conditions.
- Avoid metaphors when a boundary or transition has a precise name.
- Explain laws, causes, omissions, and checkpoints. Do not narrate clear code.

Aim for no more than 25 words in a descriptive sentence. Keep a longer sentence
when splitting it would lose a condition or change its force. Clarity is the
goal. A low word count is not.

### Use production vocabulary

The model and production code must use the same term for the same concept. Read
the [project glossary](glossary.md) and the subsystem architecture before naming
model states, actions, or observations.

Shared vocabulary does not weaken model independence. Reuse a production term,
not its queue, cache, transition helper, or semantic implementation. If the
model deliberately combines or splits production concepts, declare that mapping
beside the model. Never give a model-only convenience the name of a stronger
production concept.

Check the causal grammar as well as the nouns. Demand starts an acquisition
attempt. Adapter acceptance establishes a physical acquisition and its lease.
Committing source writes produces an applied receipt. Publication exposes one
coherent public snapshot. Adapter acceptance, promise settlement, applied
settlement, and publication are different boundaries even when one synchronous
execution crosses all four.

Avoid unqualified words that hide those distinctions. Name a `sync run`,
`public snapshot`, `logical subset owner`, or `window-operation generation`
rather than a generic session, state, owner, or generation. When production
renames a concept, update its glossary entry and the models that represent it in
the same change.

### Audit prose, model, driver, and observations together

Treat the layers as separate claims. Compare each pair during review:

1. Does every promise in the prose have a model rule?
2. Does the model retain every distinction that a legal next action can expose?
3. Can the history grammar reach each modeled transition?
4. Does the driver exercise the named production path and event boundary?
5. Does each modeled output reach an assertion at the promised checkpoint?
6. Can the recorder represent duplicate, missing, reordered, or partial output?
7. Does any assertion impose behavior that the contract and model do not state?
8. Do prose, model, driver, and production use the glossary's canonical term
   and transition grammar for each shared concept?
9. Does every model-only term declare how it maps to production, or that it has
   no production counterpart?

This comparison is a useful audit instrument. If the prose cannot explain an
assertion through the model, the model may be incomplete. If the model predicts
a fact that the test never observes, the test may be false green. If the driver
cannot create a named phase, the prose claims more reach than the test has.

### Keep the prose proportional

Do not turn every regression test into an essay. Use this form when a file owns
a reusable law, state machine, lifecycle boundary, or reference model. A focused
test can remain short when its name and setup already state the whole contract.

As a starting budget, add only prose that helps a reader answer one of the five
layer questions. After the first draft, remove comments that only translate the
next line of code into English. Run the test after the rewrite. A documentation
edit that weakens the executable law changes behavior.

## Build one small oracle

We'll build a small reference model as one example of the approach. The following is an **illustrative contract**, not a specification for every TanStack query:

- Rows have unique integer `id` values and finite numeric `rank` values.
- Rows sort by ascending rank, then ascending ID.
- A nonnegative integer width chooses the first rows; width zero returns none.
- Each action inserts an absent ID, changes the rank of a present ID, or deletes a present ID.
- After an action has been applied, the ordered visible IDs must match a full recomputation.

Here is the completed card for this example:

```text
Law: sort by rank then ID; return the first width IDs after each action.
Source: the illustrative contract above.
Domain: finite numeric ranks, unique integer IDs, legal insert/update/delete.
Reference: independent Map, fully sorted after every action.
Production path: the ordered-query entry point, after each action is applied.
Observe: the complete ordered IDs; not row values or callback counts.
Prove it ran: record applied actions and executed comparisons.
Challenge: the comparison must reject [2, 1] when [1, 2] is required.
Replay: retain the action list and width, plus the harness's replay inputs.
```

The production path still needs its concrete API name when this card becomes a real integration test. The example does not establish row-value, notification, locale or asynchronous-loading behavior.

### Start with agreement, then the model

Our expected answer is an ordered list of IDs. We may ignore internal tree nodes. We may not sort the actual IDs before comparison: doing so would erase the ordering bug.

The reference can store all rows in a `Map` and sort from scratch. It does not need production's tree, incremental caches or rank maintenance:

```js
function expectedIds(rows, width) {
  return [...rows.values()]
    .sort((a, b) => a.rank - b.rank || a.id - b.id)
    .slice(0, width)
    .map((row) => row.id);
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

For this example, choose only actions that are legal now:

| Current model        | Available choices                                                |
| -------------------- | ---------------------------------------------------------------- |
| Empty                | Insert an unused ID.                                             |
| Contains ID 1        | Insert another ID; update 1; delete 1.                           |
| Contains IDs 1 and 2 | Insert another ID; update either live ID; delete either live ID. |

After choosing an action kind, choose its key from the applicable set. This is constructive generation: build a legal case rather than repeatedly discard illegal ones. Another valid approach generates commands with applicability checks and skips those that cannot run. Either way, count executed actions; a long list of skipped commands may do little work.

Shrinking means reducing a failing input or action list while keeping its failure. Design action dependencies so the smaller histories remain meaningful; don't disable shrinking merely because the test is stateful. The [fast-check model guide](https://fast-check.dev/docs/advanced/model-based-testing/) describes commands and replay; check the installed version before copying an API recipe.

Pin the structural cases that matter: no rows, width zero, a boundary tie, and repeated changes to one key. Exhaust a small domain where that is cheap. Then randomize values and longer legal histories. Fixed cases, bounded enumeration and random exploration do different jobs; overlap between them is not a defect.

### Run fixed and random seed lanes

A fixed fast-check seed always generates the same cases. This makes a useful
history stable, but it does not explore new histories on later runs. Do not
describe a fixed-seed property as random coverage.

Run important properties in two lanes:

1. Run a fixed seed that preserves a known useful campaign.
2. Run without a seed so fast-check chooses a new seed.

When the random lane fails, retain the reported seed and shrink path. Give the
suite environment variables or another checked replay interface when practical.
The replay input must select both the seed and the path. A seed alone reruns the
campaign but might not stop at the same reduced counterexample.

When replay inputs are present, run only the requested replay lane. Do not spend
time on the fixed campaign before reaching the failure the developer asked to
reproduce.

The fixed and random lanes should use the same property, generators,
observations, and run budget. Only their seed source should differ. This keeps a
random failure eligible for promotion into a pinned example or fixed campaign.

[`fifo-retry.property.test.ts`](https://github.com/TanStack/db/blob/main/packages/offline-transactions/tests/fifo-retry.property.test.ts)
shows this shape. Its fixed lane preserves one scheduler campaign. Its second
lane uses a random seed by default and accepts `OFFLINE_ORACLE_SEED` with
`OFFLINE_ORACLE_PATH` for replay.

Do not use a larger random run count as a substitute for structural reach.
Pinned examples force rare boundaries. Bounded enumeration proves small finite
domains. A stress job increases sampling depth. Record each form separately.

### Make the comparison prove its usefulness

Suppose the update test only asserts that the result changed. Returning `[]` passes that assertion. Keep the update—it is a useful cause—but compare against `[1, 2]`.

Now test the check against a known bad _actual_ answer:

```js
function sameOrderedIds(actual, expected) {
  return (
    actual.length === expected.length &&
    expected.every((id, index) => actual[index] === id)
  );
}

sameOrderedIds([1, 2], [1, 2]); // true: the allowed answer
sameOrderedIds([2, 1], [1, 2]); // false: correct members, wrong order
sameOrderedIds([], [1, 2]); // false: an arbitrary changed answer
```

In the test harness, assert those outcomes rather than merely calling the function. This calibrates the comparison; a production mutant that reverses results would test whether the whole fixture carries that fault to the assertion. Separately, confirm that the integration test reached the production boundary it names. Checker sensitivity and path reach are different claims: a perfect comparison on an unused code path protects nothing there.

When production fails, keep the original history and the first mismatching checkpoint. Reduce the history while requiring that same violation, then retain the small witness with the broader property. That gives us both a readable explanation and more ways to encounter the class of failure.

### When a full reference is not the best fit

The `Map` works because the answer is cheap to compute independently. Other promises support other judgments:

| Method                          | Useful judgment                                                    | Important limit                                                             |
| ------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Simple model                    | Recompute the allowed result or step a small abstract state.       | The model can omit a meaningful distinction or encode the wrong rule.       |
| Differential comparison         | Run equivalent work through another implementation or formulation. | Both paths can share a bug; their semantics must actually agree.            |
| Metamorphic relation            | Transform an execution and check a relation between the answers.   | The transformation's premises must hold.                                    |
| Partial invariant               | Check a specific promise such as no duplicate completion.          | Passing says nothing about unobserved properties.                           |
| Recorded regression or snapshot | Preserve a known execution and expected result.                    | The stored result needs justification; recording it does not make it right. |

Choose the smallest authority that answers the question. Combining complementary checks can help; making every test compute every possible observation usually does not.

## Keep only state that can matter

A reference becomes suspicious when it starts to look like production. But removing fields until it looks simple is not a sound design method either. Which distinctions can we safely discard?

Consider this **illustrative support model**. An acquisition handle supports a row. Replacing handle `a` with `b` transfers that support. Releasing a retired handle is a legal no-op. We observe support, not whether a provider physically deletes a source row.

| History                                              | Current supported rows | Live support count |
| ---------------------------------------------------- | ---------------------- | ------------------ |
| Acquire `a` supporting `x`                           | `{x}`                  | 1                  |
| Acquire `a`, then replace it with `b` supporting `x` | `{x}`                  | 1                  |

The rows and count look identical. Now release `a`. The first history loses support for `x`; the second retains it through `b`. A model containing only rows and counts cannot answer both correctly.

This gives a practical simplification test: **find two states the model treats as equal, then try a legal next action that could distinguish them.** If their promised observations diverge—or an action is legal in only one—the model erased something relevant.

The witness tells us to retain the ownership distinction here. It does not prove the revised model handles every retry, pending completion or replacement race. Nor does it require every real API to accept retired handles: if the actual contract rejects them, model that rule instead.

### Know where the expected answer comes from

There are two questions behind “the model says so.” Who established the behavior? And which state determines the observable?

An example from the archive makes the risk concrete: a finite model represented scores only up to three, turning `score > 3` into an empty predicate. The model had lost permitted values; that was not a reason to change production semantics. A separate ordering correction concerned which state owned the position: the model used locally edited values where the relevant contract used source state. The case notes retain that distinction; neither historical correction defines today's operator contract. See the [case notes](oracle-test-notes.md#historical-cases).

Before changing production to satisfy a red test, check the contract, representation and comparison. A genuinely unresolved product choice belongs with its owner. A missing value in a finite model belongs in the model. References—including newly written specifications—can be wrong.

Review the accusation and suggested fix separately. In one recorded adapter episode, returning a Promise created an acquisition lease even when it later rejected. Clearing ownership on rejection looked like cleanup but reportedly leaked that release obligation. The concern was useful; that repair did not follow from it. Other adapters may use different acquisition rules.

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

Put an explicit hold or release at the event you need to control. For example, a fixture testing visibility before application can arrange this illustrative sequence:

```text
production requests data
fixture receives the response but holds delivery of its writes
test records the visible state while that delivery is held
test releases write delivery and lets production apply it
test records the visible state at the promised applied checkpoint
```

The fixture must really hold write delivery. If it delivers the writes and only delays returning from its load function, it controls a different event. Whether the returned Promise settles before or after application is a separate contract question. Record publications during the held interval if the promise concerns what users can see then. A scheduler is helpful only within the boundaries it controls; a seed cannot schedule arbitrary external I/O. The [fast-check scheduler documentation](https://fast-check.dev/docs/advanced/race-conditions/) explains the distinction between an operation's lifecycle and delivery of its result.

### One matrix can need two schedules

The historical four-receipt settlement fixture shows why enumerating more positions is not enough. A receipt here is a completion obligation for a portion of applied work. The tested contract required success to await the relevant receipts and failure not to wait for unrelated later work.

For each selected receipt, two schedules asked different questions:

| Question                                  | Hold and release pattern                                           | Observation                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Can settlement ignore this receipt?       | Keep it pending; apply every peer.                                 | The request must still await this obligation.                                                                                       |
| Does its rejection wait for a later peer? | Apply earlier receipts; leave later ones pending; reject this one. | Observe the exact rejection while later work remains pending, and compare the intact partial rows with the expected applied prefix. |

Number the four receipts `r0` through `r3` and select `r1`. In the omission branch, apply `r0`, `r2` and `r3`, hold `r1`, and check that the request remains pending. In the rejection branch, apply only `r0`; hold `r2` and `r3`; reject `r1` with error E. Before releasing either later receipt, check rejection with E and the exact rows from the applied prefix. The fixture's application action must control applied work, not merely rename a Promise resolution.

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

This section and the next are deeper branches for incremental-query and cross-formulation tests. If you are building an ordinary collection test, continue with [testing the test](#test-the-testand-keep-the-same-failure) and return when these comparisons become useful.

An incremental engine emits changes. A reference often computes a whole result. Compare compatible objects: accumulate the changes, then compare that state with full recomputation at the promised logical point. Inspect individual batches too when the contract makes their boundaries visible.

DBSP formalizes the computational relation as `QΔ = D ◦ Q ◦ I`: accumulate input changes, run the ordinary query, then take output differences. Equivalently, accumulating the incremental output should agree with querying the accumulated input. This is a useful source of laws for db-ivm. It does not choose whether a client may see a partial publication, when readiness changes, or what cancellation means. [DBSP paper](https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf).

A final correct snapshot cannot establish that every earlier callback was coherent. The recorded graph-history case used asymmetric changes to expose an old-left/new-right publication that a later settled check would miss. Choose observation points that can distinguish the promised failure, rather than adding delays until the result is stable.

When scheduling legitimately allows several results, check for **one permitted explanation of the observed history**. Do not approve each field against a different allowed execution: those individually permitted pieces may never coexist. In specification terms, refinement means implementation-visible behaviors are permitted by the specification. A bounded test checks sampled histories; it is not a refinement proof. Nor can an accepted finite prefix prove eventual completion. [Refinement mappings](https://lamport.azurewebsites.net/pubs/abadi-existence.pdf).

### Compare formulations when a model might share the bug

Even a plain reference can copy an incorrect semantic assumption. A second formulation gives another way to disagree.

For a suitably scoped includes query, compare nested results with per-parent standalone queries or a flat join regrouped by parent. First state how empty parents, duplicates, ordering and projection match. A transformation that changes the answer is not an oracle for equivalence.

SQLancer names ternary logic partitioning, or TLP, as one such strategy: compare a query with recomposed predicate partitions. Here is a simple illustration of the partition relation, not a verified TanStack recipe: give every occurrence in an input exactly one label—true, false or unknown—according to the same predicate. Recombining all three groups, retaining every occurrence once, recovers that input. NULL behavior, aggregation and ordering need explicit treatment before turning this into a library recipe. It is not a license to split an arbitrary limited query into independently limited pieces. [SQLancer's oracle inventory](https://github.com/sqlancer/sqlancer).

Metamorphic testing is the broader idea: transform an execution and check a known relation between the answers. Incremental-versus-recompute checks and legal history transformations can serve similar roles. They need not know one answer in advance, but they still need a justified relation.

Agreement across two paths is not proof of independence. NoREC's database experiments report shared operator faults and a copied join path that concealed a bug; count comparison can also miss wrong rows with the right count. Use differing formulations for the faults they can separate, not as an automatic second vote. [NoREC paper](https://arxiv.org/pdf/2007.08292).

## Test the test—and keep the same failure

“The suite passed” compresses several claims. Was the property selected? Did it run? Did it reach the intended path? Did its comparison execute? Would that comparison reject the fault under discussion?

Treat those as separate evidence. A replay registry can contain a property nobody invokes. A multiplier can be parsed without changing the run count. A no-op assertion can leave a campaign green. Use a positive execution witness and a deliberate wrong-result control where those claims matter.

Mutation testing changes production code deliberately to challenge tests. Record what happened, not just whether a mutant was “killed”:

- A value assertion rejected the intended wrong answer.
- A timeout exposed a missing progress obligation.
- Setup failed before reaching the comparison.
- The changed code never ran.
- The mutant survived, or the change was equivalent within the tested domain.

These results call for different conclusions. If deleting one clause leaves the same obligation enforced elsewhere, survival does not show the obligation unnecessary. If the test kills a compound change, it may not distinguish each part. Research on mutation testing does not supply a conversion from a score to the probability that this library is correct; the [reading notes](oracle-test-notes.md#research-and-further-reading) preserve those limits.

### Preserve the violation, not merely a red exit

Shrinking makes failures explainable by removing irrelevant values and actions. A smaller legal history that fails during setup is not a reproduction of an original torn publication. Require the original failure predicate: the violated law, the relevant observation point, and the distinguishing evidence.

Keep the original trace beside the reduction. Record which property ran and which checkpoint replay reached. “Ran, but did not reproduce the original mismatch” and “failed before reaching the comparison” are useful outcomes; neither should be labeled successful reproduction.

Capture evidence before cleanup can change it. The historical publication fix copied the batch list before rollback; that preserved the needed local evidence, not universal deep immutability. An outer copy may still hold mutable values. A serializer may lose object identity or reorder arrays. Choose capture rules for the law and retain an original representation when normalization would erase the disputed distinction.

Cleanup also has three separate jobs: preserve the primary failure, retain secondary cleanup diagnostics, and release resources. Reporting the first error does not prove the other two happened. Avoid letting a cleanup exception replace the mismatch that started the investigation.

A useful failure report contains:

```text
Law and source; requested property and actually executed target/path
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
5. What proves the path and assertion ran? What did the mutant or fault injection actually show?
6. Can capture, cleanup or shrinking turn this into a different failure?
7. Which larger promises remain outside this test, and where are they tracked?

The payoff is not a bigger test framework. It is a smaller distance between “this test is green” and a precise account of what that green result protects.
