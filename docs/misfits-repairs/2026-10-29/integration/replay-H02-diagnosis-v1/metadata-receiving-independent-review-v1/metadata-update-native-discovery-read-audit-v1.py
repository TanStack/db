"""Read/hash and compare the preserved actual epoch; no runtime or process APIs."""
from pathlib import Path
import hashlib
import json

HERE = Path(__file__).resolve().parent
H = HERE.parent
COORDINATOR = H.parents[4]
OUT = H / "metadata-update-native-discovery-v1"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text())


freeze_path = H / "metadata-update-native-discovery-result-freeze-v1.json"
freeze = load(freeze_path)
assert sha(freeze_path) == "6c2794c3b81b56cb2501013dc07e9cf9740f576bc6c06d8db7580a035ea01bb6"
reads = {str(freeze_path): sha(freeze_path)}
assert len(freeze["assets"]) == 10
for name, expected in freeze["assets"].items():
    path = OUT / name
    actual = sha(path)
    assert actual == expected, name
    assert len(path.read_bytes()) == freeze["assetBytes"][name], name
    reads[str(path)] = actual

bound_paths = {
    "actualOuterReturnSha256": H / "metadata-update-native-discovery-root-outer-return-v1.json",
    "rootAbsenceSha256": H / "metadata-update-native-discovery-root-absence-v1.json",
    "rootAdmissionSha256": H / "metadata-update-native-preparation-v1/root-universe-admission-v1.json",
    "sourceRecheckSha256": H / "metadata-update-native-discovery-source-recheck-v1.json",
    "nameDifferenceSha256": H / "metadata-update-native-discovery-name-difference-v1.json",
    "preparationManifestSha256": H / "metadata-update-native-preparation-v1/packet-manifest.json",
    "bindingSha256": H / "metadata-update-native-preparation-v1/binding.json",
    "sourceFreezeSha256": H / "metadata-update-source-v2/source-freeze.json",
    "independentPreparationReviewSha256": HERE / "metadata-native-preparation-review-v1.md",
}
for key, path in bound_paths.items():
    actual = sha(path)
    assert actual == freeze[key], key
    reads[str(path)] = actual

admission = load(bound_paths["rootAdmissionSha256"])
outer_return = load(bound_paths["actualOuterReturnSha256"])
absence = load(bound_paths["rootAbsenceSha256"])
recheck = load(bound_paths["sourceRecheckSha256"])
diff = load(bound_paths["nameDifferenceSha256"])
pre = load(OUT / "outer-pre.receipt.json")
outer = load(OUT / "outer-final.receipt.json")
child = load(OUT / "00-final.receipt.json")
failure = load(OUT / "00-failure.receipt.json")
spawn = load(OUT / "00-spawn.receipt.json")
group = load(OUT / "00-group-verified.receipt.json")
pre_spawn = load(OUT / "00-pre-spawn.receipt.json")
recipes_path = H / "metadata-update-native-preparation-v1/recipes.json"
recipes = load(recipes_path)
program_path = H / "metadata-update-native-preparation-v1/program.json"
program = load(program_path)
reads[str(recipes_path)] = sha(recipes_path)
reads[str(program_path)] = sha(program_path)

assert admission["maxInvocations"] == freeze["listInvocations"] == 1
assert admission["runtimeAdmission"] is True and admission["stage"] == "universe"
assert admission["binding"]["sha256"] == freeze["bindingSha256"]
assert admission["retry"] is False
assert outer_return["rootAdmissionSha256"] == freeze["rootAdmissionSha256"]
assert outer_return["completionToolReturn"]["exit_code"] == freeze["actualOuterExitCode"] == 1
assert outer_return["initialToolReturn"]["session_id"] == 98090
assert outer_return["retry"] is False
assert outer_return["selectorAdmitted"] is False and outer_return["receivingAdmitted"] is False
assert outer["outerPid"] == outer["outerPgid"] == outer_return["outerPid"] == 62745
assert child["pid"] == child["pgid"] == outer_return["originalChildPid"] == 62756
assert outer_return["originalChildPgid"] == 62756
assert child["exitCode"] == freeze["originalChildExitCode"] == 0
assert outer["status"] == "stopped"
assert child["primaryFailure"] == {"error": "wrong native list names", "phase": "native-list"}
assert outer["primaryFailure"]["phase"] == "metadata-update-native20-discovery-v1"
assert outer["completedRecipes"] and len(outer["completedRecipes"]) == 1
returned = outer["completedRecipes"][0]
receipt_state = {key: value for key, value in child.items() if key not in ("phase", "bindingSha256", "elapsedMs")}
returned_state = {key: value for key, value in returned.items() if key != "elapsedMs"}
assert receipt_state == returned_state
assert returned["elapsedMs"] <= child["elapsedMs"]
assert returned["elapsedMs"] == child["elapsedMs"] == 842
assert [r["elapsedMs"] for r in (pre_spawn, spawn, group, failure, child)] == [0, 2, 3, 797, 842]
assert not spawn["pgidVerified"] and group["pgidVerified"] and child["pgidVerified"]
assert child["remainingGroupRows"] == [] and child["killAttempts"] == []
assert child["maxSampledGroupRssBytes"] == 305070080 and child["samples"] == 6
assert all(not r["secondaryFailures"] for r in (pre_spawn, spawn, group, failure, child, pre, outer))
assert not outer["productPassCredit"] and not outer["receivingReachCredit"]
assert pre["identityBefore"] == outer["identityBefore"] == outer["identityAfter"] == recheck["identity"]
identity = recheck["identity"]
assert (identity["successorSourceFiles"], identity["originalSourceFiles"], identity["productionFiles"], identity["namedDependencyOwnPayloads"], identity["dependencyReuseLinks"]) == (588, 573, 511, 2544, 4)
assert identity["sourceFreezeSha256"] == freeze["sourceFreezeSha256"]
assert identity["nativeLaunches"] == identity["nativeProcessProbes"] == 0
assert len(absence["probes"]) == 4 and absence["psReturnCode"] == 0 and not absence["psStderr"]
assert {(p["participant"], p["kind"], p["identity"]) for p in absence["probes"]} == {
    ("outer", "pid", 62745), ("outer", "pgid", 62745), ("child", "pid", 62756), ("child", "pgid", 62756)
}
assert all(p["psMatches"] == [] and p["status"] == "empty-ESRCH" and p["signalZeroError"]["errno"] == 3 and p["signalZeroError"]["class"] == "ProcessLookupError" for p in absence["probes"])

values = load(OUT / "names.json")
expected = recipes["universe"]["expectedOutput"]
actual_names = [value["name"] for value in values]
expected_names = expected["names"]
assert len(values) == len(set(actual_names)) == len(expected_names) == 20
assert all(value["file"] == expected["module"] for value in values)
missing = sorted(set(expected_names) - set(actual_names))
unexpected = sorted(set(actual_names) - set(expected_names))
assert missing == diff["missing"] and unexpected == diff["unexpected"]
assert len(missing) == len(unexpected) == 4
assert [name.removesuffix(" 0") + " +0" for name in missing] == unexpected
assert all("checks source followup" in name and name.endswith("quarter 0") for name in missing)
assert actual_names != expected_names and diff["sameOrder"] is False
assert diff["qualifierUsesSortedNameSets"] is True
assert (OUT / "stderr.log").read_bytes() == (OUT / "stdout.log").read_bytes() == b""
assert program["displayName"] in actual_names
assert program["displayName"].endswith("quarter 2") and program["filterName"].endswith("quarter 2")
assert recipes["selector"]["expectedOutput"]["names"] == [program["displayName"]]
assert recipes["receiving"]["expectedDisplayName"] == program["displayName"]
assert recipes["receiving"]["expectedFilterName"] == program["filterName"]

runner = COORDINATOR / "node_modules/.pnpm/@vitest+runner@4.1.12/node_modules/@vitest/runner/dist/chunk-artifact.js"
display = COORDINATOR / "node_modules/.pnpm/@vitest+utils@4.1.12/node_modules/@vitest/utils/dist/display.js"
for path in (runner, display):
    reads[str(path)] = sha(path)
assert 'return objDisplay(value, { truncate: runner?.config?.chaiConfig?.truncateThreshold });' in runner.read_text()
assert "return options.stylize(1 / number === Infinity ? '+0' : '-0', 'number');" in display.read_text()
qualifier_path = COORDINATOR.parent / "codex-misfits-h02-metadata-receiving-v1/docs/misfits-metadata-receiving-native-list-launcher-v1/launch.py"
assert sha(qualifier_path) == diff["qualifierSourceSha256"]
reads[str(qualifier_path)] = sha(qualifier_path)
assert "sorted(names) == sorted(expected['names'])" in qualifier_path.read_text()

result = {
    "status": "ACCEPT preserved STOPPED result; four no-op DISPLAY expectations wrong",
    "reviewer": "/root/replay_covering_authority",
    "inputs": reads,
    "rawOutputFilesChecked": 10,
    "actualOuterExitCode": 1,
    "nativeChildExitCode": 0,
    "observedNameCount": 20,
    "missingNames": missing,
    "unexpectedNames": unexpected,
    "clockComparison": {"returnedElapsedMs": returned["elapsedMs"], "finalReceiptElapsedMs": child["elapsedMs"], "nonClockFieldsEqual": True},
    "sourceRecheck": "Captured pre/after/fresh source-gate identities agree:588/573/511/2544/four links. This audit does not rerun verifier or independently traverse the frozen tree.",
    "absence": "Read four captured original-ID empty-ps/ESRCH results; no new PID or signal probes.",
    "diagnosis": "Installed Vitest object attribute titles use objDisplay; numeric positive zero displays +0. Positive quarter2 display/filter unchanged.",
    "nativeLaunches": 0,
    "processProbes": 0,
    "testBodyPassCredit": False,
    "productRedGreenCredit": False,
    "receivingReachCredit": False,
    "runtimeAdmission": False,
}
result_path = HERE / "metadata-update-native-discovery-read-audit-v1.json"
with result_path.open("x") as handle:
    handle.write(json.dumps(result, indent=2, sort_keys=True) + "\n")
print(json.dumps({"status": result["status"], "auditPath": str(result_path), "auditSha256": sha(result_path), "scriptSha256": sha(Path(__file__))}, indent=2))
