# Loss audit: layered representation grammar → executable draft

The draft preserves the grammar's central separation between guessed effects and authoritative read selection. Most missing behavior is expressly deferred. This pass found no established hidden runtime violation within the stated, loaded, sequential, full-row Todo slice. It did find two proof gaps that the green oracle campaigns do not cover: independent server effect selection and malformed authoritative response coverage. These are missing tests of retained rules, not evidence that the current code breaks those rules.

## Method and boundary

One isolated source pass of `loss-audit`, using `/Users/kylemathews/programs/hegelian-dialectic-skill/reference/instruments/loss-audit.md`. SOURCE is the five grammar layers only: `model.md`, `preservation.md`, `evidence.md`, `process.md`, and `brief.md`. REDUCTION is `implementation-draft.md`, the probe runtime, coherence model, server refresh helper, compiler, and generated oracle. Earlier ground-condition/result-sharing sources and sibling audit outputs were not read. The references named by the grammar were treated as its attributed support, not independently verified evidence.

All 14 inspected source/reduction files listed in `audit/source-freeze.json` matched their SHA-256 hashes. Supplementary inspection: `tests/refresh.test.mjs` and `tests/oracles/README.md`, neither frozen in that manifest. No core live-query implementation was read. No production files were changed. This was a static trace, not a fresh test campaign; counterfactual oracle sensitivity below is inferred from the generator and assertions.

Path shorthand: **M/P/E/Pr/B** = `grammar/model.md`, `preservation.md`, `evidence.md`, `process.md`, `brief.md`; **D** = `implementation-draft.md`; **R/C/S/X** = `integrated-todo/src/runtime.ts`, `coherence.ts`, `refresh.server.ts`, and `integrated-todo/bound-transform.mjs`; **G/O/V/H** = `tests/oracles/program.mjs`, `e2e.mjs`, `reference.mjs`, `driver.mjs`; **ST** = `tests/refresh.test.mjs`. Line references below are to the frozen files except the two supplementary files just identified. Repository root for all paths is `probes/endpoints/`.

Statuses: **preserved** means traceable within the bounded slice; **deferred** means absent behavior with a stated boundary; **proof gap** means a retained rule lacks the relevant executable dimension/assertion; **analytical** means the source itself did not claim implementation evidence. These statuses do not rank usefulness or recommend restoration.

## Recovered and dropped traces

### LG1 — Unknown query analysis still needs executable authoritative fallback

- Original support: P5 (P:9), R3–R5 (M:19–21), RC3 (E:7), B's support-boundary example (B:9). Unavailable local support should disable the dependent derivation while permitting a full server result. This is broader than conservative refresh of already recognized queries.
- Exact reduction: D:51 explicitly says unsupported query shapes get compiler diagnostics and general unanalysable-query execution with inline fallback is future work. X:244–285 requires the checked extractor, full Todo rows, total order, and empty arguments. The compiler aborts before a query can join the retained registry; `S` never receives such a read.
- Mechanism: disclosed compiler admission narrowing. An unsupported local derivation is currently an unsupported endpoint declaration, rather than a query with an explicit local-analysis gap and server execution.
- Coverage consequence: G:18–27 and O:26–63 generate only accepted query forms. RC3's server-fallback half has no generated witness. This is a disclosed range loss, not a hidden passing claim about top-k or joins.

### LG2 — Collection/response generations and lifecycle catch-up are absent

- Original support: C/A units (M:10–11), R1/R6/R7 (M:17,22–23), U1 (M:40), P10 (P:14), Pr's rejection of merging C/A (Pr:11).
- Exact reduction: C becomes a collection map plus a confirmed-row map (R:110–117); A becomes `{kind, snapshots:[{id,rows}]}` (R:101–103). No generation travels in either request or response (R:270–276, S:23,33). R:140–144 rejects new endpoint creation while work is pending. R:296–303 rejects not-ready retained queries. Cleanup status is checked on the captured target before installation (R:289–292), while installation looks up the map entry by ID (R:232–244).
- Mechanism: disclosed precondition replacing generation-aware catch-up. D:54 explicitly requires a stable loaded set and defers restart/GC/initial-read races. The generation rule has not been discharged merely because IDs and cleanup checks exist.
- Coverage consequence: G:88 preloads all collections and performs configured cleanup before mutation; H:404–414 waits for that setup; G/O have no mid-operation create/restart/cleanup transition. GC-before-work is covered; U1 is not.

### LG3 — Matching-transaction retirement does not yet have sibling-overlay/publication evidence

- Original support: L5/R6 (M:13,22), NC6 (E:14), P10 (P:14), U2/D1/D2 (M:41,45–46). A response must not erase another transaction's guess. Source hashes are not database revisions; one response does not prove common snapshot or atomic publication.
- Exact reduction: R:305–333 creates and settles an ordinary transaction; R:232–244 writes confirmed baselines before `persist` resolves. But S:19–31 evaluates reads with `Promise.all`, and R:289–292 installs snapshots in a loop. Neither supplies a common PG revision or multi-collection publication barrier. D:55 expressly declines concurrent-response, linearizability, snapshot, and atomic-publication claims.
- Mechanism: disclosed concurrency and observation-contract deferral. The source's coupled obligation survives as a limit rather than an implemented contract.
- Coverage consequence: H:427–607 completes each action before starting another. O:93 declares sequential operations; its model has one visible and one confirmed world, not separately owned pending transaction histories (V:24–30,32–64). The early-settlement mutant discussed at D:32 tests premature retirement of one transaction, not NC6's surviving sibling overlay. The README also discloses lack of every-publication observation (lines 153–154).

### LG4 — Nonempty, coherent single-row authored guesses narrow the normal action space

- Original support: P1/P3/P4 (P:5,7–8), R2/R10 (M:18,26) preserve ordinary writable collections and transaction semantics. The grammar does not state a nonempty-action precondition; E includes before/after effects and coverage, not a claim that every server action creates a local mutation.
- Exact reduction: R:322–325 rolls back and throws if propagation leaves no optimistic target mutation. R:203–217 gives authored recipient keys precedence over fanout; no conflict contract is introduced. D:53 explicitly discloses empty writes, inserts excluded from all retained queries, and conflicting same-row guesses.
- Mechanism: disclosed action-contract deferral, reinforced by generator exclusion. V:97–107 chooses an existing retained target and sets inserted membership to that target's filter; if the requested non-insert has no row, it substitutes an insert. G:33–47 emits one direct collection write per action. Thus it cannot exercise an empty bulk action or multiple conflicting authored effects.
- Coverage consequence: the reduced generator deliberately avoids an unsupported action, and D:62 identifies that change. This is not a hidden false-green claim for the excluded cases. Coherent multi-effect actions also are not generated, even though the implementation loops over captured effects.

### LG5 — App-wide dispatch, multi-table dependencies, and complete actual effects remain absent

- Original support: Q/E (M:7–8), R4 (M:20), P6/P8 (P:10,12), U3/U4 (M:42–43), and the L3/L4 distinction (M:13).
- Exact reduction: C:9–16 has one relation string per query and complete/unknown relation coverage. X:377 hardcodes `todo`. X:356–365 builds a dispatch table from query declarations in the current authored module. R:264–268 always supplies unknown coverage. No actual-effects observer or app-wide registry exists.
- Mechanism: disclosed bounded representation and conservative fallback. D:51–52,56 name the missing module registry, multi-table compiler, and effects observer. The broader E unit is represented by transaction guesses plus an unknown actual-effects annotation, not an observed effect log.
- Coverage consequence: the full-stack oracle has one Todo table and one generated module (G:18–73,103–110). ST:19–49 establishes that the helper refreshes two registered IDs even when the mutation returns zero affected rows; it does not establish app-wide discovery or the client's request-selection boundary.

### LG6 — Safe shortcut admission and alternate ownership are not implemented alternatives

- Original support: F1/F2 and patch/encoding distinction (M:32–36), R9/P9 (M:25; P:13), B:7,11; E5 (E:3) states correct encoding may cost more.
- Exact reduction: D:15 explicitly chooses F1 under separate implementation authorization. D:47 says no patches, shared SQL, or result deduplication are implemented. R:194–231 performs bounded local fanout; R:264–276 and S:19–33 fetch and deliver full results. D:38–47 compares inline full results with client refetch for one fixed workload.
- Mechanism: explicit authorized ownership selection plus optimization deferral. F2's inverse writes, shared support ownership and retention obligations are absent because F2 was not selected; this is not a grammar-derived ranking. Per-shortcut safety/benefit admission is a future obligation, not proved by the inline/full-result measurement. The draft does not claim a general cost win for local derivation.
- Coverage consequence: current comparison has no alternative patch/share/skip implementation whose independent evidence can be assessed. P12's ban on broad speed/range conclusions is preserved by D:47 and the enumerated limits.

### LG7 — Full-stack tests do not separate guessed recipients from independently changed server recipients

- Original support: M:13 rejects borrowing L3's proof for L4; R4/P3/P8 (M:20; P:7,12); NC2 (E:10); Pr:11 explicitly rejects merging local and observed-effect selection.
- Current implementation: R:262–268 correctly makes actual effects unknown and selects every retained request. S:17–33 refreshes those requests after the write. No code violation established.
- Exact loss of proof: G:33–43 couples each optimistic CRUD operation to the same server row ID, table, and membership change. Its sole differing-server-behavior option trims text. V:34–37 models precisely that difference. O:64–72 has no separate actual-effect generator. Thus an unchanged local result can never become changed only because the server took a different membership/key branch.
- Mechanism: generator dimension omission. ST:19–49 checks the helper's supplied-read set, but the helper cannot recover a read omitted by the client. Full-stack checkpoints compare results, not the complete request-ID set (H:301–309,581–584).
- False-green boundary: a hypothetical client selector based on guessed mutation recipients could omit a retained query that the generated server also leaves unchanged and still satisfy row checkpoints. No such mutant was run here. The missing law is: with unknown actual coverage, request selection remains all retained reads even when local propagation predicts no change; an independent server branch can change a different supported result. This gap is not among D:51–56's declared unsupported features: it can arise within one-table, full-row queries and opaque handlers already admitted by this draft.

### LG8 — Client authoritative-coverage rejection has no malformed-response oracle dimension

- Original support: A/R7 (M:11,23), P10 (P:14), Pr:13. Identity and described result coverage must be validated before authority is accepted.
- Current implementation: R:281–287 rejects wrong response kind, missing/extra snapshot count, duplicate IDs, and omitted requested IDs. R:235–237 rejects duplicate row keys. S:10–15 validates client requests before writing. These checks are visible and no failure was established.
- Exact loss of proof: S always constructs a complete, unique response from validated request IDs. G's gates fail whole reads or release them; they never alter response IDs/coverage or duplicate result keys (G:138–149). H tests successful full results and read/write failures. ST:5–17 tests malformed requests at the server boundary, not malformed authoritative responses at client installation.
- Mechanism: adapter-boundary input omission. The current positive oracle could remain green if the client coverage checks were removed, because its transport only supplies well-formed snapshots. This is static sensitivity analysis, not a reported mutant run.
- Missing test law: incomplete, duplicate or wrong-identity authoritative result sets must not be accepted as a successful confirmation; absence outside the named complete result must not become deletion. Generation-race validation remains separately and explicitly deferred under LG2.

## Full source coverage ledger

### Units and relations

| Source item | Reduction and executable trace | Status / loss trace |
| --- | --- | --- |
| Q: trusted identity, scope, input, semantics, dependencies, gaps (M:7) | X:181–285,326–342,375–377; C:9–13; R:66–72,151–157,337–346. Empty inputs and one relation encode the admitted domain. | Preserved bounded identity/semantics; arguments, dependencies and unknown-query gap representation deferred (LG1/LG5). |
| E: relation/key, before/after, provenance, coverage (M:8) | Existing transaction mutations are frozen for fanout (R:194–218); actual coverage is a separate unknown value (R:262–268; C:14–21). | Preserved distinction; complete observer and multi-table structure deferred (LG5). No need to invent a separate E class. |
| T: guessed snapshots and settlement identity (M:9) | R:305–333 uses core transaction; persistence closes over the transaction at R:307–308. H:442–443,475–478 checks synchronous object and held settlement. | Preserved sequentially; sibling ownership not covered (LG3). |
| C: retained instance, confirmed baseline, generation (M:10) | R:110–117,126–149,188–192,232–244. | Instance/baseline preserved; generation deferred (LG2). |
| A: full results or validated patches tied to request and generation (M:11) | R:101–103,270–293; S:19–33. | Full results/request IDs preserved; patches/generation deferred; coverage test gap (LG2/LG6/LG8). |
| L1: scoped Q instantiates C (M:13) | R:66–67,151–157,337–346; compiler-generated key X:326–335. | Preserved within empty-input scoped runtime; lifecycle boundary LG2. |
| L2: T owns guessed E (M:13) | R:313–315 captures authored edits and fanout in the same `mutate` call. | Preserved; G:33–47 only generates one authored write. |
| L3: supported (Q,E,C) edits T (M:13) | R:194–230; C:24–35. Full rows and predicates are compiler admissions. | Preserved admitted membership; unsupported-query fallback deferred (LG1), action boundary LG4. |
| L4: actual E×Q selects possible reads (M:13) | R:262–275 chooses unknown; C:18–21 returns true for unknown; S:19–31 executes. | Preserved conservatively; complete selection deferred (LG5); independent evidence gap LG7. |
| L5: install A before matching T retirement (M:13) | R:232–244,289–292 runs before R:308 completes; H:475–478. | Preserved one action; NC6 not proved (LG3). |
| L3/L4 evidence cannot be merged (M:13; Pr:11) | Separate `propagate` and `persist` paths and unknown actual coverage. | Preserved code distinction; proof gap LG7. |
| C/A cannot be merged (Pr:11) | Response object and confirmed baseline separate, but no generation tag. | Partial; disclosed LG2. |

### Rules and preservation conditions

| Source item | Reduction and tests | Status / loss trace |
| --- | --- | --- |
| R1 non-GCed, subscriber-independent eligibility | R:188–192; O:126–152, G:70,88, H:418–425. | Preserved fixed/loaded set; lifecycle deferred LG2. |
| R2 synchronous whole-row guesses | X:160–167 rejects async onMutate; X:260–269 requires full rows; R:313–315; H:438–453. | Preserved typed Todo slice; whole-row snapshots rely on existing DB. No core proof claimed. |
| R3 sufficient support or explicit unsupported exit | X:249–285 diagnoses unsupported query shapes; R:194–230 derives accepted membership only. | Preserved exclusion; compiler abort replaces broader query-level fallback (LG1). |
| R4 unknown selects all; complete can exclude disjoint | C:14–21; R:262–275; ST:19–49. | Unknown path preserved; complete path unused, independent client selection proof gap LG7. |
| R5 trusted reads/full results absent justified shortcut | X:181–191,356–365; S:19–33. | Preserved accepted requests; unknown-query fallback deferred LG1. |
| R6 baseline first; retire matching overlay; never merge confirmed into pending | R:232–244,305–308; H:475–478. | Sequential evidence only; disclosed concurrency gap LG3. |
| R7 scope/identity/generation/coverage; bounded absence | R:66–67,281–292,235–241; X:339–342; S:10–15. | Scope/ID/full-result deletion boundary preserved; generation deferred LG2; negative proof gap LG8. |
| R8 confirmed/guessed/error distinct; retry only reads | S:17–39; R:277–279; H:465,485–574. | Preserved current error/reload contract; durable response-loss recovery explicitly deferred D:56. |
| R9 independent safety and cost per shortcut | D:36–47 and absent shortcut implementations. | Preserved caution; machinery deferred LG6. |
| R10 API/synchronous/server boundary/no queue | R:151–186,295–333; X:167,332–382; H:442–443; artifact checks H:188–224,260–279. | Preserved bounded API; overlapping-operation correctness not inferred from lack of queue (LG3/LG4). |
| P1 bare writable collections, Transaction action | R:155–157,163–186; G:33–47; H:442–443. | Preserved supported nonempty actions; LG4. |
| P2 affected non-GCed regardless subscribers | R:188–192; O:126–152. | Preserved; LG2 for lifecycle. |
| P3 existing overlays; server branches may differ | R:305–315; G:33–43; V:34–37. | Existing overlays and text correction covered; broader independent branch proof gap LG7. |
| P4 whole-row ownership; no preload in mutationFn | R:232–244,305–308; D:11. | Preserved adapter boundary; concurrency proof deferred LG3. |
| P5 unknown non-impact never proved; inline fallback | R:262–275; S:19–33; X:249–285. | Actual unknown handled; query unknown excluded/deferred LG1. |
| P6 identity includes scope/arguments; trusted SQL | R:66–72; X:275–285,339–365. | Empty-argument identity supported; argument generalization and app registry deferred LG5. |
| P7 no implicit queue or client server-code | R:332 returns after commit initiation; compiler split/artifact checks D:32. | Preserved in tested boundary; no universal leak claim. |
| P8 effects span tables/reads; RETURNING not completeness | C:14–21, R:262–268, ST:19–49. | Conservative policy preserved; full effects/registry deferred LG5 and oracle dimension LG7. |
| P9 safe and beneficial separate | D:38–47. | Preserved claim boundary; LG6. |
| P10 lifecycle/siblings/errors/publication remain explicit | D:54–56; error path S:34–39. | Preserved as named limits, not solved; LG2/LG3. |
| P11 SQL truth/keys/order/support constrain guesses | C:24–35; R:74–86,235–237; X:260–285; V:66–78. | Bounded predicates/order independently checked; codecs/collations/top-k/joins explicitly out (D:52); malformed key test gap LG8. |
| P12 no production speed or independent range inference | D:30,47,51–56. | Preserved. Generated accepted programs are not claimed as an independent held-out range instrument. |

### Forms, open problems, controls, and layered claims

| Source item | Reduction trace | Status |
| --- | --- | --- |
| F1 separate results with bounded descriptors/transactions | D:7–15; C/R. | Selected and implemented bounded slice. |
| F2 shared supporting state/inverse writes/support retention | D:15 names F1 selection; linked grammar retains F2. | Explicit non-selection, LG6; no ranking claimed. |
| Patches/shared encoding are delivery options, not new ownership forms | D:47 excludes them; D:15 chooses ownership separately. | Preserved separation; deferred options LG6. |
| U1 creation/restart/GC catch-up | D:54; runtime guards R:141–144,296–303. | Explicit deferral LG2. |
| U2 response observation/publication; hash not revision | D:55 declines revision/common snapshot; X:326,353 source hash remains source provenance. | Preserved limit LG3. |
| U3 module registry not app registry | D:51,56; X:358 only local declarations. | Explicit deferral LG5. |
| U4 exact complex optimism unproved | D:51–53 excludes unsupported queries/actions; actual corrections tested narrowly. | Preserved limitation; LG1/LG4/LG7. |
| U5 SQL codec/evaluator equivalence absent | D:52 lists codecs/collations out of scope. | Preserved limit. |
| D1 coupled support/publication obligations | D:54–55 leaves both explicit. | Preserved substantive limit; no claim that five records are independent modules. |
| D2 one response does not prove common snapshot/atomic visibility | D:55 expressly disclaims both. | Preserved limit LG3. |
| E1/E2 local/documentary/inferred provenance | D:24,60 links and attributes research; source layers remain accessible. | Analytical support retained; no source evidence upgraded by this audit. |
| E3 P1–P12 constraints, not experiments | D:15,24,60 distinguishes grammar from implementation. | Preserved claim distinction. |
| E4/RC1 original two-collection gap | D:3,30–34 reports old red, green and omit-fanout sensitivity. | Became executable evidence; this audit did not rerun receipts. |
| E5 cost can exceed benefit | D:47 says full-result delivery does not materially reduce bytes and limits latency claim. | Preserved caution; LG6. |
| RC2 logical F1 insertion reconstruction | R:194–244; O:126–152, H:437–453. | Bounded reconstruction now executed according to draft receipts. |
| RC3 unseen top-k replacement/join support failure | X:249–285 rejects these; D:51–52 states exclusions. | Local refusal preserved; server fallback deferred LG1. |
| NC1 subscriber exclusion | Fixed zero-subscriber fixture O:134–152; H:418–425. | Covered. |
| NC2 empty RETURNING implies no cross-table effect | ST:19–49 supplies zero affected rows with two requested reads; runtime ignores output for selection. | Helper negative control covered; full client selection boundary gap LG7; multi-table compiler deferred. |
| NC3 key-only top-k patch | X:249–285 excludes top-k; D:47 no patches. | Excluded by admission, not tested as supported behavior. |
| NC4 repeat committed write after read failure | H:533–538 asserts one released write, H:550–574 distinguishes error/reload. | Covered one read; no durable-loss protocol claim. |
| NC5 trust client handlers/raw SQL | X server dispatch and trusted imports; H:608 onward rejects raw/module paths, artifact checks. | Covered tested compiler/server boundary; not universal. |
| NC6 one response drops all overlays | Single-action held/early-settlement evidence D:32. | Different control not a substitute; explicitly deferred concurrency LG3. |
| Range/control limit: analytical, no independent case | D:30 counts generated tests; D:51–56 bounds supported slice; D:60 says grammar not arbitrary-SQL proof. | Preserved; no false independent range claim. |
| Pr:5 demoted Planner/Capability/RowPool/SQLBatch | Implementation uses descriptor/rules and existing transaction/runtime components. | No restoration of imaginary fundamental units claimed. |
| Pr:9–13 full unit/relation/rule ablations | All items individually traced above. | Analytical exclusion rationale remains linked; not misrepresented as executed mutant suite. |
| Pr:15 forms as rule combinations, not module substitutions | D:15 explicitly selection by implementation authorization. | Preserved. |
| B1 / B:3 separate Q/E/T/C/A and L3/L4 | D:7–11; C/R separation. | Preserved bounded representation; LG2/LG7. |
| B2 / B:5 retained API/transactions/no queue | D:3,9,11,54–55. | Preserved with explicit preconditions LG2–LG4. |
| B3 / B:7 two unranked ownership forms/costs | D:15 and grammar links. | Selection disclosed, LG6. |
| B4 / B:9–11 support, authority, independent cost/error claims | D:11–13,47,51–53,56. | Error/cost preserved; fallback narrowed explicitly LG1; proof gap LG7. |
| B5 / B:13 range/lifecycle/scope/concurrency/publication limits | D:51–56. | Preserved and expanded as explicit first-draft limits. |
| Pr:25 all layers recoverable, no grammar-licensed recommendation | D:15,24 links grammar and distinguishes authorization. | Preserved. |

The recovered omissions above distinguish missing behavior from missing proof. The main behavior reductions were disclosed before this audit. LG7 and LG8 identify the narrower, unadvertised places where passing generated tests would not reject loss of a retained guarantee. No recommendation about restoration or priority is made.
