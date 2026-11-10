"""Read/hash/JSON/string/regex audit only; imports no subject source.

This script does not launch native discovery, compiler, tests, processes,
mutants, canonical operations or dependency installation. Its only write is a
fresh additive JSON audit beside this script. Root owns coordinated lint.
"""

import hashlib
import itertools
import json
import pathlib
import re


REVIEW = pathlib.Path(__file__).resolve().parent
H = REVIEW.parent
PLAN = H / "metadata-next-gap-plan-v1"
SOURCE = H / "metadata-update-source-v3" / "sources"
PIN = "639f8a93c5840b2cb0d464b7236124362dc3556febd35b7dccb7e00f1b5149dc"


def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def load(path):
    return json.loads(pathlib.Path(path).read_text())


checks = []


def check(label, actual, expected=True):
    checks.append({"label": label, "actual": actual, "expected": expected,
                   "pass": actual == expected})


freeze = load(PLAN / "plan-freeze.json")
check("exact assigned plan freeze", sha(PLAN / "plan-freeze.json"), PIN)
check("seven frozen members", len(freeze["members"]), 7)
for member, expected in freeze["members"].items():
    check("member hash: " + member, sha(PLAN / member), expected)
binding = load(PLAN / "source-bindings.json")
check("source freeze", sha(binding["sourceFreeze"]["path"]),
      binding["sourceFreeze"]["sha256"])
for name, expected in binding["checkedSourceFiles"].items():
    check("named source: " + name, sha(SOURCE / name), expected)
for evidence in binding["retainedEvidence"]:
    check("retained evidence: " + evidence["role"], sha(evidence["path"]),
          evidence["sha256"])

recipes = load(PLAN / "baseline-recipes.json")["recipes"]
discovery = load(H / "metadata-update-native-discovery-v2" / "names.json")
names = [entry["name"] for entry in discovery]
check("preserved name count", len(names), 20)
check("recipe count", len(recipes), 5)
check("recipe order", [r["order"] for r in recipes], [1, 2, 3, 4, 5])
selector_results = []
outputs = []
for recipe, states, histories in zip(recipes, [31, 29, 29, 31, 31],
                                   [1, 1, 1, 8, 8]):
    selector = recipe["argv"][recipe["argv"].index("-t") + 1]
    selected = [name for name in names
                if re.fullmatch(selector, name.replace(" > ", " "))]
    check(recipe["id"] + " exact selected preserved name", selected,
          [recipe["expectedDisplayName"]])
    check(recipe["id"] + " anchored", selector.startswith("^") and
          selector.endswith("$"))
    check(recipe["id"] + " rejects suffix", not bool(re.fullmatch(
        selector, recipe["expectedFilterName"] + " suffix")))
    check(recipe["id"] + " source root", recipe["cwd"], str(SOURCE))
    check(recipe["id"] + " source binding",
          recipe["envSet"]["H02_PROGRESS_SOURCE_FREEZE"],
          binding["sourceFreeze"]["path"])
    check(recipe["id"] + " multiplier",
          recipe["envSet"]["TANSTACK_DB_ORACLE_RUNS_MULTIPLIER"], "1")
    check(recipe["id"] + " state count", recipe["expectedReachStateCount"],
          states)
    check(recipe["id"] + " history count", recipe["expectedHistoryCount"],
          histories)
    check(recipe["id"] + " replay controls unset", all(key in recipe["envUnset"]
          for key in ["NODE_OPTIONS", "NODE_PATH", "TANSTACK_DB_ORACLE_SEED",
                      "TANSTACK_DB_ORACLE_PATH", "TANSTACK_DB_ORACLE_PROPERTY",
                      "TANSTACK_DB_ORACLE_CALIBRATION"]))
    check(recipe["id"] + " unchanged inner budget", recipe["innerReceivingBudget"],
          {"groupRssBytes": 1073741824, "nodeHeapMiB": 384,
           "postEnqueueWindowMs": 1000, "wallMs": 20000})
    outputs.append(recipe["freshOutputDirectory"])
    selector_results.append({"id": recipe["id"], "selector": selector,
                             "matches": selected})

mutants = load(PLAN / "mutants.json")
controls = mutants["unmutatedDriverSuccessor"]["controls"]
check("role successor not implemented", mutants["unmutatedDriverSuccessor"]["exists"], False)
check("two fresh controls", len(controls), 2)
for control, lane in zip(controls, ["default", "authored"]):
    check("control " + lane + " identity", control["id"],
          "role-control-scope-" + lane + "-q2")
    check("control " + lane + " states", control["expectedStates"], 31)
    check("control " + lane + " histories", control["expectedHistoryCount"], 1)
    outputs.append(control["proposedFreshOutputDirectory"])

matrix = mutants["matrix"]
check("eight independent specs", len(matrix), 8)
actual_matrix = {(m["keyLane"], m["targetRole"],
                  "full-current" if "full-current" in m["id"] else "omit")
                 for m in matrix}
check("complete independent matrix", sorted(actual_matrix),
      sorted(itertools.product(["default", "authored"],
                               ["root", "downstream"],
                               ["omit", "full-current"])))
matrix_results = []
for m in matrix:
    lane, role = m["keyLane"], m["targetRole"]
    target = f"metadata-receiving:scope:{lane}:{role}"
    check(m["id"] + " exact target", m["targetCollectionId"], target)
    check(m["id"] + " lane control", m["predecessorControl"],
          f"role-control-scope-{lane}-q2")
    check(m["id"] + " target phase", m["requiredObservation"]["phase"],
          "public-change" if role == "root" else "downstream-change")
    check(m["id"] + " target history", m["targetHistory"],
          {"kind": "query", "scheduler": "microtask", "cacheIdentity": "scope",
           "metadataKeys": lane, "includes": True, "window": True,
           "nonemptyPrior": True, "keyShift": 0, "rankScale": 10,
           "metadataFollowupQuarter": 2})
    check(m["id"] + " production binding", m["mutationSite"]["unchangedFileSha256"],
          binding["checkedSourceFiles"]["packages/db/src/collection/state.ts"])
    check(m["id"] + " both role identities",
          [m["requiredCurrentRunIdentity"]["rootId"],
           m["requiredCurrentRunIdentity"]["downstreamId"]],
          [f"metadata-receiving:scope:{lane}:root",
           f"metadata-receiving:scope:{lane}:downstream"])
    predicates = m["targetPredicate"]["all"]
    check(m["id"] + " common key guards", all(guard in predicates for guard in
          ["enrichedPreviousValue.$key === change.key",
           "enrichedValue.$key === change.key"]))
    check(m["id"] + " role guards", all(guard in predicates for guard in
          [f'this.collection.id === "{target}"',
           f'enrichedPreviousValue.$collectionId === "{target}"',
           f'enrichedValue.$collectionId === "{target}"']))
    check(m["id"] + " explicit authored guard",
          (f'change.key === "metadata-{role}-3"' in predicates), lane == "authored")
    check(m["id"] + " preserved other return fields", m["fault"]["otherReturnFields"],
          "Unchanged key, type, enriched current value and metadata.")
    check(m["id"] + " predecessor source value", m["fault"]["previousValueOtherwise"],
          "enrichedPreviousValue")
    check(m["id"] + " seven result classifications", len(m["resultClassification"]), 7)
    outputs.append(m["proposedFreshOutputDirectory"])
    matrix_results.append({"id": m["id"], "lane": lane, "role": role,
                           "fault": m["fault"]["previousValueWhenTargeted"],
                           "phase": m["requiredObservation"]["phase"],
                           "intendedComparison": m["intendedComparison"],
                           "sourcePrediction": "Earlier ordinary payload rejection; F01"
                           if "full-current" in m["id"] else
                           "Omission bypasses optional ordinary previousValue assertion; no executed kill"})

check("all proposed output paths unique", len(set(outputs)), 15)
freshness = [{"path": path, "existsAtRead": pathlib.Path(path).exists()}
             for path in outputs]
check("all proposed outputs absent at this read", all(not x["existsAtRead"] for x in freshness))

query = SOURCE / "packages/query-db-collection/tests"
metadata = (query / "queued-answer-metadata-oracle.ts").read_text()
registration = (query / "queued-answer-metadata-oracle.test.ts").read_text()
progress = (query / "queued-answer-progress-oracle.ts").read_text()
supervisor = (query / "queued-answer-progress-supervisor.ts").read_text()
shared = (SOURCE / "packages/db/tests/query/virtual-row-fields-publication-oracle.ts").read_text()
base_states = re.search(r"export const metadataReceivingStates = \[(.*?)\] as const", metadata, re.S).group(1)
check("17 base states derived textually", len(re.findall(r"`[^`]+`", base_states)), 17)
check("positive31 textual state construction", all(s in metadata for s in
      ["`reload-baseline-compared`", "`followup-started`", "`source-applied`",
       "`followup-acquisitions-settled`", "`followup-retained-key-${layer}`",
       "`followup-messages-${layer}`", "`followup-final-${layer}`",
       "[`followup-update-${layer}`, `followup-previous-value-${layer}`]",
       "[`followup-noop-${layer}`]"]))
check("positive-only generator retained", "fc.constantFrom(1 as const, 2 as const, 3 as const)" in metadata)
check("positive fixed budget and seed", "{ numRuns: oracleRuns(8), seed: 20261030 }" in registration)
check("positive replay budget retained", "oraclePropertyOptions(8, property)" in registration)
check("oracle finish retained", "metadata.finish()" in registration)
check("ordinary first, downstream second, metadata last", registration.index("rootPayload(receipt)") <
      registration.index("downstreamPayload({ ...receipt, phase: `public-change` })") <
      registration.index("metadata(receipt)"))
check("defined previous value ordinary assertion", "if (change.previousValue !== undefined)" in progress and
      "projectProgressRow(change.previousValue)" in progress and
      "`event update carries the preceding public value`" in progress)
check("first observation error retained and killed", "outcome.primaryObservationError ??=" in supervisor and
      "if (!receivingExited) kill(`observation`)" in supervisor)
check("shared delta full aggregate comparison", "expectedMetadataChanges(before, after)" in shared and
      "flatMap((batch) => batch.changes)" in shared)

source_order_bindings = {str(path.relative_to(SOURCE)): sha(path) for path in
                        [query / "queued-answer-metadata-oracle.test.ts",
                         query / "queued-answer-progress-oracle.ts",
                         query / "queued-answer-progress-supervisor.ts"]}
result = {"kind": "Independent bounded source-plan audit; zero native execution",
          "assignedFreezeSha256": PIN, "checks": checks,
          "allStaticChecksPass": all(c["pass"] for c in checks),
          "finding": "F01: full-current entries must name earlier ordinary assertion for intended kill; no metadata invocation credit.",
          "selectorsAgainstPreservedNamesOnly": selector_results,
          "matrix": matrix_results, "freshOutputsAtReadOnly": freshness,
          "observerOrderSourceBindings": source_order_bindings,
          "stateArithmeticSourceOnly": {"positive": "17 + 4 + 2*(3+2) = 31",
                                        "noop": "17 + 4 + 2*(3+1) = 29"},
          "limits": ["No source module imported, compiled or evaluated.",
                     "No native discovery, tests, process probes or actual mutants.",
                     "No production/oracle/driver/configuration or canonical edits.",
                     "Named hashes are not a complete transitive source/dependency audit.",
                     "Preserved discovery names are not native v3 selection evidence.",
                     "First-divergence predictions are not actual mutant outcomes.",
                     "No runtime admission, bug-class closure, PR readiness or reviewer-hire assessment."],
          "rootOwnsLint": True}
output = REVIEW / "metadata-next-gap-independent-static-audit-v1.json"
with output.open("x") as handle:
    json.dump(result, handle, indent=2)
    handle.write("\n")
print(json.dumps({"output": str(output), "sha256": sha(output),
                  "checks": len(checks), "pass": result["allStaticChecksPass"],
                  "failures": [c for c in checks if not c["pass"]]}, indent=2))
