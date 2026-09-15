"""Check catalog accounting and local artifact links, not semantic truth."""

import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import unquote

root = Path(__file__).resolve().parent
data = json.loads((root / "05-categorization-ledger.json").read_text())
survey = (root / "02-research-survey.md").read_bytes()
assert hashlib.sha256(survey).hexdigest() == data["sourceSurveySha256"]

sources = [
    ("02-research-survey.md", r"^\| (C\d+) \|", 20),
    ("audits/language.md", r"^- \*\*(L\d+[a-z]) —", 20),
    ("audits/queries.md", r"^- \*\*(Q\d+) —", 22),
    ("audits/protocol.md", r"^\| (P\d+[a-z]) —", 23),
]
expected = set()
for file, pattern, count in sources:
    ids = set(re.findall(pattern, (root / file).read_text(), re.MULTILINE))
    assert len(ids) == count, (file, len(ids), count)
    assert expected.isdisjoint(ids), (file, "overlapping source IDs")
    expected.update(ids)

rows = data["items"]
ids = [row["id"] for row in rows]
assert len(ids) == len(set(ids)), "Duplicate ledger IDs"
assert set(ids) == expected, {"missing": sorted(expected - set(ids)), "extra": sorted(set(ids) - expected)}
for row in rows:
    assert row["family"] in data["families"], row["id"]
    assert row["evidenceRole"] in data["evidenceRoles"], row["id"]
    assert row["routes"] and set(row["routes"]) <= data["routes"].keys(), row["id"]
    assert len(row["routes"]) == len(set(row["routes"])), row["id"]
    for field in ("claim", "current", "failure", "agent"):
        assert isinstance(row[field], str) and row[field].strip(), (row["id"], field)

assert Counter(route for row in rows for route in row["routes"]) == data["routeCounts"]
assert Counter(row["evidenceRole"] for row in rows) == data["evidenceRoleCounts"]
ledger = (root / "05-categorization-ledger.md").read_text()
assert re.findall(r"^### ((?:C\d+|L\d+[a-z]|Q\d+|P\d+[a-z])) —", ledger, re.MULTILINE) == [
    row["id"] for family in data["families"] for row in rows if row["family"] == family
]
for row in rows:
    for field in ("claim", "current", "failure", "agent"):
        assert row[field] in ledger, (row["id"], "Markdown drift", field)

overview = (root / "05-categorization.md").read_text()
for family in data["families"]:
    assert f'<a id="{family}"></a>' in overview, family

checked_links = 0
for file in [root / "README.md", *root.glob("05-*.md"), root / "06-frame-projection.md"]:
    text = file.read_text()
    for target in re.findall(r"\]\(([^)]+)\)", text):
        if re.match(r"[a-z]+://", target) or target.startswith("#"):
            continue
        target = unquote(target.split("#", 1)[0].strip("<>"))
        assert (file.parent / target).exists(), (file.name, target)
        checked_links += 1
    assert not re.search(r"[^\n\S]+$", text, re.MULTILINE), (file.name, "Trailing whitespace")

print(json.dumps({
    "source_entries": len(expected),
    "ledger_entries": len(rows),
    "families": len(data["families"]),
    "evidence_placement_counts": data["evidenceRoleCounts"],
    "local_links_checked": checked_links,
    "frozen_survey": "unchanged",
    "scope": "Structural accounting only; no source truth or runtime claims validated",
}, indent=2))
