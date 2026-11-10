# Exact fixed-seed report-title correction

This source-only component changes one recipe field: `expectedOutput.title`.
It appends the exact suffix ` (with seed=1665)`. The CLI selector stays at the
authored base title. The original wrapper, strict executed singleton check,
ancestor comparison, result status and exit propagation do not change.

This packet supplies no executable launcher or runtime admission. Its recipe
copy deliberately retains the historical output path so that the patch has
exactly one changed field. That output has already been consumed. A future
operational packet needs an explicit fresh output/source binding, independent
review and separate ROOT admission.

## Authority and distinguishing predictions

The suffix comes from the hash-bound installed `@fast-check/vitest` 0.4.1
source, rather than from fitting the observed report. Its
`lib/vitest-fast-check.js` line 52 registers the label followed by
` (with seed=${customParams.seed})`. Lines 43–48 retain an explicitly supplied
seed before considering global or generated seeds. The installed source SHA256
is `d5316907da518e2069b98184962610045845f22683a36b1264ca3cfabf5cbc8d`.

The Q-bound authored property supplies seed 1665 at line 5554 and constructs its
fixed label at line 5585. `title-derivation-v1.json` binds that authored source,
the Q freeze, installed package metadata and installed title source. Only those
two installed package files were rehashed. No dependency census was added.

The original recipe predicts that the undecorated title occurs once in the
report. The installed runner predicts the exact seed-decorated title. The frozen
raw JSON distinguishes those accounts: the first has zero matches, while the
second has one executed assertion with the required ancestors. A nearby seed,
different ancestry, absent selection or second executed assertion must reject.

## Pure calibration

`calibrate-title-capture.py` parses the frozen wrapper's AST and compiles only
its unchanged `digest`, `require`, `read_json` and `capture_report` definitions.
It does not import the launcher, supervisor, installed runner, config or tests.
Every case uses that same capture function, including its regular-file,
bounded-size, stable-read, exact title, global singleton and ancestry checks.

The original report is read directly. Corruptions are deep copies serialized to
one temporary regular file, removed after calibration. The calibration requires
each rejection to occur at its intended identity comparison. A filesystem or
JSON setup failure cannot count as a successful rejection.

The final pure run, actual tool `efa5b3`, exited 0 in 0.724 seconds:

| Input and recipe | Result |
| --- | --- |
| Original raw report and original recipe | Rejected at the executed-selection comparison |
| Original raw report and exact title successor | Captured the selected **failed** assertion |
| Report title changed to seed 1666 | Rejected at the executed-selection comparison |
| Selected assertion given an extra ancestor | Rejected at the ancestry comparison |
| Selected assertion removed | Rejected at the executed-selection comparison |
| A second executed assertion added | Rejected at the executed-selection comparison |

The successful capture returns `selectedStatus: failed`, `reportSuccess: false`
and `productVerdict: UNCLASSIFIED`. It does not convert the failed assertion or
nonzero child outcome into a product GREEN. No fuzzy title matching, status
coercion, expected-failure normalization or new schema/module guard is added.

## Evidence and preservation

- **Instrument promise and authority:** Capture exactly the authored fixed-seed
  assertion under the pinned installed runner's title encoding. This is report
  identity, not a revision of a product law or oracle answer.
- **Reach:** The frozen report contains one non-skipped executed assertion with
  the exact decorated title and required ancestors. This is a bounded report
  input witness, not additional generated-history or production-path reach.
- **RED:** The unchanged original qualifier rejects that original report at
  its executed-selection comparison.
- **Instrument calibration pass:** The title-only successor captures the same
  failed assertion through the unchanged function. Product status stays failed.
- **Mutants:** All four corruptions above reject at their intended identity or
  ancestry check.
- **Limits:** The evidence covers this exact pinned fixed-seed title encoding
  and these report corruptions. It does not establish general report schema,
  status or module hardening, a future native run, another seed source or runner
  version, receiving behavior, campaign completion, reach totals or class closure.

All ten original N packet members and sixteen frozen actual-run members were
rehashed after calibration and remain unchanged. The historical wrapper
failure, null report field, report-capture secondary, actual outer exit 1 and
child exit 1 remain in their original files. The historical cleanup record's
already-absent SIGKILL attempt also remains unchanged.

ROOT's separate primary classification and the independent actual review remain
the product-evidence authorities. This instrument correction adds no product
repair, GREEN, replay, receiving, candidate, PR or canonical-import credit.

The oracle authoring and review skills, full rubric and glossary, and the
pagination coverage entry were read before this correction. ORC-006 sensitivity
and ORC-010 preservation guide this instrument calibration. Product law, model,
history grammar, production driver and refinement comparison remain unchanged;
no new product-oracle or coverage-map claim is made.

The packet awaits independent source review. No target run, native probe,
wide source/tool audit, package installation, discovery, config import, Git or
pnpm command occurred. Any required repository lint qualification remains with
ROOT's coordinated validation slot.
