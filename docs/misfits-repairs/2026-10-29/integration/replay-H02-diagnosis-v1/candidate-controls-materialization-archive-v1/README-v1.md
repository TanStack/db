# Exact constructor emit archive

These eight `.txt` snapshots retain the exact bytes of the closed constructor emit evidence from input v1. They are inspection artifacts. The actual historical constructor imported executable modules under `/private/tmp`, as recorded in the archive map.

`archive-map-v1.json` binds each original path to its text archive path, byte size and unchanged SHA256. `resolve-historical-input-v1.py` verifies every historical input-freeze and packet key using this explicit mapping, without changing either manifest. Its output can be retained as an additive resolver receipt. Original paths remain present at this copy-only stage. Root must independently verify preservation before any exact old-path removal. After removal, direct historical path resolution is superseded by this map; the original manifest bytes stay unchanged.

The failed first native result, all sixteen recipes and programs, and combined-v2 remain unchanged. No compiler, constructor, model, history, native process, product mutant, canonical import, or budget/rule/ignore change was performed. All raw20 states remain UNREACHED; State14 remains proposed.
