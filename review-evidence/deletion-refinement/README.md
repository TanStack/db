# Executable refinement evidence

The [audit](../../docs/contributing/oracle-reviews/2026-10-06-indexeddb-tla-refinement.md) maps the unchanged TLA+ models to production oracles and records every recovered loss. [validation.json](validation.json) identifies observed results, source hashes and replay commands.

`frozen/` contains the first candidate supplied to the two independent loss scanners; these historical test files are not production test registrations. The scanner reports are retained verbatim. `run_calibration.py` temporarily mutates production, runs the named receiving test, and restores every source in `finally`. Run it only in an idle checkout. All ten mutations caused assertion failures.

`receipts/` contains portable excerpts with full-log hashes. Calibration receipts omit skipped-test lines; the large original adapter RED receipt retains its beginning and ending. Full raw logs are retained locally alongside these files but are not all committed. The original formal checker logs remain in `../deletion-tla/results/`. The provider counterexample receipt records fake-indexeddb's premature native deletion; the final native-browser checks enforce the unchanged law in all three engines.
