"""Independent read/hash/JSON/string/regex/shell-token audit only.

No subject gate, launcher, configuration, model or source module is imported.
No compilation, syntax execution, native test, discovery or process probe.
Only a fresh additive JSON audit is written. Root alone admits and owns lint.
"""
import hashlib
import json
import pathlib
import re
import shlex

R = pathlib.Path(__file__).resolve().parent
H = R.parent
P = H / "metadata-authored-q2-preparation-v1"
C = H / "metadata-next-gap-plan-correction-v2"
V1 = H / "metadata-next-gap-plan-v1"
S = H / "metadata-update-source-v3"
checks = []


def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(pathlib.Path(path).read_text())


def check(label, actual, expected=True):
    checks.append({"label": label, "actual": actual, "expected": expected,
                   "pass": actual == expected})


def pins(directory, mapping, label):
    for name, expected in mapping.items():
        check(label + ": " + name, sha(directory / name), expected)


check("assigned correction freeze", sha(C / "correction-freeze.json"),
      "720909bea5b688c93a4ad43aa87df1dd1e3a9c77ffefda64f6464efaa65bd5b4")
check("assigned manifest", sha(P / "packet-manifest.json"),
      "7e06d8eff512e65a546d49c70c5b2b2524a19034c1606258e889eabf1cabaa58")
check("assigned binding", sha(P / "binding.json"),
      "28f01a4e9f5b04c06f3934ad908b3a1bf9056e8a87667fb95088fbc708cfbd4c")
check("assigned first command", sha(P / "first-command.json"),
      "ab46c417199a7ddb1c7eb82f1f21de78962eee59c61cb6912c87d4ed1508c887")
correction_freeze = read(C / "correction-freeze.json")
pins(C, correction_freeze["members"], "correction member")
for key in ["predecessorPlanFreeze", "independentReview", "rootClassification"]:
    pointer = correction_freeze[key]
    check("correction pointer " + key, sha(pointer["path"]), pointer["sha256"])
manifest = read(P / "packet-manifest.json")
pins(P, manifest["members"], "manifest member")
binding = read(P / "binding.json")
pins(P, binding["files"], "binding own member")
check("32 external inputs", len(binding["externalInputs"]), 32)
for path, expected in binding["externalInputs"].items():
    check("external input " + path, sha(path), expected)

old = read(V1 / "mutants.json")
new = read(C / "mutant-classifier.json")
check("eight specs", len(new["matrix"]), 8)
check("same ordered mutant IDs", [m["id"] for m in new["matrix"]],
      [m["id"] for m in old["matrix"]])
for field in ["law", "unmutatedDriverSuccessor", "unexercisedGeneratedNeighbors",
              "sourceAndRuntimeAdmission"]:
    check("unchanged top-level " + field, new[field], old[field])
changed_checkpoints = []
diff_inventory = []
for before, after in zip(old["matrix"], new["matrix"]):
    ident = after["id"]
    differences = [k for k in set(before) | set(after) if before.get(k) != after.get(k)]
    full = "full-current" in ident
    check(ident + " allowed entry diff", sorted(differences),
          sorted(["intendedComparison", "requiredObservation", "resultClassification",
                  "predecessorIntendedComparison", "firstFailureAndCleanup"]
                 if full else ["intendedComparison"]))
    comparator = after["intendedComparison"]
    if full:
        changed_checkpoints.append(ident)
        check(ident + " historical comparison preserved",
              after["predecessorIntendedComparison"], before["intendedComparison"])
        check(ident + " target ordinary function", comparator["function"],
              "checkReplayPublication inside createProgressReceiptCheck")
        check(ident + " exact ordinary assertion label",
              "event update carries the preceding public value" in comparator["callSite"])
        check(ident + " no metadata invocation credit",
              comparator["metadataComparatorInvocationCredit"], False)
        check(ident + " no metadata sensitivity credit",
              comparator["metadataComparatorSensitivityCredit"], False)
        check(ident + " preserves first divergence",
              "Preserve the first observation error and stop" in comparator["firstDivergencePolicy"])
        check(ident + " no manufactured late completion",
              "No normal followup-publication/worker-cleaned completion is required" in
              after["firstFailureAndCleanup"])
        bobs, aobs = dict(before["requiredObservation"]), dict(after["requiredObservation"])
        bobs.pop("currentRows")
        aobs.pop("currentRows")
        check(ident + " other observation obligations preserved", aobs, bobs)
        for index in [1, 2, 4, 5, 6]:
            check(ident + f" result class {index} preserved",
                  after["resultClassification"][index], before["resultClassification"][index])
    else:
        check(ident + " all old comparison fields preserved",
              {key: comparator[key] for key in before["intendedComparison"]},
              before["intendedComparison"])
        check(ident + " source prediction only", comparator["sourcePredictionOnly"])
        check(ident + " retains omission distinction",
              "bypasses the conditional ordinary previous-value assertion" in
              comparator["omissionDistinction"])
        check(ident + " first divergence final",
              "preserve it and stop" in comparator["firstDivergencePolicy"])
    diff_inventory.append({"id": ident, "changedFields": sorted(differences),
                           "comparator": comparator})
check("exact four changed checkpoints", changed_checkpoints,
      read(C / "finding-ledger.json")["correctedIds"])

recipe = read(P / "recipe.json")
prior_recipe = next(r for r in read(V1 / "baseline-recipes.json")["recipes"]
                    if r["id"] == "followup-scope-authored-q2")
check("exact previously reviewed recipe", recipe, prior_recipe)
first = read(P / "first-command.json")
check("one invocation", first["maxInvocations"], 1)
check("exact command interpreter", first["executable"], "/bin/zsh")
check("exact command argv", first["argv"],
      [str(P / "launcher-scope-authored-q2.zsh"), sha(P / "binding.json")])
check("exact command cwd", first["cwd"], str(H))
check("not a campaign", first["selection"]["generatedCampaign"], False)
check("exact selected history", first["selection"]["history"], recipe["receivingHistory"])
check("one pass/19 skips/one history/31 states",
      [first["selection"][key] for key in ["expectedPassedTests", "expectedSkippedTests",
                                          "historyCount", "declaredStateCount"]],
      [1, 19, 1, 31])
names = read(H / "metadata-update-native-discovery-v2/names.json")
selector = recipe["argv"][-1]
selected = [n["name"] for n in names if re.fullmatch(selector, n["name"].replace(" > ", " "))]
check("one exact preserved selected name", selected, [recipe["expectedDisplayName"]])
check("selector keeps both anchors", selector.startswith("^") and selector.endswith("$"))
check("reject appended suffix", re.fullmatch(selector, recipe["expectedFilterName"] + " extra") is None)
requirements = read(P / "evidence-requirements.json")
check("31 unique declared states", len(set(requirements["reach"]["states"])), 31)
check("one actual raw successful history required", requirements["successfulHistoryCount"], 1)

launcher = (P / "launcher-scope-authored-q2.zsh").read_text()
lines = [line for line in launcher.splitlines() if line and not line.startswith("#")]
tokens = [shlex.split(line) for line in lines]
positions = [t[0] for t in tokens]
python = "/opt/homebrew/opt/python@3.14/bin/python3.14"
check("exact allowed command positions", positions,
      ["set", "if", "print", "exit", "fi", "cd", "mkdir", "mkdir", python, "/bin/ps", "exec"])
check("strict shell settings", tokens[0], ["set", "-euo", "pipefail"])
check("exact source cwd", tokens[5], ["cd", recipe["cwd"]])
output = pathlib.Path(recipe["freshOutputDirectory"])
check("parent mkdir may create/reuse container", tokens[6],
      ["mkdir", "-p", "-m", "700", str(output.parent)])
check("exclusive output mkdir before redirects/preflight", tokens[7],
      ["mkdir", "-m", "700", str(output)])
check("exact bound preflight argv/redirect", tokens[8],
      [python, "-I", "-B", str(P / "verify.py"), "--binding", "$1", "--gate", "receiving",
       ">", str(output / "source-prelaunch.json")])
check("process capture before exec", tokens[9],
      ["/bin/ps", "-o", "pid=,pgid=,rss=,args=", "-p", "$$", ">", str(output / "launcher-process.txt")])
expected_exec = ["exec", "env"]
for key in recipe["envUnset"]:
    expected_exec += ["-u", key]
expected_exec += [key + "=" + value for key, value in recipe["envSet"].items()]
expected_exec += [recipe["executable"], *recipe["argv"], ">", str(output / "outer-vitest.log"), "2>&1"]
check("exact inner argv/env/log tokens", tokens[10], expected_exec)
check("leaf output absent now", output.exists() or output.is_symlink(), False)
check("parent absent or ordinary directory", not output.parent.is_symlink() and
      (not output.parent.exists() or output.parent.is_dir()))

gate = (P / "verify.py").read_text()
check("own files/external checked before inherited import",
      gate.index("for name, expected in binding['files'].items():") <
      gate.index("for name, expected in binding['externalInputs'].items():") <
      gate.index("prior = previous_gate()"))
check("predecessor binding/gate checked before loading module",
      gate.index("digest(PREVIOUS / 'binding.json')") <
      gate.index("digest(PREVIOUS / 'verify.py')") <
      gate.index("spec.loader.exec_module(module)"))
check("calls accepted receiving gate", "prior_result = prior.verify(PREVIOUS_SHA, gate)" in gate)
check("retains passive raw baseline",
      "prior_result.pop('receivingEvidenceBaseline')" in gate)

chain = [
    ("metadata-fixed-campaign-preparation-v1", "26be3cc8983e93699c523f374990043ba077433f7103e3078cda98c6fe7aabe1"),
    ("metadata-update-receiving-preparation-v3", "710cea233b1d57bdf9aeda39ea6fcadc317bfa0dd8d482776af30c6d07c02470"),
    ("metadata-update-receiving-preparation-v2", "ec925ca31d325cadf8a28e597c1d6ea0185fe79b0e1d4ef8b97b5333e0f5f238"),
    ("metadata-update-native-selector-preparation-v2", "bdd159931e7c4603d30f5bec97ad1953257226bb3f93a24e24ea1dc76a97f4c6"),
    ("metadata-update-native-preparation-v2", "86ccd3bf644d96f43e726f1e805c4b8850754707b7bb88c48ccd802cd90bd7b9"),
    ("metadata-update-native-preparation-v1", "f76ca819782079460124aa2fba14dc203362e5c3a03a435a5d7d30bbdab4ba65")]
chain_summary = []
for name, expected in chain:
    directory = H / name
    check("inherited gate binding " + name, sha(directory / "binding.json"), expected)
    b = read(directory / "binding.json")
    check("inherited gate exact verify source " + name, sha(directory / "verify.py"), b["files"]["verify.py"])
    chain_summary.append({"directory": str(directory), "bindingSha256": expected,
                          "verifySha256": sha(directory / "verify.py")})
fixed_gate = (H / chain[0][0] / "verify.py").read_text()
recv3_gate = (H / chain[1][0] / "verify.py").read_text()
recv2_gate = (H / chain[2][0] / "verify.py").read_text()
original_gate = (H / chain[-1][0] / "verify.py").read_text()
check("fixed gate receiving baseline retained",
      "prior.previous_gate().receipt_baseline()" in fixed_gate)
check("receiving baseline is passive with no selected artifact",
      "PASSIVE PRELAUNCH CANDIDATES ONLY; no artifact selected" in recv2_gate)
check("v3 full named inventory source-equivalence gate retained",
      "len(inventory) == 589" in recv3_gate and
      "for name, sha in inventory.items():" in recv3_gate and
      "changed == {SUPERVISOR}" in recv3_gate)
check("original named dependency/tool gate retained",
      all(text in original_gate for text in ["payload_count == 2544", "source['node']['executable']",
                                           "sys.executable == PYTHON", "source['lockfiles']"]))

freeze = read(S / "source-freeze.json")
inventory = read(S / "source-inventory.json")
check("exact source freeze", sha(S / "source-freeze.json"), binding["sourceFreezeSha256"])
check("exact source inventory", sha(S / "source-inventory.json"), freeze["sourceInventorySha256"])
check("589 named source members", len(inventory), 589)
source_bad = [name for name, expected in inventory.items() if sha(S / "sources" / name) != expected]
check("all589 named source hashes", source_bad, [])
check("511 production names agree with inventory", len(freeze["productionFiles"]), 511)
check("all511 production hashes mapped into inventory",
      all(inventory.get(name) == expected for name, expected in freeze["productionFiles"].items()))
check("Node effective executable", recipe["executable"], freeze["node"]["executable"])
check("Node current binary", sha(freeze["node"]["executable"]), freeze["node"]["sha256"])
python_sha = re.search(r"PYTHON_SHA = '([0-9a-f]{64})'", original_gate).group(1)
check("Python current binary", sha(python), python_sha)
check("source lockfile", sha(S / "sources/pnpm-lock.yaml"), freeze["lockfiles"]["repoPnpmLock"])
check("installed lockfile", sha(S / "sources/node_modules/.pnpm/lock.yaml"), freeze["lockfiles"]["installedPnpmLock"])
payload_count = 0
package_summary = []
for name, package in freeze["packages"].items():
    base = pathlib.Path(package["resolved"])
    check("effective package resolution " + name,
          str((S / "sources" / package["logical"]).resolve()), str(base))
    bad = [member for member, expected in package["regularPayloadFilesMap"].items()
           if sha(base / member) != expected]
    check("named own payload hashes " + name, bad, [])
    payload_count += len(package["regularPayloadFilesMap"])
    package_summary.append({"name": name, "resolved": str(base),
                            "namedPayloadCount": len(package["regularPayloadFilesMap"]),
                            "mismatches": bad})
check("nine named packages", len(package_summary), 9)
check("2544 named own payload hashes", payload_count, 2544)
for member, item in freeze["dependencyReuseLinks"].items():
    path = S / "sources" / member
    check("reuse symlink kind " + member, path.is_symlink(), item["isSymlink"])
    check("reuse effective resolution " + member, str(path.resolve()), item["resolved"])

recovery_path = next(path for path in binding["externalInputs"]
                     if path.endswith("root-shared-toolchain-recovery-qualification-v1.json"))
recovery = read(recovery_path)
for key in ["actualRepair", "postAudit", "closeout", "formattingAccount"]:
    item = recovery[key]
    check("recovery exact evidence " + key, sha(item["path"]), item["sha256"])
check("recovery limit keeps unaffected exactbinding admission separate",
      "No generic runtime authority" in recovery["runtimeHold"])
initial = read(P / "static-audit-initial-failure.json")
check("initial classifier failure preserved", initial["failedCheck"], "noSourceMutationCommands")
check("literal .pnpm path does not occupy command position",
      any("node_modules/.pnpm/" in token for token in tokens[10]) and
      all("pnpm" not in position for position in positions))
check("author corrected audit did not execute gate", read(P / "static-results.json")["gateExecuted"], False)

result = {"kind": "Independent SOURCE ONLY F01 correction/authored-q2 packet review",
          "checks": checks, "allStaticChecksPass": all(c["pass"] for c in checks),
          "allowedF01DiffInventory": diff_inventory, "inheritedGateChain": chain_summary,
          "namedSourceAndPackageHashEvidence": {"sourceMembers": 589, "productionMembers": 511,
                                                "packages": package_summary,
                                                "namedPayloadCount": payload_count},
          "exactOneShotProposal": first,
          "sourceOnlyVerdict": "F01 plan correction accepted; exact one-shot proposal eligible for ROOT decision, no runtime admitted by this review.",
          "limits": ["No subject gate/launcher/config/model/source import or execution.",
                     "No syntax/compiler/native/discovery/process probe/mutant/Git/PR/install/canonical operation.",
                     "Named maps rehashed; no complete transitive package/host/native/dist or extra-file equivalence.",
                     "Raw selection, actual completion, all31 reach and cleanup remain future evidence obligations.",
                     "Preserved prior invocation/finalizer/UUID ordinal/parent-V8/initial-inner-getpgid/typecheck/coverage limits remain.",
                     "Review does not admit a command or next-step progression; ROOT alone admits."],
          "runtimeAdmission": False, "actualMutants": 0, "rootOwnsLint": True}
output_path = R / "metadata-authored-q2-and-F01-independent-audit-v2.json"
with output_path.open("x") as handle:
    json.dump(result, handle, indent=2)
    handle.write("\n")
print(json.dumps({"output": str(output_path), "sha256": sha(output_path),
                  "checkCount": len(checks), "pass": result["allStaticChecksPass"],
                  "failures": [c for c in checks if not c["pass"]]}, indent=2))
