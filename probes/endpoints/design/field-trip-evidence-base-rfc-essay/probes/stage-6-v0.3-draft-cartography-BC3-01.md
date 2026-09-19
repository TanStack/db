# BC3-01 — canonical prompt

## Execution boundary

Fresh source-blind context. The probe used no tools and saw only the canonical
prompt plus the exact public specimen frozen in
`probes/stage-6-v0.3-draft-cartography-plan.md`.

## Raw response

### Expected RFC

1. **Product shape and problem solved:** An internal evidence-lifecycle architecture that makes bounded guarantees inspectable and automatable, addressing that “Code generation is becoming cheap. Guarantee work is not.” It is “an internal architecture and evidence contract, not a separate product or package roadmap.”

2. **Authority boundaries:** Domain owners define claims, authorized checks, applicability, and omissions; Trust manages evidence; consumers decide action. This follows “A domain package defines the guarantee,” “TanStack Trust maintains the evidence graph,” and “Consumer policy decides permission.” Agents and interfaces remain non-authoritative because “they do not acquire authority of their own” and an agent must not “approve its own claims.”

3. **Mechanism sequence:** A domain registers a bounded claim and support routes; checks create observations; Trust assesses reach, applicability, and freshness; contradictions are retained; causal repair may restore support; changing conditions expire prior justification; explanation exposes the resulting state. This is signposted by “observations, support routes, applicability, freshness, contradictions, repair, and explanation,” plus “Contradiction, causal repair, and expiry.” Evidence therefore changes from observed, to applicable/current, to contradicted or expired, and possibly repaired.

4. **Roles:** People and domain packages author meaning and authority; workflows perform authoring and repair; CLI/LSP/MCP carry operations to “one service”; agents assist but cannot authorize; consumers “own fallback” and “apply policy.”

5. **Implementation status:** A narrow working vertical slice exists: “a finite local kernel, verified file storage, one Endpoints check, and CLI, LSP, and MCP adapters over one service.” The RFC remains a “Draft RFC for feedback.”

6. **Endpoints role and range boundary:** Endpoints is the initial host—“built and shipped inside TanStack DB Endpoints”—and supplies “the first bounded implementation.” It is not the architecture’s semantic limit because its examples “do not define its full range.” Within the example, “External writes remain outside the law,” and supported evidence still cannot enable the optimization because “product policy” decides that.

7. **Largest unresolved areas:** Rule soundness, cross-domain generality, agent effectiveness, and operational safety remain unproven: the slice “does not establish that the registered rule is sound,” “that the architecture spans other domains,” “that agents can use it effectively,” or “that software is now safe to ship.” Further specifics sit under “Open decisions and build dependencies.”

8. **Likely conclusion:** Trust should automate the preservation, expiry, repair, and explanation of evidence while keeping meaning and permission outside the kernel—“automating more of it without letting an agent approve its own claims.” Adoption should proceed through the bounded Endpoints slice, not claims of universal assurance.

9. **Likely simplification or overclaim:** The RFC probably over-simplifies how cleanly “domain meaning, reusable evidence mechanics, and consumer policy” can be separated. Rule soundness and applicability inevitably leak domain judgment into the supposedly reusable graph, especially since the implementation “does not establish that the registered rule is sound.”
