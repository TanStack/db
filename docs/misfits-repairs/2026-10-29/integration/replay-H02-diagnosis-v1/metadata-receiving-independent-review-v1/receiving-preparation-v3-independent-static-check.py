"""Independent read/hash check. No native process, receiving, or test launch."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess

WT = Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-metadata-receiving-v1')
P = WT / 'docs/misfits-metadata-receiving-admission-preparation-v3'
OUT = Path(__file__).with_name('receiving-preparation-v3-independent-static-check.json')
BINDING = '919b931558b6d270ba343c4ead5cb6ffbd1c87612760f29518719e141e2672d4'
MANIFEST = 'cdf230bea8dfe642572b5d42b7f9daa726efc710b554386792a61a0a527ce2fc'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read(path):
    return json.loads(path.read_text())

def forbidden(*args, **kwargs):
    raise AssertionError('Native process operation is forbidden in this independent static check')

# These guards are installed before either preflight module is imported.
for name in ['Popen', 'run', 'call', 'check_call', 'check_output', 'getoutput', 'getstatusoutput']:
    setattr(subprocess, name, forbidden)
for name in ['kill', 'killpg', 'getpgid', 'getpid', 'getpgrp', 'fork', 'system', 'posix_spawn', 'posix_spawnp']:
    if hasattr(os, name):
        setattr(os, name, forbidden)
for name in ['signal', 'setitimer', 'alarm']:
    if hasattr(signal, name):
        setattr(signal, name, forbidden)

assert sha(P / 'packet-manifest.json') == MANIFEST
manifest = read(P / 'packet-manifest.json')
assert {str(p.relative_to(P)) for p in P.rglob('*') if p.is_file()} == set(manifest['members']) | {'packet-manifest.json'}
for name, item in manifest['members'].items():
    assert (P / name).stat().st_size == item['bytes']
    assert sha(P / name) == item['sha256']
assert manifest['memberCount'] == len(manifest['members']) == 14
assert manifest['totalBytes'] == sum(i['bytes'] for i in manifest['members'].values()) == 73805

spec = importlib.util.spec_from_file_location('metadata_receiving_preflight_v3', P / 'verify.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
cells = ['scope-default', 'scope-authored', 'subscription-default', 'subscription-authored']
static_results = [gate.verify(BINDING, cell, static=True) for cell in cells]
full_first_result = gate.verify(BINDING, 'scope-default', static=False)
negative = []
for binding, cell in [('0' * 64, 'scope-default'), (BINDING, 'unknown-cell')]:
    try:
        gate.verify(binding, cell, static=True)
    except ValueError as error:
        negative.append(str(error))
    else:
        raise AssertionError('invalid preflight was accepted')

old = read(WT / 'docs/misfits-metadata-receiving-recipes-v2/corrected-receiving-recipes.json')['recipes']
new = read(P / 'receiving-recipes.json')['recipes']
reach = read(P / 'reach-matrix.json')['cells']
runs = read(P / 'run-recipes.json')['runs']
unchanged = []
for index, (previous, current, states, run) in enumerate(zip(old, new, reach, runs, strict=True)):
    for key in ['argv', 'childLimitsInherited', 'cwd', 'executable', 'history', 'sourceFreezeSha256', 'postRunGate']:
        assert previous[key] == current[key], key
    assert current['envSet'] == previous['env']
    assert current['outerTestTimeoutMs'] == previous['outerWallContainmentMs'] == 60000
    assert current['expectedNativeSelection']['selected'] == 1
    assert states['history'] == current['history']
    assert len(states['requiredStates']) == (17 if index < 2 else 18)
    assert len(set(states['requiredStates'])) == len(states['requiredStates'])
    assert run['bindingSha256'] == BINDING
    assert sha(Path(current['launchScript'])) == run['launcherSha256']
    assert run['argv'] == [current['launchScript'], BINDING]
    assert run['freshOutputDirectory'] == current['freshOuterOutputDirectory']
    assert current['nextEligibleCandidate'] == run['candidate'] == (index == 0)
    unchanged.append({'cell': states['cell'], 'argvHistoryBudgetsUnchanged': True, 'requiredReachCount': len(states['requiredStates'])})

result = {
    'status': 'PASS: independent source/hash/read-only preflight only',
    'manifestSha256': MANIFEST,
    'manifestMemberCount': 14,
    'manifestMemberBytes': 73805,
    'bindingSha256': BINDING,
    'staticPreflights': static_results,
    'fullFirstReadOnlyPreflight': full_first_result,
    'invalidInputsRejected': negative,
    'preservedRecipes': unchanged,
    'nativeProcessApisGuarded': True,
    'nativeLaunches': 0,
    'nativeProcessProbes': 0,
    'receivingOrTestRuns': 0,
    'runtimeAdmitted': False,
    'limits': 'Read/hash identities and declared recipes only. No native shared-checker compilation, receiving reach, semantic GREEN, mutant kill, or new runtime admission.',
}
with OUT.open('x') as output:
    output.write(json.dumps(result, indent=2, sort_keys=True) + '\n')
print(json.dumps({'output': str(OUT), 'sha256': sha(OUT), 'sourceFiles': full_first_result['identity']['sourceFiles'], 'namedPackagePayloadFiles': full_first_result['identity']['namedPackagePayloadFiles'], 'receivingOrTestRuns': 0}, indent=2))
