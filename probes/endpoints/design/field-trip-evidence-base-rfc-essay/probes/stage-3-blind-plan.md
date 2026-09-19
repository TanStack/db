# Stage 3 Blind Cartography sampling plan

## Freeze declaration

This plan was frozen before source-grounded candidate generation and before any expectation probe was dispatched or read. Later source-map content, desired candidates, atlas labels, and source details may not be added to these prompts.

## Neutral specimen label

`An RFC for the designer of a reusable software evidence base that agents can use through command-line, editor, and tool-protocol interfaces; one domain package may appear only as a worked example.`

This label states the selected subject and output context but contains no source findings, preferred architecture, candidate, or desired novelty.

## Fixed output contract

Each fresh probe must produce four to six **unranked hypotheses** for distinct RFC/editorial approaches. For every hypothesis it must provide:

1. a neutral ID;
2. the public question or claim;
3. the central intervention for the reader;
4. the organizing form and likely scale;
5. assumptions the approach would normally make without sources;
6. the largest likely gap or failure mode; and
7. semantic tags chosen from `architecture`, `semantics`, `lifecycle`, `authority`, `workflow`, `interfaces`, `worked-example`, `tradeoffs`, `unresolved-decisions`, or `implementation-state`.

The probe must not rank, recommend, infer public opinion, claim novelty, or invent evidence. Everything it returns is a model-expectation hypothesis.

## Meaning-preserving prompt family

### Variant A — direct

> Map four to six distinct, unranked ways an RFC could explain the neutral specimen below to its designer. Keep the subject, reader, evidence standard, and output contract fixed. Treat every proposed approach as a hypothesis because no source corpus is visible. Do not rank, recommend, claim novelty, or invent support.\n>\n> Neutral specimen: An RFC for the designer of a reusable software evidence base that agents can use through command-line, editor, and tool-protocol interfaces; one domain package may appear only as a worked example.\n>\n> For each approach return: ID; public question or claim; central reader intervention; organizing form and likely scale; assumptions normally made without sources; largest likely gap or failure mode; and semantic tags from architecture, semantics, lifecycle, authority, workflow, interfaces, worked-example, tradeoffs, unresolved-decisions, implementation-state.

### Variant B — reordered

> No source corpus is available, so treat all outputs as hypotheses and do not invent evidence, rank, recommend, or claim novelty. For the neutral specimen below, produce four to six semantically distinct and unranked RFC/editorial approaches for its designer. Hold the subject, reader, evidence standard, and requested fields fixed.\n>\n> Neutral specimen: An RFC for the designer of a reusable software evidence base that agents can use through command-line, editor, and tool-protocol interfaces; one domain package may appear only as a worked example.\n>\n> Return for each approach: neutral ID; public question or claim; central intervention for the reader; organizing form and likely scale; assumptions the approach would normally make without sources; largest likely gap or failure mode; and tags selected from architecture, semantics, lifecycle, authority, workflow, interfaces, worked-example, tradeoffs, unresolved-decisions, implementation-state.

### Variant C — question-led

> What distinct RFC/editorial approaches would a model readily reconstruct for the designer of the neutral specimen below? Produce four to six unranked hypotheses. No sources are visible: do not invent support, rank, recommend, estimate popularity, or claim novelty. Keep the subject, reader, evidence standard, and output fields unchanged.\n>\n> Neutral specimen: An RFC for the designer of a reusable software evidence base that agents can use through command-line, editor, and tool-protocol interfaces; one domain package may appear only as a worked example.\n>\n> For every hypothesis give a neutral ID, public question or claim, central reader intervention, organizing form and likely scale, assumptions normally made without sources, largest likely gap or failure mode, and semantic tags chosen from architecture, semantics, lifecycle, authority, workflow, interfaces, worked-example, tradeoffs, unresolved-decisions, implementation-state.

## Initial strata and assignments

- `BC-01`: Variant A; system-model stratum — emphasize architecture, semantics, and authority without excluding other returned moves.
- `BC-02`: Variant B; operational-use stratum — emphasize lifecycle, workflow, and interfaces without excluding other returned moves.
- `BC-03`: Variant C; explanatory-form stratum — emphasize tradeoffs, worked examples, implementation state, and unresolved decisions without excluding other returned moves.

The coordinate assignment changes the sampled stratum, not the core task. No full Cartesian product is planned.

## Raw trace paths

- `probes/stage-3-blind-BC-01.md`
- `probes/stage-3-blind-BC-02.md`
- `probes/stage-3-blind-BC-03.md`

## Stop, control, and unmeasured cells

The initial atlas stops after these three fresh probes unless their disagreement identifies a border where one targeted sample could materially change the map. Shared model lineage remains correlation, not independence. No cross-model family, exact-prompt replicate, adaptive border sample, secondary audience, publication form, or outside factual check is included in the initial budget.
