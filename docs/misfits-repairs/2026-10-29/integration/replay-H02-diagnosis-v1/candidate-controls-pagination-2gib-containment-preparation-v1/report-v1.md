# Two-GiB operational successor preparation

Prepared only. The first cf550f run and its resource-limited result remain
unchanged. No test, collection, config/supervisor import, process probe,
installation, source/oracle edit or next runtime occurred.

`supervisor-2gib.py` is an additive byte copy of the accepted native-list
supervisor, with only two integer substitutions from `1073741824` to
`2147483648` and its one diagnostic changed from `1 GiB` to `2 GiB`.
`supervisor-threshold-only-v1.patch` preserves the exact diff. Every other
byte, including the 30-second deadline and process-control paths, is identical.
The copied original main entry point is not a proposed command; a future
hash-bound exact-one wrapper will import only its definitions and reuse
`run_one` as before.

Pure check `e12a22`, exit 0, verifies the exact byte substitution, parses the
source AST, and evaluates the actual RSS predicate at zero, the old limit,
old-limit+1, and new-limit−1/equal/+1, plus 3 GiB. Exactly 2 GiB is allowed;
2 GiB+1 is rejected. Restoring the old threshold rejects old-limit+1. These
are instrument allowance checks, not product-mutant or native calibration.

The actual deadline remains 30 seconds; sampling remains about 80 ms, process
inventory 1 second, and the existing reap/descendant cleanup bounds 3 seconds.
Initial actual PGID verification, conditional owned-group signalling, durable
raw logs/report/receipts and final inventory are unchanged. Sampled RSS is an
operational limit, not an instantaneous quota or product law. A resource cutoff
still supplies no product RED/GREEN. No oracle/run budget is changed.

`operational-successor-design-v1.json` records the minimal future recipe
changes. The author is preparing the shared full-child source successor.
Its exact source freeze, source counts, command and fresh output must be bound
before a launcher can be reviewed or admitted. The old cf550f recipe must not
rerun. Ordinary coverage/typecheck/setup and source assertions stay enabled.
The prior finite dependency identity map and its limits will be reused; no
dependency census was broadened.

Successor supervisor SHA256:
`dbc0406d2118f5ad4ca93908d974b829b6bf3370015d27162c329fae323eb042`.
Actual future launch needs separate root admission and elevation on that
launcher. Child nonzero remains outer nonzero; the actual tool return must be
recorded separately. Runtime source binding remains pending the author's new
epoch; this packet authorizes no execution or progression.
