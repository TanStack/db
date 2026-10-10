"""Run the bounded leader-close design grammar and verify exact TLC outcomes.

Usage:
  python3 run_checks.py --java /path/to/java --jar /path/to/tla2tools.jar

The pinned JAR is external. Configurations, TLC states, complete logs, and
machine-readable receipts are written to --output, never to the source tree.
A different invariant, parser failure, timeout, or resource failure does not
count as a killed fault or a reached witness.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time


INVARIANTS = [
    "TypeOK",
    "DurableTermUnique",
    "SuccessorRouteStable",
    "AtMostOnce",
    "AbsentApplyNeedsAnchor",
    "PresentIdAcknowledged",
    "AlreadyAppliedSameEpoch",
    "PrunedOutcomeUnknown",
    "CertifiedReloadIssued",
    "OriginalPositionReceipt",
    "ReceiptTruth",
    "CertifiedDelivery",
    "ResetEpochFence",
    "NoDuplicateEvents",
    "PositionReadIsNotPublication",
]
PROPERTIES = [
    "ReceiptEventuallySettles",
    "SuccessorEventuallyKnown",
    "CertifiedVisibilityEventually",
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--java", required=True)
    parser.add_argument("--jar", required=True)
    parser.add_argument("--output", default="/tmp/issue-2085-tlc-results")
    parser.add_argument("--only", default="")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    jar = Path(args.jar).resolve()
    expected_jar = json.loads((root / "toolchain.json").read_text())["tla"]["sha256"]
    if sha256(jar) != expected_jar:
        raise SystemExit("Unexpected TLA+ JAR checksum")

    cases = json.loads((root / "checks.json").read_text())
    receipts = []
    model_hash = sha256(root / "LeaderCloseDesign.tla")
    for case in cases:
        if args.only and not re.search(args.only, case["name"]):
            continue
        name = case["name"]
        config = output / f"{name}.cfg"
        lines = [
            f'SPECIFICATION {"FairSpec" if case.get("fair") else "Spec"}',
            f'CONSTANTS Scenario = "{case["scenario"]}" Fault = "{case["fault"]}"',
        ]
        lines += [f"INVARIANT {law}" for law in case.get("invariants", INVARIANTS)]
        if case.get("fair"):
            lines += [f"PROPERTY {law}" for law in PROPERTIES]
        config.write_text("\n".join(lines) + "\n")

        command = [
            args.java, "-Xmx1g", "-XX:+UseParallelGC", "-cp", str(jar),
            "tlc2.TLC", "-deadlock", "-seed", "1", "-fp", "0", "-workers", "1",
            "-metadir", str(output / f"{name}-states"),
            "-config", str(config), "LeaderCloseDesign",
        ]
        started = time.monotonic()
        result = subprocess.run(
            command, cwd=root, text=True, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, timeout=120,
        )
        log = output / f"{name}.log"
        log.write_text(result.stdout)
        violations = re.findall(
            r"Invariant ([A-Za-z0-9_]+) is violated", result.stdout
        )
        counts = re.findall(
            r"([\d,]+) states generated, ([\d,]+) distinct states found, "
            r"([\d,]+) states left on queue", result.stdout
        )
        actions = re.findall(
            r"^State \d+: <([^>]+)>", result.stdout, flags=re.M
        )
        expected = case.get("violation")
        matched = (
            result.returncode != 0 and violations == [expected]
            if expected else
            result.returncode == 0 and "No error has been found" in result.stdout
        )
        receipt = {
            "name": name,
            "scenario": case["scenario"],
            "fault": case["fault"],
            "expected": expected or "pass",
            "matched": matched,
            "exit_code": result.returncode,
            "seconds": round(time.monotonic() - started, 3),
            "counts": counts[-1] if counts else None,
            "trace_actions": actions,
            "model_sha256": model_hash,
            "config_sha256": sha256(config),
        }
        receipts.append(receipt)
        (output / "results.json").write_text(json.dumps({
            "jar_sha256": expected_jar,
            "checks_sha256": sha256(root / "checks.json"),
            "results": receipts,
        }, indent=2) + "\n")
        print(json.dumps(receipt), flush=True)
        if not matched:
            print(result.stdout[-6000:], flush=True)
            raise SystemExit(f"Unexpected TLC outcome: {name}")


if __name__ == "__main__":
    main()
