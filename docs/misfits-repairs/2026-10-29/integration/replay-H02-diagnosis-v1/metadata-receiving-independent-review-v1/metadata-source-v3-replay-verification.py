"""Qualify completed pure replay outputs without changing frozen packets."""

import hashlib
import json
import pathlib

R = pathlib.Path(__file__).resolve().parent
H = R.parent
V3 = H / 'metadata-update-source-v3'


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def read(p):
    return json.loads(p.read_text())


def check(condition, label):
    if not condition:
        raise AssertionError(label)


actual = read(R / 'metadata-source-v3-roundtrip-replayed.json')
author = read(V3 / 'selector-roundtrip-results.json')
old_path = str(V3 / 'selector-roundtrip-controls.mjs')
new_path = str(R / 'metadata-source-v3-selector-roundtrip-controls.mjs')


def relocate(value):
    if isinstance(value, str):
        return value.replace(new_path, old_path)
    if isinstance(value, list):
        return [relocate(x) for x in value]
    if isinstance(value, dict):
        return {k: relocate(v) for k, v in value.items()}
    return value


check(relocate(actual) == author, 'exact result equality after only derived-script path relocation in captured stacks')
check((R / 'metadata-source-v3-legacy-replayed.json').read_bytes() == (V3 / 'pure-results.json').read_bytes(), 'legacy exact output equality')
check(not actual['historical']['accepted'] and actual['historical']['stats']['observationErrors'] == [], 'historical pure post-run mismatch, no realtime error')
check(actual['historical']['stats']['outcomePassed'] == actual['historical']['stats']['finishAttempted'] == 0, 'historical finalizer nonexecution')
corrected = actual['corrected']
check(corrected['accepted'] and corrected['stats']['outcomePassed'] == corrected['stats']['finishAttempted'] == corrected['stats']['finishPassed'] == 1, 'corrected exact parent pipeline and explicit finalizer')
check(corrected['stats']['observationErrors'] == [] and corrected['stats']['observed'] == 206 and len(corrected['states']) == 31, 'corrected raw observations/reach')
check(len(actual['faults']) == actual['rejected'] == 50 and len(actual['neighbors']) == 12, 'fifty rejected and twelve lawful neighbors')
for fault in actual['faults']:
    check(fault['stats']['finishPassed'] == 0, 'no corrupt history earns finalizer success')
    check('Error' in fault['error'], 'fault retains comparison/finalizer error')
for fault in actual['faults']:
    if fault['name'].startswith('postrun-only-'):
        check(fault['stats']['observationErrors'] == [] and fault['stats']['outcomeStarted'] == 1 and fault['stats']['outcomePassed'] == 0, 'post-run-only errors rejected by intended outcome comparison')
omitted = next(x for x in actual['faults'] if x['name'] == 'followup-and-cleanup-omitted-without-reach-assertion')
check(omitted['stats']['observationErrors'] == [] and omitted['stats']['outcomePassed'] == omitted['stats']['finishAttempted'] == 1, 'omitted-stage control reaches explicit finalizer')
check('declared follow-up publication was not compared' in omitted['error'], 'omitted stage rejected by intended finalizer rule')
old_neighbors = [x for x in actual['neighbors'] if 'metadataFollowupQuarter' not in x['history']]
check(len(old_neighbors) == 4, 'four old receiving paths')
for neighbor in actual['neighbors']:
    check(neighbor['finishPassed'] == 1, 'neighbor explicit finalizer')
for neighbor in old_neighbors:
    check(len(neighbor['states']) == (18 if neighbor['history']['cacheIdentity'] == 'subscription' else 17), 'old seventeen-state core plus subscription premise')
legacy = read(R / 'metadata-source-v3-legacy-replayed.json')
check((legacy['acceptedControls'], legacy['rejected'], legacy['modeledReceiptHistories']) == (32, 140, 6720), 'unchanged legacy controls')
manifest = read(V3 / 'packet-manifest.json')
for relative, record in manifest['artifacts'].items():
    check(sha(V3 / relative) == record['sha256'], f'frozen packet preserved after replay: {relative}')
paths = [R / 'metadata-source-v3-audit.py', R / 'metadata-source-v3-audit.json', R / 'metadata-source-v3-selector-roundtrip-controls.mjs', R / 'metadata-source-v3-legacy-pure-controls.mjs', R / 'metadata-source-v3-roundtrip-replayed.json', R / 'metadata-source-v3-legacy-replayed.json']
result = {
    'status': 'INDEPENDENT PURE REPLAYS PASS; FROZEN SOURCE-V3 PACKET UNCHANGED',
    'scriptSha256': sha(pathlib.Path(__file__)),
    'artifacts': {p.name: sha(p) for p in paths},
    'roundtripOriginalEquality': 'Exact JSON after replacing only relocated derived-script absolute path in error stacks',
    'legacyOriginalEquality': 'Exact bytes',
    'oldSelectorRetained': 21, 'newSelectorRetained': 23,
    'correctedExplicitFinalizerPassed': 1, 'pureReachStates': 31,
    'rejectedControls': 50, 'acceptedNeighbors': 12,
    'legacyAccepted': 32, 'legacyRejected': 140, 'modeledReceiptHistories': 6720,
    'nativeLaunches': 0, 'processProbes': 0, 'toolchainRecoveryAccepted': False,
    'execution': 'Two serial direct Node pure script invocations, each exit0, 384 MiB heap option',
}
p = R / 'metadata-source-v3-replay-verification.json'
p.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
print(json.dumps({'status': result['status'], 'sha256': sha(p), 'scriptSha256': result['scriptSha256']}))
