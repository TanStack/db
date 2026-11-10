"""Static independent actual-result audit. No bound module imports or execution."""
import collections, datetime, hashlib, json, os
from pathlib import Path
O = Path(__file__).resolve().parent
H = O.parent
E = H / 'candidate-controls-pagination-shared-window-failure-receiving-runtime-v1'
errors = []
def check(value, message):
    if not value: errors.append(message)
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def bound(path, digest): check(sha(path) == digest, 'hash ' + str(path))
def pairs(items):
    out = {}
    for k, v in items:
        if k in out: raise ValueError('duplicate key ' + k)
        out[k] = v
    return out
def parse(text): return json.loads(text, object_pairs_hook=pairs, parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
def load(path): return parse(Path(path).read_text())
f = load(E / 'result-freeze-v1.json')
bound(E / 'result-freeze-v1.json', '5dd02625d22a6f096470737b3d09a447cf89c985d91f819e5e30cdda5c5e7b8a')
check(len(f['files']) == f['fileCount'] == 1996, '1996 members')
check(sum(i['bytes'] for i in f['files'].values()) == f['totalBytes'] == 36035934, '36035934 bytes')
check({str(p.relative_to(E)) for p in E.rglob('*') if p.is_file()} == set(f['files']) | {'result-freeze-v1.json'}, 'exact result file set')
for name, item in f['files'].items():
    p = E / name
    bound(p, item['sha256'])
    check(p.stat().st_size == item['bytes'], 'size ' + name)
    if name.endswith('.json'): load(p)
    elif name.endswith('.jsonl'):
        for line in p.read_text().splitlines(): parse(line)
copies = load(E / 'raw-copy-verification-v1.json')
check(copies['allCopiesByteEqual'] and copies['fileCount'] == len(copies['copies']) == 1972, '1972 raw copies')
for item in copies['copies']:
    bound(item['copy'], item['sha256']); bound(item['origin'], item['sha256'])
    check(Path(item['copy']).stat().st_size == Path(item['origin']).stat().st_size == item['bytes'], 'raw copy size')
for item in load(E / 'frozen-bindings-copy-verification-v1.json')['copies']:
    bound(item['copy'], item['sha256']); bound(item['originalPath'], item['sha256'])
admission = load(E / 'root-admission-v1.json')
bound(E / 'root-admission-v1.json', '61d6c5fee04057a468647bc392127d43f5f092708e287aa3b43cd932be439769')
for pin in admission['pins']: bound(pin['path'], pin['sha256'])
tool = load(E / 'actual-tool-receipt-v1.json')
check(tool['invocationCount'] == 1 and tool['executable'] == admission['executable'] and tool['args'] == admission['args'] and tool['cwd'] == admission['cwd'], 'exact actual tool command')
check(tool['actualExecCommand']['initialChunkId'] == '3be14d' and tool['actualExecCommand']['sessionId'] == 90331 and tool['actualExecCommand']['finalChunkId'] == 'd1dc4d' and tool['actualExecCommand']['exitCode'] == 1 and tool['actualExecCommand']['sandbox_permissions'] == 'require_escalated', 'actual tool completion and permission')
d = load(E / 'parent-raw/source-freeze.json'); W = Path(d['worktree'])
for name, digest in d['sourceBindings'].items(): bound(W / name, digest)
for name, digest in d['sourceCopies'].items(): bound(Path(d['sourceCopyRoot']) / name, digest)
check(len(d['sourceBindings']) == 596 and len(d['sourceCopies']) == 85 and len(d['productionFiles']) == 511, '596/85/511 source')
bound(d['node']['executable'], d['node']['sha256'])
bound(W / 'pnpm-lock.yaml', d['lockfiles']['repoPnpmLock'])
bound(W / 'node_modules/.pnpm/lock.yaml', d['lockfiles']['installedPnpmLock'])
for name, item in d['dependencyReuseLinks'].items():
    p = W / name
    check(p.is_symlink() == item['isSymlink'] and str(p.resolve()) == item['resolved'], 'reuse ' + name)
sup = load(E / 'frozen-bindings-v1/supplemental-tool-inputs.json')
seen = set(); payloads = 0
for item in list(d['packages'].values()) + sup['packages']:
    logical = Path(item['logical']); logical = logical if logical.is_absolute() else W / logical
    check(str(logical.resolve()) == item['resolved'], 'resolved package ' + str(logical))
    root = Path(item['resolved'])
    if str(root) in seen: continue
    seen.add(str(root)); actual = set(); expected = item['regularPayloadFilesMap']
    for directory, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [x for x in dirs if x != 'node_modules' and not (Path(directory) / x).is_symlink()]
        for name in files:
            p = Path(directory) / name
            if p.is_file() and not p.is_symlink(): actual.add(str(p.relative_to(root)))
    check(actual == set(expected), 'exact package own set ' + str(root))
    for name, digest in expected.items(): bound(root / name, digest)
    payloads += len(expected)
check(len(seen) == 255 and payloads == 11974, '255/11974 closure')
for edge in sup['resolutionEdges']: check(str(Path(edge['logical']).resolve()) == edge['resolved'], 'edge ' + edge['logical'])
for item in sup['uninstalledDeclaredOptionalOrPeerDependencies']:
    root = Path(item['from'])
    check(not any((p / 'node_modules' / item['dependency']).exists() for p in [root, *root.parents]), 'absent ' + item['dependency'])
check(len(sup['resolutionEdges']) == 405 and len(sup['uninstalledDeclaredOptionalOrPeerDependencies']) == 112, '405/112 closure')

receipts_path = E / 'inner-raw/receipts.jsonl'
lines = receipts_path.read_text().splitlines(keepends=True)
receipts = [parse(x) for x in lines]
check(len(receipts) == 323 and [i['sequence'] for i in receipts] == list(range(1, 324)), 'contiguous323')
by = {i['sequence']: i for i in receipts}
counts = dict(collections.Counter(i['phase'] for i in receipts))
check(not any(i['phase'] in ['completion-baseline-checkpoint-captured', 'completion-baseline-semantic-failure'] for i in receipts), 'no checkpoint marker or semantic failure')
check(not any(i.get('boundary') == 'source-failed-peer' or i.get('boundaryEvent', {}).get('boundary') == 'baseline-source-failure-applied' for i in receipts), 'no intended failure cut/applied boundary')
check(by[291]['phase'] == 'completion-baseline-cut' and by[291]['boundary'] == 'held-window' and 'pendingProviderAnswers' not in by[291], 'premature common payload291')
check(by[292] == {'h02': True, 'sequence': 292, 'phase': 'completion-baseline-epoch-end', 'epoch': '1:held-window'}, 'epochend292')
check(by[293]['phase'] == 'completion-baseline-cut' and by[293]['pendingProviderAnswers'] == 2, 'full held cut293')
check(by[294]['phase'] == 'completion-baseline-epoch-start' and by[294]['epoch'] == '2:source-failed-peer', 'failure epoch294')
check(by[295]['boundaryEvent']['detail']['error'] == 'baseline-source' and by[296]['boundaryEvent']['detail']['outcome'] == {'state': 'rejected', 'error': 'baseline-source'}, 'exact failure/load evidence295296')
for seq, boundary in [(302, 'root-callback'), (315, 'downstream-callback')]:
    event = by[seq]['boundaryEvent']; detail = event['detail']
    check(event['boundary'] == boundary, 'raw callback type ' + str(seq))
    inserted = [x for x in detail['changes'] if x['type'] == 'insert' and x['value']['id'] == 3]
    check(len(inserted) == 1 and inserted[0]['value']['children'] == [] and 'previousValue' not in inserted[0], 'raw row3 emptychildren insert ' + str(seq))
check(by[317]['boundaryEvent']['boundary'] == 'cleanup-start' and by[321]['boundaryEvent']['boundary'] == 'cleanup-complete' and by[322]['phase'] == 'worker-cleaned', 'positive raw cleanup')
check(by[319]['boundaryEvent']['detail']['source'] == 'children' and by[319]['boundaryEvent']['detail']['load'] == 2, 'peer rejection occurs during cleanup')
check('original held peer binding changed before failure barrier' in by[323]['message'], 'original guard error preserved')
excerpt = (E / 'selected-original-receipts-v1.jsonl').read_text().splitlines(keepends=True)
check(all(x in lines for x in excerpt), 'excerpt exact original lines')

parent = load(E / 'parent-raw/outcome.json'); inner = load(E / 'inner-raw/supervisor.json')
check(parse((E / 'outer.stdout.log').read_text()) == parent and (E / 'outer.stderr.log').read_bytes() == b'', 'complete outer streams')
check(parent['exitCode'] == inner['outcome']['exitCode'] == 1 and parent['signal'] is None and inner['outcome']['signal'] is None, 'actual parent/inner completion distinct and nonzero')
check('public cut preceded its complete callback interval' in inner['outcome']['primaryObservationError'], 'primary observer error')
check(inner['killAttempted'] is False and inner['outcome']['reason'] == 'exited' and inner['outcome']['cleanupErrors'] == [], 'inner no-kill/exited/cleanup')
check(parent['heap'] is False and parent['identityMatched'] and parent['remainingGroup'] == 0 and parent['cleanupErrors'] == 0 and parent['cleanupDiagnostics'] == [], 'outer operational observations')
check(parent['maxSampledGroupRssBytes'] == 707510272 and parent['maxSampledGroupRssBytes'] < 1073741824 and inner['maxSampledGroupRssBytes'] == 453361664 and inner['maxSampledGroupRssBytes'] < 1073741824, 'finite RSS below1GiB')
check(parent['elapsedMonotonicMs'] == 3020.879292 and inner['elapsedMs'] == 2290, 'finite recorded durations')
check(any(i['phase'] == 'worker-cleaned' and i['sequence'] == 322 for i in inner['outcome']['receipts']), 'raw cleanup also retained in supervisor')
for prefix, title in [('parent', 'checks a selected baseline constituent through the shared judgment'), ('inner', 'records a source-bound completion receiving gate')]:
    stdout = (E / (prefix + '-raw/worker.stdout.log')).read_text()
    stderr = (E / (prefix + '-raw/worker.stderr.log')).read_text()
    check(title in stdout and title in stderr and 'Tests  1 failed (1)' in stdout, 'one exact plain test logged ' + prefix)
named = load(E / 'named-process-absence-v1.json')
check(named['actualTool']['exitCode'] == 1 and named['actualTool']['output'] == '' and named['allNamedPidsAbsent'], 'saved named-only absence')
check(set(named['namedIdentities'].values()) == {83258, 83269, 83272, 83275}, 'exact named set')
for name in ['final-group-before-cleanup.json', 'final-group.json']: check(load(E / 'parent-raw' / name)['rows'] == [], 'saved owned group empty ' + name)

verification = load(E / 'inner-raw/binding-verification.json'); seal = load(E / 'inner-raw/binding-seal.json')
check(verification['status'] == 'bound' and verification['failures'] == [] and len(verification['bindings']) == 340 and verification['bindingProfile'] == 'completion-baseline-v1', 'bound340 exact profile')
check(seal['sealed'] and seal['skipAllPausesAcknowledged'] and seal['debuggerDisableAcknowledged'] and seal['inspectorDisconnectedBeforeHistory'], 'startup seal/ack/disconnect facts')
bound(E / 'inner-raw/evaluated-pre-history.json', seal['inventorySha256'])
inventories = {name: load(E / 'inner-raw' / name)['inventory'] for name in ['evaluated-pre-history.json', 'evaluated-after-all.json']}
for item in verification['bindings']:
    matched = [x for x in inventories[item['inventory']] if x['file'] == str(W / item['relative'])]
    check(len(matched) == 1 and matched[0]['evaluated'] and matched[0]['codeSha256'] == item['codeSha256'], 'actual evaluated binding ' + item['relative'])
    if matched:
        allowed = d['receivingProductionFiles'] if item['kind'] == 'production' else {**d['instrumentFiles'], **d['sharedInstrumentFiles']}
        check(matched[0]['sourceSha256'] == allowed.get(item['relative']), 'bound source allowance ' + item['relative'])
    bound(E / 'inner-raw/evaluated-sources' / (item['codeSha256'] + '.txt'), item['codeSha256'])
    for script in item['scripts']: bound(E / 'inner-raw/v8-sources' / (script['sourceSha256'] + '.txt'), script['sourceSha256'])

# Confirm the transport collision through frozen evaluated source text, not imports.
driver = (E / 'inner-raw/evaluated-sources/fd18243a473264578e18ab7685ee9c03afc0be0bcf5d14c2ca45760f7ddfa958.txt').read_text()
writer = (E / 'inner-raw/evaluated-sources/2a9261ce37221b142ebce90077d9ade71d096d55938f7f1038ecff01f4e07eb0.txt').read_text()
check('phase: `completion-baseline-cut`' in driver and '.emitProgressReceipt)(`completion-baseline-checkpoint-captured`, common)' in driver, 'loaded driver passes final-cut phase in physical checkpoint payload')
check('sequence: ++sequence,\n            phase,\n            ...details' in writer, 'loaded writer payload overwrites phase')
details = {k: by[291][k] for k in ['boundary', 'run', 'view', 'operations']}
details['phase'] = 'completion-baseline-cut'  # source-defined field; not copied from the observed phase
reconstructed = dict({'h02': True, 'sequence': 291, 'phase': 'completion-baseline-checkpoint-captured'}, **details)
check(reconstructed == by[291], 'independent static object-spread reconstruction equals raw291')
check('original held peer binding changed before failure barrier' in driver, 'loaded broad peer guard unchanged')
ledger = O / 'raw-items-ledger-v1.jsonl'
check(len(ledger.read_bytes().splitlines()) == 114 and sha(ledger) == 'b7fa7544ec7f7cf43641b7ecf279e0fe548fd95411cad2ee87e5b4a97a5c7e62', '114-row received ledger prefix')
facts = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'mode': __doc__, 'freezeSha256': sha(E / 'result-freeze-v1.json'), 'members':1996, 'memberBytes':36035934, 'rawCopiesAndOriginals':1972, 'sources':596, 'sourceCopies':85, 'production':511, 'packageRoots':len(seen), 'ownPayloadFiles':payloads, 'edges':405, 'absences':112, 'rawReceiptCount':len(receipts), 'phaseCounts':counts, 'bindingEntries':340, 'phaseCollision':'confirmed by frozen evaluated source plus static object-spread reconstruction equal to raw291; no module execution', 'peerBindingGuardComponent':'UNESTABLISHED', 'raw302and315':'UNCLASSIFIED', 'classification':'receiving instrumentation failure; no product RED or GREEN', 'allAuditChecksPass':not errors, 'errors':errors, 'productExecutions':0, 'boundImports':0, 'nativeProbes':0, 'runtimeAdmission':False, 'slot2':'returned after report', 'limits':['No intended failure cut or shared failure callback judgment reached','No current native process or kill-path probe','No precise runtime coverage or parent checker invocation from child evaluation','Later coordinated artifact lint pending ROOT','No success, retry, production, candidate-state or closure credit'], 'ledgerPrefixSha256':sha(ledger)}
out = O / 'shared-failure-actual-independent-facts-v1.json'
with out.open('x') as stream: json.dump(facts, stream, indent=2); stream.write('\n')
print(json.dumps({'facts':str(out), 'sha256':sha(out), 'errors':errors}))
raise SystemExit(bool(errors))
