"""Independent bounded read/hash and captured-output qualification controls."""
import ast
import copy
from contextlib import ExitStack
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
H = HERE.parent
PACKET = H / "metadata-update-native-display-correction-v1"
BINDING = "a8427c94643a8dbbe25f3242ab1aa56c125831555765c4cb0596a67dca800fe8"
MANIFEST = "c2445689e8fb7f5e931d490487a0eff0ef2b3e17173388ebd25bbbf18c277b4d"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text())


def forbidden(*args, **kwargs):
    raise AssertionError("native process/probe/signal API forbidden in independent pure audit")


manifest_path = PACKET / "packet-manifest.json"
assert digest(manifest_path) == MANIFEST
manifest = read(manifest_path)
assert {p.name for p in PACKET.iterdir()} == set(manifest["artifacts"]) | {"packet-manifest.json"}
inputs = {str(manifest_path): digest(manifest_path)}
for name, item in manifest["artifacts"].items():
    path = PACKET / name
    assert len(path.read_bytes()) == item["bytes"] and digest(path) == item["sha256"], name
    inputs[str(path)] = digest(path)
assert digest(PACKET / "binding.json") == BINDING
binding = read(PACKET / "binding.json")
assert manifest["bindingSha256"] == BINDING
assert not binding["newRuntimeAdmitted"] and not manifest["newSupervisor"] and not manifest["sourceRefreeze"]
for name, expected in binding["files"].items():
    assert digest(PACKET / name) == expected

original_path = H / "metadata-update-native-preparation-v1/recipes.json"
originals = read(original_path)
corrected = read(PACKET / "corrected-universe-recipe.json")
old_names = originals["universe"]["expectedOutput"]["names"]
new_names = corrected["expectedOutput"]["names"]
delta = [(i, old, new) for i, (old, new) in enumerate(zip(old_names, new_names)) if old != new]
assert len(old_names) == len(new_names) == 20 and len(delta) == 4
assert all(old.endswith("quarter 0") and new == old[:-1] + "+0" for _, old, new in delta)
unchanged = copy.deepcopy(corrected)
unchanged["expectedOutput"]["names"] = old_names
assert unchanged == originals["universe"]
program_path = H / "metadata-update-native-preparation-v1/program.json"
program = read(program_path)
assert program["displayName"] in new_names and program["displayName"].endswith("quarter 2")
assert originals["selector"]["expectedOutput"]["names"] == [program["displayName"]]
assert originals["receiving"]["expectedFilterName"] == program["filterName"]
inputs[str(original_path)] = digest(original_path)
inputs[str(program_path)] = digest(program_path)

for name in ["check.py", "calibrate.py"]:
    source = (PACKET / name).read_text()
    tree = ast.parse(source, filename=name)
    compile(tree, name, "exec")

spec = importlib.util.spec_from_file_location("independent_captured_display_calibration", PACKET / "calibrate.py")
calibration = importlib.util.module_from_spec(spec)
with ExitStack() as stack:
    for owner, names in [
        (subprocess, ["Popen", "run", "call", "check_call", "check_output", "getoutput", "getstatusoutput"]),
        (os, ["getpid", "getppid", "getpgrp", "getpgid", "getsid", "kill", "killpg", "system", "fork", "posix_spawn", "posix_spawnp", "execv", "execve", "execvp", "execvpe", "spawnv", "spawnve", "spawnvp", "spawnvpe"]),
        (signal, ["signal", "setitimer", "alarm", "raise_signal"]),
    ]:
        for name in names:
            if hasattr(owner, name):
                stack.enter_context(patch.object(owner, name, forbidden))
    spec.loader.exec_module(calibration)
    actual_result = calibration.run(BINDING)
    assert actual_result == read(PACKET / "pure-results.json")
    assert actual_result["acceptedCount"] == 2 and actual_result["rejectedCount"] == 8
    check_spec = importlib.util.spec_from_file_location("independent_captured_display_checker", PACKET / "check.py")
    checker = importlib.util.module_from_spec(check_spec)
    check_spec.loader.exec_module(checker)
    supervisor = checker.gate().supervisor()
    captured = read(H / "metadata-update-native-discovery-v1/names.json")
    controls = {}
    wrong = copy.deepcopy(captured)
    wrong[1]["name"] = wrong[0]["name"]
    controls["duplicate actual name"] = (wrong, "wrong native list names")
    wrong = copy.deepcopy(captured)
    wrong[0]["file"] = "/wrong/module.ts"
    controls["wrong actual module"] = (wrong, "wrong native list entry/module")
    controls["missing actual entry"] = (copy.deepcopy(captured[:-1]), "wrong native list count")
    wrong = copy.deepcopy(captured)
    wrong.append(copy.deepcopy(captured[-1]))
    controls["extra actual entry"] = (wrong, "wrong native list count")
    wrong = copy.deepcopy(captured)
    index = next(i for i, v in enumerate(wrong) if v["name"].endswith("quarter +0"))
    wrong[index]["name"] = wrong[index]["name"].replace("quarter +0", "quarter 0")
    controls["wrong actual zero display"] = (wrong, "wrong native list names")
    wrong = copy.deepcopy(captured)
    wrong[0]["name"] = None
    controls["non-string actual name"] = (wrong, "wrong native list entry/module")
    controls["non-list actual output"] = ({"names": captured}, "wrong native list count")
    independent_rejections = {}
    for name, (wrong, expected_error) in controls.items():
        with patch.object(supervisor, "load_json", lambda path, value=wrong: value):
            try:
                supervisor.qualify_output(corrected)
            except ValueError as error:
                assert str(error) == expected_error, name
                independent_rejections[name] = str(error)
            else:
                raise AssertionError("wrong captured observation accepted: " + name)

for path, expected in inputs.items():
    assert digest(Path(path)) == expected, path
result = {
    "status": "ACCEPT bounded captured DISPLAY correction only; no runtime admission",
    "inputs": inputs,
    "fourNameDelta": delta,
    "independentAuthorCalibrationReplay": {"accepted": 2, "rejected": 8, "exactResultMatchesFrozen": True},
    "independentWrongActualObservationsRejected": independent_rejections,
    "freshSourceGateIdentity": actual_result["capturedRequalification"]["freshInputIdentity"],
    "originalObservedOuterExitCode": 1,
    "originalNativeChildExitCode": 0,
    "originalStopPreserved": True,
    "nativeLaunches": 0,
    "nativeProcessProbes": 0,
    "filterSelectionCredit": False,
    "testPassCredit": False,
    "productRedGreenCredit": False,
    "receivingReachCredit": False,
    "runtimeAdmission": False,
    "bytecodeWritten": False,
}
out = HERE / "metadata-native-display-correction-read-audit-v1.json"
with out.open("x") as handle:
    handle.write(json.dumps(result, indent=2, sort_keys=True) + "\n")
print(json.dumps({"status": result["status"], "auditSha256": digest(out), "scriptSha256": digest(Path(__file__))}, indent=2))
