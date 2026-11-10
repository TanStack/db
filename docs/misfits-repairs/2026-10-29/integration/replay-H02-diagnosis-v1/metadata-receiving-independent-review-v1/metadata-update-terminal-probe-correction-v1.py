"""Preserve the first probe and make a corrected bounded pure successor."""
import hashlib
import json
from pathlib import Path

review = Path(__file__).resolve().parent
old_line = "const omittedStage = good.filter((r) => !r.phase.startsWith('followup-') && r.phase !== 'acquisition-accepted')"
new_lines = """const omittedStage = structuredClone(good)
    const start = omittedStage.findIndex((r) => r.phase === 'followup-start')
    const end = omittedStage.findIndex((r) => r.phase === 'followup-publication')
    omittedStage.splice(start, end - start + 1)"""

preserved = {}
for version in (1, 2):
    before = review / f"metadata-update-terminal-probe-v{version}.mjs"
    text = before.read_text()
    assert text.count(old_line) == 1
    preserved[before.name] = hashlib.sha256(before.read_bytes()).hexdigest()
    text = text.replace(old_line, new_lines)
    text = text.replace(
        f"metadata-update-terminal-probe-v{version}.json",
        f"metadata-update-terminal-probe-fixed-v{version}.json",
    )
    with (review / f"metadata-update-terminal-probe-fixed-v{version}.mjs").open("x") as file:
        file.write(text)

record = {
    "classification": "first probe fixture error; no product or receiving verdict",
    "firstV1ExitCode": 1,
    "firstV1Assertion": "4 !== 0",
    "reason": "Phase-prefix filtering removed followup-start but left positive public-change callbacks, so four cases failed on an earlier rank mismatch instead of demonstrating missing terminal enforcement.",
    "firstV2ExitCode": 0,
    "firstV2Limit": "Same four malformed whole-stage cases were rejected at the wrong cut; use only the separately corrected successor for the whole-stage sensitivity claim.",
    "preservedScripts": preserved,
    "repair": "Remove the complete contiguous followup-start through followup-publication interval, including actual callback receipts.",
}
with (review / "metadata-update-terminal-probe-first-attempt-v1.json").open("x") as file:
    file.write(json.dumps(record, sort_keys=True, indent=2) + "\n")
