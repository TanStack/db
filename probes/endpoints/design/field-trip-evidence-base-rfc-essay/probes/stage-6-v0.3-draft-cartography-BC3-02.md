# BC3-02 — reordered prompt

## Execution boundary

Fresh source-blind context. The probe used no tools and saw only the reordered
prompt plus the exact public specimen frozen in
`probes/stage-6-v0.3-draft-cartography-plan.md`.

## Raw response

### Mechanism and handoffs

1. A domain owner defines a bounded claim, admissible checks, context, and omissions — “A domain package defines the guarantee…contexts where evidence applies, and the known omissions.”
2. Checks produce observations whose support must actually reach the claimed behavior — “verify that those checks reached the behavior they claim to test.”
3. Trust records routes and evaluates applicability and age — “maintains the evidence graph and its history: observations, support routes, applicability, freshness.”
4. Evidence evolves through contradiction, repair, and expiry rather than remaining permanently valid — “Contradiction, causal repair, and expiry.”
5. Trust explains the resulting state — “explains current state.”
6. The consumer converts evidence into action while retaining fallback ownership — “decides permission, severity, fallback, and deployment action.”

### Authority and roles

- Domain packages own meaning and check authority — “defines claims and rules” and “implements bounded checks.”
- Trust owns reusable evidence mechanics, not domain truth or deployment permission — “assesses declared routes.”
- Consumers own operational policy — “decides use” and “owns fallback.”
- Workflows carry authoring and repair — “authoring and repair workflows.”
- CLI, LSP, and MCP are interfaces over shared semantics — “adapters over one service.”
- Agents may perform lifecycle work but cannot authorize their own claims — “without letting an agent approve its own claims.”
- Interfaces and workflows remain non-authoritative carriers — “they do not acquire authority of their own.”

### Reconstructed product

Trust is an internal evidence architecture for making guarantee work traceable, revisable, and automatable — “Most of that work is manual today” and “an architecture for automating more of it.” Its output is a contextual justification, not proof or permission — “a bounded domain claim with declared evidence, conditions, and limits.”

### Current implementation

The worktree contains a working vertical slice: “a finite local kernel, verified file storage, one Endpoints check, and CLI, LSP, and MCP adapters over one service.” It does not yet demonstrate rule soundness, cross-domain range, effective agent use, or shipping safety — “It does not establish” any of those claims.

### Endpoints boundary

Endpoints is the initial host and proving ground — “built and shipped inside TanStack DB Endpoints” and “the first bounded implementation.” Trust is not presently a standalone package — “not a separate product or package roadmap.” Endpoints examples constrain neither the architecture’s eventual range nor outside effects — “they do not define its full range” and “External writes remain outside the law.”

### Largest unresolved areas

The explicit gaps are validation of the registered rule, other-domain applicability, agent usability, and safe consumer adoption — “that the registered rule is sound,” “spans other domains,” “agents can use it effectively,” and “software is now safe to ship.” The RFC also still contains “Open decisions and build dependencies.”

### Likely conclusion

Trust can justify reliance only when evidence is authoritative, applicable, fresh, and bounded; that justification can later expire. Even then, action remains a consumer decision — “Even supported evidence does not decide whether product policy enables the optimization.”

### Collapse risk and likely overclaim

The largest collapse risk is flattening evidence into permission, allowing Trust or an agent to become the approver despite “consumer policy decides permission” and “without letting an agent approve its own claims.” The likeliest overclaim is presenting one Endpoints vertical slice as a general safety system, despite “one Endpoints check” and “It does not establish that the architecture spans other domains.”
