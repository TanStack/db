# Disposition of the v0.2 → v0.3 Loss Audit

The recovery assay was kept descriptive. This separate pass evaluates whether
each recovered signal still belongs in the approved Trust-architecture RFC.
The governing test is not “was it in v0.2?” It is whether the signal remains
supported, consequential to the approved architecture or product argument,
compatible with Endpoints incubation, and expressible without undoing the new
prerequisite-led explanation.

## Dispositions

| IDs | Judgment | Draft repair |
| --- | --- | --- |
| L01, L12 | **Restore together.** They state the product pressure and value thesis that motivates the architecture: cheap generation expands the volume of guarantee work, while shared implementations create durable application behavior and remove responsibility only when remaining obligations stay visible. | One paragraph in §1 follows the concrete human-judgment list. It combines the scaling and lasting-value claims and leaves measured outcomes explicitly unmeasured in the section status. |
| L02, L03 | **Restore together.** Trust assumptions, open decisions, and fixture ownership are check-design responsibilities, not incidental test details. | The §7 check-design inventory now assigns fixture ownership and packages trust assumptions, unsupported constructs, omissions, and open decisions. |
| L04–L06 | **Restore as current capability detail.** These signals distinguish a transport prototype from a usable contextual integration and show exactly what each adapter returns. | §8 restores the `evidence.request` name, adapter-specific partial explanation shapes, and the absence of contextual source diagnostic rendering. |
| L07 | **Restore the epistemic distinction and donor identities, but translate process labels into reader-facing prose.** The RFC should show that donor mechanisms do not all have the same evidential status. Internal run labels such as “sighted pass” would reintroduce workflow language the reader does not need. | §11 now states the heterogeneous evidence classes in plain language and names Carneades, Soufflé, Z3, Field Lab, shadcn-style diagnostics, and Beads-style tasks. Each breakpoint remains local to its donor. |
| L08 | **Restore.** Applicability and defeat are precisely the Trust mechanisms a positive Datalog derivation does not supply. | The Datalog bullet again names applicability, defeat, expiry, and repair. |
| L09 | **Restore with the current roadmap boundary.** A second domain is not planned; the signal only explains when such a test could later become relevant. | The validation decisions now say a future extraction choice may create the reason to test another domain then and is not a current milestone. |
| L10 | **Restore.** Endpoint- or artifact-level dependency scope is a concrete integration requirement that generic “dependency evidence” does not preserve. | The Endpoints-loop build step now names that scope. |
| L11 | **Restore the broader boundary.** Plugin isolation is one case of hostile-process isolation and should not narrow the deployment threat model. | Runtime decisions and the hardening step now name hostile-process isolation, including a hostile-plugin boundary. |

## Net effect

All twelve recovered signals are again representable in v0.3. They enter at six
existing explanation sites rather than as a second dense register. No restored
item changes the selected architecture, status of the implementation, Endpoints
incubation plan, no-second-implementation decision, or range claims.

This repair is itself a new material edit pass. Its final hash must replace the
pre-repair validation hash, and the affected semantic comparison must be rerun
before the Stage 6 return.
