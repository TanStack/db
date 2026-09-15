---
id: design-grammar
name: "Design grammar extractor"
summary: "Candidate primitives, overlap topology, legal transformations, supported range, adjacent forms, and decomposition loss"
use_when: "A fixed artifact or system may hide a reusable language of possible forms"
avoid_when: "Do not use when the whole's key properties cannot survive decomposition or when mere variation is mistaken for evidence."
access_target: "Primitives, invariants, overlaps, transformation rules, supported range, adjacent forms, and certainties lost"
requires: "One grounded artifact or system, a live extraction target, and confirmed preservation properties for exact-equivalence work"
execution_seat: hybrid
fresh_context: timing-dependent
effort: variable
persistence: "One bounded extraction and reconstruction pass; use a Field Log when the source or variants must remain traceable."
artifact_risk: "False primitives, fake modularity, invented rules, combinatorial junk, and erasure of overlaps or properties that belong to the whole."
maturity: established
documented_uses: 25
---

# Design grammar extractor (`design-grammar`)

- **Phenomenon:** A fixed artifact or system may contain a reusable design language: smaller parts, overlapping structures, stable constraints, and rules or transformations that can reconstruct the source and generate nearby forms.
- **Why use it:** A finished form hides which features are essential, which can vary, which overlaps carry function, and which transformations remain members of the same family. A candidate grammar makes those claims visible and testable.
- **Range / input:** Use one grounded artifact or system with enough source detail to trace its parts, relations, constraints, and behavior. State the live extraction target; a large source can support several different grammars. Do not begin with several donor systems.
- **What changes:** The instrument turns one fixed arrangement into a candidate set of primitives, pattern relations, invariants, overlaps, combination rules, legal transformations, and bounded adjacent forms. It marks every inferred rule and every relation or property lost in decomposition.
- **Procedure:**
  1. **Freeze the source, target, and preservation contract.** Name the artifact or system, state the exact system or relation being modeled, record its current arrangement, and attach source pointers. Before extraction, draft a compact preservation preview from the source **and the live target**. Usually propose six to twelve consequential properties, covering scope, directed relations, state or authority distinctions, active overlaps, legal exits, evidence limits, and unresolved quantities where present. Mark each as source-stated, user-required, or analyst-inferred.

     For an **exact-equivalence** run, show this preview to the user and ask one question: what should be added, removed, or corrected before it freezes? Do not freeze it by silence. The user may confirm it as written. For an **exploratory** run, the user may choose to proceed with a provisional model-derived list; label it provisional and do not later claim that every consequential property survived. If the user already supplied an explicit list, normalize it into the preview and ask only about a material ambiguity. A later correction creates a new run rather than rewriting a frozen analysis.
  2. **Separate observation from inference.** Record observed parts, relations, operations, and constraints. Mark inferred functions or boundaries.
  3. **Propose candidate primitives and pattern relations.** Identify smaller reusable units with source links. Call them candidates, not atoms or fundamental parts. Admit a candidate only when it does at least one job: reconstructs a sourced relation, constrains a legal transformation or exclusion, or preserves a named whole-property or active overlap. A renamed source component or a derived measure is not a primitive merely because it can be labeled. When a unit appears pattern-like, record the context in which it recurs, the problem or forces it resolves, its response, and its links to larger and smaller units. Do not force every component into that schema.
  4. **Extract invariants and rules.** State what must remain fixed, what can vary, which units can combine, and which transitions are allowed. Mark each rule that the analyst adds rather than finds. When candidate rules conflict, record the conflict. Record a priority only when the source supports it; otherwise mark the priority unresolved and preserve both branches.
  5. **Map containment, overlap, and dependency.** Record which candidate units contain others and which overlap. Where two units overlap, test whether their intersection is itself an active unit with a distinct function, constituency, constraint, or meaning. Do not assign a consequential overlap to one parent merely to obtain a clean tree. Identify modules only where the source supports an architecture, an interface, an integration test, and bounded cross-unit dependencies; use a lightweight dependency matrix when it clarifies the claim. Treat semilattice structure as a diagnostic for consequential overlap, not a required formal classification.
  6. **Run reconstruction and compression controls.** Use only the proposed primitives, overlaps, and rules to rebuild the source arrangement. Revise or stop if the grammar cannot account for it. Then ablate each primitive, relation, and rule in turn. Remove, merge, or demote it to an annotation when its absence does not break reconstruction, erase a named preservation property or active overlap, change a legal transformation, or weaken the negative-case exclusion. Among grammars with equal coverage and source support, keep the one with the shorter description. Treat this minimum-description-length preference as a pruning heuristic, not evidence that reality is simple.
  7. **Test range and exclusion.** Separate the candidate account into **dynamics** (generative and transformation rules), **constraints** (invariants, interfaces, and forbidden combinations), and **boundary conditions** (source-specific context, starting state, scale, or raw values). Freeze the source-derived grammar before any range case enters an executor's context. If an independently sourced marginal case was supplied, give a fresh evaluator only the frozen grammar, preservation contract, and range case—not the extraction source or its working analysis. Have it state which invariants map, what must be reformulated, which facts are missing, and whether the case is a parameter change, rule change, break, or unresolved. Treat the result as a range addendum; it cannot silently revise the frozen grammar. If it exposes a required rule change, stop and offer a new Design Grammar run.

     A case used to extract, tune, or reconstruct the grammar is not range evidence. If no independent case is already available, mark range untested; do not search for one or reuse a source example merely to fill the slot. A later case requires a newly selected range check unless a selected workflow already scheduled it. Also name one nearby out-of-family artifact or state that the grammar should not generate. Prefer a separately sourced near negative when one is available. If the grammar generates it, the grammar is too broad.
  8. **Generate a small sample.** Produce only adjacent forms that exercise different transformation paths or expose different rule boundaries. Usually return two to four; one or none is valid. Merge forms that differ only by splitting one representation into more fields, adding detail, or restating the same move. Return fewer and state why rather than inject rules to meet a count. Choose only the generation routes the source supports:
     - **Modular operators:** Where real module boundaries exist, apply one or a short sequence of Baldwin and Clark's moves: split, substitute, augment, exclude, invert, or port. State which interface or invariant stays fixed, which dependency changes, what option the move creates, its new coordination cost, and its loss. Do not apply all six by rote.
     - **Pattern unfolding:** Where context, nested patterns, or whole-properties govern fit, make one source-backed move at a time. After each move, check the context and forces, links to larger and smaller units, preserved overlaps, and the frozen whole-properties. Call a move structure-preserving only relative to those explicit properties, not an unsupported impression of “life.”
     - **Rule combination:** Where neither route fits, combine primitives under the extracted rules without pretending the result is modular or pattern-derived.
     For every form, name its route, changed variables, preserved invariants and overlaps, source support, new structure, and loss. State the distinct transformation or boundary the form adds; if none exists, omit or merge it. When a form depends on an unresolved rule conflict, show the alternative branches or omit the form; never choose a priority silently. Do not rank the forms unless asked.

## Model-first projection gate

Treat the detailed analytical state as an intermediate representation and the human brief as its projection. **Do not draft the primary brief while extracting the grammar.** First materialize the Model, Evidence, and Process layers; complete reconstruction, ablation, range, exclusion, and generation controls; and freeze that analytical state.

Give stable internal IDs to the model items, evidence and control results, unresolved conflicts, and generated forms. Before projection begins, the frozen state must contain:

- every surviving primitive or pattern, relation, invariant, and rule;
- each observation/inference distinction and source pointer that warrants them;
- reconstruction and ablation results, including failures or equivocal controls;
- range status, the negative case, injected structure, and decomposition loss;
- the distinct adjacent forms and their transformation routes; and
- every unresolved conflict or missing input that limits the reading.

Generate the brief only from this frozen state. For each consequential claim in the brief, keep an internal support map to the exact model and evidence IDs that warrant it. The IDs need not appear in the prose, but must remain in the Process layer so a reader or validator can trace the projection.

Projection may select, order, translate, and compress frozen material. It may not add a primitive, relation, rule, implication, priority, confidence, or recommendation. If drafting exposes a missing or inconsistent analytical item, stop projection, reopen the analytical state, make the correction there with a new frozen-state version, and regenerate the affected brief passage. Never retrofit the model merely to make an existing narrative flow.

## Two-output return

The operation, its human reading, and its process record have different contracts. Run and freeze the full extraction, reconstruction, ablation, range, exclusion, and generation state before drafting the compact human reading. Keep a separate audit trace of the process that earned it. The trace is provenance and control evidence, not a second version of the reading.

Use a **layered brief**. The default human-facing layer answers the reader's questions before exposing the grammar's machinery:

1. **What this tells us:** state the central reading and the consequential relation it reveals in plain language. Explain why it matters for the source artifact or system.
2. **What it changes:** give two to four concrete implications for how the artifact can be understood, used, or varied. Do not turn implications into adoption, ranking, or advice unless the user requested that later task.
3. **What it does not tell us:** state the range limit, negative case, material decomposition loss, failed or equivocal control, unresolved conflict, and any conclusion the run cannot support. Combine related limits instead of listing empty audit fields.
4. **Concrete cases, when useful:** show one to three short examples of the grammar in operation. Use examples to clarify a consequential distinction, not to restate every rule or generated form.

Write this layer for an intelligent reader who wants the meaning of the result, not the mechanics of the extraction. Do not lead with primitive IDs, schema names, event IDs, lifecycle terms, source ledgers, or ablation detail. Translate a technical distinction into ordinary language when that does not weaken it. Technical compactness is not reader accessibility.

Keep three linked support layers for a saved run:

- **Model:** the surviving primitives or patterns, active overlaps and dependencies, operative rules and invariants, and distinct adjacent forms. Prefer one compact graph or table plus terse source pointers.
- **Evidence:** the source basis, reconstruction status, range comparison, exclusion test, and claims destabilized by failed or equivocal controls.
- **Process:** the frozen source and preservation list, observation/inference ledger, candidate admissions and rejections, full reconstruction and component ablations, generation routes, and run provenance.

Materialize and freeze all three support layers before drafting the primary brief. They are not alternate prose versions of the result. Give each fact one home and link to it from the primary brief. If the runtime cannot separate artifacts, use collapsed appendices after the brief and label that fallback. In an unsaved conversational run, build the same structured analytical state before returning the primary brief, then offer the support layers on request.

Aim for at most **700 words in the primary brief**. This is a presentation ceiling, not an epistemic stopping rule or a limit on the support layers. Exceed it only when a failed control, unresolved conflict, or source ambiguity needs more space to prevent a misleading reading; name the reason in **What it does not tell us**.

Before returning, run a **layer reconstruction**. The primary brief alone must preserve every property, uncertainty, and authority limit that would materially change its takeaway. A reader using the linked layers must also be able to recover every frozen whole-property and each distinction that changes a legal transformation or exclusion. Restore a missing property in the smallest fitting layer, or name its loss. Do not use the working trace to excuse an omission from the layered package.

## Compound execution

This is a sparse-checkpoint contract. Card selection authorizes the candidate
primitives, functions, rules, overlaps, reconstruction judgments, and adjacent
forms named above. Do not ask for an extra LLM grant for those readings. Keep
potential missing-source and range slots on the card's `ask-at-checkpoint`
default until an actual instance blocks a stage.

```yaml
compound-execution:
  stages:
    - id: freeze-source
      mode: mixed
      requires: [source-fact, extraction-target]
      emits: [frozen-source, preservation-preview]
      completion: The source, pointers, live extraction target, and a six-to-twelve-item draft preservation preview are explicit.
    - id: freeze-preservation
      mode: mixed
      requires: [frozen-source, preservation-preview]
      emits: [frozen-preservation-list]
      completion: In exact-equivalence mode the user has explicitly confirmed or corrected the preview; in exploratory mode the provisional status is explicit.
    - id: extract
      mode: judgmental
      requires: [frozen-source, frozen-preservation-list]
      emits: [candidate-grammar, rule-conflict]
      completion: Candidate primitives, overlaps, invariants, rules, conflicts, and inference labels are recorded.
    - id: reconstruct
      mode: mixed
      requires: [candidate-grammar]
      emits: [minimal-grammar, reconstruction-result]
      completion: The frozen source is rebuilt, every admitted unit survives ablation, and redundant units are removed, merged, or demoted—or the run stops.
    - id: test-range
      mode: mixed
      requires: [minimal-grammar, reconstruction-result, marginal-case-evidence]
      emits: [range-classification, range-addendum]
      completion: A fresh evaluator saw only the frozen grammar, preservation list, and independent case and classified it, or the range is explicitly untested.
    - id: generate
      mode: judgmental
      requires: [minimal-grammar, reconstruction-result, range-classification]
      emits: [adjacent-forms]
      completion: Every form uses a supported route, preserves declared invariants or names its loss, and adds a distinct transformation or boundary.
    - id: freeze-analysis
      mode: mixed
      requires: [minimal-grammar, reconstruction-result, range-classification, adjacent-forms]
      emits: [frozen-analysis]
      completion: Versioned Model, Evidence, and Process layers exist with stable item IDs, controls, source links, limits, and unresolved conflicts.
    - id: project
      mode: judgmental
      requires: [frozen-analysis]
      emits: [result]
      completion: The primary brief is derived only from the frozen analysis and every consequential claim has a support map to model and evidence IDs.
  slots:
    - id: extraction-target
      role: input
      value-type: exact-system-or-relation-to-model
      required: true
      consequence: shapes-result
      authority-basis: user-owned
      evidence-from: [user]
      adjudicated-by: [user]
      default: pause
      review: all
      contamination: user-first
      batch-key: preservation-list
    - id: source-fact
      role: input
      value-type: sourced-artifact-fact
      required: true
      consequence: shapes-result
      authority-basis: source-claim
      evidence-from: [user, supplied-source, research]
      adjudicated-by: [user, expert, card-authorized-llm]
      default: pause
      review: all
      contamination: source-first
      batch-key: source-gap
    - id: preservation-property
      role: input
      value-type: named-property-that-the-account-must-preserve
      required: true
      consequence: shapes-result
      authority-basis: user-owned
      evidence-from: [user, expert, supplied-source]
      adjudicated-by: [user, expert]
      default: pause
      review: all
      contamination: user-first
      batch-key: preservation-list
    - id: rule-conflict
      role: candidate-reading
      value-type: unresolved-rule-priority
      required: false
      consequence: shapes-result
      authority-basis: card-selection
      evidence-from: [supplied-source, none]
      adjudicated-by: [card-authorized-llm, user, expert]
      default: unknown
      review: all
      contamination: source-first
      batch-key: conflict
    - id: marginal-case-evidence
      role: input
      value-type: sourced-in-domain-marginal-case
      required: false
      consequence: informational
      authority-basis: source-claim
      evidence-from: [user, supplied-source, research]
      adjudicated-by: [user, expert, card-authorized-llm]
      default: unknown
      review: all
      contamination: source-first
      batch-key: range-question
  calls:
    - when: Reconstruction reaches a consequential missing source fact.
      instrument: ground-condition
      fills: [source-fact]
      authorization: ask-at-checkpoint
      return-type: sourced-artifact-fact
    - when: The range claim needs a sourced material boundary case.
      instrument: ground-condition
      fills: [marginal-case-evidence]
      authorization: ask-at-checkpoint
      return-type: sourced-in-domain-marginal-case
  stop-if:
    - Reconstruction fails or a source fact needed for it remains unavailable.
    - A whole-property or overlap disappears without a stated loss.
    - A nested operation would choose a rule priority, new method, or new result type.
```

- **Result:** After freezing the analytical state, return the primary layered brief above—What this tells us, What it changes, What it does not tell us, and useful concrete cases—and, when the run is saved, linked Model, Evidence, and Process layers. Keep the brief-to-model support map in the Process layer. When a true held-out case was supplied, also return the fresh evaluator's range addendum without rewriting the frozen grammar. The primary brief must preserve every claim and limit that changes its takeaway. Across the linked package, preserve the minimal surviving grammar, active overlaps, operative rules, distinct generated forms, source trace, reconstruction status, range and negative controls, injected structure, material loss, failed controls, and unresolved conflicts. Treat generated forms as samples, not discoveries, predictions, or recommendations.
- **Control:** The target-aware preservation preview is a user-confirmed input in exact-equivalence mode and a provisional model inference in exploratory mode. Reconstruction is the first grammar control; component ablation and description length control gratuitous structure. A fresh matched-case evaluator tests false universality without contaminating extraction; the out-of-family case tests overbreadth. The overlap map blocks false tree decompositions; the dependency and interface check blocks fake modularity; stepwise whole-property checks constrain claims of structure-preserving change. The rule-conflict register prevents the grammar from supplying a missing synthesis. Source pointers, explicit inference labels, and the preservation list expose unsupported structure and decomposition loss.
- **Characteristic distortions:** The analyst may rename current components and call them primitives, split one useful relation across several levels of description, turn every component into a pattern or module, force overlapping units into a tree, mistake a middle-case grammar for a universal one, use an unmatched outlier as a boundary break, invent clean interfaces or a missing priority rule, apply all six modular operators mechanically, call subjective appeal “living fit,” produce cosmetic variants, let a fluent narrative pull the unfinished model toward its framing, retrofit analytical items to support drafted prose, mirror the execution schema as prose, confuse combinatorial possibility with desirability, or erase properties that arise only from the whole.
- **Escalate / stop:** Hand a range claim to [`ground-condition`](ground-condition.md) when it needs sourced material conditions or a controlled boundary comparison. Escalate when one generated form needs comparison, testing, or evaluation by another instrument. Stop when the source cannot be reconstructed, rules lack source trace, module boundaries require hidden coupling, variants differ only in style, or a key overlap or whole-property disappears without a stated loss.
- **Effort and burden:** Variable model effort. The preservation preview adds one short user checkpoint in exact-equivalence mode; exploratory mode may proceed with an explicitly provisional list. A supplied range case adds one fresh bounded evaluation. Ask for missing source facts one at a time. Do not make the user judge each primitive or variant during extraction.
- **Execution placement:** **Hybrid.** The orchestrator holds the live target, asks the single preservation-preview question, and owns source trace and reconstruction. The source executor may share that context. A true range case must go to a fresh evaluator after the source-derived grammar freezes; that evaluator may see only the frozen grammar, confirmed preservation list, and independent case. If fresh-context separation is unavailable, mark range untested. The orchestrator returns the layered brief and any range addendum without merging the addendum back into the frozen grammar.
- **Distinctness:** Unlike [`structural-recombine`](structural-recombine.md), this instrument extracts a reusable language from one system rather than joining parts from several sources into a new arrangement. Unlike [`ground-condition`](ground-condition.md), it uses one boundary comparison to calibrate a candidate grammar rather than investigating material conditions as its main result. Unlike [`frame-projector`](frame-projector.md), it does not impose a two-axis projection. Unlike a focal-length or attribute sweep, it generates several structural combinations instead of varying one declared dimension.
- **Provenance:** This card is a Field Lab adaptation of Venkatesh Rao's account of **oozification**, especially the move from specific technological “texts” to design grammars and then languages, plus his distinction among dynamics, constraints, and boundary conditions; Christopher Alexander's pattern languages, structure-preserving transformations, and tree/semilattice distinction; and Carliss Baldwin and Kim Clark's modular design rules and six modular operators. None published this card or a named method with this exact procedure. See Rao's [“Oozy Intelligence in Slow Time”](https://contraptions.venkateshrao.com/p/oozy-intelligence-in-slow-time), [“Fear of Oozification”](https://contraptions.venkateshrao.com/p/fear-of-oozification), and [“Boundary Condition Thinking”](https://ribbonfarm.com/2011/01/19/boundary-condition-thinking/); Alexander et al.'s [*A Pattern Language*](https://arl.human.cornell.edu/linked%20docs/Alexander_A_Pattern_Language.pdf), Alexander's [“A City Is Not a Tree”](https://christopher-alexander-ces-archive.org/record/the-city-is-a-semi-lattice-but-not-a-tree-original-text-of-article-a-city-is-not-a-tree/), and the archive's collection on [structure-preserving transformations](https://christopher-alexander-ces-archive.org/research-categories/?areas_of_focus=Design+and+Building+Process&guiding_idea=Structure-Preserving+Transformations); and Baldwin and Clark's [*Design Rules, Volume 1: The Power of Modularity*](https://direct.mit.edu/books/monograph/1856/Design-Rules-Volume-1The-Power-of-Modularity).
