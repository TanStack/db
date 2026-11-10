"""Independent recorded-evidence audit; no subject imports or process probes.

Only Python standard library read/hash/JSON/string work runs. No native lane,
model, checker, configuration, capture script or absence script is executed.
The event reconstruction is recorded-evidence consistency, not a new oracle.
"""
from pathlib import Path
import collections
import hashlib
import json
import re

R = Path(__file__).resolve().parent
H = R.parent
A = H / "metadata-authored-q2-actual-v1"
P = H / "metadata-authored-q2-preparation-v1"
S = H / "metadata-update-source-v3"
checks = []


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def lines(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines()]


def check(label, actual, expected=True):
    checks.append({"label": label, "actual": actual, "expected": expected,
                   "pass": actual == expected})


check("assigned capture manifest", sha(A / "capture-manifest.json"),
      "9522fa338cd148a0353553bf0964202d527c56f76a4c7e2c0ddd9265966fe4e4")
check("assigned raw manifest", sha(A / "raw-manifest.json"),
      "f665deab9129653f917989234ebff891b1907460f99b4ac26bfc317880693e1f")
check("assigned report", sha(A / "report.md"),
      "b79c198abdab7d7a7fb7080239254b424ebf36838cc194706356d30db7383f9e")
manifest = read(A / "capture-manifest.json")
for name, expected in manifest["files"].items():
    check("capture member " + name,
          {"bytes": (A / name).stat().st_size, "sha256": sha(A / name)}, expected)
raw_manifest = read(A / "raw-manifest.json")
check("1954 preserved files", len(raw_manifest), 1954)
check("31401025 preserved bytes", sum(x["bytes"] for x in raw_manifest.values()), 31401025)
bad_copies, bad_originals = [], []
for name, expected in raw_manifest.items():
    copy, original = A / name, Path(expected["original"])
    if (not copy.is_file() or copy.is_symlink() or copy.stat().st_size != expected["bytes"]
            or sha(copy) != expected["sha256"]):
        bad_copies.append(name)
    if (not original.is_file() or original.is_symlink() or original.stat().st_size != expected["bytes"]
            or sha(original) != expected["sha256"]):
        bad_originals.append(name)
check("all copies exact", bad_copies, [])
check("all originals exact", bad_originals, [])
raw_roots = list((A / "raw-histories").iterdir())
check("one preserved raw history directory", len(raw_roots), 1)
raw = raw_roots[0]
check("exact recorded UUID", raw.name,
      "h02-progress-71040-04724b7e-0737-4566-bdf4-576d7363ee6b")
original = Path(raw_manifest[str((raw / "history.json").relative_to(A))]["original"]).parent
check("1948 inner files", len(list(f for f in raw.rglob("*") if f.is_file())), 1948)
outer_files = sorted(p.name for p in (A / "raw-outer").iterdir())
check("three outer files", outer_files,
      ["launcher-process.txt", "outer-vitest.log", "source-prelaunch.json"])

first = read(P / "first-command.json")
requirements = read(P / "evidence-requirements.json")
history = requirements["history"]
admission = read(A / "actual-root-admission.json")
initial = read(A / "actual-initial-exec-return.json")
final = read(A / "actual-final-exec-return.json")
check("exact admitted proposal", admission["proposal"], first)
check("single admitted invocation", [admission["admittedRuntime"], admission["maxInvocations"]], [True, 1])
check("initial tool/session", [initial["response"]["chunk_id"], initial["response"]["session_id"]],
      ["e143cb", 35271])
check("actual separate outer final", [final["sessionId"], final["response"]["chunk_id"],
                                     final["response"]["exit_code"]], [35271, "12ec83", 0])
log = (A / "raw-outer/outer-vitest.log").read_text()
pass_lines = [line for line in log.splitlines() if line.startswith(" ✓ ")]
check("exact sole selected pass", pass_lines,
      [" ✓ packages/query-db-collection/tests/queued-answer-metadata-oracle.test.ts > " +
       first["selection"]["displayName"] + " 2372ms"])
check("19 skipped names", len([line for line in log.splitlines() if line.startswith(" ↓ ")]), 19)
check("native pass summary", "Tests  1 passed | 19 skipped (20)" in log)
check("no generated seed suffix", "(with seed=" not in log)
blocks = re.findall(r"H02 metadata receiving reach \{.*?counts: \{(.*?)\n  \}\n\}", log, re.S)
check("one reach block", len(blocks), 1)
counts = dict((key, int(value)) for key, value in re.findall(r"'([^']+)': (\d+)", blocks[0]))
check("31 declared counts", sorted(counts), sorted(requirements["reach"]["states"]))
check("every count exactly one", list(sorted(set(counts.values()))), [1])
prelaunch = read(A / "raw-outer/source-prelaunch.json")
check("actual prelaunch binding", prelaunch["bindingSha256"], first["bindingSha256"])
check("actual top singleton scope", [prelaunch["history"], prelaunch["historyCount"],
                                    prelaunch["generatedCampaign"], prelaunch["property"],
                                    prelaunch["multiplier"]], [history, 1, False, None, 1])
baseline = prelaunch["receivingEvidenceBaseline"]
check("32 baseline candidates", len(baseline["members"]), 32)
candidate_record = read(A / "candidate-selection.json")
check("exact captured baseline", candidate_record["passiveBaseline"], baseline)
matching = []
for path in Path(baseline["temporaryRoot"]).iterdir():
    if not path.name.startswith("h02-progress-") or path.name in baseline["members"]:
        continue
    if not (path / "prepared.json").is_file() or not (path / "history.json").is_file():
        continue
    prepared_candidate = read(path / "prepared.json")
    if prepared_candidate.get("cwd") == str(S / "sources") and read(path / "history.json") == history:
        matching.append(str(path.resolve()))
check("unique matching original by complete history/source", matching, [str(original.resolve())])

prepared = read(raw / "prepared.json")
supervisor = read(raw / "supervisor.json")
writer = read(raw / "receipts.jsonl.writer.json")
outcome = supervisor["outcome"]
receipts = lines(raw / "receipts.jsonl")
check("206 contiguous raw receipts", [r["sequence"] for r in receipts], list(range(1, 207)))
check("all receipts carry transport marker", all(r["h02"] is True for r in receipts))


def one(phase):
    selected = [r for r in receipts if r["phase"] == phase]
    check("one raw " + phase, len(selected), 1)
    return selected[0]


check("complete canonical original history", read(raw / "history.json"), history)
start = one("worker-start")
check("complete worker history", start["history"], history)
check("exact worker source/tool", [start["cwd"], start["execPath"]],
      [str(S / "sources"), read(S / "source-freeze.json")["node"]["executable"]])
for key in ["directory", "historyPath", "receiptTransport", "limits", "executable", "args"]:
    check("prepared/supervisor " + key, prepared[key], supervisor[key])
check("original path resolves", str(Path(prepared["directory"]).resolve()), str(original.resolve()))
check("original history path resolves", str(Path(prepared["historyPath"]).resolve()), str((original / "history.json").resolve()))
check("original receipt path resolves", str(Path(writer["path"]).resolve()), str((original / "receipts.jsonl").resolve()))
check("outcome log writer identity", str(Path(outcome["logPath"]).resolve()), str(Path(writer["path"]).resolve()))
check("exclusive regular writer", [writer["flags"], writer["mode"], writer["regularFile"]], ["wx", 384, True])
check("leader/writer identities", [supervisor["pid"], writer["pid"]], [71052, 71056])
check("unchanged inner limits", supervisor["limits"],
      {"wallMs": 20000, "groupRssBytes": 1073741824, "nodeHeapMiB": 384, "postEnqueueWindowMs": 1000})
check("child separate normal exit", [outcome["reason"], outcome["exitCode"], outcome["signal"], outcome["bindingStatus"]],
      ["exited", 0, None, "bound"])
check("no first observation/cleanup/prefix/warning failure",
      [outcome.get("primaryObservationError"), outcome["cleanupErrors"], outcome["prefixViolations"], outcome["warnings"]],
      [None, [], 0, 0])
check("normal final supervisor", [supervisor["phase"], supervisor["killAttempted"],
                                  supervisor["heapDiagnosticDetected"], supervisor["latestGroupRows"]],
      ["final-with-binding", False, False, []])
check("RSS/time within inner limits", supervisor["maxSampledGroupRssBytes"] < 1073741824 and supervisor["elapsedMs"] < 20000)
retained_source = (S / "sources/packages/query-db-collection/tests/queued-answer-progress-receipts.ts").read_text()
retained_phases = set(re.findall(r"`([^`]+)`", retained_source))
check("exact retained23 raw receipts", outcome["receipts"],
      [r for r in receipts if r["phase"] in retained_phases])
check("retained count", len(outcome["receipts"]), 23)
identity = one("metadata-identities")
check("actual key lane", identity["keyLane"], "authored")
check("three distinct actual identities", len({identity[k] for k in ["sourceId", "rootId", "downstreamId"]}), 3)


def attributed(layer, ident, rank):
    # Accepted authored getKey and ordinary-projection attribution, applied to
    # this recorded fixture. IDs come from the actual current-run receipt.
    row = {"id": ident, "rank": rank, "markers": [], "$hasPendingWrites": False,
           "$origin": "remote", "$key": f"metadata-{layer}-{ident}",
           "$collectionId": identity[layer + "Id"]}
    if layer == "downstream":
        row.update(observedKey=f"metadata-root-{ident}", observedCollectionId=identity["rootId"],
                   observedOrigin="remote", observedPending=False)
    return row


cuts = {phase: one(phase) for phase in ["initial-publication", "retained-publication",
                                       "final-publication", "followup-publication"]}
cut_coordinates = [("initial-publication", 87, 4, 40), ("retained-publication", 134, 4, 40),
                   ("final-publication", 161, 3, 30), ("followup-publication", 185, 3, 35)]
for phase, sequence, ident, rank in cut_coordinates:
    cut = cuts[phase]
    check(phase + " sequence", cut["sequence"], sequence)
    for layer, field, entries in [("root", "rows", "entries"),
                                   ("downstream", "downstream", "downstreamEntries")]:
        expected = attributed(layer, ident, rank)
        check(phase + " complete " + layer + " public row", cut[field], [expected])
        check(phase + " complete " + layer + " entries", cut[entries], [[expected["$key"], expected]])
check("held actual provider premise", [cuts["retained-publication"]["reason"],
                                      cuts["retained-publication"]["pendingProviderAnswers"]],
      ["provider-hold-before-release", 3])
check("checked reload baseline settled", [cuts["final-publication"][k] for k in
      ["reloadSettled", "rootSubscriptionStatus", "downstreamSubscriptionStatus", "rootLoadingSubset", "downstreamLoadingSubset"]],
      [True, "ready", "ready", False, False])
callbacks = [r for r in receipts if r["phase"] in ["public-change", "downstream-change"]]
check("every callback original order", [c["sequence"] for c in callbacks], [83, 84, 85, 86, 159, 160, 182, 183])
states = {"root": {}, "downstream": {}}
event_checks = []
for callback in callbacks:
    layer = "root" if callback["phase"] == "public-change" else "downstream"
    current = states[layer]
    seen = set()
    for change in callback["changes"]:
        key = change["key"]
        check(f"callback{callback['sequence']} distinct message key " + key, key not in seen)
        seen.add(key)
        if change["type"] == "insert":
            check(f"callback{callback['sequence']} insertion has no prior", key not in current)
            check(f"callback{callback['sequence']} insert exact value key", change["value"]["$key"], key)
            current[key] = change["value"]
        elif change["type"] == "delete":
            check(f"callback{callback['sequence']} deletion complete prior", change["value"], current.get(key))
            current.pop(key)
        elif change["type"] == "update":
            check(f"callback{callback['sequence']} update complete previous", change.get("previousValue"), current.get(key))
            check(f"callback{callback['sequence']} retained actual key", change["value"]["$key"], key)
            current[key] = change["value"]
        else:
            check("unknown operation", change["type"], "insert/delete/update")
    model_id, model_rank = (4, 40) if callback["sequence"] < 88 else ((3, 30) if callback["sequence"] < 162 else (3, 35))
    expected = attributed(layer, model_id, model_rank)
    check(f"callback{callback['sequence']} complete modeled rows", callback["rows"], [expected])
    check(f"callback{callback['sequence']} complete synchronous entries", callback["entries"], [[expected["$key"], expected]])
    check(f"callback{callback['sequence']} complete event-derived snapshot", list(current.values()), callback["rows"])
    if layer == "downstream":
        expected_root = attributed("root", model_id, model_rank)
        check(f"callback{callback['sequence']} complete upstream entries", callback["upstreamEntries"],
              [[expected_root["$key"], expected_root]])
        check(f"callback{callback['sequence']} upstream matches actual earlier root", list(states["root"].values()), [expected_root])
    event_checks.append(callback)
check("both empty callbacks retained", [c["sequence"] for c in callbacks if not c["changes"]], [85, 86])
for phase, seq in [("reload-start", 88), ("answer-queued", 152), ("answer-executed", 153),
                   ("followup-start", 162), ("followup-source-applied", 177),
                   ("followup-acquisition-settled", 181), ("followup-settled", 184), ("worker-cleaned", 206)]:
    check(phase + " exact sequence", one(phase)["sequence"], seq)
check("answer enqueue returned", one("answer-queued")["enqueueReturned"])
check("followup acquisition fulfilled", one("followup-acquisition-settled")["outcome"], "fulfilled")
settled = one("followup-settled")
check("actual followup settlement", [settled[k] for k in ["attempts", "rootCallbacks", "downstreamCallbacks",
      "rootSubscriptionStatus", "downstreamSubscriptionStatus", "rootLoadingSubset", "downstreamLoadingSubset"]],
      [[[12, "fulfilled"]], 1, 1, "ready", "ready", False, False])
check("last raw receipt normal cleanup", receipts[-1], one("worker-cleaned"))
reconstruction = read(A / "publication-reconstruction.json")
check("author reconstruction retains exact callbacks", reconstruction["allCallbacksInOriginalOrder"], callbacks)
check("author reconstruction retains exact cuts", reconstruction["cuts"], cuts)

freeze = read(S / "source-freeze.json")
inventory = read(S / "source-inventory.json")
check("post source freeze", sha(S / "source-freeze.json"), "d651df85eb08ff46d8e68bd01b6fcc644f18a6a8efbb4b52ef557af0fd6a2fcd")
check("589 current named source hashes", [name for name, expected in inventory.items()
      if sha(S / "sources" / name) != expected], [])
check("511 unchanged production mappings", len(freeze["productionFiles"]), 511)
check("all production in inventory", all(inventory.get(k) == v for k, v in freeze["productionFiles"].items()))
payload_count = 0
for name, package in freeze["packages"].items():
    check("post package effective resolution " + name,
          str((S / "sources" / package["logical"]).resolve()), package["resolved"])
    check("post named own package hashes " + name, [member for member, expected in package["regularPayloadFilesMap"].items()
          if sha(Path(package["resolved"]) / member) != expected], [])
    payload_count += len(package["regularPayloadFilesMap"])
check("2544 post named payload hashes", payload_count, 2544)
check("post Node executable", sha(freeze["node"]["executable"]), freeze["node"]["sha256"])
check("post source lock", sha(S / "sources/pnpm-lock.yaml"), freeze["lockfiles"]["repoPnpmLock"])
check("post installed lock", sha(S / "sources/node_modules/.pnpm/lock.yaml"), freeze["lockfiles"]["installedPnpmLock"])
for member, item in freeze["dependencyReuseLinks"].items():
    path = S / "sources" / member
    check("post reuse link " + member, [path.is_symlink(), str(path.resolve())], [item["isSymlink"], item["resolved"]])
binding = read(P / "binding.json")
check("actual reviewed preparation binding", sha(P / "binding.json"), first["bindingSha256"])
for name, expected in binding["files"].items():
    check("post preparation " + name, sha(P / name), expected)
for name, expected in binding["externalInputs"].items():
    check("post external " + name, sha(name), expected)

verification = read(raw / "binding-verification.json")
seal = read(raw / "binding-seal.json")
check("original binding judgment", [verification["status"], verification["failures"]], ["bound", []])
check("binding transport/key/empty observations", [verification["actualKeyCount"], verification["emptyCallbacks"],
                                                verification["receiptTransport"]["count"]], [97, 3, 206])
check("startup seal root/flags", [seal[k] for k in ["selectedRoot", "sealed", "skipAllPausesAcknowledged",
      "debuggerDisableAcknowledged", "inspectorDisconnectedBeforeHistory"]], [str(S / "sources"), True, True, True, True])
check("seal inventory hash", sha(raw / "evaluated-pre-history.json"), seal["inventorySha256"])
v8 = lines(raw / "v8-binding.jsonl")
scripts = {row["scriptId"]: row for row in v8 if row["phase"] == "v8-compiled-script"}
sealed = {row["file"]: row for row in seal["bindings"]}
check("inspector ack order", [row["method"] for row in v8 if row["phase"] == "inspector-ack"],
      ["Debugger.setSkipAllPauses", "Debugger.enable", "Debugger.disable"])
check("163 sealed and815 binding entries", [len(seal["bindings"]), len(verification["bindings"])], [163, 815])
binding_bad = []
registries = {}
for item in verification["bindings"]:
    registry = registries.setdefault(item["inventory"], read(raw / item["inventory"]))
    file = str(S / "sources" / item["relative"])
    entry = next((e for e in registry["inventory"] if e["file"] == file), None)
    good = (registry["selectedRoot"] == str(S / "sources") and entry is not None and entry["evaluated"]
            and entry["codeSha256"] == item["codeSha256"] and entry["sourceSha256"] == inventory[item["relative"]]
            and sealed[file]["codeSha256"] == item["codeSha256"])
    transformed = (raw / "evaluated-sources" / (item["codeSha256"] + ".txt")).read_bytes()
    good = good and hashlib.sha256(transformed).hexdigest() == item["codeSha256"]
    for script in item["scripts"]:
        script_bytes = (raw / "v8-sources" / (script["sourceSha256"] + ".txt")).read_bytes()
        good = good and scripts[script["scriptId"]]["sourceSha256"] == script["sourceSha256"]
        good = good and hashlib.sha256(script_bytes).hexdigest() == script["sourceSha256"] and transformed in script_bytes
    if not good:
        binding_bad.append([item["inventory"], item["relative"]])
check("all815 evaluated/source/compiled/sealed bindings consistent", binding_bad, [])
check("positive callback source stacks bound to current source", all(str(S / "sources") in row["stack"]
      for row in receipts if row["phase"] == "source-stack"))
registration = (S / "sources/packages/query-db-collection/tests/queued-answer-metadata-oracle.test.ts").read_text()
check("strict checker source order retained", registration.index("rootPayload(receipt)") < registration.index("metadata(receipt)"))
check("outcome/finish source order retained", registration.index("checkQueuedAnswerProgress(history, outcome)") < registration.index("metadata.finish()"))
check("caller reach assertion retained", "reach.assertReached()" in registration)

absence = read(A / "proposed-original-absence.json")
script_text = (A / "proposed-original-absence.py").read_text()
check("assigned absence JSON", sha(A / "proposed-original-absence.json"),
      "c5ab1883f6047a022bca5903048ff45a345b2e81bd54d3c8b0e216686f42bcb9")
check("assigned absence script", sha(A / "proposed-original-absence.py"),
      "8f6682920c60c0ed8cf5ddf052f02216eb0896b0bd35c36aab8b553bf4042491")
check("exact original PID targets", absence["originalPids"], [71010, 71040, 71052, 71056])
check("exact original group targets", absence["originalTargetGroups"], [71010, 71052])
check("source targets match proposal", "PIDS = [71010, 71040, 71052, 71056]" in script_text and "GROUPS = [71010, 71052]" in script_text)
check("one literal signal-zero call", re.findall(r"os\.kill\((.*?)\)", script_text), ["target, 0"])
check("only bounded ps subprocess source", script_text.count("subprocess.run("), 1)
check("ps timeout5 retained", "capture_output=True, text=True, timeout=5" in script_text)
check("only ESRCH counts absent", "'absent' if error.errno == errno.ESRCH else 'unknown'" in script_text)
check("presence failure does not kill or retry", "present-or-permitted" in script_text and "os.kill(target, 0)" in script_text)
check("exclusive result write", "with OUTPUT.open('x')" in script_text)
check("absence output still absent", Path(absence["exclusiveOutput"]).exists() or Path(absence["exclusiveOutput"]).is_symlink(), False)
check("exact absence Python binary", sha(absence["executable"]), absence["executableSha256"])
check("original identities pin", sha(A / "original-process-identities.json"), absence["originalIdentitiesSha256"])
check("recorded process identities targets", [p["pid"] for p in read(A / "original-process-identities.json")["processes"]], absence["originalPids"])
check("outer actual PID/PGID", (A / "raw-outer/launcher-process.txt").read_text().split()[:2], ["71010", "71010"])
diag = read(A / "author-audit-diagnostics.json")
check("both author audit failures preserved", [diag["initialCapture"]["exitCode"], diag["exploratoryRead"]["exitCode"]], [1, 1])
old_capture = (A / "capture-audit.py").read_text()
new_capture = (A / "capture-audit-v2.py").read_text()
old_pattern = "r'^ ✓ .* > (.*?) (\\d+)ms$'"
new_pattern = "r'^ ✓ packages/query-db-collection/tests/queued-answer-metadata-oracle\\.test\\.ts > (.*?) (\\d+)ms$'"
check("capture audit changes only greedy title regex", old_capture.replace(old_pattern, new_pattern), new_capture)

result = {"kind": "Independent authored-q2 recorded actual evidence review; zero native replay or probes",
          "checks": checks, "allChecksPass": all(c["pass"] for c in checks),
          "currentRunIdentities": identity, "callbacksInOriginalOrder": event_checks,
          "cuts": cuts, "reachCounts": counts,
          "rawEvidence": {"files": 1954, "bytes": 31401025, "rawReceipts": 206, "retainedReceipts": 23,
                          "originalDirectory": str(original)},
          "bindingEvidence": {"entries": 815, "sealedModules": 163,
                              "evaluatedCuts": sorted(registries), "executionLimit": verification["limits"]},
          "exactOriginalAbsenceProposal": absence,
          "boundedVerdict": "Recorded healthy authored-q2 singleton result is consistent; original numeric identity absence remains unobserved. ROOT alone decides exact absence proposal.",
          "limits": ["No subject native repetition, model/config/checker/capture/absence-script import or execution.",
                     "No process probe, new lane, mutant, compiler, install, Git/PR or canonical operation.",
                     "Selected pass plus frozen source order supports finalizer/assert invocation; no dedicated runtime finish/assert/UUID ordinal or new parent-checker V8 proof.",
                     "Compiled/evaluated startup bindings are not precise runtime coverage; callback stacks add only their recorded path evidence.",
                     "No initial live outer/parent PPID/PGID or actual initial inner getpgid receipt; detached target convention remains.",
                     "Native coverage/typecheck false and named dependency-map/transitive limits remain.",
                     "One stable-metadata/direct eager source-sync authored q2 trace; no generated/noop/changing-metadata/subscription/framework/mutant/class-closure credit.",
                     "No cleanup absence claim or runtime admission by this review."],
          "processProbesExecuted": False, "runtimeAdmission": False, "rootOwnsLint": True}
output = R / "metadata-authored-q2-actual-independent-audit-v1.json"
with output.open("x") as handle:
    json.dump(result, handle, indent=2)
    handle.write("\n")
print(json.dumps({"output": str(output), "sha256": sha(output), "checkCount": len(checks),
                  "pass": result["allChecksPass"], "failures": [c for c in checks if not c["pass"]]}, indent=2))
