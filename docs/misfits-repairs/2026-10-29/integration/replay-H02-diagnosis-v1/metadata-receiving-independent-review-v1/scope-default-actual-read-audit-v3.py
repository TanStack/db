"""Read-only audit of one frozen run. No test, process probe, or new oracle."""
import hashlib
import json
from collections import Counter
from pathlib import Path

WT = Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-metadata-receiving-v1')
FREEZE = WT / 'docs/misfits-metadata-scope-default-result-freeze-v3.json'
OUT = Path(__file__).with_suffix('.json')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read(path):
    return json.loads(path.read_text())

def lines(path):
    return [json.loads(line) for line in path.read_text().splitlines()]

assert sha(FREEZE) == '6ab1f9d725a91919bdedc45cc92c869bce2ddcf4b3d290e81a5bb40300d4841b'
frozen = read(FREEZE)
output = Path(frozen['outputDirectory'])
assert {str(p.relative_to(output)) for p in output.rglob('*') if p.is_file()} == set(frozen['assets'])
assert len(frozen['assets']) == frozen['assetCount'] == 1954
for name, expected in frozen['assets'].items():
    assert sha(output / name) == expected, name
admission = WT / 'docs/misfits-metadata-scope-default-root-admission-v3.json'
assert sha(admission) == frozen['admissionSha256'] == 'f851652a162b43b73f455493d107c0ea030ff13c7cdb6b120fb3bba2ec02d82a'
native = output / 'receiving-artifacts'
original = Path(frozen['originalNativeDirectory'])
copy = read(output / 'root-native-artifact-copy.json')
assert copy['fileCount'] == frozen['nativeFileCount'] == len(copy['files']) == 1947
assert {str(p.relative_to(native)) for p in native.rglob('*') if p.is_file()} == set(copy['files'])
assert {str(p.relative_to(original)) for p in original.rglob('*') if p.is_file()} == set(copy['files'])
for name, expected in copy['files'].items():
    assert sha(native / name) == sha(original / name) == expected, name

raw_bytes = (native / 'receipts.jsonl').read_bytes()
assert raw_bytes.endswith(b'\n')
raw = lines(native / 'receipts.jsonl')
assert len(raw) == 177
assert [r['sequence'] for r in raw] == list(range(1, 178))
assert all(r['h02'] is True for r in raw)
phases = Counter(r['phase'] for r in raw)
assert not any(phases[name] for name in ['worker-error', 'warning', 'conflicting-cache-premise'])
one = lambda phase: next(r for r in raw if r['phase'] == phase)
assert phases['answer-queued'] == phases['answer-executed'] == 1
assert one('answer-queued')['sequence'] == 152 and one('answer-queued')['enqueueReturned'] is True
assert one('answer-executed')['sequence'] == 153
assert one('initial-publication')['sequence'] == 87
assert one('reload-start')['sequence'] == 88
assert one('retained-publication')['sequence'] == 134
assert one('retained-publication')['pendingProviderAnswers'] == 3
assert one('final-publication')['sequence'] == 160
assert one('cleanup-start')['sequence'] == 161
assert one('worker-cleaned')['sequence'] == 177
writer = read(native / 'receipts.jsonl.writer.json')
assert writer['flags'] == 'wx' and writer['mode'] == 384 and writer['regularFile'] is True
assert writer['path'] == str(original / 'receipts.jsonl')

supervisor = read(native / 'supervisor.json')
outcome = supervisor['outcome']
assert supervisor['phase'] == 'final-with-binding' and supervisor['pid'] == 32210
assert supervisor['latestGroupRows'] == [] and supervisor['killAttempted'] is False
assert supervisor['heapDiagnosticDetected'] is False and 'watchdogTrigger' not in supervisor
assert outcome['reason'] == 'exited' and outcome['exitCode'] == 0 and outcome['signal'] is None
assert outcome['cleanupErrors'] == [] and outcome['warnings'] == outcome['prefixViolations'] == 0
assert outcome['bindingStatus'] == 'bound' and 'primaryObservationError' not in outcome
assert supervisor['postEnqueue']['receiptCount'] == 177 and supervisor['postEnqueue']['lastSequence'] == 177
assert supervisor['limits'] == {'wallMs':20000,'groupRssBytes':1073741824,'nodeHeapMiB':384,'postEnqueueWindowMs':1000}
assert supervisor['maxSampledGroupRssBytes'] == 453509120
assert supervisor['elapsedMs'] == 2688
raw_by_sequence = {r['sequence']: r for r in raw}
assert all(raw_by_sequence[r['sequence']] == r for r in outcome['receipts'])
assert len({r['sequence'] for r in outcome['receipts']}) == len(outcome['receipts'])
assert (native / 'worker.stderr.log').stat().st_size == 0

source = read(WT / 'docs/misfits-metadata-receiving-preparation-v1/source-freeze.json')
maps = {}
for key in ['productionFiles','receivingProductionFiles','instrumentFiles','sharedInstrumentFiles']:
    maps.update(source[key])
assert len(maps) == 573
for name, expected in maps.items():
    assert sha(WT / name) == expected
payload_count = 0
for package in source['packages'].values():
    for name, expected in package['regularPayloadFilesMap'].items():
        assert sha(Path(package['resolved']) / name) == expected
        payload_count += 1
assert payload_count == 2544
assert sha(output / 'source-prelaunch.json') == sha(output / 'source-postreturn.json') == frozen['sourcePostreturnGateSha256']

binding = read(native / 'binding-verification.json')
assert binding['status'] == 'bound' and binding['failures'] == []
assert binding['actualKeyCount'] == phases['actual-key-prefix'] == 86
assert binding['emptyCallbacks'] == 3
assert binding['receiptTransport']['count'] == 177 and 'error' not in binding['receiptTransport']
assert len(binding['bindings']) == 652
v8 = lines(native / 'v8-binding.jsonl')
scripts = {s['scriptId']: s for s in v8 if s['phase'] == 'v8-compiled-script'}
assert len(scripts) == 1620
assert [s['method'] for s in v8 if s['phase'] == 'inspector-ack'] == ['Debugger.setSkipAllPauses','Debugger.enable','Debugger.disable']
assert not any('error' in s for s in v8 if s['phase'] == 'inspector-ack')
assert not any(s['phase'] == 'v8-source-error' for s in v8)
seal = read(native / 'binding-seal.json')
assert all(seal[k] is True for k in ['sealed','skipAllPausesAcknowledged','debuggerDisableAcknowledged','inspectorDisconnectedBeforeHistory'])
assert seal['inventorySha256'] == sha(native / 'evaluated-pre-history.json')
inventory_cache = {}
for item in binding['bindings']:
    name = item['inventory']
    if name not in inventory_cache:
        inventory_cache[name] = read(native / name)
    inventory = inventory_cache[name]
    assert inventory['selectedRoot'] == str(WT)
    path = str(WT / item['relative'])
    module = next(m for m in inventory['inventory'] if m.get('file','').split('?')[0] == path)
    assert module['sourceSha256'] == maps[item['relative']]
    assert module['codeSha256'] == item['codeSha256']
    assert item['evaluated'] == (module.get('evaluated') is True)
    transformed = (native / 'evaluated-sources' / (item['codeSha256'] + '.txt')).read_bytes()
    assert hashlib.sha256(transformed).hexdigest() == item['codeSha256']
    sealed = next(x for x in seal['bindings'] if x['file'] == path and x['codeSha256'] == item['codeSha256'])
    assert item['scripts']
    for script in item['scripts']:
        actual = scripts[script['scriptId']]
        assert actual['sourceSha256'] == script['sourceSha256']
        assert actual['url'] in [path, 'file://' + path, module.get('url')]
        assert script in sealed['scripts']
        executed = (native / 'v8-sources' / (script['sourceSha256'] + '.txt')).read_bytes()
        assert transformed in executed

actual = read(output / 'root-actual-tool-return.json')
assert actual['initialToolReturn']['session_id'] == 21330
assert actual['actualCompletionToolReturn']['exit_code'] == actual['actualOuterExitCode'] == 0
log = (output / 'outer-vitest.log').read_text()
assert 'Tests  1 passed | 3 skipped (4)' in log
required = read(WT / 'docs/misfits-metadata-receiving-admission-preparation-v3/reach-matrix.json')['cells'][0]['requiredStates']
assert len(required) == 17 and all("'" + name + "': 1" in log for name in required)
absence = read(output / 'root-original-identities-absence.json')
assert [(x['participant'],x['kind'],x['identity'],x['status']) for x in absence['probes']] == [
    ('outer','pid',32152,'empty-ESRCH'),('outer','pgid',32152,'empty-ESRCH'),
    ('supervisor-host','pid',32195,'empty-ESRCH'),('receiving-child','pid',32210,'empty-ESRCH'),
    ('receiving-detached-group-target','pgid',32210,'empty-ESRCH')]

result = {'status':'PASS: read/hash audit of frozen actual run only','freezeSha256':sha(FREEZE),
    'assetCount':1954,'nativeFileCount':1947,'originalAndCopyBytesEqual':True,
    'rawReceiptCount':177,'contiguousSequences':True,'phaseCounts':dict(phases),
    'sourceFiles':573,'namedPackagePayloadFiles':payload_count,'bindings':652,'bindingsPerCut':dict(Counter(i['inventory'] for i in binding['bindings'])),
    'compiledV8ScriptCount':1620,'nativeOuterSummary':'1 passed / 3 skipped','requiredReaches':{s:1 for s in required},
    'actualOuterExitCode':0,'receivingChildExitCode':0,'maxSampledGroupRssBytes':453509120,'elapsedMs':2688,
    'nativeRunsByReviewer':0,'processProbesByReviewer':0,'newRuntimeAdmission':False,
    'parentCheckerV8BindingCaptured':False,'childGroupInitialActualPgidPersisted':False,
    'limits':'Native test pass and post-comparison reaches supply parent shared-checker invocation/equality evidence; copied child inventories do not attest the parent compiled module bytes. Group absence covers named detached childPid target, without a separately persisted initial actual getpgid observation or escaped-descendant census.'}
with OUT.open('x') as output_file:
    output_file.write(json.dumps(result,indent=2,sort_keys=True)+'\n')
print(json.dumps({'output':str(OUT),'sha256':sha(OUT),'assetCount':1954,'rawReceiptCount':177,'bindings':652},indent=2))
