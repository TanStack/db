"""Independent receiving source/runtime-suitability audit; no native runtime path."""
import ast
import copy
from contextlib import ExitStack, nullcontext
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import signal
import stat
import subprocess
import tempfile
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
H = HERE.parent
PACKET = H / "metadata-update-receiving-preparation-v2"
P1 = H / "metadata-update-native-preparation-v1"
SOURCE = H / "metadata-update-source-v2/sources"
OUTPUT = H / "metadata-update-native-scope-default-q2-v2"
BINDING = "ec925ca31d325cadf8a28e597c1d6ea0185fe79b0e1d4ef8b97b5333e0f5f238"
MANIFEST = "d019dfef5829b69817bcd8ae5c50c22aafc9ece643bac3ed816cb6169c82830a"


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
    raise AssertionError("native process/probe/signal API forbidden during receiving source/pure audit")


manifest_path = PACKET / "packet-manifest.json"
assert digest(manifest_path) == MANIFEST
manifest = read(manifest_path)
assert len(manifest["artifacts"]) == 10
assert {p.name for p in PACKET.iterdir()} == set(manifest["artifacts"]) | {"packet-manifest.json"}
inputs = {str(manifest_path): digest(manifest_path)}
for name, item in manifest["artifacts"].items():
    path = PACKET / name
    assert len(path.read_bytes()) == item["bytes"] and digest(path) == item["sha256"], name
    inputs[str(path)] = digest(path)
assert digest(PACKET / "binding.json") == BINDING
binding = read(PACKET / "binding.json")
for name, expected_hash in binding["files"].items():
    assert digest(PACKET / name) == expected_hash
assert not binding["newRuntimeAdmitted"] and not binding["newSupervisor"]
first = read(PACKET / "first-command.json")
assert first["executable"] == "/bin/zsh" and first["argv"] == [str(PACKET / "launcher-scope-default-q2.zsh"), BINDING]
assert first["cwd"] == str(H) and first["maxInvocations"] == 1
recipes = read(PACKET / "recipes.json")
assert set(recipes) == {"status", "receiving"}
recipe = recipes["receiving"]
original = read(P1 / "recipes.json")["receiving"]
program = read(P1 / "program.json")
expected = copy.deepcopy(original)
expected["freshOutputDirectory"] = str(OUTPUT)
assert recipe == expected
assert program["history"] == recipe["receivingHistory"]
assert hashlib.sha256(json.dumps(program["history"], sort_keys=True, separators=(",", ":")).encode()).hexdigest() == program["canonicalProgramSha256"] == binding["canonicalProgramSha256"]
assert len(program["requiredReachStates"]) == len(set(program["requiredReachStates"])) == 31
shell = (PACKET / "launcher-scope-default-q2.zsh").read_text()
old_shell = (P1 / "launcher-scope-default-q2.zsh").read_text()
assert shell == old_shell.replace(str(P1 / "verify.py"), str(PACKET / "verify.py")).replace(str(H / "metadata-update-native-scope-default-q2-v1"), str(OUTPUT))
lines = shell.splitlines()
tokens = ["exec", "env"]
for key in recipe["envUnset"]:
    tokens += ["-u", key]
tokens += [f"{key}={value}" for key, value in recipe["envSet"].items()]
tokens += [recipe["executable"], *recipe["argv"], ">", str(OUTPUT / "outer-vitest.log"), "2>&1"]
assert shlex.split(lines[-1]) == tokens
assert lines.index(next(line for line in lines if "--gate receiving" in line)) < lines.index(next(line for line in lines if line.startswith("/bin/ps "))) < len(lines) - 1
assert not OUTPUT.exists()
for name in ["verify.py", "calibrate.py"]:
    tree = ast.parse((PACKET / name).read_text(), filename=name)
    compile(tree, name, "exec")
inventory_path = H / "metadata-update-source-v2/source-inventory.json"
inventory = read(inventory_path)
for relative in [
    "packages/query-db-collection/tests/queued-answer-progress-supervisor.ts",
    "packages/query-db-collection/tests/queued-answer-progress-driver.ts",
    "packages/query-db-collection/tests/queued-answer-metadata-oracle.test.ts",
    "packages/query-db-collection/tests/queued-answer-metadata-oracle.ts",
    "scripts/h02-progress/receipt-transport.mjs",
    "scripts/h02-progress/verify-bindings.mjs",
]:
    path = SOURCE / relative
    assert digest(path) == inventory[relative]
    inputs[str(path)] = digest(path)
supervisor_path = SOURCE / "packages/query-db-collection/tests/queued-answer-progress-supervisor.ts"
assert digest(supervisor_path) == "49a221be1f01db107b1d85218a48fdc3a30c3a6b233e5b119ec61925f1675772"
for path in [P1 / "recipes.json", P1 / "program.json", P1 / "launcher-scope-default-q2.zsh", inventory_path]:
    inputs[str(path)] = digest(path)

# Create synthetic directories before forbidding process identity APIs used by
# Python's temporary-name implementation. No real receiving candidates are read.
with tempfile.TemporaryDirectory(prefix="metadata-receiving-review-", dir="/private/tmp") as temporary:
    fixture = Path(temporary)
    calibration_fixture = fixture / "author-controls"
    calibration_fixture.mkdir()
    with ExitStack() as stack:
        for owner, names in [
            (subprocess, ["Popen", "run", "call", "check_call", "check_output", "getoutput", "getstatusoutput"]),
            (os, ["getpid", "getppid", "getpgrp", "getpgid", "getsid", "kill", "killpg", "system", "fork", "posix_spawn", "posix_spawnp", "execv", "execve", "execvp", "execvpe", "spawnv", "spawnve", "spawnvp", "spawnvpe"]),
            (signal, ["signal", "setitimer", "alarm", "raise_signal"]),
        ]:
            for name in names:
                if hasattr(owner, name):
                    stack.enter_context(patch.object(owner, name, forbidden))
        calibration = load("independent_receiving_calibration", PACKET / "calibrate.py")
        with patch.object(calibration.tempfile, "TemporaryDirectory", return_value=nullcontext(str(calibration_fixture))):
            calibrated = calibration.run(BINDING)
        assert calibrated == read(PACKET / "pure-results.json")
        assert calibrated["acceptedCount"] == 7 and calibrated["rejectedCount"] == 19
        gate = load("independent_receiving_preflight", PACKET / "verify.py")
        selector, checker = gate.accepted_selector()
        assert Path(checker.verify_classification.__code__.co_filename) == P1 / "verify.py"
        assert checker.classification_paths is gate.selector_paths
        assert selector["nativeNames"] == 1
        rejected = []
        for name, mutate in [
            ("raised inner heap", lambda r: r["innerReceivingBudget"].update(nodeHeapMiB=768)),
            ("changed key shift", lambda r: r["receivingHistory"].update(keyShift=1)),
            ("changed rank scale", lambda r: r["receivingHistory"].update(rankScale=100)),
            ("added generated property", lambda r: r.update(property="other")),
            ("changed executable", lambda r: r.update(executable="/other/node")),
        ]:
            wrong = copy.deepcopy(recipe)
            mutate(wrong)
            try:
                gate.check_recipe(wrong, original, program)
            except ValueError as error:
                assert str(error) == "receiving differs beyond fresh output path"
                rejected.append(name)
            else:
                raise AssertionError("wrong receiving recipe accepted: " + name)
        baseline_fixture = fixture / "independent-baseline"
        baseline_fixture.mkdir()
        (baseline_fixture / "h02-progress-directory").mkdir()
        (baseline_fixture / "h02-progress-file").write_text("synthetic")
        (baseline_fixture / "h02-progress-symlink").symlink_to(baseline_fixture / "h02-progress-directory")
        baseline = gate.receipt_baseline(baseline_fixture)
        assert set(baseline["members"]) == {"h02-progress-directory", "h02-progress-file", "h02-progress-symlink"}
        assert stat.S_ISDIR(baseline["members"]["h02-progress-directory"]["mode"])
        assert stat.S_ISREG(baseline["members"]["h02-progress-file"]["mode"])
        assert stat.S_ISLNK(baseline["members"]["h02-progress-symlink"]["mode"])
        assert "selected" not in baseline and "artifact" not in baseline
        assert not OUTPUT.exists()
for path, expected_hash in inputs.items():
    assert digest(Path(path)) == expected_hash, path
audit = {
    "status": "ACCEPT bounded receiving source/runtime-suitability preparation; root one-shot admission required",
    "inputs": inputs,
    "firstCommand": first,
    "independentAuthorCalibrationReplay": {"accepted": 7, "rejected": 19, "exactFrozenResultMatched": True},
    "independentWrongRecipesRejected": rejected,
    "fullSourceAndBothPriorEpochs": calibrated["sourceAndPriorResultPreflight"],
    "shellExactInheritedPatternAndParsedArgv": True,
    "independentShellSyntaxExecution": False,
    "syntaxEvidence": "Frozen author zsh -n exit0 and empty log inspected; reviewer parsed source/tokens only.",
    "baselineCalibration": "Synthetic roots only; lstat distinguishes directories/files/symlinks, selects nothing. No actual receiving candidate inventory executed.",
    "freshOutputAbsent": str(OUTPUT),
    "nativeLaunches": 0,
    "nativeProcessProbes": 0,
    "runtimeAdmission": False,
    "testBodyPassCredit": False,
    "productRedGreenCredit": False,
    "receivingReachCredit": False,
    "bytecodeWritten": False,
    "limits": ["Stable metadata; direct eager source update only", "Child binding does not prove parent checker compiled/invoked provenance", "Original childPid group targeting lacks separately persisted initial actual getpgid", "60s Vitest test timeout is not a new hard outer command watchdog", "Passive baseline is not artifact identity; unique actual identity match and original-ID absence still required"],
}
out = HERE / "metadata-update-receiving-preparation-read-audit-v2.json"
with out.open("x") as handle:
    handle.write(json.dumps(audit, indent=2, sort_keys=True) + "\n")
print(json.dumps({"status": audit["status"], "auditSha256": digest(out), "scriptSha256": digest(Path(__file__))}, indent=2))
