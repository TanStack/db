# Guarantees describe code; they do not replace it

The Design Grammar found a useful boundary already present in the compiler: it analyzes ordinary functions, then uses the result both for runtime dependency matching and for diagnostics. Auth does not need a special compiler role. The application keeps ownership of checks, writes and order.

The important distinction is between **what was established** and **what that permits the system to do**. A set of tables is a dependency claim. It does not, by itself, describe permission policy, all observable effects, or whether omitting an entire invocation preserves the application's behavior. The current output does not separately represent those stronger claims.

Six compiler controls grounded the extraction:

- A pure helper produced a known read set; two reads produced both relations, even when only one supplied the returned rows.
- An unknown helper before or after a SELECT made the complete proof unknown.
- A query that wrote produced `Effectful query`, a different reason from an unresolved helper.
- Naming a helper `authorize` gave it no special treatment. All six emitted registry handler bodies preserved the submitted body AST.

This supports a distinction between incomplete observations useful to a developer and complete evidence a runtime decision requires. For example:

```ts
async function listRecipes(req) {
  await requireUser(req)
  return db.select().from(recipes)
}
```

If `requireUser` is unresolved, a diagnostic could explain that the later SELECT reads recipes while the whole handler remains unknown. It cannot turn that observation into a recipes-only guarantee. That richer diagnostic is a generated design possibility, not implemented lint output.

The grammar produced two unranked extensions:

1. **Traceable lint explanations.** Extend the current reasons with source paths, the missing evidence, the blocked optimization, and possible author-owned edits. Runtime behavior stays unchanged. The cost is retaining useful partial observations without letting them masquerade as complete proofs.
2. **Checks for each optimization's requirements.** Before emitting eligibility, require the particular claims that optimization needs. Runtime still checks live inputs, baselines and optimism. This may withdraw some skips until stronger evidence exists; it does not restructure the handler or prescribe auth placement.

These extensions can coexist. They are not configuration choices. A lint suppression or an agent's suggested edit grants no new guarantee: only analyzing the resulting source can change the evidence. Compiler-generated auth extraction is outside the grammar.

The run does **not** settle the full contract for omitting a handler, application request-context lifetime, or the supported behavior of opaque queries that write. Ordinary fallback remains execution, not a proof of convergence. Build evidence remains conditional on supported code/schema/deployment assumptions, with schema inspection confined to compilation and server code kept outside client bundles.

The first fixture hit the current requirement to bind both `query` and `mutation`; the controls were then run in that supported shape. Body AST preservation is narrower than full execution equivalence or a client-bundle audit. No independent range case was supplied, and no new full-stack oracle or performance campaign ran. Decomposing code into footprints can hide order, error meaning and background effects; the grammar names those losses rather than filling them with assumptions.

[Model](MODEL.md) · [Evidence and ablations](EVIDENCE.md) · [Process](PROCESS.md) · [Measured controls](control-results.json)
