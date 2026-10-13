---
'@tanstack/db': patch
---

Keep `undefined` in the configured nulls-first position when BasicIndex builds from existing rows. Preserve indexed key ownership and public string order across mixed and prefixed values. Make Duration equality follow its fields, order indexed ZonedDateTimes by instant and time-only Durations by elapsed time, and ignore a manual index whose order conflicts with a limited public read.
