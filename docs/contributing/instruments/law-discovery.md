# Law discovery

**Use when:** a bug, example, or implementation exists but the promised behavior
is unclear; several supplied reports may share a law; or an existing law might
conflate distinct obligations.

**Inputs:** the question, contract sources, known examples, existing oracle owner
and limits, and the public observation that matters. A missing authority is an
input gap, not permission to infer a promise from production.

With several supplied reports or examples, ask whether one caller-visible
obligation predicts their different symptoms. Name its common preconditions,
check an apparent outlier and a nearby case it should permit, and split the
proposal if those cases require different promises. Shared code is a clue, not
contract authority.

## Operation

1. State the obligation in domain terms before describing machinery: for which
   legal inputs or histories, under which preconditions, what must be observable
   at which checkpoint? Include what can still be pending or unspecified.
2. Trace its authority. Separate accepted contract, observed current behavior,
   mathematical consequence, and proposed design. Explain why the obligation
   matters to a caller. A mathematical rule still needs an argument that it is
   the right rule for this API.
3. Form a plausible rival interpretation. Derive both predictions for the
   smallest legal case that separates them, without consulting production for
   the expected answer. If authority does not select a prediction, retain the
   design question instead of turning one guess into an assertion.
4. Compare an ordinary case with a nearby boundary case. Vary a relevant
   condition such as cardinality, ordering, identity, authority, or observation
   time. Keep other conditions fixed where possible. Check the boundary is
   within the claimed domain.
5. Describe the smallest independent model that can make those predictions.
   For any proposed merge of model states, ask whether a legal next action can
   distinguish them. Map model abstractions to the project vocabulary.

**Return:** the candidate law and status, its source, rival predictions, a
concrete distinguishing witness, and the next experiment or unresolved decision.
For a simple law, a short paragraph and a worked example suffice.

**Control:** try a legal alternative implementation. Does the proposed law
reject it only because its scheduling or representation differs? Also try a
plausible wrong result: could the proposed observation distinguish it?

**Distortion:** freezing an implementation accident into a law; treating a vivid
edge case as representative; or overstating what is owed at an intermediate cut.

**Stop when:** the law is precise enough to enact independently, or a named
missing authority or fact prevents choosing between predictions. Continue other
authorized work while keeping that choice unresolved.

Adapted from Field Lab's assumption mapping and ground-condition probe.
