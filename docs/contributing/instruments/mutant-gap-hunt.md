# Mutant gap hunt

**Use when:** a recent refactor, a suspicious green oracle, or an open review
question leaves doubt that the tests would reject a plausible wrong behavior.
One carefully chosen mutant can answer a useful question; a campaign is optional.

**Inputs:** the changed code and commits that shaped it, the claimed law and its
authority, the primary oracle and its limits, open review questions, and the
public observation that could distinguish a mistake.

## Operation

1. **Design plausible mistakes before reading the tests.** Start with semantic,
   type-plausible edits near the changed boundaries: a lost operand, wrong
   prior value, premature clear, duplicated event, changed ordering, or skipped
   callback. Turn each open review question into a candidate. If code is called
   dead, try removing it. In a larger hunt, spread candidates across the
   affected files and boundaries rather than clustering where edits are easy.
   If a separate designer is authorized, keep the current assertions out of
   its brief. Otherwise draft the candidates before inspecting those assertions
   and label the design as self-generated.
2. **Make each edit replayable.** Record `{ id, file, old, new, desc }`; require
   `old` to occur exactly once at the pinned revision and `new` to parse. Run
   each candidate in an isolated checkout against an unchanged, pinned
   baseline, then restore the checkout exactly. Use `main` when measuring what
   the existing suite catches; use a PR revision when challenging its new
   coverage. Do not combine those kill claims. A full-suite kill can locate an
   existing witness, but a crash, timeout, setup error, or unreached edit is not
   a kill at the promised comparison. Record that distinction, not a mutation
   score.
3. **Interrogate every survivor.** Find a legal public history and checkpoint
   where baseline and mutant predict different observations, or name the
   invariant that makes them equivalent. Check all relevant entry paths,
   including reentry and environment-specific branches; one unreachable path
   does not establish general equivalence. Probe the nearest unusual legal
   history before accepting an unreachability claim. Treat earlier guesses as
   hints. Assert the distinguishing premise, then run the same focused probe
   on both revisions. A confirming probe for a test gap passes on the unchanged
   baseline and fails on the mutant at the intended assertion. If the contract
   instead predicts the mutant's result, record baseline RED and mutant GREEN,
   then investigate a product bug rather than calling it a test gap.
4. **Repair the oracle chain, when authorized.** Locate the missing law, model
   rule, history action, production path, recorder, or assertion. Extend the
   primary owner where it can express the distinction. Show that the extension
   rejects the motivating mutant and a nearby plausible wrong design without
   rejecting a legal alternative. For a bug on the baseline, demonstrate the
   production RED before its repair. Update the coverage map when the owner's
   reach or limits change.

**Return:** each chosen mutant's pinned revision, exact edit, observed outcome,
public distinction or equivalence invariant, oracle gap or product bug, and
disposition. Keep run logs and result tables in task-local evidence unless the
task explicitly asks to publish them.

**Control:** public observations such as Collection reads, events, transaction
states, or query results decide product claims. Check that the probe reaches
the path and premise it names. A green suite does not prove equivalence; a
surviving mutant does not automatically prove a gap. Use a positive control
when instrumentation reports that a branch was never reached. Recheck types
after a commit hook or other tool rewrites code.

**Distortion:** mutants chosen to satisfy existing tests, syntax failures
counted as semantic kills, private-state differences treated as product bugs,
or an oracle extension that accepts the motivating mutant at the relevant cut.

**Stop when:** each selected mutant has an executed distinction, a supported
equivalence argument, or an explicit unresolved experiment. Do not infer broad
coverage from a kill count.

The collection-state hunts that inspired this card used larger campaigns.
Their candidate counts and archival format are examples, not requirements.
