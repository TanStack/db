# Completion profile successor: independent source acceptance

Accept the exact four-source profile successor in source and offline instrument
scope. It addresses the confirmed completion/progress verifier mismatch without
waiving provenance. This is not acceptance of a new combined packet or singleton
input, runtime admission, product RED/GREEN, or candidate-state credit.

- Source freeze: `512408885f77e90d3a8374452e044f0216a2f803ff97dfe31894dba7b66d02db`.
- Packet: `04315917d06fa4e674efce03fe222632265261aa9ebc5684294136999abfdfc2`.
- Author report: `00ae26b7e10ea4e665a55c84d230acc232df413d2eca38e99277e7174d3e26d9`.
- Independent checks: `profile-successor-source-independent-checks-v1.json`,
  SHA256 `980b361ac661b28f913286849f1eabb83fdda4cc8574a6e5dc2c2689d93799b8`.

The review read the exact diffs for the verifier, offline calibration, completion
supervisor, and operational parent, against frozen combined v2. All four live
sources, four frozen text copies, and nineteen packet record entries match.
Current 511 production files and 23 shared instruments match combined v2;
the 50-instrument map differs only in the four declared paths. Node, two locks,
four reuse links, and all 2,544 pinned payload files still match. No install or
dependency workaround was performed by this review.

## Corrected enforcement boundary

The verifier takes an explicit `completion-baseline-v1` profile and retains
`progress-v1` as the original caller default. Unknown selectors, absent or
duplicate worker starts, mismatched modes, and cross-profile identities reject.
The completion supervisor passes the constant selector and requires that same
selector in the verifier's returned bound result. The operational parent
requires `recipe.bindingProfile='completion-baseline-v1'` and returns the
constant in its captured invocation command. An old unmodified recipe cannot
silently select the new gate.

The completion profile statically requires seventeen receiving/common
instruments plus the three existing production entry sources, evaluated at
`evaluated-pre-history.json`. The list exactly matches the independently
inspected twenty relevant bindings from the failed actual run. This is an
expected-path list established independently from the receiver's source roles;
it is not discovered from whichever modules a future invocation happens to
load. The completion entry awaits its driver import before sealing, so the
pre-history evaluation requirement is suitable for this exact receiver. It is
an operational fixture premise and creates no general product requirement
about module evaluation.

Five inspected verifier sections are byte-identical to combined v2:

- Frozen source, dependency payload, and Node checks.
- Startup seal and inspector acknowledgement checks.
- The complete loop that binds every observed approved module through original
  bytes, retained loader bytes, actual V8 body, and sealed script identity.
- Query key, prefix, and warning checks.
- The original progress source-stack check.

The progress required module list and driver-start cut remain; its required
modules may still finish evaluation at a later sealed inventory cut. Completion
does not invent the old progress callbacks or import obsolete progress modules.
Every observed approved module still undergoes the common provenance checks,
including modules at later cuts. The completion startup list is an additional
required path check.

## Instrument evidence

The retained unchanged verifier snapshot matches combined v2. Author
`red-v3.log` contains exactly the six observed original failure strings when
the new authored completion fixture is checked by that unchanged verifier.
The earlier red-v1/v2 fixture reconstruction failures remain preserved and are
not credited as sensitivity evidence.

This reviewer independently ran the source-inspected offline calibration with
pinned Node and no package-manager wrapper:

```text
/Users/kyle.mathews/.n/bin/node --max-old-space-size=384 --test --test-concurrency=1 scripts/h02-progress/bindings-calibration.test.mjs
```

Actual completion tool return `928fab` is exit 0. Initial session `25863` was
not mistaken for completion. The log reports 87 passed, zero failed, zero
skipped: 83 authored verifier cases (6 allowed, 77 rejected) and four actual
pure recipe-validator cases (one allowed, three rejected). The independent
83-case names, statuses, and exit codes match the author's final run.

Each required completion startup module is independently removed once and
marked unevaluated at startup despite later evaluation once. Other controls
exercise selector/mode/cross-profile failures, missing cut/seal/code witnesses,
wrong original/loader/V8 bytes, and first-seen-later bindings. The original
progress default and its later-evaluation control pass. The tests execute the
actual offline verifier and actual import-safe recipe validator. Authored fake
source bytes are never imported or evaluated as product modules; no receiver,
native product import, generated history, or process probe ran. Slot 2 was
released after actual completion to the input coordinator.

The author retains a failed `pnpm lint:changed` wrapper whose automatic install
attempt aborted before module removal, and a passing direct pinned feedback
check. This review did not rerun the wrapper. The independent post-check
Node/lock/link/payload hashes match; the failed wrapper is not claimed as a
passing check. Root separately reported its report-lint completion exit 0.

## Historical input archive and remaining gates

Root explicitly relocated eight historical compiler outputs to exact-byte
`.txt` archive evidence so lint does not classify them as authored JavaScript.
The original 45-file/46-entry manifests are unchanged. The direct eight old
paths are superseded, not silently claimed present. This review read and ran
the explicit Python stdlib read/hash resolver, with no imports or execution of
the archived outputs:

- Archive map: `06c0f44a6f0d348bc80c1d5ba27fbf66ceab1ef9b8546b41c3456a5c16f244b9`.
- Resolver: `837e9572f5191fab7714eb154a02c7aefdf57cb35211c31a2204ffdcc383b847`.
- Independent resolution result:
  `historical-input-v1-archive-resolution-independent-v1.json`, SHA256
  `ab93a37ef2a7ca943dda9e4c62cd58648d786f0f8d621b4a2c56c4a998c4886f`.

All 45 historical freeze files and 46 packet entries resolve with their old
hashes; exactly eight resolve through the archive, and all eight superseded
old paths are absent. The archived bytes are preservation evidence and are not
runtime import targets. The archive map's initial copy-only stage is historical;
root's separate relocation receipt records its later authorized removal step.
The unchanged failed-run freeze still hashes to
`cfd7d4c32192a39d315c7318bc599aeeedc167f4f729cd919ab23a17257b572c`.

The next gate is a new combined source freeze and exactly one new
`inline-park-root` input recipe/output leaf. The program may retain its existing
bytes, but the recipe must pin the new profile and source freeze. Independently
review that exact composition and invocation before root admission. Do not
reuse the old failed output or interpret its native worker pass as product
evidence. The successor's actual receiver/provenance path remains unexecuted.

All twenty candidate states remain UNREACHED. State14 mapping remains proposed.
The actual-helper/no-active-operation neighbor and separate metadata obligations
remain open. No numeric product deadline or containment limit was changed.
