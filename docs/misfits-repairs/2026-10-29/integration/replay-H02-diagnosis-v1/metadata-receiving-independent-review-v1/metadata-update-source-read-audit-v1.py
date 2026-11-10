"""Read/hash audit only. Imports no project runtime and changes no source."""
import hashlib
import json
from pathlib import Path

review = Path(__file__).resolve().parent
prepared = review.parent / "metadata-update-source-v1"
source = prepared / "sources"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(name):
    return json.loads((prepared / name).read_text())


freeze = read("source-freeze.json")
assert sha(prepared / "source-freeze.json") == "048170249ec3e679d289bf69c9358fc7b0ac1074d9384b06b19caa868b3ec1c0"
assert sha(prepared / "source-inventory.json") == freeze["sourceInventorySha256"]
assert sha(prepared / "changed-members.json") == freeze["changedMembersSha256"]
inventory = read("source-inventory.json")
assert len(inventory) == 588
for relative, digest in inventory.items():
    assert sha(source / relative) == digest, relative

parent_path = Path(freeze["parentSourceFreeze"])
assert sha(parent_path) == freeze["parentSourceFreezeSha256"]
parent = json.loads(parent_path.read_text())
old_source = Path(parent["worktree"])
parent_members = {}
for section in ("productionFiles", "instrumentFiles", "sharedInstrumentFiles"):
    parent_members.update(parent[section])
assert len(parent_members) == 573
for relative, digest in parent_members.items():
    assert sha(old_source / relative) == digest, relative

actual_deltas = {
    relative: {"before": digest, "after": inventory[relative]}
    for relative, digest in parent_members.items()
    if digest != inventory[relative]
}
assert actual_deltas == read("changed-members.json")
assert len(actual_deltas) == 5
assert len(freeze["productionFiles"]) == 511
assert freeze["productionFiles"] == parent["productionFiles"]
for relative, digest in freeze["productionFiles"].items():
    assert inventory[relative] == digest, relative

additional = read("additional-support.json")
assert len(additional) == 15
assert set(inventory) - set(parent_members) == set(additional)
for relative, digest in additional.items():
    assert inventory[relative] == digest, relative

dependency_count = 0
for name, package in freeze["packages"].items():
    package_root = Path(package["resolved"])
    assert (source / package["logical"]).resolve() == package_root, name
    assert sha(package_root / "package.json") == package["packageJsonSha256"], name
    payloads = package["regularPayloadFilesMap"]
    assert len(payloads) == package["regularPayloadFiles"], name
    for relative, digest in payloads.items():
        assert sha(package_root / relative) == digest, (name, relative)
        dependency_count += 1
assert dependency_count == 2544
for relative, link in freeze["dependencyReuseLinks"].items():
    path = source / relative
    assert path.is_symlink() == link["isSymlink"], relative
    assert str(path.resolve()) == link["resolved"], relative
assert sha(Path(freeze["node"]["executable"])) == freeze["node"]["sha256"]

result = {
    "status": "read/hash only; no project runtime imported or native command executed",
    "sourceFreezeSha256": sha(prepared / "source-freeze.json"),
    "sourceInventorySha256": sha(prepared / "source-inventory.json"),
    "allSuccessorInventoryMembersMatch": len(inventory),
    "allOriginalFrozenMembersStillMatch": len(parent_members),
    "unchangedProductionMembers": len(freeze["productionFiles"]),
    "exactChangedOldMembers": actual_deltas,
    "additionalUnchangedSupportMembers": len(additional),
    "namedOwnPackagePayloadsMatch": dependency_count,
    "dependencyReuseLinksMatch": len(freeze["dependencyReuseLinks"]),
    "nodeExecutableHashMatches": True,
    "artifactHashes": {
        name: sha(prepared / name)
        for name in (
            "source-delta.patch", "pure-controls.mjs", "pure-results.json",
            "static-results.json", "typecheck-final.log", "eslint-final.log",
            "format-final.log", "pure-final.log",
        )
    },
    "limits": "Named source/dependency byte equality only; no transitive/native/host equivalence, actual registration, receiving reach or mutant result.",
}
output = review / "metadata-update-source-read-audit-v1.json"
output.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n")
print(json.dumps(result, sort_keys=True, indent=2))
