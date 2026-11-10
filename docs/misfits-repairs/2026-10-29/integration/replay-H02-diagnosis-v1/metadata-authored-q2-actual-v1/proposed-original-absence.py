"""INERT PROPOSAL. Do not run without separate exact root one-shot admission.

This only observes four original PIDs and two recorded target groups. It never
sends a nonzero signal, substitutes an identity, retries, or starts product code.
"""
from pathlib import Path
import errno
import json
import os
import subprocess
import sys
import time

if sys.argv != [sys.argv[0], '--root-admitted-one-shot']:
    raise SystemExit('Separate root one-shot admission is required; no probe ran.')

PIDS = [71010, 71040, 71052, 71056]
GROUPS = [71010, 71052]
HERE = Path(__file__).resolve().parent
OUTPUT = HERE.parent / 'metadata-authored-q2-root-original-absence-v1.json'
if OUTPUT.exists():
    raise SystemExit('Exclusive result already exists; no probe ran.')


def ps(argv):
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=5)
        return {'argv': argv, 'returncode': result.returncode,
                'stdout': result.stdout, 'stderr': result.stderr}
    except subprocess.TimeoutExpired as error:
        return {'argv': argv, 'timeoutSeconds': 5, 'error': str(error)}


def signal_zero(target):
    try:
        os.kill(target, 0)
        return {'result': 'present-or-permitted', 'signal': 0}
    except OSError as error:
        return {'result': 'absent' if error.errno == errno.ESRCH else 'unknown',
                'errno': error.errno, 'message': str(error), 'signal': 0}


started = time.monotonic_ns()
group_snapshot = ps(['/bin/ps', '-axo', 'pid=,pgid=,args='])
group_rows = []
if group_snapshot.get('returncode') == 0:
    for line in group_snapshot['stdout'].splitlines():
        parts = line.strip().split(maxsplit=2)
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            if int(parts[1]) in GROUPS:
                group_rows.append({'pid': int(parts[0]), 'pgid': int(parts[1]),
                                   'args': parts[2] if len(parts) == 3 else ''})
probes = []
for pid in PIDS:
    probes.append({'kind': 'original-pid', 'target': pid,
        'actualPs': ps(['/bin/ps', '-o', 'pid=,pgid=,args=', '-p', str(pid)]),
        'actualSignalZero': signal_zero(pid)})
for group in GROUPS:
    probes.append({'kind': 'original-target-group', 'target': group,
        'actualPsGroupRows': [row for row in group_rows if row['pgid'] == group],
        'actualSignalZero': signal_zero(-group)})
all_absent = group_snapshot.get('returncode') == 0 and all(
    probe['actualSignalZero']['result'] == 'absent' and (
        probe['actualPs'].get('returncode') == 1 and
        probe['actualPs'].get('stdout') == '' and probe['actualPs'].get('stderr') == ''
        if probe['kind'] == 'original-pid' else not probe['actualPsGroupRows'])
    for probe in probes)
result = {'kind': 'Actual original recorded identity absence observations',
    'atMonotonicNs': started, 'finishedMonotonicNs': time.monotonic_ns(),
    'originalPids': PIDS, 'originalTargetGroups': GROUPS, 'probes': probes,
    'groupPsArgv': group_snapshot['argv'],
    'groupPsReturncode': group_snapshot.get('returncode'),
    'groupPsStderr': group_snapshot.get('stderr'),
    'groupPsError': group_snapshot.get('error'),
    'allOriginalRecordedIdentitiesObservedAbsent': all_absent,
    'limits': 'Point-in-time observations of original recorded numeric identities only. No initial receiving-parent/outer PPID/PGID or detached actual getpgid receipt exists. Bound detached-spawn target assumption remains. Permission failure, timeout or live/reused identity is not absence and causes no kill/retry.'}
with OUTPUT.open('x') as stream:
    stream.write(json.dumps(result, indent=2, sort_keys=True) + '\n')
print(json.dumps({'output': str(OUTPUT), 'allOriginalRecordedIdentitiesObservedAbsent': all_absent,
                  'originalPidCount': len(PIDS), 'originalTargetGroupCount': len(GROUPS)}))
raise SystemExit(0 if all_absent else 1)
