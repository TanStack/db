"""Independent complete actual-selector read/hash/JSON audit; no process APIs."""
from pathlib import Path
import hashlib
import json
import re
import stat

HERE = Path(__file__).resolve().parent
H = HERE.parent
PREP = H / "metadata-update-native-selector-preparation-v2"
OUT = H / "metadata-update-native-selector-v2"
FREEZE = "7f797473ed69940fdca4f4506ef99a71997224fb3785aa99e7c9dc71006958b6"
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


def assets(freeze, count):
    out = Path(freeze["outputDirectory"])
    assert len(freeze["assets"]) == count and {p.name for p in out.iterdir()} == set(freeze["assets"])
    for name, expected in freeze["assets"].items():
        path = out / name
        assert Path(name).name == name and stat.S_ISREG(path.lstat().st_mode) and path.stat().st_nlink == 1
        record(path, expected)
        assert len(path.read_bytes()) == freeze["assetBytes"][name]


freeze_path = H / "metadata-update-native-selector-result-freeze-v2.json"
record(freeze_path, FREEZE)
freeze = read(freeze_path)
assert freeze["outputDirectory"] == str(OUT)
assets(freeze, 9)
bound = {
    "actualOuterReturnSha256": H / "metadata-update-native-selector-root-outer-return-v2.json",
    "rootAbsenceSha256": H / "metadata-update-native-selector-root-absence-v2.json",
    "sourceRecheckSha256": H / "metadata-update-native-selector-source-recheck-v2.json",
    "rootAdmissionSha256": PREP / "root-selector-admission-v1.json",
    "bindingSha256": PREP / "binding.json",
    "preparationManifestSha256": PREP / "packet-manifest.json",
    "independentPreparationReviewSha256": HERE / "metadata-native-selector-preparation-review-v2.md",
    "sourceFreezeSha256": H / "metadata-update-source-v2/source-freeze.json",
    "acceptedFreshUniverseClassificationSha256": H / "metadata-update-native-discovery-root-classification-v2.json",
    "acceptedFreshUniverseResultFreezeSha256": H / "metadata-update-native-discovery-result-freeze-v2.json",
}
for key, path in bound.items():
    record(path, freeze[key])
manifest = read(bound["preparationManifestSha256"])
for name, item in manifest["artifacts"].items():
    record(PREP / name, item["sha256"])
    assert len((PREP / name).read_bytes()) == item["bytes"]
universe_freeze = read(bound["acceptedFreshUniverseResultFreezeSha256"])
assets(universe_freeze, 9)
for suffix, key in [("root-outer-return", "actualOuterReturnSha256"), ("root-absence", "rootAbsenceSha256"), ("source-recheck", "sourceRecheckSha256")]:
    record(H / f"metadata-update-native-discovery-{suffix}-v2.json", universe_freeze[key])
universe_class = read(bound["acceptedFreshUniverseClassificationSha256"])
assert universe_class["boundedAccepted"] is True and universe_class["newRuntimeAdmitted"] is False
assert universe_class["stage"] == "universe" and universe_class["actualOuterExitCode"] == universe_class["nativeChildExitCode"] == 0
record(HERE / "metadata-update-native-discovery-actual-result-review-v2.md", universe_class["independentReviewSha256"])
old_path = H / "metadata-update-native-discovery-result-freeze-v1.json"
record(old_path, universe_freeze["priorStoppedResultFreezeSha256"])
old = read(old_path)
assets(old, 10)
stopped_path = H / "metadata-update-native-discovery-root-stopped-classification-v1.json"
record(stopped_path, universe_freeze["priorStoppedClassificationSha256"])
stopped = read(stopped_path)
assert stopped["boundedAccepted"] is False and stopped["actualOuterExitCode"] == 1 and stopped["nativeChildExitCode"] == 0
for suffix, key in [("root-outer-return", "actualOuterReturnSha256"), ("root-absence", "rootAbsenceSha256"), ("source-recheck", "sourceRecheckSha256"), ("name-difference", "nameDifferenceSha256")]:
    record(H / f"metadata-update-native-discovery-{suffix}-v1.json", old[key])

actual = read(bound["actualOuterReturnSha256"])
admission = read(bound["rootAdmissionSha256"])
absence = read(bound["rootAbsenceSha256"])
recheck = read(bound["sourceRecheckSha256"])
first = read(PREP / "first-command.json")
assert admission["admittedBy"] == "/root" and admission["stage"] == "selector" and admission["runtimeAdmission"] is True
assert admission["maxInvocations"] == 1 and admission["sandbox_permissions"] == "require_escalated"
assert admission["exactCommand"] == [first["executable"], *first["argv"]] and admission["cwd"] == first["cwd"] == str(H)
assert admission["bindingSha256"] == first["bindingSha256"] == freeze["bindingSha256"]
assert admission["packetManifestSha256"] == freeze["preparationManifestSha256"]
assert admission["independentSourceReview"]["sha256"] == freeze["independentPreparationReviewSha256"]
assert admission["prerequisiteUniverseClassification"]["sha256"] == freeze["acceptedFreshUniverseClassificationSha256"]
assert actual["rootAdmissionSha256"] == freeze["rootAdmissionSha256"]
assert actual["actualOuterExitCode"] == actual["completionToolReturn"]["exit_code"] == freeze["actualOuterExitCode"] == 0
assert actual["initialToolReturn"]["session_id"] == 77661
assert actual["nativeInvocationsThisAdmission"] == freeze["listInvocationsThisAdmission"] == 1
assert actual["retry"] is False and actual["receivingAdmitted"] is False

pre = read(OUT / "outer-pre.receipt.json")
outer = read(OUT / "outer-final.receipt.json")
child = read(OUT / "00-final.receipt.json")
early = [read(OUT / name) for name in ["00-pre-spawn.receipt.json", "00-spawn.receipt.json", "00-group-verified.receipt.json"]]
assert outer["status"] == freeze["outerStatus"] == "qualified" and outer["stage"] == "selector"
assert outer["outerPid"] == outer["outerPgid"] == actual["outerPid"] == actual["outerPgid"] == 21526
assert child["pid"] == child["pgid"] == actual["originalChildPid"] == actual["originalChildPgid"] == 21537
assert child["exitCode"] == freeze["nativeChildExitCode"] == 0 and child["phase"] == "final"
assert child["pgidVerified"] is True and child["remainingGroupRows"] == []
assert len(outer["completedRecipes"]) == 1
returned = outer["completedRecipes"][0]
assert {k: v for k, v in child.items() if k not in ["phase", "bindingSha256", "elapsedMs"]} == {k: v for k, v in returned.items() if k != "elapsedMs"}
assert 0 <= returned["elapsedMs"] <= child["elapsedMs"] == 845 and returned["elapsedMs"] == 845
assert [r["elapsedMs"] for r in [*early, child]] == [0, 2, 2, 845]
assert early[0]["pid"] is None and early[0]["pgid"] is None and not early[1]["pgidVerified"] and early[2]["pgidVerified"]
assert early[1]["pid"] == early[2]["pid"] == early[1]["pgid"] == early[2]["pgid"] == child["pid"]
for receipt in [pre, outer, *early, child]:
    assert receipt["primaryFailure"] is None and receipt["secondaryFailures"] == [] and receipt["bindingSha256"] == freeze["bindingSha256"]
for receipt in [*early, child]:
    assert receipt["killAttempts"] == []
assert child["samples"] == 6 and child["maxSampledGroupRssBytes"] == 303923200
assert not outer["productPassCredit"] and not outer["receivingReachCredit"]

identity = recheck["identity"]
assert pre["identityBefore"] == outer["identityBefore"] == outer["identityAfter"] == identity
assert (identity["successorSourceFiles"], identity["originalSourceFiles"], identity["productionFiles"], identity["namedDependencyOwnPayloads"], identity["dependencyReuseLinks"]) == (588, 573, 511, 2544, 4)
assert identity["acceptedFreshUniverseClassificationSha256"] == freeze["acceptedFreshUniverseClassificationSha256"]
assert recheck["priorClassifications"] == [{"classificationSha256": freeze["acceptedFreshUniverseClassificationSha256"], "nativeNames": 20, "productPassCredit": False, "receivingReachCredit": False, "resultFreezeSha256": freeze["acceptedFreshUniverseResultFreezeSha256"], "stage": "universe"}]
recipe_path = PREP / "recipes.json"
recipe = read(recipe_path)["selector"]
assert identity["selectorRecipeSha256"] == digest(recipe_path)
assert child["recipeId"] == recipe["id"] and child["argv"] == [recipe["executable"], *recipe["argv"]]
assert child["cwd"] == recipe["cwd"] and set(child["envUnset"]) == set(recipe["envUnset"]) and child["envSet"] == {"CI": "1", "NO_COLOR": "1"}
program_path = H / "metadata-update-native-preparation-v1/program.json"
record(program_path)
program = read(program_path)
assert identity["canonicalProgramSha256"] == program["canonicalProgramSha256"] == hashlib.sha256(json.dumps(program["history"], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
assert identity["perHistoryFinalizer"] == program["perHistoryFinalizer"]
inventory_path = H / "metadata-update-source-v2/source-inventory.json"
record(inventory_path, identity["sourceInventorySha256"])
assert len(read(inventory_path)) == 588
for path_key, sha_key in [("definition", "definitionSha256"), ("callSite", "callSiteSha256")]:
    item = identity["perHistoryFinalizer"]
    assert read(inventory_path)[item[path_key]] == item[sha_key]
    record(H / "metadata-update-source-v2/sources" / item[path_key], item[sha_key])
assert recipe["argv"][-2:] == ["-t", "^" + re.escape(program["filterName"]) + "$"]
assert program["filterName"] != program["displayName"]
values = read(OUT / "names.json")
expected = recipe["expectedOutput"]
assert values == [{"name": program["displayName"], "file": expected["module"]}]
assert expected["count"] == 1 and expected["names"] == [program["displayName"]]
qualification = {"count": 1, "jsonSha256": digest(OUT / "names.json"), "module": expected["module"], "names": [program["displayName"]], "stderrEmpty": True}
assert child["qualification"] == freeze["qualification"] == qualification
assert (OUT / "stdout.log").read_bytes() == (OUT / "stderr.log").read_bytes() == b""
assert absence["psReturnCode"] == 0 and absence["psStderr"] == ""
assert [(p["participant"], p["kind"], p["identity"]) for p in absence["probes"]] == [("outer", "pid", 21526), ("outer", "pgid", 21526), ("child", "pid", 21537), ("child", "pgid", 21537)]
assert all(p["psMatches"] == [] and p["status"] == "empty-ESRCH" and p["signalZeroError"]["errno"] == 3 and p["signalZeroError"]["class"] == "ProcessLookupError" for p in absence["probes"])
assert not freeze["newRuntimeAdmitted"] and not freeze["receivingAdmitted"]

audit = {
    "status": "ACCEPT actual qualified exact selector evidence only; root classification pending",
    "inputs": inputs,
    "rawSelectorFilesChecked": 9,
    "rawPriorUniverseFilesChecked": 9,
    "rawOriginalStoppedFilesChecked": 10,
    "actualOuterExitCode": 0,
    "nativeChildExitCode": 0,
    "outerStatus": "qualified",
    "selectedDisplayName": program["displayName"],
    "clockComparison": {"returnedElapsedMs": returned["elapsedMs"], "finalReceiptElapsedMs": child["elapsedMs"], "nonClockFieldsEqual": True},
    "capturedPrePostFreshInputIdentitiesAgree": True,
    "sourceLimit": "Captured complete source/prior-result preflight compared; freeze/inventory/program/finalizer hashes checked. No full source checker rerun by reviewer.",
    "capturedOriginalIdsAbsent": True,
    "absenceLimit": "Four captured original-ID ps/ESRCH records read; no new probes or escaped-descendant census.",
    "priorAcceptedAndStoppedEpochsPreserved": True,
    "nativeLaunches": 0,
    "nativeProcessProbes": 0,
    "runtimeAdmission": False,
    "testBodyPassCredit": False,
    "productRedGreenCredit": False,
    "receivingReachCredit": False,
}
out = HERE / "metadata-update-native-selector-read-audit-v2.json"
with out.open("x") as handle:
    handle.write(json.dumps(audit, indent=2, sort_keys=True) + "\n")
print(json.dumps({"status": audit["status"], "auditSha256": digest(out), "scriptSha256": digest(Path(__file__))}, indent=2))
