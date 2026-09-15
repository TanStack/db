"""Validate this design packet's accounting; this is not an engine oracle."""

import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import unquote

root = Path(__file__).resolve().parent
worksheet = json.loads((root / "04-guide-word-worksheet.json").read_text())
candidate_hash = hashlib.sha256((root / worksheet["candidate"]).read_bytes()).hexdigest()
assert candidate_hash == worksheet["candidateSha256"], "Worksheet candidate changed"
assert worksheet["status"] == "prepared-not-completed"
words = ["No", "More", "Less", "Part of", "As well as", "Reverse", "Other than"]
assert worksheet["words"] == words
rows = worksheet["rows"]
assert len(rows) == 112
assert len({row["id"] for row in rows}) == len(rows)
pairs = {(row["node"], row["parameter"]) for row in rows}
assert len(pairs) == 16
assert {node for node, _ in pairs} == {f"N{i}" for i in range(1, 9)}
assert Counter(node for node, _ in pairs) == {f"N{i}": 2 for i in range(1, 9)}
for node, parameter in pairs:
    selected = [row for row in rows if (row["node"], row["parameter"]) == (node, parameter)]
    assert [row["guideWord"] for row in selected] == words
for row in rows:
    assert row["status"] == "pending-content-review"
    for field in ("credibility", "causes", "consequences", "safeguards", "controlFailure", "warningSigns", "action", "owner", "dueDate", "completionEvidence", "residualGap"):
        assert row[field] is None, (row["id"], "Unreviewed field populated", field)
    assert row["candidateQuestion"].endswith("?"), row["id"]
rendered = (root / "04-guide-word-worksheet.md").read_text()
for row in rows:
    assert rendered.count(f'| {row["id"]} |') == 1
    assert row["candidateQuestion"] in rendered

audit = (root / "05-hostile-assay.md").read_text()
assert candidate_hash in audit, "Hostile audit used a different candidate"
hostile_ids = set(re.findall(r"\bH(\d+)\s+[—–]", audit))
assert hostile_ids == {str(i) for i in range(1, 13)}
ground_ids = re.findall(r"^\| (G\d+) \|", (root / "01-ground-condition.md").read_text(), re.MULTILINE)
assert ground_ids == [f"G{i}" for i in range(1, 9)]
fracture_ids = re.findall(r"^## (F\d+) —", (root / "02-fracture-scan.md").read_text(), re.MULTILINE)
assert fracture_ids == [f"F{i}" for i in range(1, 4)]
followup = (root / "07-authority-challenge.md").read_text()
assert candidate_hash in followup
assert hashlib.sha256((root / "05-hostile-assay.md").read_bytes()).hexdigest() in followup
authority_ids = re.findall(r"^### (A\d+) —", followup, re.MULTILINE)
assert authority_ids == [f"A{i}" for i in range(1, 5)]

links = 0
for path in root.glob("*.md"):
    text = path.read_text()
    assert not re.search(r"[^\n\S]+$", text, re.MULTILINE), path.name
    for target in re.findall(r"\]\(([^)]+)\)", text):
        if re.match(r"[a-z]+://", target) or target.startswith("#"):
            continue
        target = unquote(target.split("#", 1)[0].strip("<>"))
        assert (path.parent / target).exists(), (path.name, target)
        links += 1

print(json.dumps({
    "candidate_sha256": candidate_hash,
    "ground_pairs": len(ground_ids),
    "fracture_candidates": len(fracture_ids),
    "hostile_findings_with_dispositions": len(hostile_ids),
    "authority_challenges": len(authority_ids),
    "guide_word_pairs": len(rows),
    "guide_word_status": worksheet["status"],
    "local_links_checked": links,
    "validation_scope": "Artifact structure and frozen inputs; not semantic truth, production behavior or reviewed sweep findings",
}, indent=2))
