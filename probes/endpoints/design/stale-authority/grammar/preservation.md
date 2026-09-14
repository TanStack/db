# Provisional preservation contract

Exploratory extraction of the proposed Endpoints authority-admission and transaction-retirement protocol. This is not an exact-equivalence run or a claim that every consequential property has been confirmed. The user's existing explicit requirements supply the preservation target; the counter protocol is still a candidate.

| ID | Required distinction or property | Basis |
| --- | --- | --- |
| P1 | Bare writable collections; actions return actual Transactions synchronously; writes remain immediately dispatched | User, source S1/S3 |
| P2 | Retained means every affected non-GCed instance, including zero-subscriber instances; creation, GC and recreation must remain visible | User; S1/S3 |
| P3 | Confirmed baseline, guessed whole-row snapshots, handler outcome and coherence error are distinct | User; S1/S4 |
| P4 | Server execution order, handler completion, response delivery, read observation, admission, publication and retirement are separate events | S1; analyst formalization |
| P5 | A read may retire a guess only with coverage of the relevant completed effects; freshness is not arrival order | S1; analyst formalization |
| P6 | Settlement of one mutation cannot erase a still-owned sibling overlay or rewrite its validated whole-row snapshot | User; existing DB boundary |
| P7 | Unknown effects select conservative retained reads; possible, actual and optimistic recipients remain separate, including multi-table dependencies | User; earlier grammar |
| P8 | Isolated inline reconciliation remains a candidate fast path; overlap invalidates unsupported freshness assumptions | Source S1 |
| P9 | Query/argument/auth scope and collection lifetime identify the target; ordinary/initial reads obey admission too | S1/S4; analyst scope formalization |
| P10 | Handler failure may follow commits; retry reads only; missing response does not establish no effects or a finished handler | User; S4; analyst transport distinction |
| P11 | Preserve safety versus liveness, causal catch-up versus wall-clock freshness, and snapshot installation versus atomic visibility | S1/S5; analyst distinctions |
| P12 | Optimizations require separate proof and measurement; bounded grammar/model execution is not implementation or independent range evidence | User; S5 |
