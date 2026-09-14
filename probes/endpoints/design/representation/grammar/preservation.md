# Provisional exploratory preservation contract

Source: the current Endpoints probe as inspected in the representation survey, bounded by the user's explicit corrections. Target: the representation linking authored reads, guessed row effects, retained collections and authoritative result delivery. This is exploratory, not exact equivalence; the source has known missing behavior.

P1 (user): Bare writable query collections; synchronous Transaction-returning actions.
P2 (user): Every affected non-GCed collection participates, regardless of subscribers.
P3 (user/source): Guesses use existing transaction overlays; actual server branches may differ.
P4 (source): Preserve whole-row snapshot and transaction retirement semantics; no preload in mutationFn.
P5 (user): Unknown analysis cannot prove non-impact. Inline full-result fallback remains.
P6 (source/inference): Query identity includes client scope and arguments; no untrusted SQL execution.
P7 (user): No implicit mutation queue; no server code in client artifacts.
P8 (user/source): Effects may span tables and reads; returned target rows are not complete-effects proof.
P9 (user): Safety and benefit are separate, independently per shortcut.
P10 (source/inference): Late creation/GC, pending sibling overlays, read errors and publication order require explicit boundaries; do not erase them through decomposition.
P11 (user/source): SQL truth, result keys, ordering and support completeness constrain local guesses.
P12 (evidence): No production speed claim or independent range claim follows from local examples.
