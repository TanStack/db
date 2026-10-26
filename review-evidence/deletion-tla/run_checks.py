"""Run retained TLA+ configurations and reject unexpected failures.

Usage: python3 run_checks.py --java /path/to/java --jar /path/to/tla2tools.jar
The Java/JAR binaries are external, checksum-recorded prerequisites, not vendored.
Logs, TLC states, and result receipts go to --output (default a scratch directory).
Every expected-negative case must name the exact violated invariant. A parser,
runtime, resource, or different-invariant error never counts as a successful kill.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--java', required=True)
    parser.add_argument('--jar', required=True)
    parser.add_argument('--output', default='/tmp/pr1179-tla-results')
    parser.add_argument('--only', default='')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    jar = Path(args.jar).resolve()
    digest = hashlib.sha256(jar.read_bytes()).hexdigest()
    if digest != '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88':
        raise SystemExit('Unexpected TLA+ 1.7.4 JAR checksum')
    cases = json.loads((root/'checks.json').read_text())
    results = []
    for case in cases:
        if args.only and not re.search(args.only, case['name']):
            continue
        command = [args.java, '-Xmx1g', '-XX:+UseParallelGC', '-cp', str(jar),
                   'tlc2.TLC', '-deadlock', '-seed', '1', '-fp', '0',
                   '-workers', '1', '-metadir', str(output/(case['name']+'-states')),
                   '-config', case['name']+'.cfg', case['module']]
        started = time.monotonic()
        result = subprocess.run(command, cwd=root, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (output/(case['name']+'.log')).write_text(result.stdout)
        expected = case.get('violation')
        if case.get('temporal'):
            matched = result.returncode != 0 and 'Temporal properties were violated' in result.stdout
        elif expected:
            matched = result.returncode != 0 and f'Invariant {expected} is violated' in result.stdout
        else:
            matched = result.returncode == 0 and 'No error has been found' in result.stdout
        states = re.findall(r'([\d,]+) states generated, ([\d,]+) distinct states found, ([\d,]+) states left on queue', result.stdout)
        actions = re.findall(r'^State \d+: <([^>]+)>', result.stdout, flags=re.M)
        receipt = dict(name=case['name'], expected=expected or 'pass',
                       matched=matched, exit_code=result.returncode,
                       seconds=round(time.monotonic()-started,3),
                       counts=states[-1] if states else None,
                       trace_actions=actions, command=command,
                       model_sha256=hashlib.sha256((root/(case['module']+'.tla')).read_bytes()).hexdigest(),
                       config_sha256=hashlib.sha256((root/(case['name']+'.cfg')).read_bytes()).hexdigest())
        results.append(receipt)
        print(json.dumps(receipt), flush=True)
        (output/'results.json').write_text(json.dumps(dict(jar_sha256=digest,results=results),indent=2))
        if not matched:
            print(result.stdout[-6000:], flush=True)
            raise SystemExit('Unexpected checker result: '+case['name'])


if __name__ == '__main__':
    main()
