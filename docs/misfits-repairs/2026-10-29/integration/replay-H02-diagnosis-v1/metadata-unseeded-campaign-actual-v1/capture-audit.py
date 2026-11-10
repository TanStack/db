"""Preserve actual artifacts and audit recorded evidence; no product imports.

Native model/checker execution is the completed bound campaign. These checks
audit its recorder, identities, message consistency and source/tool postimage.
They do not rerun the campaign or supply a new product oracle.
"""
from pathlib import Path
import hashlib
import json
import re
import shutil

HERE = Path(__file__).resolve().parent
H = HERE.parent
PREP = H / 'metadata-unseeded-campaign-preparation-v1'
SOURCE = H / 'metadata-update-source-v3'
OUTER = H / 'metadata-unseeded-campaign-scope-default-v1'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def save(name, value):
    (HERE / name).write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def one(rows, phase):
    selected = [x for x in rows if x['phase'] == phase]
    assert len(selected) == 1, (phase, len(selected))
    return selected[0]


initial = read(HERE / 'actual-initial-exec-return.json')
final = read(HERE / 'actual-final-exec-return.json')
assert initial['actualToolReturn']['session_id'] == final['sessionId'] == 94881
assert initial['invocation']['sandbox_permissions'] == 'require_escalated'
assert final['actualToolReturn']['exit_code'] == 0
log = (OUTER / 'outer-vitest.log').read_text()
title = read(PREP / 'recipe.json')['expectedDisplayName']
assert len(re.findall(r'^ ✓ .* > ' + re.escape(title) + r' \d+ms$', log, re.M)) == 1
assert 'Tests  1 passed | 19 skipped (20)' in log
assert '(with seed=' not in log
states = read(PREP / 'evidence-requirements.json')['reach']['states']
blocks = re.findall(r'H02 metadata receiving reach \{.*?counts: \{(.*?)\n  \}\n\}', log, re.S)
assert len(blocks) == 8
cumulative = []
for index, block in enumerate(blocks, 1):
    counts = {name: int(value) for name, value in re.findall(r"'([^']+)': (\d+)", block)}
    assert set(counts) == set(states) and set(counts.values()) == {index}
    cumulative.append(counts)

prelaunch = read(OUTER / 'source-prelaunch.json')
baseline = prelaunch['receivingEvidenceBaseline']
temporary = Path(baseline['temporaryRoot'])
frozen_root = str(SOURCE / 'sources')
candidates = []
for path in sorted(temporary.iterdir()):
    if not path.name.startswith('h02-progress-') or path.name in baseline['members']:
        continue
    prepared_path = path / 'prepared.json'
    if not prepared_path.is_file():
        continue
    prepared = read(prepared_path)
    if prepared.get('cwd') != frozen_root:
        continue
    history = read(path / 'history.json')
    if history.get('cacheIdentity') != 'scope' or history.get('metadataKeys') != 'default':
        continue
    candidates.append((path, prepared, history))
assert len(candidates) == 8, [str(x[0]) for x in candidates]
assert {re.fullmatch(r'h02-progress-(\d+)-[0-9a-f-]+', x[0].name)[1] for x in candidates} == {'99770'}

raw_directory = HERE / 'raw-histories'
raw_directory.mkdir(mode=0o700)
manifest = {}
summaries = []
processes = [
    {'role': 'outer', 'pid': 99756, 'groupTarget': 99756, 'identitySource': 'actual launcher-process.txt'},
    {'role': 'receiving-parent', 'pid': 99770, 'groupTarget': 99756, 'identitySource': 'eight actual prepared UUID paths plus actual live outer-group observation row with PPID99756 and PGID99756'},
]
lifecycle = read(HERE / 'actual-outer-lifecycle-observation.json')
assert lifecycle['originalPid'] == lifecycle['originalPgid'] == lifecycle['actualGetpgid'] == 99756
observed_members = []
for row in lifecycle['matchingOriginalGroupRows']:
    values = row.strip().split(None, 4)
    observed_members.append({'pid': int(values[0]), 'ppid': int(values[1]), 'pgid': int(values[2]), 'rawRow': row})
assert any(x['pid'] == 99770 and x['ppid'] == 99756 and x['pgid'] == 99756 for x in observed_members)
for member in observed_members:
    if member['pid'] not in {x['pid'] for x in processes}:
        processes.append({'role': 'actual-outer-group-observed-member', 'pid': member['pid'], 'groupTarget': member['pgid'], 'identitySource': 'actual-outer-lifecycle-observation.json', 'actualRow': member['rawRow'], 'limit': 'Includes the actual short-lived monitor ps and esbuild observed in the group; no launch-time identity reconstructed.'})
retained_source = (SOURCE / 'sources/packages/query-db-collection/tests/queued-answer-progress-receipts.ts').read_text()
retained_phases = set(re.findall(r'`([^`]+)`', retained_source))
for original, prepared, history in candidates:
    assert Path(prepared['directory']).resolve() == original.resolve()
    assert Path(prepared['historyPath']).resolve() == (original / 'history.json').resolve()
    assert history['kind'] == 'query' and history['scheduler'] == 'microtask'
    assert history['includes'] and history['window'] and history['nonemptyPrior']
    assert 0 <= history['keyShift'] <= 20 and 1 <= history['rankScale'] <= 20
    assert history['metadataFollowupQuarter'] in [1, 2, 3]
    supervisor = read(original / 'supervisor.json')
    writer = read(original / 'receipts.jsonl.writer.json')
    verification = read(original / 'binding-verification.json')
    seal = read(original / 'binding-seal.json')
    rows = [json.loads(line) for line in (original / 'receipts.jsonl').read_text().splitlines()]
    assert [row['sequence'] for row in rows] == list(range(1, len(rows) + 1))
    assert one(rows, 'worker-start')['history'] == history
    assert one(rows, 'worker-start')['cwd'] == frozen_root
    assert seal['selectedRoot'] == frozen_root and seal['sealed'] is True
    assert seal['inspectorDisconnectedBeforeHistory'] is True
    assert verification['status'] == 'bound' and not verification['failures']
    assert Path(writer['path']).resolve() == (original / 'receipts.jsonl').resolve()
    assert writer['regularFile'] and writer['flags'] == 'wx' and writer['mode'] == 384
    assert supervisor['phase'] == 'final-with-binding'
    assert supervisor['cwd'] == frozen_root and supervisor['directory'] == prepared['directory']
    assert supervisor['receiptTransport'] == prepared['receiptTransport']
    assert Path(supervisor['outcome']['logPath']).resolve() == Path(writer['path']).resolve()
    assert supervisor['limits'] == prepared['limits'] == {'wallMs': 20000, 'groupRssBytes': 1073741824, 'nodeHeapMiB': 384, 'postEnqueueWindowMs': 1000}
    outcome = supervisor['outcome']
    assert outcome['exitCode'] == 0 and outcome['signal'] is None and outcome['reason'] == 'exited'
    assert outcome['bindingStatus'] == 'bound' and not outcome.get('primaryObservationError')
    assert not outcome['cleanupErrors'] and outcome['prefixViolations'] == outcome['warnings'] == 0
    assert not supervisor['killAttempted'] and not supervisor['latestGroupRows']
    assert not supervisor['heapDiagnosticDetected']
    assert outcome['receipts'] == [row for row in rows if row['phase'] in retained_phases]
    baseline_row = one(rows, 'final-publication')
    followup_start = one(rows, 'followup-start')['sequence']
    applied = one(rows, 'followup-source-applied')['sequence']
    followup = one(rows, 'followup-publication')
    assert baseline_row['sequence'] < followup_start < applied < followup['sequence']
    assert rows[-1] == one(rows, 'worker-cleaned')
    updates = {}
    for layer, phase, values_name in [('root', 'public-change', 'rows'), ('downstream', 'downstream-change', 'downstream')]:
        callbacks = [row for row in rows if row['phase'] == phase and followup_start < row['sequence'] < followup['sequence']]
        changes = [change for row in callbacks for change in row['changes']]
        assert len(changes) == 1 and changes[0]['type'] == 'update'
        change = changes[0]
        assert [change['previousValue']] == baseline_row[values_name]
        assert [change['value']] == followup[values_name]
        assert all(row['rows'] == followup[values_name] for row in callbacks)
        assert change['key'] == change['previousValue']['$key'] == change['value']['$key']
        assert change['previousValue']['id'] == change['value']['id'] == 3 + history['keyShift']
        assert change['previousValue']['rank'] == 3 * history['rankScale']
        assert change['value']['rank'] == history['rankScale'] * (3 + history['metadataFollowupQuarter'] / 4)
        for field in ['$hasPendingWrites', '$origin', '$key', '$collectionId']:
            assert field in change['previousValue'] and field in change['value']
        updates[layer] = {'callbackSequences': [row['sequence'] for row in callbacks], 'change': change}
    target = raw_directory / original.name
    shutil.copytree(original, target, symlinks=True)
    files = 0
    total_bytes = 0
    for path in sorted(original.rglob('*')):
        if path.is_dir():
            continue
        assert path.is_file() and not path.is_symlink()
        name = str(path.relative_to(original))
        copied = target / name
        actual = digest(path)
        assert digest(copied) == actual and copied.stat().st_size == path.stat().st_size
        manifest[str(copied.relative_to(HERE))] = {'original': str(path), 'bytes': path.stat().st_size, 'sha256': actual}
        files += 1
        total_bytes += path.stat().st_size
    processes += [
        {'role': 'detached-leader', 'pid': supervisor['pid'], 'groupTarget': supervisor['pid'], 'identitySource': str(original / 'supervisor.json'), 'limit': 'detached target group from bound spawn design, no persisted initial actual getpgid'},
        {'role': 'receipt-writer', 'pid': writer['pid'], 'groupTarget': None, 'identitySource': str(original / 'receipts.jsonl.writer.json')},
    ]
    summaries.append({'originalDirectory': str(original), 'capturedDirectory': str(target), 'history': history,
                      'detachedLeaderPid': supervisor['pid'], 'receiptWriterPid': writer['pid'],
                      'rawReceipts': len(rows), 'retainedReceipts': len(outcome['receipts']),
                      'workerCleanedSequence': rows[-1]['sequence'], 'elapsedMs': supervisor['elapsedMs'],
                      'maxSampledGroupRssBytes': supervisor['maxSampledGroupRssBytes'],
                      'childExitCode': outcome['exitCode'], 'bindingStatus': outcome['bindingStatus'],
                      'followupStartSequence': followup_start, 'followupPublicationSequence': followup['sequence'],
                      'updates': updates, 'files': files, 'bytes': total_bytes})

outer_capture = HERE / 'raw-outer'
outer_capture.mkdir(mode=0o700)
for original in sorted(OUTER.iterdir()):
    assert original.is_file() and not original.is_symlink()
    copied = outer_capture / original.name
    shutil.copy2(original, copied)
    assert digest(copied) == digest(original)
    manifest[str(copied.relative_to(HERE))] = {'original': str(original), 'bytes': original.stat().st_size, 'sha256': digest(original)}
save('raw-manifest.json', manifest)
save('original-process-identities.json', {'processes': processes, 'limit': 'Original recorded PID/target identities only. Actual postlaunch outer getpgid and receiving-parent PPID/group rows were captured while alive; no launch-time detached-group getpgid receipts are reconstructed.'})
save('observation-summary.json', {'actualOuterExitCode': 0, 'actualInitialChunk': '6e3e50', 'actualSessionId': 94881,
     'actualFinalChunk': '59a0d2', 'passedTests': 1, 'skippedTests': 19, 'selectedDisplayName': title,
     'suppliedSeed': None, 'chosenSeed': None, 'chosenSeedEvidence': 'Unavailable on successful unchanged unseeded campaign; no seed inferred.', 'budget': 8, 'multiplier': 1, 'rawHistoryArtifacts': len(summaries),
     'cumulativeReach': cumulative, 'minimumInSource': 1, 'observedEveryStatePerHistory': True,
     'reachBasis': 'Source beginHistory resets per-history deduplication; eight actual cumulative log increments require every state per serial history. Eight individual raw paths back the recorded transitions. No dedicated UUID-to-log-ordinal receipt is invented.',
     'finishEvidence': 'Exact frozen run/check/finish order plus selected campaign pass; no dedicated finalizer/assert receipt or new parent-checker V8 provenance.',
     'histories': summaries, 'rawFiles': len(manifest), 'rawBytes': sum(x['bytes'] for x in manifest.values()),
     'limits': read(PREP / 'evidence-requirements.json')['limits']})

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
save('source-tool-postcheck.json', {'status': 'all bound existing source/tool hashes match after the one actual campaign',
     'sourceMembers': len(inventory), 'productionMembers': len(source['productionFiles']),
     'namedPackageMaps': len(source['packages']), 'namedOwnPayloadHashes': payloads, 'reuseLinks': len(source['dependencyReuseLinks']),
     'sourceFreezeSha256': digest(SOURCE / 'source-freeze.json'), 'nodeBinary': 'matches', 'lockfiles': 'both match',
     'limits': 'No new preimage, complete transitive host/native/dist equivalence or fresh standalone typecheck claimed.'})
print(json.dumps({'historyArtifacts': len(summaries), 'allChildExits': [x['childExitCode'] for x in summaries],
                 'actualOuterExit': 0, 'rawFiles': len(manifest), 'rawBytes': sum(x['bytes'] for x in manifest.values()),
                 'final31Counts': list(cumulative[-1].values()), 'processIdentities': len(processes)}))
