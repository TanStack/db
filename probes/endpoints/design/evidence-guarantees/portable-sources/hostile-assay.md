---
id: hostile-assay
name: "Hostile failure assay"
summary: "Defeaters, broken links, failure scenes, and repair conditions"
use_when: "A candidate needs a blind failure test"
avoid_when: "Do not claim a hostile assay without one grounded candidate, its source trace, and a fresh auditor blind to sibling candidates."
access_target: "Defeaters, broken links, failure scenes, and repair conditions"
requires: "one candidate and its source trace"
execution_seat: fresh-subagent
fresh_context: required
effort: high
persistence: "One strong agent per candidate; preserve for high-cost decisions."
artifact_risk: "Criticism becomes consequence-free cleverness, generic pessimism, or an attack from an irrelevant standard."
maturity: trialed
documented_uses: 8
---

# Hostile failure assay (`hostile-assay`)

- **Phenomenon / range / input:** Hidden assumptions, broken links, compromise, and failure under the candidate's own standard; needs one candidate and its source trace.
- **Why use it:** Authors tend to test intended success paths. A blind failure stance exposes defeaters and unsupported links the constructive pass suppresses.
- **Perturbation / procedure:** Give a fresh auditor one candidate, its declared structural claim, source trace, and success standard while hiding sibling candidates and preferred outcomes. Instruct the auditor to assume the candidate failed, then seek undercutting defeaters, rebutting evidence, untraced links, concealed compromise, reversibility failures, and one concrete failure scene. Require each attack to name the broken claim and the evidence or consequence that would establish it, plus a possible repair condition.
- **Readout / control:** Undercutting and rebutting defeaters, reversibility failures, likely failure scene, and repair conditions; the auditor sees no sibling candidate.
- **Common artifacts:** Criticism becomes consequence-free cleverness, generic pessimism, or an attack from an irrelevant standard.
- **Escalate / stop:** Escalate when repair requires new evidence or reopening decomposition. Stop when each material failure has a disposition.
- **What it requires:** One strong agent per candidate; keep the result with any consequential decision it informs.
- **Execution placement:** **Fresh subagent required.** The auditor sees source positions, trace, and one candidate, but not sibling candidates or the orchestrator's preferred outcome. That separation is what makes the hostile check useful. Without a fresh context, downgrade to an author self-critique and state the capture risk. Return failure claims and repair conditions without deciding their importance inside the result.
