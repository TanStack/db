"""Independent read/hash preflight; native process, probe and signal APIs forbidden."""
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
from contextlib import ExitStack
from unittest.mock import patch

review = Path(__file__).resolve().parent
packet = review.parent / "metadata-update-native-preparation-v1"
manifest_sha = "6bbe4a9975268f5a4a2ef18d00cf9f5d3c98782a35bffd81cd6308e2ce33e228"
binding_sha = "f76ca819782079460124aa2fba14dc203362e5c3a03a435a5d7d30bbdab4ba65"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def forbidden(*args, **kwargs):
    raise AssertionError("native process/probe/signal forbidden in independent audit")


assert digest(packet / "packet-manifest.json") == manifest_sha
manifest = json.loads((packet / "packet-manifest.json").read_text())
assert {p.name for p in packet.iterdir()} == set(manifest["artifacts"]) | {"packet-manifest.json"}
for relative, item in manifest["artifacts"].items():
    path = packet / relative
    assert path.is_file() and not path.is_symlink()
    assert path.stat().st_size == item["bytes"] and digest(path) == item["sha256"]
assert digest(packet / "binding.json") == binding_sha

for name in ("launch.py", "verify.py", "calibrate.py"):
    source = (packet / name).read_text()
    ast.parse(source)
    compile(source, str(packet / name), "exec")

with ExitStack() as stack:
    for owner, names in (
        (subprocess, ("Popen", "run", "call", "check_call", "check_output")),
        (os, ("getpid", "getpgrp", "getpgid", "kill", "killpg", "fork", "system")),
        (signal, ("signal", "setitimer")),
    ):
        for name in names:
            stack.enter_context(patch.object(owner, name, forbidden))
    spec = importlib.util.spec_from_file_location("independent_metadata_native_gate", packet / "verify.py")
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    actual_preflight = gate.verify(binding_sha, "source")

epoch_counts = {}
for version, inventory_sha in (
    (1, "5556a3bd4b48543189ef7095c34dc65bb6d3e0f8d92e38a01727db967e8c2141"),
    (2, "c5cdea6b41d82b331435162ea06b9254be96acff7b7450be79e0c37690cb74b2"),
):
    epoch = review.parent / f"metadata-update-source-v{version}"
    assert digest(epoch / "source-inventory.json") == inventory_sha
    inventory = json.loads((epoch / "source-inventory.json").read_text())
    assert len(inventory) == 588
    for relative, expected in inventory.items():
        assert digest(epoch / "sources" / relative) == expected, (version, relative)
    epoch_counts[f"v{version}"] = len(inventory)

recipes = json.loads((packet / "recipes.json").read_text())
first = json.loads((packet / "first-command.json").read_text())
assert first["executable"] == gate.PYTHON
assert first["argv"] == ["-I", "-B", str(packet / "launch.py"), "--execute-exact-one", "universe", binding_sha]
assert first["cwd"] == str(packet.parent)
program = json.loads((packet / "program.json").read_text())
assert len(set(program["requiredReachStates"])) == 31
assert " > " not in program["filterName"] and " > " in program["displayName"]

future_paths = []
for stage in ("universe", "selector"):
    future_paths.append(Path(recipes[stage]["expectedOutput"]["path"]).parent)
    future_paths.extend(gate.classification_paths(stage).values())
future_paths.append(Path(recipes["receiving"]["freshOutputDirectory"]))
assert all(not p.exists() for p in future_paths)

assert digest(packet / "packet-manifest.json") == manifest_sha
for relative, item in manifest["artifacts"].items():
    assert digest(packet / relative) == item["sha256"], relative
result = {
    "status": "independent read/hash and syntax only; all native process/probe/signal APIs forbidden",
    "manifestSha256": manifest_sha,
    "bindingSha256": binding_sha,
    "packetMembers": len(manifest["artifacts"]),
    "packetBytes": sum(v["bytes"] for v in manifest["artifacts"].values()),
    "sourcePreflight": actual_preflight,
    "bothPreservedSourceEpochsMatch": epoch_counts,
    "firstCommandExactlyMatchesUniverseCandidate": True,
    "pythonAstAndCompileModules": 3,
    "futureOutputAndClassificationPathsAbsent": [str(p) for p in future_paths],
    "packetUnchangedAfterAudit": True,
    "nativeLaunches": 0,
    "nativeProcessProbes": 0,
    "limits": "No native registration/list/body, Collection, receiving, actual result classification or runtime admission. Named source/dependency evidence remains bounded as in the accepted source review.",
}
output = review / "metadata-native-preparation-read-audit-v1.json"
with output.open("x") as file:
    file.write(json.dumps(result, sort_keys=True, indent=2) + "\n")
print(json.dumps(result, sort_keys=True, indent=2))
