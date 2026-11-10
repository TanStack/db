"""Read/hash/JSON review of complete actual fresh discovery; no process APIs."""
from pathlib import Path
import hashlib
import json
import stat

HERE = Path(__file__).resolve().parent
H = HERE.parent
OUT = H / "metadata-update-native-discovery-v2"
PREP = H / "metadata-update-native-preparation-v2"
FREEZE = "da91882f1c06b924a8956be32d668d74ac9268dee9b78916821407e861573c5e"
inputs = {}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def record(path, expected=None):
    actual = digest(path)
    assert expected is None or actual == expected, str(path)
    inputs[str(path)] = actual
    return actual


def read(path):
    return json.loads(path.read_text())


def assets(freeze, expected_count):
    out = Path(freeze["outputDirectory"])
    assert len(freeze["assets"]) == expected_count
    assert {p.name for p in out.iterdir()} == set(freeze["assets"])
    for name, expected in freeze["assets"].items():
        assert Path(name).name == name
        path = out / name
        assert stat.S_ISREG(path.lstat().st_mode) and path.stat().st_nlink == 1
        record(path, expected)
        assert len(path.read_bytes()) == freeze["assetBytes"][name]


freeze_path = H / "metadata-update-native-discovery-result-freeze-v2.json"
record(freeze_path, FREEZE)
freeze = read(freeze_path)
assert freeze["outputDirectory"] == str(OUT)
assets(freeze, 9)
bound_paths = {
    "actualOuterReturnSha256": H / "metadata-update-native-discovery-root-outer-return-v2.json",
    "rootAbsenceSha256": H / "metadata-update-native-discovery-root-absence-v2.json",
    "sourceRecheckSha256": H / "metadata-update-native-discovery-source-recheck-v2.json",
    "rootAdmissionSha256": PREP / "root-fresh-universe-admission-v1.json",
    "bindingSha256": PREP / "binding.json",
    "preparationManifestSha256": PREP / "packet-manifest.json",
    "independentPreparationReviewSha256": HERE / "metadata-native-preparation-review-v2.md",
    "sourceFreezeSha256": H / "metadata-update-source-v2/source-freeze.json",
    "priorStoppedClassificationSha256": H / "metadata-update-native-discovery-root-stopped-classification-v1.json",
    "priorStoppedResultFreezeSha256": H / "metadata-update-native-discovery-result-freeze-v1.json",
}
for key, path in bound_paths.items():
    record(path, freeze[key])
manifest = read(bound_paths["preparationManifestSha256"])
for name, item in manifest["artifacts"].items():
    record(PREP / name, item["sha256"])
    assert len((PREP / name).read_bytes()) == item["bytes"]
old_freeze = read(bound_paths["priorStoppedResultFreezeSha256"])
assets(old_freeze, 10)
old_stopped = read(bound_paths["priorStoppedClassificationSha256"])
assert old_stopped["classifiedBy"] == "/root" and old_stopped["boundedAccepted"] is False
assert old_stopped["actualOuterExitCode"] == 1 and old_stopped["nativeChildExitCode"] == 0
assert old_stopped["newRuntimeAdmitted"] is False
for item in [old_stopped["resultFreeze"], old_stopped["independentActualReview"]]:
    record(Path(item["path"]), item["sha256"])
for suffix, key in [("root-outer-return", "actualOuterReturnSha256"), ("root-absence", "rootAbsenceSha256"), ("source-recheck", "sourceRecheckSha256"), ("name-difference", "nameDifferenceSha256")]:
    record(H / f"metadata-update-native-discovery-{suffix}-v1.json", old_freeze[key])

admission = read(bound_paths["rootAdmissionSha256"])
actual = read(bound_paths["actualOuterReturnSha256"])
absence = read(bound_paths["rootAbsenceSha256"])
recheck = read(bound_paths["sourceRecheckSha256"])
first = read(PREP / "first-command.json")
assert admission["admittedBy"] == "/root" and admission["maxInvocations"] == 1
assert admission["runtimeAdmission"] is True and admission["stage"] == "fresh-universe"
assert admission["exactCommand"] == [first["executable"], *first["argv"]]
assert admission["cwd"] == first["cwd"] == str(H)
assert admission["bindingSha256"] == first["bindingSha256"] == freeze["bindingSha256"]
assert admission["packetManifestSha256"] == freeze["preparationManifestSha256"]
assert admission["independentSourceReview"]["sha256"] == freeze["independentPreparationReviewSha256"]
assert actual["actualOuterExitCode"] == actual["completionToolReturn"]["exit_code"] == freeze["actualOuterExitCode"] == 0
assert actual["initialToolReturn"]["session_id"] == 48331
assert actual["nativeInvocationsThisAdmission"] == freeze["listInvocationsThisAdmission"] == 1
assert actual["rootAdmissionSha256"] == freeze["rootAdmissionSha256"]
assert actual["retry"] is False and actual["selectorAdmitted"] is False and actual["receivingAdmitted"] is False

pre = read(OUT / "outer-pre.receipt.json")
outer = read(OUT / "outer-final.receipt.json")
child = read(OUT / "00-final.receipt.json")
pre_spawn = read(OUT / "00-pre-spawn.receipt.json")
spawn = read(OUT / "00-spawn.receipt.json")
group = read(OUT / "00-group-verified.receipt.json")
assert outer["status"] == freeze["outerStatus"] == "qualified" and outer["stage"] == "universe"
assert outer["outerPid"] == outer["outerPgid"] == actual["outerPid"] == actual["outerPgid"] == 97300
assert child["pid"] == child["pgid"] == actual["originalChildPid"] == actual["originalChildPgid"] == 97310
assert child["exitCode"] == freeze["nativeChildExitCode"] == 0
assert child["phase"] == "final" and child["pgidVerified"] is True
assert len(outer["completedRecipes"]) == 1
returned = outer["completedRecipes"][0]
receipt_state = {k: v for k, v in child.items() if k not in ["phase", "bindingSha256", "elapsedMs"]}
assert receipt_state == {k: v for k, v in returned.items() if k != "elapsedMs"}
assert 0 <= returned["elapsedMs"] <= child["elapsedMs"] == 804
assert returned["elapsedMs"] == 804
assert [r["elapsedMs"] for r in [pre_spawn, spawn, group, child]] == [0, 2, 2, 804]
assert pre_spawn["pid"] is None and pre_spawn["pgid"] is None
assert not spawn["pgidVerified"] and group["pgidVerified"]
assert spawn["pid"] == group["pid"] == child["pid"]
assert spawn["pgid"] == group["pgid"] == child["pgid"]
for r in [pre, outer, pre_spawn, spawn, group, child]:
    assert r["primaryFailure"] is None and r["secondaryFailures"] == []
    assert r["bindingSha256"] == freeze["bindingSha256"]
for r in [pre_spawn, spawn, group, child]:
    assert r["killAttempts"] == []
assert child["remainingGroupRows"] == [] and child["samples"] == 6
assert child["maxSampledGroupRssBytes"] == 274808832
assert not outer["productPassCredit"] and not outer["receivingReachCredit"]
identity = recheck["identity"]
assert pre["identityBefore"] == outer["identityBefore"] == outer["identityAfter"] == identity
assert (identity["successorSourceFiles"], identity["originalSourceFiles"], identity["productionFiles"], identity["namedDependencyOwnPayloads"], identity["dependencyReuseLinks"]) == (588, 573, 511, 2544, 4)
assert identity["sourceFreezeSha256"] == freeze["sourceFreezeSha256"]
recipe_path = PREP / "recipes.json"
recipe = read(recipe_path)["universe"]
assert identity["freshRecipeSha256"] == digest(recipe_path)
assert child["recipeId"] == recipe["id"]
assert child["argv"] == [recipe["executable"], *recipe["argv"]] and child["cwd"] == recipe["cwd"]
assert set(child["envUnset"]) == set(recipe["envUnset"]) and child["envSet"] == {"CI": "1", "NO_COLOR": "1"}
program_path = H / "metadata-update-native-preparation-v1/program.json"
program = read(program_path)
record(program_path)
assert identity["canonicalProgramSha256"] == program["canonicalProgramSha256"] == hashlib.sha256(json.dumps(program["history"], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
assert identity["perHistoryFinalizer"] == program["perHistoryFinalizer"]
inventory_path = H / "metadata-update-source-v2/source-inventory.json"
record(inventory_path, identity["sourceInventorySha256"])
inventory = read(inventory_path)
assert len(inventory) == 588
for path_key, sha_key in [("definition", "definitionSha256"), ("callSite", "callSiteSha256")]:
    item = identity["perHistoryFinalizer"]
    assert inventory[item[path_key]] == item[sha_key]
    record(H / "metadata-update-source-v2/sources" / item[path_key], item[sha_key])

assert absence["psReturnCode"] == 0 and absence["psStderr"] == ""
assert [(p["participant"], p["kind"], p["identity"]) for p in absence["probes"]] == [("outer", "pid", 97300), ("outer", "pgid", 97300), ("child", "pid", 97310), ("child", "pgid", 97310)]
assert all(p["psMatches"] == [] and p["status"] == "empty-ESRCH" and p["signalZeroError"]["errno"] == 3 and p["signalZeroError"]["class"] == "ProcessLookupError" for p in absence["probes"])

values = read(OUT / "names.json")
names = [v["name"] for v in values]
expected = recipe["expectedOutput"]
assert len(names) == len(set(names)) == expected["count"] == 20
assert sorted(names) == sorted(expected["names"])
assert all(v["file"] == expected["module"] for v in values)
qualified = {"count": 20, "jsonSha256": digest(OUT / "names.json"), "module": expected["module"], "names": names, "stderrEmpty": True}
assert child["qualification"] == freeze["qualification"] == qualified
assert (OUT / "stdout.log").read_bytes() == (OUT / "stderr.log").read_bytes() == b""
assert sum(name.endswith("quarter +0") for name in names) == 4
assert program["displayName"] in names
assert freeze["newRuntimeAdmitted"] is False and freeze["selectorAdmitted"] is False and freeze["receivingAdmitted"] is False

audit = {
    "status": "ACCEPT actual qualified fresh universe collection only; root classification pending",
    "inputs": inputs,
    "rawFreshOutputFilesChecked": 9,
    "rawPriorStoppedOutputFilesChecked": 10,
    "actualOuterExitCode": 0,
    "nativeChildExitCode": 0,
    "outerStatus": "qualified",
    "nativeNames": 20,
    "clockComparison": {"returnedElapsedMs": returned["elapsedMs"], "finalReceiptElapsedMs": child["elapsedMs"], "nonClockFieldsEqual": True},
    "capturedSourceIdentitiesAgree": True,
    "sourceCheckLimit": "Captured pre/post/fresh full-source identity records compared; source freeze/inventory and finalizer source files hashed. Full source gate not rerun by this actual-result audit.",
    "capturedOriginalIdsAbsent": True,
    "absenceLimit": "Four original-ID captured ps/ESRCH records read; no new probes or escaped-descendant census.",
    "priorStoppedResultPreserved": True,
    "nativeLaunches": 0,
    "nativeProcessProbes": 0,
    "runtimeAdmission": False,
    "filterSelectionCredit": False,
    "testBodyPassCredit": False,
    "productRedGreenCredit": False,
    "receivingReachCredit": False,
}
out = HERE / "metadata-update-native-discovery-read-audit-v2.json"
with out.open("x") as handle:
    handle.write(json.dumps(audit, indent=2, sort_keys=True) + "\n")
print(json.dumps({"status": audit["status"], "auditSha256": digest(out), "scriptSha256": digest(Path(__file__))}, indent=2))
