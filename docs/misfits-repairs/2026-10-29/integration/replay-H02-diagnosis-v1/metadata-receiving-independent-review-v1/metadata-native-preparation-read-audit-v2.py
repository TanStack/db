"""Independent source/static/pure review; never execute the native entry point."""
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
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
H = HERE.parent
PACKET = H / "metadata-update-native-preparation-v2"
PREVIOUS = H / "metadata-update-native-preparation-v1"
CORRECTION = H / "metadata-update-native-display-correction-v1"
OUTPUT = H / "metadata-update-native-discovery-v2"
BINDING = "86ccd3bf644d96f43e726f1e805c4b8850754707b7bb88c48ccd802cd90bd7b9"
MANIFEST = "5948004228457d7f7155c6499762a4d267c16365cc70a2398342d56b961408f9"


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
    raise AssertionError("native process/probe/signal API forbidden during source/pure audit")


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
assert binding["newRuntimeAdmitted"] is False and binding["newSupervisor"] is False
assert binding["sourceCopies"] == 0
assert manifest["sourceRefreezes"] == 0 and manifest["stoppedSuccessExemption"] is False

first = read(PACKET / "first-command.json")
assert first["executable"] == "/opt/homebrew/opt/python@3.14/bin/python3.14"
assert first["argv"] == ["-I", "-B", str(PACKET / "run.py"), BINDING]
assert first["cwd"] == str(H) and first["maxInvocations"] == 1
assert first["bindingSha256"] == BINDING
assert first["sourceFreezeSha256"] == binding["sourceFreezeSha256"]
recipes = read(PACKET / "recipes.json")
assert set(recipes) == {"status", "universe"}
fresh = recipes["universe"]
corrected = read(CORRECTION / "corrected-universe-recipe.json")
expected = copy.deepcopy(corrected)
expected["id"] = "metadata-update-native20-discovery-v2"
expected["argv"] = [f"--json={OUTPUT / 'names.json'}" if arg.startswith("--json=") else arg for arg in expected["argv"]]
expected["expectedOutput"]["path"] = str(OUTPUT / "names.json")
expected["stdoutPath"] = str(OUTPUT / "stdout.log")
expected["stderrPath"] = str(OUTPUT / "stderr.log")
assert fresh == expected
assert not OUTPUT.exists()

for name in ["run.py", "verify.py", "calibrate.py"]:
    tree = ast.parse((PACKET / name).read_text(), filename=name)
    compile(tree, name, "exec")

stopped_path = H / "metadata-update-native-discovery-root-stopped-classification-v1.json"
assert digest(stopped_path) == binding["originalStoppedClassificationSha256"]
stopped = read(stopped_path)
assert stopped["boundedAccepted"] is False and stopped["actualOuterExitCode"] == 1
assert stopped["nativeChildExitCode"] == 0 and stopped["newRuntimeAdmitted"] is False
inputs[str(stopped_path)] = digest(stopped_path)
for path in [PREVIOUS / "binding.json", PREVIOUS / "launch.py", PREVIOUS / "verify.py", CORRECTION / "packet-manifest.json", CORRECTION / "corrected-universe-recipe.json"]:
    inputs[str(path)] = digest(path)

with ExitStack() as stack:
    for owner, names in [
        (subprocess, ["Popen", "run", "call", "check_call", "check_output", "getoutput", "getstatusoutput"]),
        (os, ["getpid", "getppid", "getpgrp", "getpgid", "getsid", "kill", "killpg", "system", "fork", "posix_spawn", "posix_spawnp", "execv", "execve", "execvp", "execvpe", "spawnv", "spawnve", "spawnvp", "spawnvpe"]),
        (signal, ["signal", "setitimer", "alarm", "raise_signal"]),
    ]:
        for name in names:
            if hasattr(owner, name):
                stack.enter_context(patch.object(owner, name, forbidden))
    calibration = load("independent_fresh_universe_calibration", PACKET / "calibrate.py")
    result = calibration.run(BINDING)
    assert result == read(PACKET / "pure-results.json")
    assert result["acceptedCount"] == 5 and result["rejectedCount"] == 13
    gate = load("independent_fresh_universe_gate", PACKET / "verify.py")
    entry = load("independent_fresh_universe_entry", PACKET / "run.py")
    wrapper = entry.load_wrapper()
    assert wrapper.HERE == PACKET
    assert Path(wrapper.execute.__code__.co_filename) == PREVIOUS / "launch.py"
    assert Path(wrapper.load_gate.__code__.co_filename) == PREVIOUS / "launch.py"
    imported_gate = wrapper.load_gate(BINDING)
    assert imported_gate.HERE == PACKET
    assert Path(imported_gate.verify.__code__.co_filename) == PACKET / "verify.py"
    supervisor = imported_gate.supervisor()
    assert Path(supervisor.run_one.__code__.co_filename) == H.parents[4].parent / "codex-misfits-h02-metadata-receiving-v1/docs/misfits-metadata-receiving-native-list-launcher-v1/launch.py"
    inputs[str(Path(supervisor.run_one.__code__.co_filename))] = digest(Path(supervisor.run_one.__code__.co_filename))
    calls = []
    sentinel = SimpleNamespace(execute=lambda stage, binding: calls.append((stage, binding)) or 23)
    with patch.object(entry, "load_wrapper", return_value=sentinel):
        assert entry.execute(BINDING) == 23
    assert calls == [("universe", BINDING)]
    extra_cases = {}
    for name, mutate in [
        ("changed recipe identity", lambda r: r.update(id="metadata-update-native20-discovery-v1")),
        ("old stdout path", lambda r: r.update(stdoutPath=corrected["stdoutPath"])),
        ("old stderr path", lambda r: r.update(stderrPath=corrected["stderrPath"])),
        ("old JSON argv destination", lambda r: r["argv"].__setitem__(-1, corrected["argv"][-1])),
        ("raised heap", lambda r: r.update(workerNodeHeapMiB=768)),
        ("changed positive quarter", lambda r: r["expectedOutput"]["names"].__setitem__(1, r["expectedOutput"]["names"][1] + " changed")),
    ]:
        wrong = copy.deepcopy(fresh)
        mutate(wrong)
        try:
            gate.check_recipe(wrong, corrected)
        except ValueError as error:
            assert str(error) == "fresh universe differs beyond accepted display correction and fresh identity/output"
            extra_cases[name] = str(error)
        else:
            raise AssertionError("wrong fresh recipe accepted: " + name)
    for stage in ["selector", "receiving", "other"]:
        try:
            imported_gate.verify(BINDING, stage)
        except ValueError as error:
            assert str(error).startswith("only fresh universe")
        else:
            raise AssertionError("unprepared gate accepted: " + stage)
    assert not OUTPUT.exists()

for path, expected_hash in inputs.items():
    assert digest(Path(path)) == expected_hash, path
audit = {
    "status": "ACCEPT bounded fresh-universe source preparation; separate root runtime admission required",
    "inputs": inputs,
    "firstCommand": first,
    "exactFreshRecipeOnly": True,
    "originalWrapperAndRunOneFunctionsUnchanged": True,
    "independentCalibrationReplay": {"accepted": 5, "rejected": 13, "exactFrozenResultMatched": True},
    "independentExtraWrongRecipesRejected": extra_cases,
    "freshSourceIdentity": result["sourcePreflight"]["identity"],
    "freshOutputAbsent": str(OUTPUT),
    "originalStopPreserved": True,
    "runtimeAdmission": False,
    "nativeLaunches": 0,
    "nativeProcessProbes": 0,
    "testPassCredit": False,
    "productRedGreenCredit": False,
    "receivingReachCredit": False,
    "bytecodeWritten": False,
}
audit_path = HERE / "metadata-native-preparation-read-audit-v2.json"
with audit_path.open("x") as handle:
    handle.write(json.dumps(audit, indent=2, sort_keys=True) + "\n")
print(json.dumps({"status": audit["status"], "auditSha256": digest(audit_path), "scriptSha256": digest(Path(__file__))}, indent=2))
