"""Independent static inactive-source audit; no bound JS/TS, harness or model execution."""
import collections, datetime, difflib, hashlib, json
from pathlib import Path
O = Path(__file__).resolve().parent
H = O.parent
S = H / 'candidate-controls-pagination-receiving-checkpoint-peer-diagnostics-successor-v1'
Q = H / 'candidate-controls-pagination-failed-peer-shared-receiving-successor-v1'
D = H / 'candidate-controls-pagination-shared-window-receiving-operational-preparation-v1'
E = H / 'candidate-controls-pagination-shared-window-failure-receiving-runtime-v1'
errors = []
def check(value, message):
    if not value: errors.append(message)
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def pairs(items):
    out = {}
    for k, v in items:
        if k in out: raise ValueError('duplicate key ' + k)
        out[k] = v
    return out
def parse(text): return json.loads(text, object_pairs_hook=pairs, parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
def load(path): return parse(Path(path).read_text())
def bound(path, digest): check(sha(path) == digest, 'hash ' + str(path))
def fmap(base, items):
    for name, item in items.items():
        path = Path(base) / name
        if isinstance(item, dict):
            bound(path, item['sha256']); check(path.stat().st_size == item['bytes'], 'bytes ' + str(path))
        else: bound(path, item)
m = load(S / 'packet-manifest-v1.json')
bound(S / 'packet-manifest-v1.json', 'a56541c3188c6a8348aa1187575e0192410dc3e8d86d1a9697628dc4a9312d25')
fmap(S, m['files'])
check(len(m['files']) == m['fileCount'] == 120 and sum(i['bytes'] for i in m['files'].values()) == m['totalBytes'] == 2599271, '120members2599271bytes')
check({str(p.relative_to(S)) for p in S.rglob('*') if p.is_file()} == set(m['files']) | {'packet-manifest-v1.json'}, 'S exact closure')
for name in m['files']:
    if name.endswith('.json'): load(S / name)
    elif name.endswith('.jsonl'):
        for line in (S / name).read_text().splitlines(): parse(line)
f = load(S / 'source-freeze-v1.json'); q = load(Q / 'source-freeze-v1.json'); W = Path(f['acceptedActiveWorktree'])
bound(S / 'source-freeze-v1.json', '1bb89680e1cf69142d2edec1d5936a8e8a2a58ae12eff39f524d3422205ca4d8')
bound(S / 'report-v1.md', 'acd260374f76ee99c7dbcee42e3f8ee211fd13ac82041a3c768685d971803a31')
check(f['acceptedActiveSourceBindingsUnchanged'] == q['sourceBindings'] and len(q['sourceBindings']) == 596, 'accepted596 map')
check(f['acceptedSourceCopiesUnchanged'] == q['sourceCopies'] and len(q['sourceCopies']) == 85, 'accepted85 map')
check(f['acceptedProductionFilesUnchanged'] == q['productionFiles'] and len(q['productionFiles']) == 511, 'accepted511 map')
fmap(W, q['sourceBindings']); fmap(q['sourceCopyRoot'], q['sourceCopies'])
mapping = load(S / 'copy-prefix-map-v1.json')
check(mapping['copyCount'] == len(mapping['copies']) == 85, '85 inactive prefix map')
changed = []; texts = {}
for item in mapping['copies']:
    name = item['canonicalRelativePath']; origin = Path(item['origin']); copy = S / item['inactiveCopyRelativePath']
    check(item['inactiveCopyRelativePath'] == 'sources/' + name + '.txt' and item['proposedRuntimeRelativePath'] == name, 'exact suffix/path mapping ' + name)
    check(origin == Path(q['sourceCopyRoot']) / name and item['originalSha256'] == q['sourceCopies'][name], 'exact source origin ' + name)
    bound(origin, item['originalSha256']); bound(copy, f['inactiveCopies'][name]); texts[name] = copy.read_text()
    if copy.read_bytes() != origin.read_bytes(): changed.append(name)
driver_name = 'packages/query-db-collection/tests/queued-answer-completion-baseline-driver.ts'
check(changed == [driver_name] and len(f['inactiveCopies']) == 85, 'only inactive driver changed')
old = (Path(q['sourceCopyRoot']) / driver_name).read_text(); new = texts[driver_name]
bound(S / ('sources/' + driver_name + '.txt'), '5b61e73c4872d7f496d4ff17f5157b1179d54af2497a3ebfd426ff483a5bf3ae')
expected_proposed = dict(q['sourceBindings']); expected_proposed[driver_name] = sha(S / ('sources/' + driver_name + '.txt'))
check(f['proposedSourceBindings'] == expected_proposed and len(f['changedProposedBindings']) == 1, 'exact one proposed binding')
patch = ''.join(difflib.unified_diff(old.splitlines(True), new.splitlines(True), fromfile='Q/' + driver_name, tofile='inactive-successor/' + driver_name))
check(patch == (S / 'copied-driver-change-v1.diff.txt').read_text(), 'exact full driver diff')
guard = (S / 'original-peer-guard-condition-v1.ts.txt').read_text().removesuffix('\n')
bound(S / 'original-peer-guard-condition-v1.ts.txt', 'a99a016f903375d02c44f56a12cb92a61cb9a62b317979d648983f7d0fdf2339')
check(hashlib.sha256(guard.encode()).hexdigest() == 'd45113a2d77d9367f97e6418ebe6caf403e00ca625619a01eebbc4c13ee87b20', 'exact guard condition hash excludes standalone final LF')
check(guard in old and guard + ' {' in new, 'exact guard condition retained')
tail = '      const peerPending ='
old_tail = old[old.index(tail):]; new_tail = new[new.index(tail):]
old_marker = '    emit(`completion-baseline-checkpoint-captured`, common)'
new_marker_start = new_tail.index('    emit(`completion-baseline-checkpoint-captured`, {')
new_marker_end = new_tail.index('\n    })', new_marker_start) + len('\n    })')
new_emission = new_tail[new_marker_start:new_marker_end]
# Apart from the local marker and its explanatory comments, all following machinery is identical.
old_marker_pos = old_tail.index(old_marker)
new_comment_start = new_tail.index('    // The writer preserves payload fields after its envelope.')
check(new_tail[:new_comment_start] == old_tail[:old_marker_pos] and new_tail[new_marker_end:] == old_tail[old_marker_pos + len(old_marker):], 'pending/retired and tail exact except local marker')
check('...common,\n      phase: `completion-baseline-checkpoint-captured`,' in new_emission, 'local explicit marker phase after payload')
check(old.count('structuredClone(load.queryKey)') == new.count('structuredClone(load.queryKey)') == 1 and old.count('structuredClone(request.queryKey)') == new.count('structuredClone(request.queryKey)') == 1, 'both clone expressions unchanged')
error_literal = '`completion instrument: original held peer binding changed before failure barrier`'
check(old.count(error_literal) == new.count(error_literal) == 1, 'exact original guard error')
check(new.count('recordPeerDiagnostic(`baseline-held-peer-key-snapshot-fidelity`') == 2 and 'matchesAtBind: isDeepStrictEqual(load.queryKey, binding.queryKeyValue)' in new and 'matchesAtBind: isDeepStrictEqual(request.queryKey, binding.queryKeyValue)' in new, 'immediate request/load fidelity records')
labels = ['request.appliedLoad identity', 'request.options identity', 'request.queryKey identity', 'request.queryKey saved value', 'request.source', 'request.id', 'load provider membership', 'load.id', 'load.source', 'load.generation', 'load.enteredAt', 'load.receipt identity', 'load.options identity', 'load.signal identity', 'load.queryKey identity', 'load.queryKey saved value']
check(all('clause: `' + label + '`' in new for label in labels), 'all16 guard clause diagnostic labels')
check('Reflect.ownKeys(current)' in new and 'Object.getOwnPropertyDescriptor(current, key)' in new and 'Object.getPrototypeOf(current)' in new and 'customInspect: false' in new and 'getters: false' in new, 'descriptor/prototype representation source')

extracts = load(S / 'boundary-calibration-v1/extraction-bindings-v1.json')['extracts']
for item in extracts:
    if 'source' not in item: continue
    source = texts[item['source']]; exact = source[item['start']:item['end']]
    check(len(source[:item['end']].encode()) == item['end'], 'claimed offset is byte offset ' + item['name'])
    check(hashlib.sha256(exact.encode()).hexdigest() == item['sha256'], 'exact extracted span ' + item['name'])
    name = item['name'] if item['name'] != 'copied local checkpoint emission' else 'corrected-marker-emission'
    check((S / 'boundary-calibration-v1' / (name + '.js.txt')).read_text() == exact, 'saved extract bytes ' + name)
parent = texts['packages/query-db-collection/tests/queued-answer-completion-baseline.test.ts']
cut = (S / 'boundary-calibration-v1/completion-baseline-cut.js.txt').read_text()
guard_end = cut.index('        const observation = receipt as unknown as CompletionBaselineObservation')
compare_start = cut.index('        compare(`public cut ${observation.boundary}`, () =>')
compare_end = cut.index('        cuts++', compare_start) + len('        cuts++')
check((S / 'boundary-calibration-v1/cut-guard.js.txt').read_text() == cut[:guard_end], 'exact extracted routing guard')
check((S / 'boundary-calibration-v1/cut-compare-dispatch.js.txt').read_text() == cut[compare_start:compare_end], 'exact final comparison dispatch')
check((S / 'boundary-calibration-v1/old-collision-emission.js.txt').read_text().strip() == old_marker.strip(), 'old emission exact original statement')
cal = load(S / 'boundary-calibration-v1/result-v1.json')
bound(S / 'boundary-calibration-v1/result-v1.json', '8dd921eddacd6ca8d12a996f60edc664c952e242f1c65437699d7974196b1ba5')
domain = {(mode, delivery, short) for mode in ['corrected', 'old-collision', 'wrong-preclose-cut'] for delivery in ['live', 'final'] for short in [False, True]}
check({(i['mode'], i['delivery'], i['shortIo']) for i in cal['cases']} == domain and len(cal['cases']) == 12, 'exact12 domain')
for item in cal['cases']:
    path = S / 'boundary-calibration-v1' / (item['name'] + '.receipts.jsonl')
    bound(path, item['rawSha256']); records = [parse(x) for x in path.read_text().splitlines()]
    check([i['sequence'] for i in records] == list(range(1, len(records) + 1)) and [i['phase'] for i in records] == item['rawPhases'], 'case raw sequence/phases ' + item['name'])
    check(item['acceptedPhases'] == item['rawPhases'][:len(item['acceptedPhases'])], 'accepted original prefix ' + item['name'])
    check(item['allControlledDescriptorsClosed'], 'saved descriptors closed ' + item['name'])
    if item['mode'] == 'corrected':
        check(item['failure'] is None and item['routing']['cutCalls'] == item['routing']['checkpointCalls'] == 1 and item['finalRouting'] == {'epochIndex':1, 'orderedIndex':1, 'cuts':1}, 'corrected exact dispatch ' + item['name'])
        check(item['rawPhases'] == ['completion-baseline-epoch-start', 'completion-baseline-checkpoint-captured', 'completion-baseline-epoch-end', 'completion-baseline-cut'], 'corrected ordering ' + item['name'])
    else:
        check(item['failure']['message'] == 'public cut preceded its complete callback interval' and item['routing']['cutCalls'] == item['routing']['checkpointCalls'] == 0 and item['finalRouting']['activeEpoch'] == '1:held-window' and item['finalRouting']['cuts'] == 0, 'wrong boundary rejected at same guard ' + item['name'])
check(cal['sourceHashes'] == {'transport': hashlib.sha256(texts['scripts/h02-progress/receipt-transport.mjs'].encode()).hexdigest(), 'parent': hashlib.sha256(parent.encode()).hexdigest(), 'copiedDriver':hashlib.sha256(new.encode()).hexdigest()}, 'calibration exact input source hashes')
check(not cal['productRed'] and not cal['productGreen'] and not cal['receivingRetry'] and not cal['reachCredit'], 'no product/runtime credit')
tool = load(S / 'boundary-calibration-tool-receipt-v1.json')
check(tool['chunkId'] == '1b31d5' and tool['exitCode'] == 0 and parse(tool['stdout']) == {'passed':True, 'cases':12, 'corrected':4, 'rejectedControls':8, 'resultSha256':sha(S / 'boundary-calibration-v1/result-v1.json')}, 'saved pure calibration actual completion')

rel = load(Q / 'artifact-snapshot-relocation-v1/path-map-v1.json')
relocations = {i['from']: i['to'] for i in rel['relocations']}
for base, name, count, mapping0 in [(Q,'packet-sha256-v1.json',126,relocations),(Q,'packet-sha256-with-snapshot-relocation-v2.json',133,{}),(D,'packet-manifest-v1.json',21,{})]:
    manifest = load(base / name); members = manifest.get('files', manifest)
    check(len(members) == count, 'ancestor count ' + name)
    fmap(base, {mapping0.get(k,k):v for k,v in members.items()})
e = load(E / 'result-freeze-v1.json'); check(len(e['files']) == 1996, 'E1996'); fmap(E,e['files'])
for item in f['authority'].values():
    if isinstance(item,dict): bound(item['path'],item['sha256'])
for item in load(S / 'required-reading-bindings-v1.json')['bindings']: bound(item['path'],item['sha256'])
ledger = O / 'raw-items-ledger-v1.jsonl'
check(len(ledger.read_bytes().splitlines()) == 119 and sha(ledger) == 'eabfde1b27f844712d9f191656cfd58443b8b3313190c37aea2cfd0562439795', '119-row ledger prefix')
facts = {'at':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'mode':__doc__, 'manifestSha256':sha(S/'packet-manifest-v1.json'), 'sourceFreezeSha256':sha(S/'source-freeze-v1.json'), 'members':120, 'memberBytes':2599271, 'activeSourcesUnchanged':596, 'acceptedCopiesUnchanged':85, 'productionUnchanged':511, 'inactiveCopies':85, 'changedInactiveSources':changed, 'guardFileSha256':sha(S/'original-peer-guard-condition-v1.ts.txt'), 'guardConditionWithoutFinalLfSha256':hashlib.sha256(guard.encode()).hexdigest(), 'priorAuditFailure':'v1 incorrectly compared whole-file bytes to no-final-LF expression digest; preserved without overwrite', 'exactExtractionEntries':len(extracts), 'savedCalibrationCases':12, 'corrected':4, 'hostileRejected':8, 'reviewerCalibrationExecutions':0, 'ESealedMembers':1996, 'QHistoricalMembers':126, 'QCurrentMembers':133, 'DSealedMembers':21, 'allAuditChecksPass':not errors, 'errors':errors, 'normalBoundKeySourceSuitability':'no blocking source finding identified', 'diagnosticCaptureNoninterference':'local catches only; no unconditional end-to-end receipt-fault preservation credit', 'diagnosticsRuntime':'UNREACHED', 'typecheck':0, 'boundImports':0, 'nativeProbes':0, 'runtimeAdmission':False, 'slot2':'return after report', 'ledgerPrefixSha256':sha(ledger)}
out = O / 'checkpoint-peer-successor-source-independent-facts-v2.json'
with out.open('x') as stream: json.dump(facts,stream,indent=2); stream.write('\n')
print(json.dumps({'facts':str(out),'sha256':sha(out),'errors':errors}))
raise SystemExit(bool(errors))
