# TanStack Trust RFC v0.3 — source trace

Final draft SHA-256:
`cb5d2620be30fdd12baf7173ad383ae76507a665f45cedcdf8c3296f269d8724`

## Frozen inputs

- drafts/tanstack-trust-rfc-v0.2.md, SHA-256
  61fd916f61b53e8440de673a39fbbce4b745c7d5215e330ace2bc01ff22efb60
- drafts/tanstack-trust-rfc-v0.2-source-trace.md
- drafts/rfc-v0.2-concept-grammar-model.md
- drafts/rfc-v0.2-concept-grammar-evidence.md
- drafts/rfc-v0.2-concept-grammar-process.md
- drafts/rfc-v0.2-trust-architecture-grammar-model-v2.md
- drafts/rfc-v0.2-trust-architecture-grammar-evidence-v2.md
- drafts/rfc-v0.2-trust-architecture-grammar-process-v2.md
- drafts/stage-5-trust-architecture-revised-outlines.md
- drafts/stage-5-complete-trust-architecture-design-v2.md
- Existing registered Essay sources and completed readings within their
  recorded coverage
- Kyle's preserved comments in Field Log events 231, 235, 243, and 259

No outside source or new Trust theory entered the initial draft. The following
official TanStack documentation entered only during the authorized post-draft
illustration check:

- Router route-tree documentation and the React file-based quick-start example
- Query `persistQueryClient` documentation
- Table sorting and column-filtering guides
- Form validation guide

That check narrowed or grounded generated examples. It added no Trust theory,
implementation claim, product outcome, or range evidence.

## Section trace

| v0.3 section | Frozen support | Claim kind and status |
| --- | --- | --- |
| Abstract | C01–C10, C17–C23, C66–C72, C82; user corrections | Product framing and architecture summary; safe-automation outcome unmeasured |
| Status vocabulary | C07, I13/I16, U07; v0.2 status legend and later status uses | Proposed document convention; expanded to retain unresolved and unselected rather than erase them |
| 1. Why Trust exists | C01–C10; source-transfer reading for capability/deployability, bounded promises, control evidence, maintenance; user corrections | Product judgment and bounded source transfer; adoption and outcome unmeasured |
| 2. Authority | C17–C23; I01–I03/I13/I16/I17; O07/O09/O11; v0.2 authority map | Proposed architecture with bounded partial implementation; no package extraction implied |
| 3. Evidence graph | C24–C36; I04/I05/I11/I15; R01–R04/R15/R16; O05/O06/O08; v0.2 evidence forms and formal-donor readings | Proposed model with implemented local subset and explicit formal/tool limits |
| 4. Current evidence | C16/C28/C37–C43; I06–I08; R03/R05; O01/O02/O04; current kernel behavior | Implemented local state and revision behavior; applicability and operational-failure integration unresolved |
| 5. Contradiction and repair | C29/C44–C49; I09/I10; R06–R08; O03/O04; repair tests and v0.2 trace | Implemented bounded exact replay; richer repair and identity unresolved |
| 6. Explanation | C35/C50/C51; R09/R16; O05/O06; formal explanation donors | Proposed stable operation; structured local internals only |
| 7. Lifecycle automation | C20/C23/C54–C58/C62/C63; Oracle Guide-derived authoring and repair discipline; workflow cards | Normative documented workflows; generic operations absent and effectiveness unmeasured |
| 8. Service, interfaces, persistence | C21/C52/C53/C59–C63; I14; R11/R13; current service, adapters, store, and shared test | Implemented local subset; distribution, multi-process safety, security, and agent use absent or unmeasured |
| 9. Integration and policy | C17/C19/C31–C33/C64/C65/C75–C78; I01/I02/I11/I15; R01/R10/R15; O01/O07/O08 | Normative package obligations, proposed integration, and intentionally unselected universal policy |
| 10. Endpoints today | C10–C16/C61/C66–C72; I12/I13/I17/I18; O12; Endpoints code, tests, DESIGN and HANDOFF | Bounded implementation evidence; working-tree state; not independent range evidence |
| 11. Decisions and build | C58/C73–C81; B01–B10; U01–U07; donor pass and decision register | Source-bounded mechanism transfers, open decisions, and proposed dependency order |
| 12. Later-agent recovery | C07/C82; I13/I16; Stage 4 reader promise | Proposed product success condition; agent and product outcome unmeasured |

## Transition control

- Human guarantee work to Trust architecture is a product rationale, not an
  empirical claim that the architecture reduces work.
- The generic authority architecture precedes the Endpoints example; Endpoints
  illustrates responsibility without creating the general rule.
- Authority to evidence objects is definitional: ownership determines who may
  assign meaning to the objects.
- Static evidence to temporal evidence adds reach, context, and history; it
  does not imply that every dependency can be discovered.
- Failure to repair uses the implemented causal rule and retains richer repair
  as unresolved.
- Explanation to workflow and interface treats structured explanation as an
  operation agents need; it does not establish usability.
- Current adapters to desired operations contrasts implemented and absent
  capability; it does not turn the desired service into an API commitment.
- Integration to policy is a handoff, not an inference from evidence to
  permission.
- Endpoints to Trust is explicitly blocked as independent range evidence.
- Donors to architecture preserve each breakpoint and never serve as
  validation.
- Open gaps to build order are a proposed dependency model, not settled product
  priority.

## Generated illustration register

| ID | Draft location | Generated illustration | Role | Current status |
| --- | --- | --- | --- | --- |
| GI01 | Evidence graph | TanStack Router generated route tree and runtime URL matching | Clarify joint and alternate evidence routes | Checked and narrowed: official docs say the route tree matches URLs to component trees; the quick start imports generated `routeTree.gen` into `createRouter` |
| GI02 | Applicability and freshness | TanStack Query persisted client under timestamp/max-age, buster, hydration, storage, and cache settings | Clarify domain-owned applicability with Trust-captured dependencies | Checked and narrowed to documented persistence controls; the vague library-version dependency was removed |
| GI03 | Check design | TanStack Table sorting or filtering row-model property | Clarify law, reference, production checkpoint, bounds, and counterexample reduction | Checked: official guides expose client-side row-model stages and manual modes that assume pre-sorted or pre-filtered rows |
| GI04 | Domain integration | TanStack Form validation results mapped to field-level and form-level errors | Clarify domain-owned translation and dependency capture | Checked: official validation guide documents Standard Schema propagation and separate form/field error structures |

No illustration is used as evidence for Trust's range or implementation. Each
remains visibly labeled in the draft. The official-source check grounded the
surface of all four and narrowed the Query dependency list.

## Applied writing constraints

- Trust architecture is the subject.
- Endpoints is one reusable miniature and one late implementation audit.
- Major concepts use practical question, example, rule, and boundary.
- Useful bounded-control reasoning is stated directly.
- Reader-facing prose does not mention the internal Design Grammar or use the
  word “silently.”
- Status and authority limits appear at the point of use.
- Non-Endpoints examples are labeled illustrations.
- No safe-automation, agent-effectiveness, portability, or product-outcome
  result is claimed.

## Draft transformation check

- Every planned section performs the function assigned in TA-1.
- The whole-system map remains simple and introduces no later primitive or
  state-machine detail.
- All C01–C82 concept clusters have a section home.
- All I01–I18 invariants and O01–O12 overlaps remain recoverable.
- The prior P2 title, subtitle, and description remain accurate.
- Exhaustive matrices and registers appear after their architectural
  prerequisites.
- No load-bearing unsupported addition was accepted.

## Post-draft v0.2 loss recovery

The user-selected loss audit compared the complete frozen v0.2 source with the
post-cleanup v0.3 draft through three source-isolated passes. It recovered
twelve weakened signals. A separate disposition pass restored all twelve at
six existing explanation sites:

- §1 combines the cheap-generation scaling burden with the shared-
  implementation and responsibility-removal value thesis;
- §7 restores fixture ownership, trust assumptions, and open decisions as
  check-design outputs;
- §8 restores `evidence.request`, adapter-specific partial explanation shapes,
  and the absent contextual source-diagnostic layer;
- §11 states the heterogeneous evidence status of donor transfers in
  reader-facing language, restores the named donor systems, and restores
  applicability and defeat to the Datalog breakpoint;
- §11 reconnects possible later extraction to the possible timing of a
  second-domain range test without creating a current milestone; and
- the build and hardening sequence restores endpoint- or artifact-scoped
  dependencies and the broader hostile-process boundary.

Every restored claim comes directly from the frozen v0.2 RFC and remains under
its original status and scope. The edit adds no new Trust mechanism, current
capability, measured product outcome, extraction commitment, second-domain
plan, or independent range evidence. The complete recovery and disposition
ledgers are in `probes/stage-6-loss-audit-v0.2-to-v0.3.md` and
`probes/stage-6-loss-audit-v0.2-to-v0.3-disposition.md`.

The final semantic comparison is
`probes/stage-6-semantic-drift-v0.3-final.md`. It reconstructs every declared
architecture invariant and finds no unauthorized or unresolved semantic delta.

## Stranded material

No consequential v0.2 concept is knowingly stranded after the completed loss
audit and repair. The draft still compresses repeated statements of the same
authority refusal and Endpoints incubation decision.
