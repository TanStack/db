# Fracture Scan: stale-authority proposal

The source's **qualified quiet-read route survives this bounded scan**. A counter alone does not. No admitted counterexample was found to the route once finished-effect coverage, correct authority, target lifetime and epoch checks are all enforced. Several attractive simplifications break those rules; several practical promises remain conditional or unspecified.

This scan ran in the continuing orchestrator context, concurrently with a fresh hostile auditor. The hostile readout was not used to construct or classify these cases. [Candidate](./candidate.md), [frozen grammar](../grammar/model.md), [constructed probe](./fracture-probe.mjs), [receipt](./fracture-probe.json).

## Position and frozen standard

**Core claim:** immediate overlapping actions can retain optimistic overlays while the client refuses insufficiently justified snapshots, obtains a fresh read after the relevant handlers finish, then installs authority and retires covered transactions.

**Protected insight:** a local generation detects intervening local work; a new post-completion observation removes the need to infer commit order from request or response order. Waiting to acknowledge persistence is different from queuing handler execution.

**Premises:** one fixed client/auth domain; relevant effects close within handler lifetime; reads observe the completed effects from the same authority; handler knowledge is separate from persistence receipts; admitted reads have sufficient effect coverage; target lifetimes match; unchanged relevant epoch; full result validity; other owned whole-row overlays survive. Progress additionally requires eventual handler/read completion and a mutation-free read interval. These conditions remain frozen during testing.

**Scope of success:** no stale baseline replacement from reordered local responses, conditional catch-up of retained lifetimes, correct handler/error distinction and existing API shape. The source expressly does not establish atomic cross-collection visibility, coordinated overlay retirement, unknown-outcome recovery, exact newly loading-query optimism or cross-client freshness.

## Internal-extension route

### F1 — The local counter cannot itself establish observation coverage

Trace: A starts at epoch1 → ordinary R starts at epoch1 → R observes pre-A data → A commits → A's inline result installs value1 → R arrives with epoch1 and the same lifetime. Token equality permits R's old value0. Every write is finite, local and complete; no external writer or replica is needed.

**Admissibility:** this refutes the simplified statement “matching generation and lifetime prevent stale authority.” It is **not** an admitted fracture of the frozen candidate's stronger rule: R did not cover A's effects and must fail sufficient-coverage admission. The proposal's phrase “ordinary reads follow the same checks” must preserve that additional evidence, not merely copy counter comparisons.

**Exposed hidden condition in the shorthand:** an ordinary attempt must retain why its observation is causally after the relevant effects, or be prevented from qualifying until a covering observation is obtained. The counter is only one input.

**Preserved insight:** epoch invalidation remains useful when new work starts after a request. It does not make all requests started in the same epoch equivalent.

**Weakening evidence:** a verified adapter that never admits ordinary reads taken during unresolved work, or otherwise proves their coverage, removes this failure. This scan does not assert that a particular hook already supports that mechanism.

### F2 — Waiting for the existing persistence set would wait on itself

Current runtime removes `pending` entries after `isPersisted.promise` settles. Core commit awaits mutationFn; proposed reconciliation would be inside that persistence path. Substituting the existing set for “handlers still running” gives: receipt waits for reconciliation → reconciliation waits for empty pending → pending waits for receipts.

**Admissibility:** static integration hazard, **excluded** by the frozen M/O split and rule “wait on handler knowledge, not receipts.” It is not a defect in the current sequential implementation, which does not perform that wait.

**Preserved insight:** separate execution knowledge is sufficient to avoid this particular cycle, but the current combined handler/read response only exposes that knowledge when the envelope arrives.

**Weakening evidence:** separate execution-completion bookkeeping with no dependency on persistence settlement rejects the cycle. A transport exception alone must not stand in for that completion signal.

### F3 — No queued writes does not imply bounded settlement delay

For each quiet read, start one more finite mutation before the read returns. Dispatch stays immediate. Every old attempt fails its epoch check. Repeat indefinitely and no quiet read is admitted; completed mutations can retain obligations and guesses.

**Admissibility:** a real policy boundary, but **not** an internal counterexample to the frozen conditional progress claim: this construction violates its mutation-free read-interval premise. The finite 100-round probe illustrates the pattern; it does not empirically observe an infinite execution.

**Defeated stronger consequence:** “no action queue means every completed action is acknowledged promptly” does not follow. No latency bound was supplied. An unrelated unknown/slow execution can couple otherwise independent operations under conservative global impact.

**Preserved insight:** safety can survive while progress stalls. The source's finite quiet route remains available when its condition eventually holds.

**Weakening evidence:** a workload bound ensuring an adequate quiet interval, or a separately justified protocol admitting observations under continued work, would remove the progress obstacle. Neither is inferred here.

## Counterexample route: publication boundary

### F4 — Current authority can coexist with a backwards visible transition

A's whole-row guess is `A-guess`; B's later whole-row guess is `B-guess`. Both handlers finish, and a fresh read supplies `B-server`. Install that authority beneath both overlays, then retire B before A:

```text
visible: B-guess → A-guess → B-server
baseline throughout retirement: B-server
```

The short probe executes this abstract overlay order. It does not use real DB collections.

**Admissibility:** the scene satisfies install-before-retirement and preserves the still-owned A overlay. It exposes the absence of a coordinated retirement/publication rule. It **does not** falsify baseline freshness: authority never regresses. It also does not falsify a claimed atomic-observer guarantee, because the frozen source expressly leaves that guarantee unresolved. Calling this a stale server snapshot would conflate baseline and optimistic view.

**Consequence and preserved insight:** install-before-retirement is necessary for the intended final result, but does not establish every visible intermediate result. Whole-row ownership remains a real constraint; field-merging the guesses is not a source-authorized repair.

**Weakening evidence:** actual DB notification batching or a retirement protocol that prevents this observation would disqualify the example for the implemented system. A physical adapter trace is needed; the abstract scene cannot settle that question.

## Finite scheduling probe

The [receipt](./fracture-probe.json) enumerates **34,650** interleavings for three operations, each with start → commit → observe → deliver order internally. Cross-operation commit and delivery order vary independently. Server state follows model commit order; the client is checked for baseline revision regression and final mismatch.

- Full candidate interpretation: **0** failing histories.
- Arrival-wins control: **10,344** failing histories.
- Largest-invocation control: **6,708** failing histories.

This is a small, source-derived model. Quiet reads are immediate coherent model observations; no actual PostgreSQL, transport, lifecycle, unknown outcomes, adapter publication or DB overlay retirement is exercised in the enumeration. Its assertions strengthen the local scheduling reading, not the whole system claim. The separate ordinary-read and overlay examples test selected omitted boundaries, not independent range.

## Required rejection controls

**Outside-standard rebuttal:** “A framework should guarantee no extra request and constant-time acknowledgement under any traffic.” Rejected as an immanent fracture: the candidate expressly permits an extra read and does not supply a latency bound. It remains a possible product preference, not evidence against the stated safety claim.

**Vivid near-counterexample:** another client writes between the first client's two read observations, making their results disagree. Rejected as a fracture within B1/B2: the candidate discloses that external-writer visibility and common snapshot behavior need a separate contract. This may matter to the eventual product but cannot be smuggled into a proof of internal inconsistency.

The continuous-traffic example is a second near miss: it violates conditional progress while leaving the local safety conditions intact. An unknown handler that later commits after a timeout is likewise not a refutation of a protocol that refuses to treat the timeout as completed-effect evidence.

## Bounded result

There is **no demonstrated internal stale-baseline fracture in the fully qualified candidate** within this scan's finite model. There are consequential under-specified interfaces and rejected simplifications: coverage of ordinary reads, distinct handler knowledge, progress under continued work, and observable overlay retirement. Each needs a concrete mechanism before the candidate can claim an implementation.

The instrument can manufacture certainty by making a hand trace vivid or making a mathematical model's “covering read” look like a deployed server guarantee. This readout therefore keeps constructed executions, static dependency facts and untested integration conditions separate. It does not choose a revised architecture or authorize implementation.
