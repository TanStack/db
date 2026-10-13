---
'@tanstack/db': patch
---

Keep `undefined` in the configured nulls-first position when BasicIndex builds from existing rows. Preserve indexed key ownership and public query order across mixed and prefixed values. Make Duration equality follow its fields; order indexed ZonedDateTimes by instant, PlainDates by calendar, and time-only Durations by elapsed time; and preserve required errors for mixed or unordered Temporal values. Keep custom index callback inputs consistent across index types and ignore a manual index whose order conflicts with a limited public read.
