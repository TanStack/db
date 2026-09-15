# RFC: TanStack DB Endpoints

**Status:** Draft for feedback  
**Working name:** TanStack DB Endpoints  
**Audience:** TanStack maintainers and contributors, plus developers working on full-stack TypeScript and client data systems

## Writing the code is no longer the hard part

As coding agents make implementation cheaper, writing the code becomes a smaller part of developing software. But these questions remain. We still need to decide what the system should do, which changes are possible, and how to make those changes safely while meeting its goals and constraints. We also need to verify that they work as intended in production.

Coding agents are especially effective when a task has a tight feedback loop within the codebase: inspect the code, make a change, run the tests, and try again. The task is playable: the available moves and checks are close at hand. Much of software engineering lacks that setup. Deciding what to optimize, checking behavior under production traffic, or judging a rollout requires information and feedback spread across other systems and people.

Data access brings this problem into focus. A query can be valid TypeScript and valid SQL yet return the wrong data for the view, become expensive as usage grows, or interact badly with a mutation. These questions connect application code to database behavior, product requirements, and real workloads.

In the coding-agent era, frameworks can do more than manage a critical slice of an application: they can help agents develop it. This RFC proposes **TanStack DB Endpoints**, an optional compiler-assisted layer connecting server queries and mutations to TanStack DB collections and actions. Starting from code that looks like an ordinary server route, Endpoints will generate the client and server outputs DB needs and check the relations it can establish.

Beyond that wiring, Endpoints will help agents work across the software development lifecycle: clarify requirements, choose implementations, write tests, evaluate deployments, and improve production behavior, with specific tasks and evidence to guide that work.

Anthropic's [AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook) develops a related argument about shifting work and controls around faster code generation.

The goal is to bring the codebase's tight feedback loop to the rest of the software development lifecycle. Making that work **playable** means helping agents discover worthwhile changes, try them within project constraints, evaluate the results, and improve the tools and information available for the next task. Static analysis supplies an initial set of facts; agents can gather missing evidence, add tests, and help developers state requirements. Later sessions should inherit both that knowledge and a clear account of what is still unknown. Connecting this information should let the framework check and enforce more without requiring heavy syntax or rewriting large parts of the JavaScript ecosystem.

## One small Todo route

Start with the server functions the app needs to read and write Todos. Those same declarations will supply the client source collection and mutation call, without a second client implementation to keep in sync. Here is the relevant code from a one-component TanStack Start app, with imports, route registration, and UI omitted:

```tsx
// Endpoint server query function
const listTodos = query({
  input: z.object({}),
  async handler(req, res) {
    const user = await requireUser(req);
    const todos = await db
      .select({
        id: todo.id,
        text: todo.text,
        completed: todo.completed,
        createdAt: todo.createdAt,
      })
      .from(todo)
      .where(eq(todo.userId, user.id))
      .orderBy(asc(todo.createdAt), asc(todo.id));
    return res.json(todos);
  },
});

// Endpoint server mutation function
const addTodo = mutation({
  input: z.object({
    id: z.string().uuid(),
    text: z.string().trim().min(1).max(200),
  }),
  onMutate({ dbClient, input }) {
    dbClient.collection(listTodos).insert({
      id: input.id,
      text: input.text,
      completed: false,
      createdAt: new Date(),
    });
  },
  async handler(req, res) {
    const user = await requireUser(req);
    const { id, text } = req.body;
    const [created] = await db
      .insert(todo)
      .values({
        id,
        userId: user.id,
        text,
        completed: false,
      })
      .returning({
        id: todo.id,
        text: todo.text,
        completed: todo.completed,
        createdAt: todo.createdAt,
      });
    return res.json(created);
  },
});

// Inside the component
const dbClient = useDbClient();
const todosCollection = dbClient.collection(listTodos);
const { data: todos } = useLiveQuery(todosCollection);

// In the form's submit handler
await addTodo({ id: crypto.randomUUID(), text });
```

Here, a **query** reads server-authoritative data. A **mutation** may change it. Together they are the app's **endpoints**: named network calls whose server code also defines how client data enters TanStack DB. The mutation's input schema validates and types `req.body`.

## The code we didn't write

We wrote the input validation, auth, database operations, optimistic update, and UI—not the glue between them. The build supplies the source collection and action: URLs, fetch functions, types, query keys, cancellation, row keys, protocol handling, and the default `mutationFn`. None needed a second client implementation.

At first glance this looks like a simple typed server-function wrapper. The differences appear in the questions an agent can work through: first from the code and schema, then from measurements and developer choices.

## The collection contract hidden in the query

What makes that generated collection valid? In `listTodos`, the Drizzle selection supplies public fields and nullability, the database schema can confirm `id` as a stable key, and the predicate scopes the complete result to the authenticated user. The `orderBy` clause defines a total order: `createdAt`, then `id` as the stable tie-breaker. These facts also constrain how later loads and writes update the collection.

A coding agent's first draft might sort only by `createdAt`. That seems harmless until two rows share a timestamp or the query gains cursor pagination. Endpoint should report the broken relation in those terms:

```text
ENDPOINT_ORDER_NOT_TOTAL listTodos

`createdAt ASC` can contain ties. Pagination and ordered updates
need a stable total order.

Found candidate: todo.id is a non-null primary key.
Suggested fix: orderBy(asc(todo.createdAt), asc(todo.id))
```

The agent can apply that small fix and rerun the check. The diagnostic names the database fact, the failed rule, and the supported change.

Helpers, raw SQL, dynamic control flow, stored procedures, triggers, or external systems may hide part of the relation. Endpoint reports what it could not check and continues with the checks it can run. A developer or agent can inspect that logic and manually certify the rule, recording the reasoning and supporting evidence.

## Measuring the loading decision

The Todo app can start by loading every Todo for the current user and refetching after writes. As the data grows, an agent needs to evaluate whether that remains practical or whether the collection should load subsets on demand.

In a new project, the code and schema may be nearly all the agent has to go on. There is no production history yet, and the developer may not have set response-size or latency limits. Early suggestions should help fill those gaps: agree on the relevant limits, add a representative test, and arrange to measure key queries once traffic arrives. Building that evidence is useful work even when the best choice is to leave the implementation alone.

Types cannot settle the loading choice. The compiler can see the predicate, order, result shape, and candidate index. It cannot know the current distribution of Todos per user, the serialized response size, or the latency under real data.

With database access, an agent can measure the query over representative user IDs. It can inspect query plans and record row counts, response bytes, and latency. It can then compare those measurements with a project limit, such as a maximum expected response size. The check may support either choice:

- keep eager loading because the complete per-user set is small and cheap; or
- use on-demand loading because the measured distribution crosses the limit.

This is the gap between code analysis and a useful answer. Endpoint gives the agent a precise question, the code it concerns, a way to measure it, and the project setting that will decide it. The agent gathers the missing data; the developer or existing project policy supplies the acceptable limit.

Endpoint records the measured population, date, and conditions that trigger a recheck as data and workload change.

## A conservative mutation

A successful server write does not by itself tell the browser how to update its collections. After `addTodo` succeeds, inserting the returned row into `listTodos` is tempting—but it is not always safe. The goal is to bring affected collections back in sync without guessing how the query result changed.

Here we focus on Query Collections. Other supported collection types will follow their own mutation and confirmation strategies, such as waiting for a sync stream to deliver the server write rather than refetching.

The visible query may contain filters, selected fields, ordering, joins, aggregates, or a pagination window. Database triggers may alter the row. One mutation may affect several collections. Whether a patch is correct can also depend on runtime state: a new row might belong outside the current page even when its fields are known.

Endpoint therefore separates three jobs:

1. The compiler generates the mutation transport; the authored server handler performs the authoritative database write.
2. The developer or agent may author an optimistic TanStack DB transaction when the intended experience is known.
3. After the server confirms the mutation succeeded, the runtime patches only when the mutation–query relation and current collection state make the patch safe. Otherwise it refetches the affected collection.

The Todo appears immediately through the authored `onMutate` callback. The generated action keeps that optimistic transaction active while the server writes the row and `todosCollection.utils.refetch()` loads the confirmed data. Both use the client-generated row ID. If the write fails, TanStack DB rolls back the optimistic insert.

A safe patch can be much smaller. Suppose another mutation marks an existing Todo complete and the server confirms `{ id, completed: true }`. For our complete per-user collection, changing only `completed` changes neither membership nor the `createdAt, id` order. If there are no other relevant effects and the response has not been superseded, the generated code can apply `todosCollection.utils.writeUpdate({ id, completed: true })`. This updates confirmed state. A query that selects only incomplete Todos would need different handling: that same change removes the row from its result.

The compiler may later rewrite or augment a supported query so the protocol returns data needed for a safe patch. Such a rewrite must preserve auth, the public response contract, query meaning, and cost limits. When patch safety cannot be established, the authored query remains unchanged.

These are existing [Query Collection mechanisms](https://tanstack.com/db/latest/docs/collections/query-collection). Its `onInsert`, `onUpdate`, and `onDelete` handlers refetch their collection after success unless they return `{ refetch: false }`. Direct writes update confirmed collection data and the Query cache. A [custom action](https://tanstack.com/db/latest/docs/guides/mutations#intent-based-mutations-with-custom-actions) instead puts the sync step in its `mutationFn`; the documented example calls `collection.utils.refetch()` after the server write.

Endpoint should generate that wiring using DB's existing mechanisms. Selecting all target collections for a cross-collection server mutation remains part of the design to test.

## A stale token during the write

Now suppose several requests use the same client auth provider and its token expires. We want them to recover automatically without a refresh storm or repeated writes. That requires coordinating refresh and establishing when replay is safe. Endpoint should integrate with the existing provider rather than become an auth framework.

Auth may run inside the endpoint handler. Automatic replay requires one strict path:

```ts
import { protocol } from "@tanstack/db-endpoints";

async function handler(req, res) {
  const auth = await readUser(req);

  if (auth.kind === "stale") {
    return res.status(401).json({
      code: protocol.AUTH_STALE_NO_EFFECTS_RETRYABLE,
    });
  }

  // Database writes and other effects may begin here.
  // ...
}
```

The result name states three facts: credentials were stale, this invocation produced no side effects, and the client may replay it under the protocol's retry limit. A generic `401`, `403`, or `AUTH_STALE` does not state enough.

The framework rule is also strict: the handler must return this result before any effect. The compiler checks that order when it can analyze the code. If opaque code prevents the check, a developer or agent can use the manual-certification path described above. Without that support, project config decides whether to warn, fail the build, or disable automatic replay for that endpoint.

The client then follows a generated sequence:

1. Requests using the same auth provider share one in-flight refresh instead of starting a refresh storm.
2. The original mutation is replayed once with fresh credentials and the same mutation ID.
3. The normal server-response and collection-sync path resumes.

The HTTP response may use `401` and a stable Problem Details type. The framework result carries the stronger replay meaning. The application still owns auth policy, token acquisition, logout, role changes, and any hard browser reload or adapter-specific storage reset those events require.

The stable mutation ID protects a different failure: the database commits, but the response is lost. Safe deduplication requires the ID and mutation result to be recorded atomically with the effect. A retry with that ID can then return the recorded result instead of repeating the effect. The durable store, transaction boundary, retention, and cross-system behavior remain open design work.

## Testing endpoint changes

The app is now running in production. Rather than wait for a performance problem, we ask an agent to find worthwhile query optimizations. It uses traffic and latency measurements to identify where improvements would matter, checks the relevant policies and constraints, and investigates possible changes. The earlier work gives it a starting point: known requirements, existing tests, and measurements it can compare against.

A promising change might involve a new SQL shape, index, pagination plan, or loading strategy. Static analysis can reject some bad variants, but it cannot establish how the rest will behave under real traffic. If the available measurements cannot distinguish an improvement from a regression, the next useful action may be to improve those measurements first.

The agent need not stop at the tools already available. It could add custom observability to distinguish database time from response serialization, write a helper that compares two query results, or build a representative workload for repeated tests. The useful output may be a better way to investigate the system before it is a better query.

Later sessions should inherit those tools alongside the findings. An agent should not have to reconstruct the same measurement or comparison from scratch each time it encounters a similar question.

If the project already exposes suitable external tools, the agent can propose a bounded experiment. With developer approval and project policy, it could:

- run old and new read paths against sampled inputs;
- deploy the new implementation under a variant identity while preserving the public endpoint contract;
- shadow the read variant or route a small cohort to it;
- compare normalized results, ordering, errors, latency, response size, database load, and cost;
- set minimum time and sample thresholds;
- define guardrails and rollback conditions; and
- leave a dated TODO for a future agent to inspect the result.

At that date, an agent can read the measurements and take one authorized branch: promote the variant, roll it back, repair it and start a new test, or leave the issue open because the sample was weak.

These integrations are optional and provider-neutral. A feature-flag service, database branch, deployment system, observability platform, rollback control, or scheduler adds a way to act or measure.

## When the page is slow, not the query

As the app grows, the question is often “why is this page slow?” rather than “can we make this query faster?” The developer might care that the page's five parallel queries all finish within 300 milliseconds, not that each query finishes within 50. Endpoints should help an agent investigate and maintain that combined result.

Production evidence is often most useful at this level. Queries that look cheap in isolation can compete for database connections, CPU, I/O, and cache when they run together. Their timings also depend on the rest of the application's traffic. Measuring each query separately does not establish how the group behaves under that shared workload. Individual timings remain useful for diagnosis, but the product's performance budget belongs to the combined operation.

The application should be able to name a **composite**—a page's data load, an onboarding journey, or a dashboard—and attach its own requirements, checks, and evidence history. Those records will link to the contributing endpoints, collections, and relevant external systems. Its checks evaluate the combined behavior.

Suppose a production trace shows the page's queries spending time waiting for database connections. The agent could investigate redundant loads or request scheduling, test a candidate change, and compare the combined completion time under representative traffic. The useful change might involve how queries run together rather than their SQL. The resulting evidence would connect the page's budget, the observed workload, the tested change, and its outcome. Later sessions would inherit why the change helped and the conditions under which that result still applies.

This also changes what needs rechecking. Two pages can use different endpoints while sharing a database pool; a change that increases load on one can affect the other. The record should track shared resources as well as called endpoints, along with operating conditions and gaps the agent still needs to investigate.

The same approach applies beyond latency. Fixing a readiness bug may help onboarding without bringing completion up to the product's target. A dashboard may refresh promptly while displaying an incomplete aggregate. Composite checks evaluate those product outcomes using established relations or measurements at the product boundary.

An investigation can also leave behind a better measurement, a missing-data issue, or a supported diagnosis for an external system's owner. Endpoints will connect that work to the original goal through the project's analytics, ingestion, and deployment tools. The aim is to let an agent start from the behavior an engineer cares about, find the relevant data operations, and judge its work against that same goal.

## The model behind the example

The work an agent does to investigate an endpoint should give later sessions more to go on. They need to know what was established, what supported it, and what still needs checking—not just inherit the resulting code. Endpoints will include an **evidence engine** to keep that knowledge available to its checks and agent workflow.

Explicit rules connect each claim to its supporting information, the conditions where that support applies, and the consequences under project config.

Endpoint analysis supplies facts about routes and collections, while tests, external tools, and developer settings supply other inputs. The engine should accept new check methods and sources, provided each method establishes what its results support.

Database probes, test runs, production measurements, deployment actions, and scheduled reviews retain their own results outside the build.

### Rules, checks, and results

An agent needs to distinguish a requirement from the check that evaluates it and the result that check produced. Otherwise it cannot tell whether the next step is to fix the code, gather missing evidence, or ask for a product decision. Endpoint's public model should make those distinctions in familiar linter and test-runner terms:

- A **rule** states something an endpoint or composite should satisfy: `id` uniquely identifies returned rows, pagination has a total order, or automatic replay cannot repeat an effect.
- A **check** evaluates one rule using the inputs available to it.
- A **result** says `passed`, `failed`, `not checked`, `out of date`, `check error`, or `disabled`.
- Project config gives each rule a severity: `off`, `warning`, or `error`.
- An unresolved result becomes an **issue** with an explanation and, when available, a fix, suggestion, or TODO.

The input should use its ordinary name: source code, type, runtime schema, database constraint, query plan, generated test, database sample, production metric, or developer setting. Each stored result also records its scope, date, and the changes that require it to run again.

Results form a dependency graph. A response-size measurement can become out of date while an unchanged row-key check remains valid.

Some questions need a developer choice rather than more analysis. The compiler cannot decide how much response data is acceptable for this product. The developer or project config must supply the limit. Once the limit exists, tests and production measurements can evaluate the endpoint against it.

Internally, the tooling can retain a more exact model for agents. It can record the precise condition being tested, how each input supports it, where that support applies, how confident the method is, and what change made a result out of date. It can derive the current check result under project config. An agent can request this structured detail when it needs to explain or extend a check.

### Open issues become agent work

When a check cannot run, Endpoint records an issue instead of emitting a vague warning. The issue identifies the endpoint or composite, stable rule ID, missing input, reason, available next action, severity, rerun command, and any due or recheck date. It may tell an agent to add a runtime schema, measure a query against a representative database, inspect production traces, or ask the developer for a product limit.

Detailed check history can live in a project-level JSONL file keyed by stable endpoint or composite IDs and rule IDs rather than filling the route with prose. Tooling should mediate writes, keep raw production data out of source control, and retain enough source information to reproduce the result.

When a requirement comes from an external system, the record links to its authoritative source and revision, so changes there can trigger reevaluation.

A result can link to the function, script, or observability query used to produce it, including its version and limits, so another agent can inspect, reuse, or improve the method.

Check methods need tests too. An agent-written query comparator should pass known matching and mismatching examples, including differences in ordering or missing rows.

This record lets agents collaborate across time. One agent leaves a precise issue in the codebase; a later agent sees it, gathers the missing input, reruns the check, and records the new result. The record retains the method behind each result, including the reasoning and evidence for manual certifications.

Suppose a later change adds a field to `listTodos`' response. The old response-size measurement describes the old output, so that check becomes **out of date**, not automatically **failed**. Endpoint can give the next agent a specific task: measure the changed query and compare it with the existing limit. That agent records the new result and, if necessary, investigates a different loading strategy. A row-key check whose inputs have not changed can remain valid.

The environment becomes more useful as those gaps are filled. A later session can see not only the current code, but which requirements apply, what has been tested or measured, and which results need to be checked again. A project may run checks on demand, in CI, after a relevant change, or on a schedule for high-stakes endpoints.

### Where human review matters

As controls and evidence mature, organizations could use them to decide which changes need human review. A routine optimization might proceed without individual review when it stays within approved requirements and satisfies the required checks. Missing evidence or a change outside those boundaries would bring a person back into the decision.

Agents could also propose changes to the controls themselves: a different performance budget, a justified exception, or a better way to test a requirement. That includes changing a comparison script or test workload when it determines whether a change is accepted. Those proposals will include their reasoning and evidence and require human review.

This shifts scarce human attention toward goals, tradeoffs, and exceptions rather than requiring equal scrutiny of every implementation change. The evidence system will inform that delegation; the organization’s review and deployment policies will authorize it.

## Supported variation

An app should be able to start with a simple loading strategy and adopt a supported alternative when its needs change.

For ordinary Query Collections, request and refetch is the default. Supported loading and update strategies may add on-demand sync, pagination, polling, invalidation events, safe patches, or maintained streams. Endpoint runs only the checks each strategy and adapter can support.

A **collection adapter** connects an endpoint to one TanStack DB collection type. Query Collections fit the endpoint-owned request/refetch model. An Electric adapter may let the endpoint authenticate or proxy a shape while Electric owns stream state and confirmation. First-class support should depend on declared lifecycle capabilities.

A **host adapter** registers the portable Fetch handler in TanStack Start or another JavaScript server. Optional integrations connect database, deployment, flag, traffic-control, observability, rollback, or scheduling tools.

REST is the initial transport scope. GraphQL and a new query language are out of scope. Adding live infrastructure is also a product choice. If a project already has a supported event channel, an agent may enable live updates. Otherwise it should present polling, invalidation events, maintained streams, and their costs rather than silently provision a service.

## Adoption without a rewrite

An existing app should be able to gain useful checks before all its code can be analyzed. A greenfield project can set every selected rule to error from its first endpoint; an existing app can build toward stricter checks incrementally.

Developers should be able to wrap current routes and compile them with missing information. Endpoint then reports what it inferred, what was authored, where those sources conflict, and which checks could not run. Opaque effects stay legal. Custom transport may replace the generated fetch function. A whole-path escape hatch may do anything the app needs while marking checks that depend on the hidden path as not checked.

This resembles a JavaScript-to-TypeScript migration. Almost every stronger rule is optional at first, but the tool never hides what is missing. Teams can raise severity globally, for all queries or mutations, or for one endpoint. Agents can apply many fixes as ordinary code changes and attach the test or measurement that supports the new result.

## Proposal, simulation, and open work

The next step is to test how much of this support we can deliver around ordinary server code. The simulated Todo exercises only part of the proposal; the prototype still needs to test the compiler and runtime design.

This RFC proposes:

- explicit `query(...)` and `mutation(...)` declarations around ordinary server code;
- generated server and browser outputs with stable endpoint identity;
- generated TanStack DB source collections and actions;
- a portable Fetch handler plus host adapters;
- familiar rules, checks, results, issues, fixes, and TODOs backed by a formal evidence engine connecting code analysis, external evidence, and developer settings;
- supported collection lifecycles and loading or update strategies; and
- incremental adoption with exact diagnostics when a check cannot run.

An initial one-component Todo fixture simulated the TypeScript surface and a small in-memory protocol. Its checks covered typed query and mutation handles, user-scoped loading, runtime input rejection, non-optimistic server-authoritative mutation, one post-success refetch, stable cross-target identity, and absence of server handlers from client-facing objects.

Prototype work includes the compiler, TanStack Start integration, browser-bundle erasure, Drizzle and PostgreSQL analysis, request-scoped `DbClient` behavior, SSR, stable identity across source movement, deployed version skew, auth refresh, distributed mutation deduplication, safe patch generation, and production experiments.

The first prototype should answer a smaller set of questions:

1. How much reliable contract and query-plan information can we recover from an ordinary inline Drizzle handler?
2. What source grammar lets one declaration generate safe client and server outputs while keeping the code natural?
3. How should the callable mutation bind to the active `DbClient` so it can refresh or patch affected collections while retaining portable server behavior?
4. How should collection identity partition authenticated scopes without putting credentials in cache keys?
5. Can diagnostics teach a fresh coding agent to repair the Todo route without hidden framework knowledge?
6. What is the smallest useful check-result and issue schema before production integrations exist?

The central test is whether an agent can work through the Todo's questions using the code, checks, and available evidence—while the developer writes the server code they care about. When the answer cannot be established, the system should make the missing information or decision clear.

That is the intended meaning of making data systems playable: more of the work becomes inspectable and testable without forcing the application into a new language. The evidence engine will connect knowledge that is otherwise scattered, so stronger checks can depend on more than what the compiler sees alone.
