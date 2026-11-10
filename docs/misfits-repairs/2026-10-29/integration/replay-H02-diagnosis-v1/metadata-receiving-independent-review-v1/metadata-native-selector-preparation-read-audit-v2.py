"""Independent exact-selector source/static/pure review, with native APIs forbidden."""
import ast
import copy
from contextlib import ExitStack
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
H = HERE.parent
PACKET = H / "metadata-update-native-selector-preparation-v2"
P2 = H / "metadata-update-native-preparation-v2"
P1 = H / "metadata-update-native-preparation-v1"
OUTPUT = H / "metadata-update-native-selector-v2"
BINDING = "bdd159931e7c4603d30f5bec97ad1953257226bb3f93a24e24ea1dc76a97f4c6"
MANIFEST = "9413a1653b12f1d8c3741ae9a003570d4f46f75060998a2a6d3fbf69972e1c0f"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text())


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def forbidden(*args, **kwargs):
    raise AssertionError("native process/probe/signal API forbidden during selector source/pure audit")


manifest_path = PACKET / "packet-manifest.json"
assert digest(manifest_path) == MANIFEST
manifest = read(manifest_path)
assert len(manifest["artifacts"]) == 9
assert {p.name for p in PACKET.iterdir()} == set(manifest["artifacts"]) | {"packet-manifest.json"}
inputs = {str(manifest_path): digest(manifest_path)}
for name, item in manifest["artifacts"].items():
    path = PACKET / name
    assert len(path.read_bytes()) == item["bytes"] and digest(path) == item["sha256"], name
    inputs[str(path)] = digest(path)
assert digest(PACKET / "binding.json") == BINDING
binding = read(PACKET / "binding.json")
for name, expected in binding["files"].items():
    assert digest(PACKET / name) == expected
assert not binding["newRuntimeAdmitted"] and not binding["newSupervisor"]
assert binding["sourceCopies"] == binding["sourceRefreezes"] == 0
first = read(PACKET / "first-command.json")
assert first["executable"] == "/opt/homebrew/opt/python@3.14/bin/python3.14"
assert first["argv"] == ["-I", "-B", str(PACKET / "run.py"), BINDING]
assert first["cwd"] == str(H) and first["maxInvocations"] == 1
recipes = read(PACKET / "recipes.json")
assert set(recipes) == {"status", "selector"}
recipe = recipes["selector"]
universe = read(P2 / "recipes.json")["universe"]
program = read(P1 / "program.json")
expected = copy.deepcopy(universe)
expected["id"] = "metadata-update-scope-default-q2-selector-v2"
expected["argv"] = [f"--json={OUTPUT / 'names.json'}" if arg.startswith("--json=") else arg for arg in universe["argv"]] + ["-t", "^" + re.escape(program["filterName"]) + "$"]
expected["stdoutPath"] = str(OUTPUT / "stdout.log")
expected["stderrPath"] = str(OUTPUT / "stderr.log")
expected["expectedOutput"].update(path=str(OUTPUT / "names.json"), count=1, names=[program["displayName"]])
assert recipe == expected
assert universe["expectedOutput"]["names"].count(program["displayName"]) == 1
assert program["filterName"] != program["displayName"]
assert [name for name in universe["expectedOutput"]["names"] if re.fullmatch(recipe["argv"][-1], name.replace(" > ", " "))] == [program["displayName"]]
assert not OUTPUT.exists()
for name in ["run.py", "verify.py", "calibrate.py"]:
    tree = ast.parse((PACKET / name).read_text(), filename=name)
    compile(tree, name, "exec")
for path in [P2 / "binding.json", P2 / "run.py", P2 / "verify.py", P2 / "recipes.json", P1 / "binding.json", P1 / "launch.py", P1 / "verify.py", P1 / "program.json", H / "metadata-update-native-discovery-root-classification-v2.json"]:
    inputs[str(path)] = digest(path)
assert inputs[str(H / "metadata-update-native-discovery-root-classification-v2.json")] == binding["acceptedFreshUniverseClassificationSha256"]

with ExitStack() as stack:
    for owner, names in [
        (subprocess, ["Popen", "run", "call", "check_call", "check_output", "getoutput", "getstatusoutput"]),
        (os, ["getpid", "getppid", "getpgrp", "getpgid", "getsid", "kill", "killpg", "system", "fork", "posix_spawn", "posix_spawnp", "execv", "execve", "execvp", "execvpe", "spawnv", "spawnve", "spawnvp", "spawnvpe"]),
        (signal, ["signal", "setitimer", "alarm", "raise_signal"]),
    ]:
        for name in names:
            if hasattr(owner, name):
                stack.enter_context(patch.object(owner, name, forbidden))
    calibration = load("independent_selector_calibration", PACKET / "calibrate.py")
    calibrated = calibration.run(BINDING)
    assert calibrated == read(PACKET / "pure-results.json")
    assert calibrated["acceptedCount"] == 5 and calibrated["rejectedCount"] == 16
    gate = load("independent_selector_gate", PACKET / "verify.py")
    entry = load("independent_selector_entry", PACKET / "run.py")
    wrapper = entry.load_wrapper()
    assert wrapper.HERE == PACKET
    assert Path(wrapper.execute.__code__.co_filename) == P1 / "launch.py"
    assert wrapper.load_gate(BINDING).HERE == PACKET
    classified, checker = gate.accepted_universe()
    assert Path(checker.verify_classification.__code__.co_filename) == P1 / "verify.py"
    assert checker.classification_paths is gate.universe_paths
    calls = []
    sentinel = SimpleNamespace(execute=lambda stage, binding: calls.append((stage, binding)) or 23)
    with patch.object(entry, "load_wrapper", return_value=sentinel):
        assert entry.execute(BINDING) == 23
    assert calls == [("selector", BINDING)]
    paths = gate.universe_paths("universe")
    actual_classification = read(paths["classification"])
    freeze = read(paths["freeze"])
    raw = Path(freeze["outputDirectory"])
    # Supply wrong captured observations to the same unchanged clean checker.
    # No captured file or hash is rewritten; this is checker calibration only.
    negative = []
    original_read = checker.read
    cases = []
    def wrong(path, label, mutate, error):
        value = copy.deepcopy(original_read(path))
        mutate(value)
        cases.append((path, label, value, error))
    wrong(paths["classification"], "unaccepted prior classification", lambda v: v.update(boundedAccepted=False), "missing exact bounded root classification")
    wrong(paths["return"], "nonzero actual outer return", lambda v: v.update(actualOuterExitCode=1), "actual outer completion not zero")
    wrong(raw / "outer-final.receipt.json", "stopped actual outer", lambda v: v.update(status="stopped"), "outer was not fully qualified/rechecked")
    wrong(raw / "00-final.receipt.json", "nonzero native child", lambda v: v.update(exitCode=1), "original child containment/return not clean")
    wrong(raw / "00-final.receipt.json", "unverified child group", lambda v: v.update(pgidVerified=False), "original child containment/return not clean")
    wrong(raw / "00-final.receipt.json", "remaining child group", lambda v: v.update(remainingGroupRows=[{"pid": 97310}]), "original child containment/return not clean")
    wrong(raw / "outer-final.receipt.json", "changed postflight identity", lambda v: v["identityAfter"].update(productionFiles=510), "outer was not fully qualified/rechecked")
    wrong(raw / "outer-final.receipt.json", "returned child state mismatch", lambda v: v["completedRecipes"][0].update(exitCode=1), "outer and child final state disagree")
    wrong(paths["absence"], "wrong original absent identity", lambda v: v["probes"][0].update(identity=1), "original identity absence unestablished")
    wrong(raw / "00-final.receipt.json", "changed native qualification", lambda v: v["qualification"].update(count=19), "outer and child final state disagree")
    for path, label, value, expected_error in cases:
        with patch.object(checker, "read", side_effect=lambda requested, target=path, bad=value: bad if Path(requested) == target else original_read(requested)):
            try:
                checker.verify_classification("universe", gate.PREVIOUS_BINDING, {"universe": universe})
            except ValueError as error:
                assert str(error) == expected_error, (label, str(error))
                negative.append({"case": label, "error": str(error)})
            else:
                raise AssertionError("wrong prior observation accepted: " + label)
    assert classified["classificationSha256"] == binding["acceptedFreshUniverseClassificationSha256"]
    assert classified["resultFreezeSha256"] == binding["acceptedFreshUniverseResultFreezeSha256"]
    assert classified["nativeNames"] == 20
    assert not OUTPUT.exists()
for path, expected_hash in inputs.items():
    assert digest(Path(path)) == expected_hash, path
audit = {
    "status": "ACCEPT exact-selector source preparation only; separate root one-shot admission required",
    "inputs": inputs,
    "firstCommand": first,
    "exactRecipeAndProspectiveUniqueFilter": True,
    "filterLimit": "Python exact-pattern control only; native singleton selection remains unexecuted.",
    "independentAuthorCalibrationReplay": {"accepted": 5, "rejected": 16, "exactFrozenResultMatched": True},
    "independentWrongPriorObservationsRejected": negative,
    "fullSourceAndPriorPreflight": calibrated["sourceAndPriorResultPreflight"],
    "originalWrapperAndCleanJudgmentUnchanged": True,
    "originalStoppedResultPreserved": True,
    "freshOutputAbsent": str(OUTPUT),
    "nativeLaunches": 0,
    "nativeProcessProbes": 0,
    "runtimeAdmission": False,
    "filterSelectionCredit": False,
    "testPassCredit": False,
    "productRedGreenCredit": False,
    "receivingReachCredit": False,
    "bytecodeWritten": False,
}
out = HERE / "metadata-native-selector-preparation-read-audit-v2.json"
with out.open("x") as handle:
    handle.write(json.dumps(audit, indent=2, sort_keys=True) + "\n")
print(json.dumps({"status": audit["status"], "auditSha256": digest(out), "scriptSha256": digest(Path(__file__))}, indent=2))
