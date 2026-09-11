# Phase 2 red/green contract

Phase 1 remains unchanged. Start with tests importing the phase 1 checker as a baseline adapter where possible. A valid full order with deployed `text integer` must not pass merely because the PK matches. Full schema claims are narrowed to selected-column SQL types/nullability and a caller-declared local schema identity, not live deployment identity. A changed db/todo import remains unsupported.

Raw SQL and recognized Drizzle source must converge on ONE SQL checker. That checker must reject join duplication, dropped/aliased projected keys, expression order, unknown predicate grammar and mismatched parameter type/count. Adapters alone carry spans/repairs. A raw SQL total order and Drizzle total order should produce identical semantic result, with actual PG execution.

Real CLI findings support diagnostic delivery: check, hash-guarded apply, rerun clear; stale source refusal and moved order range. CLI accepts caller-owned fixture copies and uses a clearly labeled disposable PG schema. No silent certification of deployed context.

Failing tests precede phase 2 implementation; retain red/green output. No host advisors or extensions selected: catalog/schema checks, SQL checks, PL/pgSQL checking and workload advice are different inputs per the new survey.
