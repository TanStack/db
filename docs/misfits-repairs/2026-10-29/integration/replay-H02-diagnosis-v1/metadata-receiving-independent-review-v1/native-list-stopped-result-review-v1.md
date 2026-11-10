# Stopped native list: independent result review

Reviewer: `replay_covering_authority`. Method: read/hash review of root's completed, frozen native result and installed naming source. No reviewer native command, process probe, rerun, config/test-body import, or receiving follow-up ran.

**Verdict:** preserve the original **child exit 0 / actual outer tool exit 1 / STOPPED** result. The first list collected four raw native display names from the expected module. Qualification failed because V2's expected display strings omitted the suite separator. The other five commands never ran. No singleton filter, negative filter, receiving path, metadata law, or product result is validated by this stopped batch.

## Exact evidence

- Root admission: `43d87af72e048c0469730246753a027668a05b7b65c93b23406fe00ae1fedce8`.
- Stopped freeze: `1c47fe8e1526411ac238b86d91ba844aea5ec9237af39b64a55886a08e0872d8`.
- Raw all-four JSON: `d980e5c4be37058eaca1ebe32cfff6c818da2edbac5fe3daf1dc25d03e3cc863`.
- Actual root tool-return record: `2dee69f89f8c46f9224b02971c36c79ab29148b08214d4259a6f5e4077b11a58`.
- Root's original PID/PGID absence record: `ab5d70395ad957defa8f262715d31a59bd62d49ead85031db275827867699a27`.

All are under the metadata worktree's `docs/`. Runtime files remain in `misfits-metadata-receiving-native-list-v2/`. Independently checked all 10 frozen runtime files, their exact file set, three root records, and all 573 active frozen source files. See `native-list-stopped-independent-verification-v1.json` beside this report.

The child recorded seven samples, 296,828,928 bytes maximum sampled group RSS, exit 0, empty stderr/stdout, no kill attempts, no remaining original PID/group rows, and no secondary failure. Its primary failure is exactly `wrong native list names`. The outer stopped after that one result. Root separately observed actual tool exit 1 and recorded ESRCH for original outer PID/PGID 42883 and original child PID/PGID 42939. These are root-observed records; this reviewer did not repeat the probes.

## F2 — list display names and filter names are different representations

Actual native JSON includes:

```text
queued-answer metadata receiving > checks metadata 'scope' 'default'
```

The other three entries use the same ` > ` separator and the remaining cache/key cells. V2 expected the string with a plain space between suite and test instead. This is a preparation expectation defect, not a metadata/product defect or containment failure.

The exact installed source has two different paths:

1. **Display:** `cli-api.B0Pz1_R7.js` lines 14719–14734 serializes the reported `test.fullName`. Its `TestCase.fullName` getter, lines 11682–11686, concatenates reported parent suites and test with ` > `. The matching suite getter at lines 11890–11894 uses the same representation. This source explains the observed JSON.
2. **Filter:** `@vitest/runner/dist/chunk-artifact.js` lines 964–966 applies the pattern to `getTaskFullName(t)`. That helper, lines 1006–1008, recursively concatenates raw suite/test names with a plain space. The formatter supplies single quotes inside the individual test title, as F1 already established.

These installed files retain the frozen hashes `222aa60f8555aea9311703c68edaaa8eba0888ea29bfb4a49b37f98e0811ee2d` and `bf6af6d2f4469911879a67e83b8f9e7b20332cf42795032c53457b10ccc1c617`, respectively. The first is the list serializer/reported-name file; the second is the runner/filter file.

Therefore a successor should add ` > ` to expected **list display names**, while keeping the quoted, space-joined **filter anchors** as source predictions until native singleton collection actually validates them. Replacing both representations with the display string would introduce another zero-selection risk. Name the representations explicitly in recipe prose/data so a field called only `fullName` cannot hide this distinction.

## Why the previous review and pure checks missed it

My V2 source review traced quoted property formatting and the serializer's access to `test.fullName`, but did not follow that reported-name getter. It incorrectly treated the matcher's space-joined name as the serializer's display name. The pure recipe checks and launcher fakes generated their expected results from the same mistaken recipe strings, so they reproduced the expectation instead of challenging its native representation. They proved wrapper rejection/stop behavior; they did not independently establish native names. This result corrects that specific premise in the earlier V2/launcher preparation reviews without changing their preserved historical artifacts.

The smallest general improvement is to keep display and matcher naming separate, bind expected display strings to the reported getter plus the preserved actual all-four list, and retain the all-four/singleton/negative native calibration sequence. Pure controls should include correct display output and deliberately conflated space-only output while preserving the filter text separately. Root must separately admit any corrected successor; no runtime or recipe edit is authorized by this review.

The launcher correctly rejected the unexpected names and prevented commands 2–6. Preserve the stopped raw evidence rather than rewriting it to success. The raw four-entry universe is factual native collection evidence; operational batch qualification and singleton matching remain incomplete. All receiving and product obligations remain open.
