"""Preserve and audit recorded singleton evidence; no application imports or probes.

This audit compares recorder identities, rows and retained evidence. It does not
execute the native oracle, infer unrecorded runtime assertions, or establish a
new product-law judgment. Originals remain untouched. Run once into fresh paths.
"""
from pathlib import Path
import hashlib
import json
import re
import shutil
import sys

HERE = Path(__file__).resolve().parent
H = HERE.parent
PREP = H / 'metadata-authored-q2-preparation-v1'
SOURCE = H / 'metadata-update-source-v3'
OUTER = H / 'metadata-next-gap-runs-v1/followup-scope-authored-q2'
FROZEN = str(SOURCE / 'sources')


def read(path):
    return json.loads(Path(path).read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(name, value):
    with (HERE / name).open('x') as stream:
        stream.write(json.dumps(value, indent=2, sort_keys=True) + '\n')


def one(rows, phase):
    selected = [row for row in rows if row['phase'] == phase]
    assert len(selected) == 1, (phase, len(selected))
    return selected[0]


requirements = read(PREP / 'evidence-requirements.json')
history = requirements['history']
initial_path = H / 'metadata-authored-q2-actual-initial-tool-return-v1.json'
final_path = H / 'metadata-authored-q2-actual-final-tool-return-v1.json'
admission_path = H / 'metadata-authored-q2-root-one-shot-admission-v1.json'
initial, final, admission = map(read, [initial_path, final_path, admission_path])
assert initial['response']['chunk_id'] == 'e143cb'
assert initial['response']['session_id'] == final['sessionId'] == 35271
assert final['response']['chunk_id'] == '12ec83' and final['response']['exit_code'] == 0
assert admission['admittedRuntime'] and admission['maxInvocations'] == 1
assert digest(admission_path) == '0e7f43163d12719003185ba86e3ba654801bb9282457ec59ba476acc7edb27e4'
assert admission['proposal']['selection']['history'] == history
log = (OUTER / 'outer-vitest.log').read_text()
title = requirements['parentSelection']['title']
passed = re.findall(r'^ ✓ .* > (.*?) (\d+)ms$', log, re.M)
assert passed == [(title, '2372')], passed
assert 'Tests  1 passed | 19 skipped (20)' in log
assert '(with seed=' not in log
blocks = re.findall(r'H02 metadata receiving reach \{.*?counts: \{(.*?)\n  \}\n\}', log, re.S)
assert len(blocks) == 1
counts = {name: int(value) for name, value in re.findall(r"'([^']+)': (\d+)", blocks[0])}
assert set(counts) == set(requirements['reach']['states']) and set(counts.values()) == {1}
launcher = (OUTER / 'launcher-process.txt').read_text().split()
assert launcher[:2] == ['71010', '71010']
prelaunch = read(OUTER / 'source-prelaunch.json')
assert prelaunch['history'] == history
baseline = prelaunch['receivingEvidenceBaseline']
assert len(baseline['members']) == 32
candidates, candidate_inventory = [], []
for path in Path(baseline['temporaryRoot']).iterdir():
    if not path.name.startswith('h02-progress-') or path.name in baseline['members']:
        continue
    item = {'path': str(path)}
    if not (path / 'prepared.json').is_file() or not (path / 'history.json').is_file():
        item['status'] = 'missing prepared/history; not attributable by this audit'
    else:
        prepared = read(path / 'prepared.json')
        actual_history = read(path / 'history.json')
        item.update(cwd=prepared.get('cwd'), history=actual_history)
        if prepared.get('cwd') == FROZEN and actual_history == history:
            candidates.append((path, prepared))
            item['status'] = 'exact source and complete canonical history; further identity checks required'
        else:
            item['status'] = 'does not match exact source/history'
    candidate_inventory.append(item)
save('candidate-selection.json', {'passiveBaseline': baseline, 'novelCandidates': candidate_inventory,
     'rule': 'Novelty filters candidates only. No directory iteration order or mtime identity inference.'})
assert len(candidates) == 1, candidate_inventory
original, prepared = candidates[0]
assert original.name == 'h02-progress-71040-04724b7e-0737-4566-bdf4-576d7363ee6b'
assert Path(prepared['directory']).resolve() == original.resolve()
assert Path(prepared['historyPath']).resolve() == (original / 'history.json').resolve()
supervisor = read(original / 'supervisor.json')
writer = read(original / 'receipts.jsonl.writer.json')
verification = read(original / 'binding-verification.json')
seal = read(original / 'binding-seal.json')
rows = [json.loads(line) for line in (original / 'receipts.jsonl').read_text().splitlines()]
assert len(rows) == 206 and [r['sequence'] for r in rows] == list(range(1, 207))
assert one(rows, 'worker-start')['history'] == history
assert one(rows, 'worker-start')['cwd'] == FROZEN
assert seal['selectedRoot'] == FROZEN and seal['sealed'] and seal['inspectorDisconnectedBeforeHistory']
assert verification['status'] == 'bound' and not verification['failures']
assert Path(writer['path']).resolve() == (original / 'receipts.jsonl').resolve()
assert writer['regularFile'] and writer['flags'] == 'wx' and writer['mode'] == 384
assert supervisor['phase'] == 'final-with-binding' and supervisor['cwd'] == FROZEN
for key in ['directory', 'historyPath', 'receiptTransport', 'limits', 'executable', 'args']:
    assert supervisor[key] == prepared[key], key
assert supervisor['limits'] == {'wallMs': 20000, 'groupRssBytes': 1073741824,
    'nodeHeapMiB': 384, 'postEnqueueWindowMs': 1000}
outcome = supervisor['outcome']
assert Path(outcome['logPath']).resolve() == Path(writer['path']).resolve()
assert outcome['exitCode'] == 0 and outcome['signal'] is None and outcome['reason'] == 'exited'
assert outcome['bindingStatus'] == 'bound' and not outcome.get('primaryObservationError')
assert not outcome['cleanupErrors'] and outcome['prefixViolations'] == outcome['warnings'] == 0
assert not supervisor['killAttempted'] and not supervisor['latestGroupRows']
assert not supervisor['heapDiagnosticDetected']
retained_source = SOURCE / 'sources/packages/query-db-collection/tests/queued-answer-progress-receipts.ts'
retained_phases = set(re.findall(r'`([^`]+)`', retained_source.read_text()))
assert outcome['receipts'] == [r for r in rows if r['phase'] in retained_phases]
assert len(outcome['receipts']) == 23
identity = one(rows, 'metadata-identities')
assert identity['keyLane'] == 'authored'
assert len({identity[k] for k in ['sourceId', 'rootId', 'downstreamId']}) == 3
assert supervisor['pid'] == 71052 and writer['pid'] == 71056
cuts = {phase: one(rows, phase) for phase in ['initial-publication', 'retained-publication',
    'final-publication', 'followup-publication']}
assert [cuts[p]['sequence'] for p in cuts] == [87, 134, 161, 185]
assert cuts['retained-publication']['pendingProviderAnswers'] == 3
assert one(rows, 'reload-start')['sequence'] == 88
assert one(rows, 'answer-queued')['sequence'] == 152 and one(rows, 'answer-queued')['enqueueReturned']
assert one(rows, 'answer-executed')['sequence'] == 153
assert one(rows, 'followup-start')['sequence'] == 162
assert one(rows, 'followup-source-applied')['sequence'] == 177
assert one(rows, 'followup-acquisition-settled') == {'h02': True, 'sequence': 181,
    'phase': 'followup-acquisition-settled', 'attempt': 12, 'outcome': 'fulfilled'}
assert one(rows, 'followup-settled')['attempts'] == [[12, 'fulfilled']]
assert rows[-1] == one(rows, 'worker-cleaned')
for phase, cut in cuts.items():
    if phase in ['initial-publication', 'retained-publication']:
        expected_id, expected_rank = 4, 40
    else:
        expected_id, expected_rank = 3, 35 if phase == 'followup-publication' else 30
    for layer, field, entries_field in [('root', 'rows', 'entries'),
                                       ('downstream', 'downstream', 'downstreamEntries')]:
        assert len(cut[field]) == 1
        value = cut[field][0]
        expected = {'id': expected_id, 'rank': expected_rank, 'markers': [],
            '$hasPendingWrites': False, '$origin': 'remote',
            '$key': f'metadata-{layer}-{expected_id}', '$collectionId': identity[f'{layer}Id']}
        if layer == 'downstream':
            expected.update(observedKey=f'metadata-root-{expected_id}',
                observedCollectionId=identity['rootId'], observedOrigin='remote', observedPending=False)
        assert value == expected, (phase, layer, value)
        assert cut[entries_field] == [[expected['$key'], expected]]

# Recorder consistency checks preserve every callback and duplicate. Expected
# deltas here come from complete recorded public cuts, not product internals.
callbacks = [r for r in rows if r['phase'] in ['public-change', 'downstream-change']]
assert [r['sequence'] for r in callbacks] == [83, 84, 85, 86, 159, 160, 182, 183]
previous = {'root': [], 'downstream': []}
for callback in callbacks:
    layer = 'root' if callback['phase'] == 'public-change' else 'downstream'
    field = 'rows' if layer == 'root' else 'downstream'
    checkpoint = 'initial-publication' if callback['sequence'] < 88 else (
        'final-publication' if callback['sequence'] < 162 else 'followup-publication')
    current = cuts[checkpoint][field]
    assert callback['rows'] == current
    assert callback['entries'] == [[v['$key'], v] for v in current]
    if layer == 'downstream':
        assert callback['upstreamEntries'] == cuts[checkpoint]['entries']
    prior = previous[layer]
    assert len({v['$key'] for v in prior}) == len(prior)
    assert len({v['$key'] for v in current}) == len(current)
    expected_changes = []
    for old in prior:
        matching = [v for v in current if v['$key'] == old['$key']]
        if not matching:
            expected_changes.append({'type': 'delete', 'key': old['$key'], 'value': old})
        elif matching[0] != old:
            expected_changes.append({'type': 'update', 'key': old['$key'],
                'value': matching[0], 'previousValue': old})
    for value in current:
        if not any(old['$key'] == value['$key'] for old in prior):
            expected_changes.append({'type': 'insert', 'key': value['$key'], 'value': value})
    canonical = lambda values: sorted(json.dumps(v, sort_keys=True) for v in values)
    assert canonical(callback['changes']) == canonical(expected_changes), callback['sequence']
    previous[layer] = current
save('publication-reconstruction.json', {'currentRunIdentities': identity,
    'cuts': cuts, 'allCallbacksInOriginalOrder': callbacks,
    'followupLifecycle': [r for r in rows if 162 <= r['sequence'] <= 185 and
        r['phase'] not in ['actual-key-prefix', 'query-key-callback', 'source-stack']],
    'receiptPhases': [[r['sequence'], r['phase']] for r in rows],
    'judgmentLimit': 'This is recorded-evidence consistency, not another runtime execution of the independent native checker.'})

manifest = {}
def preserve_file(path, target):
    assert path.is_file() and not path.is_symlink()
    shutil.copy2(path, target)
    size, sha = path.stat().st_size, digest(path)
    assert target.stat().st_size == size and digest(target) == sha
    manifest[str(target.relative_to(HERE))] = {'original': str(path), 'bytes': size, 'sha256': sha}

raw = HERE / 'raw-histories' / original.name
raw.parent.mkdir(mode=0o700)
shutil.copytree(original, raw, symlinks=True)
for path in sorted(original.rglob('*')):
    assert not path.is_symlink()
    if path.is_dir():
        continue
    target = raw / path.relative_to(original)
    assert path.is_file() and digest(target) == digest(path) and target.stat().st_size == path.stat().st_size
    manifest[str(target.relative_to(HERE))] = {'original': str(path), 'bytes': path.stat().st_size,
        'sha256': digest(path)}
(HERE / 'raw-outer').mkdir(mode=0o700)
assert {p.name for p in OUTER.iterdir()} == {'outer-vitest.log', 'launcher-process.txt', 'source-prelaunch.json'}
for path in OUTER.iterdir():
    preserve_file(path, HERE / 'raw-outer' / path.name)
for path, name in [(initial_path, 'actual-initial-exec-return.json'),
                   (final_path, 'actual-final-exec-return.json'), (admission_path, 'actual-root-admission.json')]:
    preserve_file(path, HERE / name)
save('raw-manifest.json', manifest)
processes = [
    {'role': 'outer', 'pid': 71010, 'groupTarget': 71010, 'identitySource': str(OUTER / 'launcher-process.txt')},
    {'role': 'receiving-parent', 'pid': 71040, 'groupTarget': None,
     'identitySource': 'Exact bound supervisor source process.pid naming in the original prepared UUID directory; no live PPID/PGID receipt'},
    {'role': 'detached-leader', 'pid': 71052, 'groupTarget': 71052,
     'identitySource': str(original / 'supervisor.json'),
     'limit': 'Bound detached-spawn target group; no persisted initial actual getpgid'},
    {'role': 'receipt-writer', 'pid': 71056, 'groupTarget': None,
     'identitySource': str(original / 'receipts.jsonl.writer.json')},
]
save('original-process-identities.json', {'processes': processes,
    'status': 'Original recorded identities only; absence checks not executed by this audit.',
    'limits': 'No actual current-run parent/outer live PPID/PGID observation or initial inner getpgid receipt was supplied. No later identity substituted.'})
source = read(SOURCE / 'source-freeze.json')
inventory = read(SOURCE / 'source-inventory.json')
for name, expected in inventory.items():
    assert digest(SOURCE / 'sources' / name) == expected
payloads = 0
for package in source['packages'].values():
    assert str((SOURCE / 'sources' / package['logical']).resolve()) == package['resolved']
    for name, expected in package['regularPayloadFilesMap'].items():
        assert digest(Path(package['resolved']) / name) == expected
        payloads += 1
for name, expected in source['dependencyReuseLinks'].items():
    path = SOURCE / 'sources' / name
    assert path.is_symlink() == expected['isSymlink'] and str(path.resolve()) == expected['resolved']
assert digest(source['node']['executable']) == source['node']['sha256']
assert digest(SOURCE / 'sources/pnpm-lock.yaml') == source['lockfiles']['repoPnpmLock']
assert digest(SOURCE / 'sources/node_modules/.pnpm/lock.yaml') == source['lockfiles']['installedPnpmLock']
binding = read(PREP / 'binding.json')
for name, expected in binding['files'].items():
    assert digest(PREP / name) == expected
for name, expected in binding['externalInputs'].items():
    assert digest(name) == expected
save('source-tool-postcheck.json', {'status': 'All existing bound source/tools/packages/locks/preparation/external hashes match',
    'sourceMembers': len(inventory), 'productionMembers': len(source['productionFiles']),
    'namedPackageMaps': len(source['packages']), 'namedOwnPayloadHashes': payloads,
    'reuseLinks': len(source['dependencyReuseLinks']), 'externalPins': len(binding['externalInputs']),
    'sourceFreezeSha256': digest(SOURCE / 'source-freeze.json'),
    'python': {'path': sys.executable, 'resolved': str(Path(sys.executable).resolve()),
               'sha256': digest(Path(sys.executable).resolve())},
    'limit': 'No transitive host/native/dist equivalence, application imports or fresh compiler result.'})
save('observation-summary.json', {'actualInitialChunk': 'e143cb', 'actualSessionId': 35271,
    'actualFinalChunk': '12ec83', 'actualOuterExitCode': 0, 'selectedDisplayName': title,
    'passedTests': 1, 'skippedTests': 19, 'generatedCampaign': False, 'historyCount': 1,
    'seed': None, 'property': None, 'multiplier': 1, 'reachCounts': counts,
    'originalDirectory': str(original), 'childExitCode': outcome['exitCode'],
    'bindingStatus': outcome['bindingStatus'], 'rawReceipts': len(rows), 'retainedReceipts': len(outcome['receipts']),
    'workerCleanedSequence': 206, 'elapsedMs': supervisor['elapsedMs'],
    'maxSampledGroupRssBytes': supervisor['maxSampledGroupRssBytes'],
    'rawFiles': len(manifest), 'rawBytes': sum(v['bytes'] for v in manifest.values()),
    'assertionEvidence': 'Exact frozen registration source orders root ordinary, downstream ordinary, metadata callback checks, then outcome check, metadata.finish(), and caller reach.assertReached(). Selected pass supports invocation under this source-order assumption; no dedicated runtime finish/assert/UUID-console ordinal receipt or new parent-checker V8 proof.',
    'absenceStatus': 'Not probed. Exact original identity proposal is separate and inert.',
    'limits': requirements['inheritedEvidenceLimits']})
print(json.dumps({'historyArtifacts': 1, 'rawReceipts': 206, 'retainedReceipts': 23,
    'all31StatesAt': 1, 'childExitCode': 0, 'actualOuterExitCode': 0,
    'rawFiles': len(manifest), 'rawBytes': sum(v['bytes'] for v in manifest.values()),
    'originalPids': [p['pid'] for p in processes], 'targetGroups': [71010, 71052],
    'processProbesExecuted': False}))
