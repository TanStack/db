"""Read/hash audit of frozen strict progress evidence; no run or process probe."""
import hashlib
import json
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
WT = Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-metadata-receiving-v1')
FREEZE = WT / 'docs/misfits-metadata-subscription-default-result-freeze-v3.json'
OUT = Path(__file__).with_suffix('.json')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read(path):
    return json.loads(path.read_text())

def lines(path):
    return [json.loads(line) for line in path.read_text().splitlines()]

assert sha(FREEZE) == '4186b8fda8a73a6432b1b50b9bf0a2ff86d472432f1b5c37c24f6268c84c902c'
frozen = read(FREEZE)
output = Path(frozen['outputDirectory'])
native = output / 'receiving-artifacts'
original = Path(frozen['originalNativeDirectory'])
assert {str(p.relative_to(output)) for p in output.rglob('*') if p.is_file()} == set(frozen['assets'])
assert len(frozen['assets']) == frozen['assetCount'] == 1953
for name, expected in frozen['assets'].items():
    assert sha(output / name) == expected, name
copy = read(output / 'root-native-artifact-copy.json')
assert copy['fileCount'] == len(copy['files']) == frozen['nativeFileCount'] == 1946
assert {str(p.relative_to(native)) for p in native.rglob('*') if p.is_file()} == set(copy['files'])
assert {str(p.relative_to(original)) for p in original.rglob('*') if p.is_file()} == set(copy['files'])
for name, expected in copy['files'].items():
    assert sha(original / name) == sha(native / name) == expected
admission_path = WT / 'docs/misfits-metadata-subscription-default-root-admission-v3.json'
assert sha(admission_path) == frozen['admissionSha256'] == '445abcdf4e75996785ecfcbc1352fa5bddde2c372a66884b6efdda76d1defa0b'
classification = WT / 'docs/misfits-metadata-scope-authored-root-classification-v3.json'
assert sha(classification) == '0c941598074238637f54d5e3907b973c3295f6a21a896bc473ceaeeca77e2820'
assert read(classification)['boundedAccepted'] is True
admission = read(admission_path)
assert admission['precedingRootClassificationSha256'] == sha(classification)

receipt_bytes = (native / 'receipts.jsonl').read_bytes()
assert receipt_bytes.endswith(b'\n')
raw = lines(native / 'receipts.jsonl')
assert len(raw) == 59552
assert [r['sequence'] for r in raw] == list(range(1, 59553))
assert all(r['h02'] is True for r in raw)
phases = Counter(r['phase'] for r in raw)
assert not any(phases[p] for p in ['warning','worker-error','answer-executed','final-publication','cleanup-start','worker-cleaned'])
assert phases['conflicting-cache-premise'] == phases['answer-queued'] == 1
by_sequence = {r['sequence']: r for r in raw}
premise = by_sequence[183]
assert premise['phase'] == 'conflicting-cache-premise' and premise['cut'] == 'held-queryFn-registration'
assert premise['pivot'] == 3
pending_key = ['h02-progress-markers',2,[3]]
sibling_key = ['h02-progress-markers',1,[3]]
compact = lambda value:json.dumps(value,separators=(',',':'))
assert premise['pendingKey'] == pending_key and premise['pendingAtom'] == compact(pending_key)
assert premise['cached'] == {'version':4,'backendVersion':0,'rows':[3]}
assert premise['emptySibling'] == {'atom':compact(sibling_key),'key':sibling_key,'answer':{'version':8,'backendVersion':1,'rows':[]}}
assert premise['observed'] == {
    'pending':True,'aborted':False,'pendingScope':[3],'pendingOwner':2,
    'pendingStartCount':1,'pendingActualCount':1,'pendingStatus':'success','pendingFetchStatus':'fetching',
    'siblingScope':[3],'siblingOwner':1,'siblingStartCount':0,'siblingActualCount':1,
    'siblingStatus':'success','siblingRows':[],'physicalQueriesCurrent':True,
    'pendingPhysicalQuery':4,'currentPhysicalQuery':4,'siblingPhysicalQuery':8,'siblingAnswerPhysicalQuery':8}
queued = by_sequence[185]
assert queued == {'h02':True,'sequence':185,'phase':'answer-queued','kind':'resolving-conflict',
    'atom':premise['pendingAtom'],'key':pending_key,'cachedVersion':4,'emptyVersion':8,
    'scheduler':'microtask','enqueueReturned':True}
assert by_sequence[181]['phase'] == 'provider-request' and by_sequence[181]['physicalQuery'] == 4
assert by_sequence[172]['phase'] == 'provider-answer' and by_sequence[172]['physicalQuery'] == 8
assert by_sequence[172]['answer'] == premise['emptySibling']['answer']
assert not any(r['phase'] in ['public-change','downstream-change'] and r['sequence'] > 110 for r in raw)

writer = read(native / 'receipts.jsonl.writer.json')
assert writer == {'path':str(original/'receipts.jsonl'),'pid':51470,'flags':'wx','mode':384,'regularFile':True}
supervisor = read(native / 'supervisor.json')
outcome = supervisor['outcome']
assert supervisor['phase'] == 'final-with-binding' and supervisor['pid'] == 51467
assert supervisor['watchdogTrigger'] == 'post-enqueue-window' and supervisor['killAttempted'] is True
assert supervisor['heapDiagnosticDetected'] is False and supervisor['latestGroupRows'] == []
assert supervisor['maxSampledGroupRssBytes'] == 699596800 < 1073741824
assert supervisor['elapsedMs'] == 3413
assert supervisor['limits'] == {'wallMs':20000,'groupRssBytes':1073741824,'nodeHeapMiB':384,'postEnqueueWindowMs':1000}
assert outcome['reason'] == 'wall' and outcome['exitCode'] is None and outcome['signal'] == 'SIGKILL'
assert outcome['cleanupErrors'] == [] and outcome['warnings'] == outcome['prefixViolations'] == 0
assert outcome['bindingStatus'] == 'bound' and 'primaryObservationError' not in outcome
monitor = supervisor['postEnqueue']
assert monitor['conflictSequence'] == 183 and monitor['queuedSequence'] == 185
assert 'executedSequence' not in monitor and isinstance(monitor['queuedAtParentMonotonicMs'],(int,float))
assert monitor['receiptCount'] == monitor['lastSequence'] == 59552 and monitor['lastPhase'] == raw[-1]['phase']
assert monitor['acquisitionCount'] == phases['acquisition-attempt'] == 5947
assert monitor['releaseCount'] == phases['acquisition-release'] == 5939
assert all(by_sequence[r['sequence']] == r for r in outcome['receipts'])
assert (native/'worker.stderr.log').stat().st_size == 0

# Reuse only the unchanged independent source/retained-code binding audit block.
# This does not import or run the default campaign or any native verifier.
template_path = HERE / 'scope-default-actual-read-audit-v3.py'
assert sha(template_path) == '2ceb8c09690fe4e59f31f76f570f486287499cd675870c269da6ec533b3cb581'
template = template_path.read_text()
start = template.index("source = read(WT / 'docs/misfits-metadata-receiving-preparation-v1/source-freeze.json')")
end = template.index("actual = read(output / 'root-actual-tool-return.json')")
common = template[start:end]
assert "len(binding['bindings']) == 652" in common
assert "binding['actualKeyCount'] == phases['actual-key-prefix'] == 86" in common
assert "binding['receiptTransport']['count'] == 177" in common
common = common.replace("len(binding['bindings']) == 652","len(binding['bindings']) == 489")
common = common.replace("binding['actualKeyCount'] == phases['actual-key-prefix'] == 86","binding['actualKeyCount'] == phases['actual-key-prefix'] == 29785")
common = common.replace("binding['receiptTransport']['count'] == 177","binding['receiptTransport']['count'] == 59552")
exec(compile(common,str(template_path),'exec'),globals())

actual = read(output/'root-actual-tool-return.json')
assert actual['initialToolReturn']['session_id'] == 62993 and actual['initialToolReturn']['chunk_id'] == 'f6ef5f'
assert actual['actualCompletionToolReturn']['exit_code'] == actual['actualOuterExitCode'] == 1
assert actual['actualCompletionToolReturn']['chunk_id'] == '3fa9e1'
log = (output/'outer-vitest.log').read_text()
assert 'Tests  1 failed | 3 skipped (4)' in log
assert 'bounded queued-answer progress failure after reached premise' in log
reach_packet = WT/'docs/misfits-metadata-receiving-admission-preparation-v3/reach-matrix.json'
states = read(reach_packet)['cells'][2]
terminal = set(states['terminalMetadataStates'])
reaches = {state:0 if state in terminal else 1 for state in states['requiredStates']}
assert len(reaches) == 18 and sum(reaches.values()) == 9
assert all("'"+state+"': "+str(count) in log for state,count in reaches.items())
absence = read(output/'root-original-identities-absence.json')
assert [(r['participant'],r['kind'],r['identity'],r['status']) for r in absence['probes']] == [
    ('outer','pid',51447,'empty-ESRCH'),('outer','pgid',51447,'empty-ESRCH'),
    ('supervisor-host','pid',51466,'empty-ESRCH'),('receiving-child','pid',51467,'empty-ESRCH'),
    ('receiving-detached-group-target','pgid',51467,'empty-ESRCH')]

result = {'status':'PASS: exact bounded queued-progress RED premises established from frozen bytes',
    'resultFreezeSha256':sha(FREEZE),'assetCount':1953,'nativeFileCount':1946,'originalAndCopyBytesEqual':True,
    'rawReceiptCount':59552,'rawBytes':len(receipt_bytes),'completeContiguousFinalDrain':True,
    'physicalConflictSequence':183,'completedResolvingEnqueueSequence':185,'answerExecutedCount':0,
    'firstWatchdogTrigger':'post-enqueue-window','reason':'wall','childExitCode':None,'childSignal':'SIGKILL',
    'phaseCounts':dict(phases),'reachCounts':reaches,'metadataMutantKill':False,'terminalMetadataGreen':False,'adapterCleanupCredit':False,
    'bindingRecords':489,'bindingsPerCut':dict(Counter(r['inventory'] for r in binding['bindings'])),
    'sourceFiles':573,'namedPackagePayloadFiles':2544,'maxSampledGroupRssBytes':699596800,'elapsedMs':3413,
    'nativeRunsByReviewer':0,'processProbesByReviewer':0,'newRuntimeAdmitted':False,
    'limits':'Finite bounded progress witness only; no product deadline or universal nontermination proof. No parent compiled-byte attestation, separately persisted initial actual childPGID, escaped-descendant census, terminal metadata or worker cleanup.'}
with OUT.open('x') as file:
    file.write(json.dumps(result,indent=2,sort_keys=True)+'\n')
print(json.dumps({'output':str(OUT),'sha256':sha(OUT),'rawReceiptCount':59552,'bindingRecords':489,'terminalReachCounts':{s:reaches[s] for s in terminal}},indent=2))
