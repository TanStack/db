import hashlib
import json
from pathlib import Path
import shutil
import sys

H = Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1')
batch_path = H / 'remaining-neighbor-setup-successor-root-batch-admission-v2.json'
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(batch_path) == 'e0b7cd93993c94945eacca81d4a88feed66ba7419e1f07074a953dbd387690af'
index = int(sys.argv[1])
entry = json.loads(batch_path.read_text())['orderedAdmissions'][index]
assert sha(entry['admission']) == entry['sha256']
admission = json.loads(Path(entry['admission']).read_text())
R = Path(admission['outputDirectory'])
T = Path(sys.argv[2])
W = Path(admission['worktree'])

def write(name, value):
    with (R / name).open('x') as f:
        f.write(value if isinstance(value, str) else json.dumps(value, indent=2) + '\n')

def inventory(base):
    files = {}
    for p in sorted(base.rglob('*')):
        assert not p.is_symlink(), p
        if p.is_file():
            files[str(p.relative_to(base))] = {'bytes': p.stat().st_size, 'sha256': sha(p)}
    return files

before = inventory(T)
shutil.copytree(T, R / 'receiving')
assert before == inventory(T) == inventory(R / 'receiving')
write('actual-receiving-copy-verification-v1.json', {'originalDirectory': str(T), 'canonicalOriginalDirectory': str(T.resolve()), 'archiveDirectory': 'receiving', 'members': len(before), 'bytes': sum(x['bytes'] for x in before.values()), 'allOriginalBytesMatchedBeforeAndAfterCopy': True, 'files': before})
s = json.loads((T / 'supervisor.json').read_text())
o = s['outcome']
a = [json.loads(line) for line in (T / 'receipts.jsonl').read_text().splitlines()]
assert a and [x['sequence'] for x in a] == list(range(1, len(a) + 1))
assert all(x['h02'] is True for x in a)
assert not s['killAttempted'] and not s.get('watchdogTrigger') and not s['latestGroupRows'] and not s['heapDiagnosticDetected']
assert o['reason'] == 'exited' and o['exitCode'] == 0 and o['signal'] is None and o['bindingStatus'] == 'bound'
assert not any(o.get(k) for k in ['primaryObservationError', 'bindingError', 'cleanupErrors', 'prefixViolations', 'warnings'])
b = json.loads((T / 'binding-verification.json').read_text())
assert b['status'] == 'bound' and not b['failures'] and b['receiptTransport']['count'] == len(a)
seal = json.loads((T / 'binding-seal.json').read_text())
assert all(seal[k] is True for k in ['sealed', 'skipAllPausesAcknowledged', 'debuggerDisableAcknowledged', 'inspectorDisconnectedBeforeHistory'])
history = json.loads((T / 'history.json').read_text())
assert history == admission['actualHistoryRequired'] == a[0]['history']
assert a[0]['phase'] == 'worker-start'
outer = (R / 'outer-vitest.log').read_text()
assert 'Tests  1 passed | 4 skipped (5)' in outer
assert (T / 'worker.stderr.log').read_bytes() == b''
reaches = {k: [] for k in admission['expectedReach']}
reload_active = False
reloads = []
cleanups = []
for x in a:
    phase = x['phase']
    if phase == 'reload-start':
        reload_active = True
        reloads.append(x['sequence'])
    if phase == 'cleanup-start':
        reload_active = False
        cleanups.append(x['sequence'])
    states = []
    if history['kind'] == 'query':
        if phase == 'initial-publication' and isinstance(x.get('rows'), list):
            states.append('nonempty-prior' if x['rows'] else 'empty-prior')
        if phase == 'retained-publication' and x.get('reason') == 'provider-hold-before-release' and x.get('pendingProviderAnswers', 0) > 0:
            states.append('held-provider-read')
        if phase == 'answer-queued' and x.get('enqueueReturned') is True:
            states.append('completed-enqueue')
        if phase == 'answer-executed':
            states.append('answer-executed')
        if reload_active and phase == 'public-change':
            states.append('root-change')
        if reload_active and phase == 'downstream-change':
            states.append('downstream-change')
    else:
        if phase == 'source-establishing-receipt' and x.get('literalTrue') is True:
            states.append('literal-true-establishing-receipt')
        if phase == 'immediate-publication' and history['kind'] == 'sync-initial' and x.get('cut') == 'subscriber-return-before-preload':
            states.append('subscriber-return-before-preload')
        if phase == 'immediate-publication' and history['kind'] == 'sync-mutation':
            states.append('ordinary-mutation-return-before-host-turn')
    if phase == 'final-publication':
        states.append('final-publication')
    if phase == 'worker-cleaned':
        states.append('worker-cleaned')
    for state in states:
        if state in reaches:
            reaches[state].append(x['sequence'])
assert all(len(v) == 1 for v in reaches.values()), reaches
if history['kind'] == 'query':
    assert len(reloads) == len(cleanups) == 1
    assert reaches['completed-enqueue'][0] < reaches['answer-executed'][0]
    assert all(reloads[0] < reaches[k][0] < cleanups[0] for k in ['root-change', 'downstream-change', 'final-publication'])
else:
    immediate = next(x for x in a if x['phase'] == 'immediate-publication')
    assert immediate['sequence'] < reaches['final-publication'][0]
write('reach-reconstruction-v1.json', {'status': 'Every original finite runner reach reconstructed once from complete raw receipts', 'history': history, 'counts': {k: len(v) for k, v in reaches.items()}, 'receiptSequences': reaches, 'reloadStartSequences': reloads, 'cleanupStartSequences': cleanups, 'rawReceiptCount': len(a), 'rawReceiptSha256': sha(T / 'receipts.jsonl'), 'basis': 'Exact unchanged source runner predicates and reload-start to cleanup-start event cut; normal native test passed its original assertReached. No console output or independent model result is invented by this static trace audit.'})
observations = [x for x in a if x['phase'] in ['initial-publication', 'immediate-publication', 'retained-publication', 'public-change', 'downstream-change', 'final-publication']]
write('public-comparison-qualification-v1.json', {'status': 'Live unchanged shared publication judgment/model and V4 validating authored-payload projection passed all reached original cuts', 'observations': observations, 'liveEvidence': 'Native exact finite test passed; no primary observation error; all expected finite reaches measured; normal worker exit0.', 'rawMetadata': 'All raw public metadata and change payloads preserved in the complete receipt stream; expected values remain in the unchanged shared model.', 'limits': 'One finite path. No temporal virtual-metadata coherence, generated closure, candidate control or conflicting-cache progress claim.'})
f = json.loads(Path(admission['sourceFreeze']).read_text())
n = m = 0
for key in ['productionFiles', 'instrumentFiles', 'sharedInstrumentFiles']:
    for rel, digest in f[key].items():
        assert sha(W / rel) == digest, rel
        n += 1
assert sha(f['node']['executable']) == f['node']['sha256']
assert sha(W / 'pnpm-lock.yaml') == f['lockfiles']['repoPnpmLock']
assert sha(W / 'node_modules/.pnpm/lock.yaml') == f['lockfiles']['installedPnpmLock']
for rel, row in f['dependencyReuseLinks'].items():
    assert (W / rel).is_symlink() == row['isSymlink'] and str((W / rel).resolve()) == row['resolved']
for pkg in f['packages'].values():
    for rel, digest in pkg['regularPayloadFilesMap'].items():
        assert sha(Path(pkg['resolved']) / rel) == digest
        m += 1
write('source-identity-after-v1.json', {'sourceMapEntries': n, 'namedPackagePayloadFiles': m, 'allMatched': True, 'nodeLocksAndReuseLinksMatched': True, 'limits': 'Disk identity; full actual compiled/evaluated/V8 source binding evidence retained separately with its stated limits.'})
outer_pid, outer_pgid = [int(v) for v in (R / 'launcher-process.txt').read_text().split()[:2]]
child_pid = s['pid']
for src, dest in [(Path(entry['admission']), 'root-admission-v2.json'), (batch_path, 'root-batch-admission-v2.json'), (Path(admission['sourceFreeze']), 'source-freeze-v4.json'), (Path(admission['launcher']), Path(admission['launcher']).name), (Path(admission['independentSourceReview']), 'independent-v4-source-review-v1.md'), (Path(admission['successorIndependentReview']), 'independent-setup-successor-source-review-v1.md'), (Path(__file__), 'result-freeze-source-v1.py')]:
    assert not (R / dest).exists()
    shutil.copyfile(src, R / dest)
root_absence = H / (R.name + '-root-process-absence-v1.json')
absence_sha = None
if root_absence.exists():
    shutil.copyfile(root_absence, R / 'root-process-absence-v1.json')
    absence_sha = sha(root_absence)
write('result-qualification-v1.json', {'status': 'Finite control normal complete GREEN qualified; independent and root result acceptance pending', 'selectedPath': admission['selectedPath'], 'nativePassed': 1, 'nativeSkipped': 4, 'finiteHistories': 1, 'actualHistory': history, 'rawReceiptCount': len(a), 'finiteReachCounts': {k: len(v) for k, v in reaches.items()}, 'liveSharedComparisonsPassed': True, 'rawMetadataPreserved': True, 'binding': {'status': 'bound', 'bindings': len(b['bindings']), 'failures': [], 'startupSealed': True, 'inspectorDisconnectedBeforeHistory': True, 'inventories': sorted(p.name for p in T.glob('evaluated-*.json')), 'limits': b['limits']}, 'operational': {'outerExitCode': 0, 'childExitCode': 0, 'signal': None, 'reason': 'exited', 'killAttempted': False, 'heap': False, 'observationError': None, 'cleanupErrors': [], 'remainingGroupRows': [], 'elapsedMs': s['elapsedMs'], 'maxSampledGroupRssBytes': s['maxSampledGroupRssBytes'], 'outerPid': outer_pid, 'outerPgid': outer_pgid, 'childPid': child_pid, 'childOriginalPgid': child_pid, 'rootAbsenceReceiptSha256': absence_sha, 'executionSandboxPermissions': 'require_escalated'}, 'sourceIdentityAfter': {'sourceMapEntries': n, 'namedPackagePayloadFiles': m, 'nodeLocksAndReuseLinksMatched': True}, 'limits': 'One finite baseline control, not generated closure, temporal virtual-metadata coherence or candidate reach. Sync mutation makes no literal-true source receipt claim. Original failed setup preserved. No retry or new recipe admitted; subsequent controls require their own already-issued exact admissions and no-surprise batch condition.'})
write('handoff-v1.md', f"The exact separately admitted setup-successor control {admission['selectedPath']} passed once, with one native test passed/four skipped and {len(a)} contiguous raw receipts. Every original declared finite reach occurred once. All {len(before)} original child files are copied byte-for-byte with before/after identity. Live unchanged shared comparisons and V4 authored-payload projection passed; raw metadata is retained. Normal outer/child exit0, no kill/resource/observation/binding/cleanup failure and empty original child group. Original outer PID/PGID {outer_pid}/{outer_pgid}, child PID/originalPGID {child_pid}/{child_pid}. Independent root original-ID absence receipt SHA is {absence_sha or 'pending; root notified separately'}.\n\nBinding status bound, with {len(b['bindings'])} bindings; startup inspector disconnected before history. All {n} source entries/{m} package payloads, Node, locks and reuse links match after execution. This is finite baseline evidence only. No generated closure, metadata temporal coherence, candidate states, retry or source edit is claimed. The initial sandbox setup failure remains immutable. Independent/root result classification remains required.\n")
files = inventory(R)
write('packet-sha256-v1.json', {'format': 'relative-path bytes SHA256; excludes this manifest only', 'status': 'frozen exact separately admitted setup-successor finite control result', 'members': len(files), 'bytes': sum(v['bytes'] for v in files.values()), 'files': files})
print(json.dumps({'directory': str(R), 'manifestSha256': sha(R / 'packet-sha256-v1.json'), 'members': len(files), 'bytes': sum(v['bytes'] for v in files.values()), 'childFiles': len(before), 'rawReceipts': len(a), 'reach': {k: len(v) for k, v in reaches.items()}, 'outerPid': outer_pid, 'outerPgid': outer_pgid, 'childPid': child_pid, 'childOriginalPgid': child_pid, 'rootAbsenceReceiptSha256': absence_sha, 'normalExpectedResult': True}))
