# Second Design Grammar: source and preservation preview

Exploratory run, 2026-09-11. This is a **provisional** preservation list derived from the user's explicit constraints and the fixed source. It is not an exact-equivalence certification. The previous grammar remains a historical result; this is a new run.

**Target:** A language of possible Endpoints implementations that propagates supported optimism across active collections and plans authoritative updates, with bounded analysis, conservative exits, and independently optional optimizations for recipient selection, update derivation, shared SQL evaluation, and shared response encoding.

**Grounded system:** Current Endpoints prototype and its attached source trace, oracle receipt, and result-sharing experiment. The [source freeze](./source-freeze.json) pins those inputs. The previous research survey supplies context only; no additional donor system is extracted.

| ID | Property to retain | Authority |
| --- | --- | --- |
| P1 | Bare writable collection handles bound through `endpoints(dbClient)`; actions return Transactions synchronously; supported optimism is immediate | User-required and current source surface |
| P2 | Client/scope/source identity remains sound, query arguments stay validated, and server implementation code does not cross into the client | User-required; prototype checks only its narrow fixture |
| P3 | Tentative intent, accepted writes, authoritative query observations, and synchronization failure remain distinct; an unseen server decision is not presumed predictable | User correction and analytical boundary; unsupported-optimism policy unresolved |
| P4 | Correctness checks include every active collection independently of a strategy's selected recipients; order and membership both count | User-required; narrow oracle source |
| P5 | Query read dependencies, mutation prediction inputs, predicted writes, and actual direct/indirect writes are distinct; absence and unchanged join partners can matter | Multi-table probe, analyst-derived preservation requirement |
| P6 | Missing analysis is explicit and cannot authorize a dependent optimization or prove no effect; established facts have bounded scope and assumptions | User-required; generalized evidence representation is proposed |
| P7 | Authoritative baseline reruns potentially affected queries and returns full results with the mutation; excluding queries needs adequate impact evidence | User-selected fallback; client refetch remains historical source behavior, not the desired normal fallback |
| P8 | Each response retains its result domain, projection, key/multiplicity, membership, and order; sharing cannot erase another result's ownership | Source snapshot contract, prior controls, measured shared-result fixture |
| P9 | No implicit mutation queue; reconciliation must still identify the correct observation and pending effects without inventing cross-query atomicity | User-required; precise concurrency/publication contract unresolved |
| P10 | Declaration, argument/scope instance, current demand, retained cache, and pending-operation lifetime remain distinguishable | User activity question and public subscriber signals; policy unresolved |
| P11 | Exhausted reads may surface an error; a committed write is not undone by reporting read failure | User correction; retained rows and recovery policy unresolved |
| P12 | Correct/safe transformations and profitable ones are different; measured work, bytes, and latency use full-result baselines and retain experimental limits | User performance aim and executed result-sharing experiment |

The source's known propagation gap must be reconstructed, not preserved as a desired behavior. No claim is made that this provisional list exhausts every consequential property. No candidate architecture is selected by the run.
