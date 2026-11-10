"""Read/hash/JSON qualification only. No native launch, import, or process probe."""

import collections
import hashlib
import json
import pathlib
import re

REVIEW = pathlib.Path(__file__).resolve().parent
H = REVIEW.parent
CAPTURE = H / 'metadata-update-receiving-actual-v3'
PREP = H / 'metadata-update-receiving-preparation-v3'
PACKET = H / 'metadata-update-source-v3'
SOURCES = PACKET / 'sources'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text())


def require(condition, label):
    if not condition:
        raise AssertionError(label)


def pointer(record, label):
    path = pathlib.Path(record['path'])
    require(sha(path) == record['sha256'], 'pointer: ' + label)
    return path


pins = {
    H / 'metadata-update-receiving-result-freeze-v3.json': '19e653540452eaa9df8230f32e7a4de68238a2a059ef26ab180ed9005218fc66',
    PREP / 'root-receiving-admission-v3.json': '0825d82d96afde7e2edd60cf2f86b8a2225e78a1831840ac49236742382f53ce',
    CAPTURE / 'raw-manifest.json': '88c113659f9d77281e93ba9afd3ecb64fdcfea2d2a164f95b2a9399825f33e70',
    CAPTURE / 'observation-summary.json': '283af678c3c3e7794c98aeeeb6214cd42f682e97ecd3c8c4745b8c9b50aabce5',
    H / 'metadata-update-receiving-root-outer-return-v3.json': '5ebdce936a22d8b9d6aac97689a78bed6921caccc8ea1b3572f1bce2ba16f1a8',
    H / 'metadata-update-receiving-inner-identity-v3.json': 'b49833c28182869cbc45a522a0187ebfddefa805841cf8b1ab669efb4142a511',
    H / 'metadata-update-receiving-root-absence-v3.json': 'fd532e5cb52729324ebad7bca6e6e0f019cf4b7ddd68d58fd061eec8630ef1ed',
    H / 'metadata-update-receiving-prerun-recheck-v3.json': 'a09d61b56e5ea031bd114e2b70b8dbe7f66fbffd70eb0f986bdd58cccb23cb4e',
    H / 'metadata-update-receiving-source-recheck-v3.json': '7dadb00fe2fd3e5ffd749534dc48ccb904d34707ae7e5f329bd2b7e59d6e01e0',
    PACKET / 'source-freeze.json': 'd651df85eb08ff46d8e68bd01b6fcc644f18a6a8efbb4b52ef557af0fd6a2fcd',
    PACKET / 'source-inventory.json': '3c8ece36701d450758587bd16dbf691b5e700668bc0be32ae2f20af8bc8bfb84',
    PACKET / 'packet-manifest.json': 'e7574c41407e9e5b7fecfa181abc7f22b7ed4e2dcc48a7ab19860180a49bc00a',
    PREP / 'binding.json': '710cea233b1d57bdf9aeda39ea6fcadc317bfa0dd8d482776af30c6d07c02470',
    PREP / 'packet-manifest.json': 'b541cc7f75830a6d9bb12eb8f174a792c31b532b53912f18f8584c111160bd43',
    PREP / 'first-command.json': '0202923c2af3b89485d744ce789293a522cc1efd2412df4a78a1f42accda5a51',
    H / 'metadata-update-receiving-result-freeze-v2.json': 'e490825ed92a6fa97891d2ab8b0414f65691bc06c214573e7ed119e9d236d9eb',
    H / 'metadata-update-source-v2/source-freeze.json': '4ae26549a4edc1565ef08ca7f1b096f7b644b32773fa520d688431335aa5bd8a',
    H / 'metadata-update-receiving-actual-v2/raw-manifest.json': '091d5b2cec5155f52003ee629758b2ce69e0bd20a6f56ea15eda012d15432803',
    REVIEW / 'metadata-source-v3-independent-review.md': 'a07ed61feca7172165fb6d2489ce9d255fe160d761464152827f2dd584efd9f2',
    REVIEW / 'metadata-update-receiving-preparation-review-v3.md': '83c10d9fc61522dcd2f2b19bffb63711daffe241fcd0ccb835dd05fc1860866e',
}
for path, expected in pins.items():
    require(sha(path) == expected, 'pin: ' + path.name)
freeze = read(H / 'metadata-update-receiving-result-freeze-v3.json')
for key, value in freeze.items():
    if isinstance(value, dict) and 'path' in value and 'sha256' in value:
        pointer(value, key)
admission = read(PREP / 'root-receiving-admission-v3.json')
require(admission['reservedHeavySlot'] == 4 and admission['maxInvocations'] == 1, 'one-shot slot 4 admission')
for key in ['firstCommand', 'packetManifest', 'binding', 'independentReview', 'sharedRecoveryQualification']:
    pointer(admission[key], key)
recovery = read(pathlib.Path(admission['sharedRecoveryQualification']['path']))
require(admission['sharedRecoveryQualification']['sha256'] == freeze['sharedRecoveryQualificationSha256'] == 'c02badc1d10295180a8cc560c8aa1057af3bede2f5b5dc7df7d35791dbf23406', 'accepted recovery digest')
for key in ['actualRepair', 'postAudit', 'closeout', 'formattingAccount']:
    pointer(recovery[key], 'recovery/' + key)
for packet in [PREP, PACKET]:
    for relative, record in read(packet / 'packet-manifest.json')['artifacts'].items():
        require(sha(packet / relative) == record['sha256'], 'packet artifact digest: ' + relative)
        require((packet / relative).stat().st_size == record['bytes'], 'packet artifact bytes: ' + relative)


def raw_members(manifest, capture, counts):
    result = {}
    for kind, (count, total) in counts.items():
        members = manifest[kind + 'Members']
        require(len(members) == count and sum(r['bytes'] for r in members.values()) == total, kind + ' exact cardinality')
        roots = [pathlib.Path(manifest['original' + kind.title() + 'Directory']), capture / kind]
        for root in roots:
            actual = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()}
            require(actual == set(members), 'exact raw regular-file set: ' + str(root))
            for relative, record in members.items():
                path = root / relative
                require(path.stat().st_size == record['bytes'] and sha(path) == record['sha256'], 'raw bytes/hash: ' + relative)
        result[kind] = {'files': count, 'bytes': total, 'originalAndPreservedExact': True}
    return result


manifest = read(CAPTURE / 'raw-manifest.json')
members = raw_members(manifest, CAPTURE, {'inner': (1948, 31374418), 'outer': (3, 13685)})
old_capture = H / 'metadata-update-receiving-actual-v2'
old_members = raw_members(read(old_capture / 'raw-manifest.json'), old_capture, {'inner': (1948, 31372571), 'outer': (3, 15840)})
inventory = read(PACKET / 'source-inventory.json')
require(len(inventory) == 589, '589 sources')
for relative, digest in inventory.items():
    require(sha(SOURCES / relative) == digest, 'source inventory: ' + relative)
source_freeze = read(PACKET / 'source-freeze.json')
require(len(source_freeze['productionFiles']) == 511, '511 production files')
for relative, digest in source_freeze['productionFiles'].items():
    require(sha(SOURCES / relative) == digest, 'production: ' + relative)
payloads = 0
for name, package in source_freeze['packages'].items():
    root = pathlib.Path(package['resolved'])
    require(sha(root / 'package.json') == package['packageJsonSha256'], 'package JSON: ' + name)
    actual = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and not p.is_symlink() and 'node_modules' not in p.relative_to(root).parts}
    require(actual == set(package['regularPayloadFilesMap']), 'package own payload set: ' + name)
    for relative, digest in package['regularPayloadFilesMap'].items():
        require(sha(root / relative) == digest, 'package payload: ' + name + '/' + relative)
        payloads += 1
require(payloads == 2544, '2544 named package own payloads')
for relative, record in source_freeze['dependencyReuseLinks'].items():
    path = SOURCES / relative
    require(path.is_symlink() == record['isSymlink'] and str(path.resolve()) == record['resolved'], 'dependency link: ' + relative)
require(sha(pathlib.Path(source_freeze['node']['executable'])) == source_freeze['node']['sha256'], 'Node binary')
require(sha(SOURCES / 'pnpm-lock.yaml') == source_freeze['lockfiles']['repoPnpmLock'], 'repository lock')
require(sha(SOURCES / 'node_modules/.pnpm/lock.yaml') == source_freeze['lockfiles']['installedPnpmLock'], 'installed lock')
precheck = read(H / 'metadata-update-receiving-prerun-recheck-v3.json')
prelaunch = read(CAPTURE / 'outer/source-prelaunch.json')
postcheck = read(H / 'metadata-update-receiving-source-recheck-v3.json')
preflight = dict(precheck['preflight'])
launchflight = {k: v for k, v in prelaunch.items() if k != 'receivingEvidenceBaseline'}
require(preflight.pop('gate') == 'source' and launchflight.pop('gate') == 'receiving', 'preflight gates')
require(preflight == launchflight, 'pre-run/prelaunch preflight identity except gate and passive baseline')
require(precheck['admissionSha256'] == pins[PREP / 'root-receiving-admission-v3.json'] and precheck['freshOutputAbsent'], 'pre-run prerequisites')
for key in ['sourceFreezeSha256', 'sourceInventorySha256', 'sharedRecoveryQualificationSha256']:
    require(postcheck[key] == freeze[key], 'postcheck identity: ' + key)
require((postcheck['sourceMembers'], postcheck['productionMembers'], postcheck['namedDependencyOwnPayloads']) == (589, 511, 2544), 'postcheck counts')

inner = CAPTURE / 'inner'
history = read(inner / 'history.json')
require(history == prelaunch['canonicalProgram']['history'], 'actual selected history')
canonical = json.dumps(history, sort_keys=True, separators=(',', ':')).encode()
require(hashlib.sha256(canonical).hexdigest() == freeze['canonicalProgramSha256'] == 'bb837d81114314f37f2d8383f471aedbd3d2a3350c84db4075a5d3b79247b213', 'canonical history')
identity = read(H / 'metadata-update-receiving-inner-identity-v3.json')
original = pathlib.Path(manifest['originalInnerDirectory'])
require(identity['matchingCandidates'] == [str(original)] and not identity['selectedAsFirstNew'] and not identity['selectedByMtime'], 'unique recorded selection')
require(original.name not in prelaunch['receivingEvidenceBaseline']['members'], 'not a passive baseline member')
prepared, supervisor = read(inner / 'prepared.json'), read(inner / 'supervisor.json')
writer = read(inner / 'receipts.jsonl.writer.json')
for key, value in prepared.items():
    require(supervisor[key] == value, 'prepared/supervisor: ' + key)
require(prepared['cwd'] == str(SOURCES) and pathlib.Path(prepared['directory']).resolve() == original.resolve(), 'exact selected source/output')
require(pathlib.Path(prepared['historyPath']).resolve() == (original / 'history.json').resolve(), 'selected history path')
require(supervisor['pid'] == identity['supervisorRecordedDetachedLeaderPid'] == 12600, 'detached leader identity')
require(writer['pid'] == identity['writerPid'] == 12603 and writer['path'] == prepared['receiptTransport']['path'], 'writer identity')
require(writer['flags'] == 'wx' and writer['mode'] == 384 and writer['regularFile'], 'exclusive regular transport')
require(prepared['limits'] == {'wallMs': 20000, 'groupRssBytes': 1073741824, 'nodeHeapMiB': 384, 'postEnqueueWindowMs': 1000}, 'unchanged containment')
require(supervisor['phase'] == 'final-with-binding' and supervisor['elapsedMs'] == 2443 and supervisor['maxSampledGroupRssBytes'] == 481460224, 'final supervisor observations')
require(supervisor['latestGroupRows'] == [] and not supervisor['killAttempted'] and not supervisor['heapDiagnosticDetected'], 'normal supervision')

receipts = [json.loads(x) for x in (inner / 'receipts.jsonl').read_text().splitlines()]
require(len(receipts) == 206 and [x['sequence'] for x in receipts] == list(range(1, 207)), '206 contiguous raw receipts')
require(receipts[0]['history'] == history and receipts[0]['cwd'] == str(SOURCES), 'worker-start actual program')
counts = collections.Counter(r['phase'] for r in receipts)
summary = read(CAPTURE / 'observation-summary.json')
# The summary names semantic facts, while the full raw phase inventory remains
# preserved here. Do not infer phase counts from reach counters.
outcome = supervisor['outcome']
require(outcome['reason'] == 'exited' and outcome['exitCode'] == 0 and outcome['signal'] is None, 'normal child exit0')
require(outcome['keyCallbacks'] == counts['query-key-callback'] == 23, '23 query callbacks')
require(outcome['prefixViolations'] == outcome['warnings'] == 0 and outcome['cleanupErrors'] == [] and 'primaryObservationError' not in outcome, 'no realtime mismatch/cleanup errors')
require(outcome['bindingStatus'] == 'bound', 'bound actual outcome')
selector = (SOURCES / 'packages/query-db-collection/tests/queued-answer-progress-receipts.ts').read_text()
phases = re.findall(r'`([^`]+)`', selector[selector.index('return ['):])
retained = [r for r in receipts if r['phase'] in phases]
require(retained == outcome['receipts'] and len(retained) == 23, 'exact v3 retained projection')
require([(r['sequence'], r['phase']) for r in retained] == [(1, 'worker-start'), (4, 'metadata-identities'), (5, 'source-establishing-receipt'), (9, 'source-stack'), (83, 'public-change'), (84, 'downstream-change'), (85, 'downstream-change'), (86, 'public-change'), (87, 'initial-publication'), (88, 'reload-start'), (134, 'retained-publication'), (152, 'answer-queued'), (153, 'answer-executed'), (159, 'public-change'), (160, 'downstream-change'), (161, 'final-publication'), (162, 'followup-start'), (164, 'source-stack'), (182, 'public-change'), (183, 'downstream-change'), (185, 'followup-publication'), (186, 'cleanup-start'), (206, 'worker-cleaned')], 'retained semantic sequence')
by = {r['sequence']: r for r in receipts}
require(by[134]['pendingProviderAnswers'] > 0 and by[152]['enqueueReturned'] is True, 'held-provider/completed-enqueue premises')
require(by[176]['phase'] == 'followup-source-accepted' and by[177]['phase'] == 'followup-source-applied', 'source acceptance then application')
require(by[181]['phase'] == 'followup-acquisition-settled' and by[181]['attempt'] == 12 and by[181]['outcome'] == 'fulfilled', 'actual acquisition settles')
settled = by[184]
require(settled['phase'] == 'followup-settled' and settled['attempts'] == [[12, 'fulfilled']], 'complete acquisition cut')
require(settled['rootSubscriptionStatus'] == settled['downstreamSubscriptionStatus'] == 'ready' and not settled['rootLoadingSubset'] and not settled['downstreamLoadingSubset'], 'settled output subscriptions')
require(settled['rootCallbacks'] == settled['downstreamCallbacks'] == 1, 'both actual followup callbacks')

# Independently accumulate every complete event, including empty batches. The
# exact previous row must match the prior event-derived row before an update.
states = {'public-change': {}, 'downstream-change': {}}
for receipt in receipts:
    phase = receipt['phase']
    if phase not in states:
        continue
    state = states[phase]
    for change in receipt['changes']:
        key = change['key']
        require(key == change['value']['$key'], 'event key agrees with row virtual key')
        if change['type'] == 'insert':
            require(key not in state, 'insert adds absent key')
            state[key] = change['value']
        elif change['type'] == 'delete':
            require(state.get(key) == change['value'], 'delete carries exact previous row')
            del state[key]
        else:
            require(change['type'] == 'update' and state.get(key) == change['previousValue'], 'update complete previousValue')
            state[key] = change['value']
    require(state == dict(receipt['entries']), 'event-derived rows equal synchronous entries')
    require(receipt['rows'] == [value for _, value in receipt['entries']], 'callback rows equal ordered entries')
for sequence in [87, 134]:
    require([(r['id'], r['rank']) for r in by[sequence]['rows']] == [(4, 40)], 'prior complete snapshot')
for sequence in [159, 160, 161]:
    require([(r['id'], r['rank']) for r in by[sequence]['rows']] == [(3, 30)], 'completed reload snapshot')
for sequence in [182, 183]:
    update = by[sequence]['changes']
    require(len(update) == 1 and update[0]['type'] == 'update', 'one actual same-key update')
    before, after = update[0]['previousValue'], update[0]['value']
    require(before['id'] == after['id'] == 3 and before['rank'] == 30 and after['rank'] == 35, 'rank30 to35')
    require({k: v for k, v in before.items() if k != 'rank'} == {k: v for k, v in after.items() if k != 'rank'}, 'all other ordinary and virtual fields preserved')
    require(all(k in before for k in ['$key', '$collectionId', '$origin', '$hasPendingWrites']), 'all four prior metadata fields present')
require(by[183]['upstreamEntries'] == by[182]['entries'], 'downstream callback sees exact current root')
require(by[185]['entries'] == by[182]['entries'] and by[185]['downstreamEntries'] == by[183]['entries'], 'followup final root/downstream reads')
require(by[185]['ready'] and not by[185]['syncError'] and by[206]['phase'] == 'worker-cleaned', 'ready coherent final and normal cleanup')

verification = read(inner / 'binding-verification.json')
seal = read(inner / 'binding-seal.json')
require(verification['status'] == 'bound' and verification['failures'] == [] and len(verification['bindings']) == 815, '815 bound module entries')
require(verification['actualKeyCount'] == 97 and verification['emptyCallbacks'] == 3 and verification['receiptTransport']['count'] == 206, 'binding callback/transport observations')
require(seal['selectedRoot'] == str(SOURCES) and all(seal[k] for k in ['sealed', 'skipAllPausesAcknowledged', 'debuggerDisableAcknowledged', 'inspectorDisconnectedBeforeHistory']), 'startup seal')
require(len(seal['bindings']) == 163 and seal['inventorySha256'] == 'b3f8efe64525cca45c8af9d42c9c4a76de3c698e67be283d72e7352f795a9198', 'startup seal identity')
v8 = [json.loads(x) for x in (inner / 'v8-binding.jsonl').read_text().splitlines()]
scripts = {r['scriptId']: r for r in v8 if r['phase'] == 'v8-compiled-script'}
sealed = {b['file']: b for b in seal['bindings']}
evaluated_cuts = {}
for binding in verification['bindings']:
    registry = read(inner / binding['inventory'])
    require(registry['selectedRoot'] == str(SOURCES), 'evaluated registry source root')
    evaluated_cuts[registry['cut']] = len(registry['inventory'])
    file = str(SOURCES / binding['relative'])
    entry = next((e for e in registry['inventory'] if e['file'] == file), None)
    require(entry is not None and entry['evaluated'] and entry['codeSha256'] == binding['codeSha256'], 'bound evaluated registry entry')
    require(entry['sourceSha256'] == inventory[binding['relative']], 'registry source digest equals frozen source')
    require(sha(inner / 'evaluated-sources' / (binding['codeSha256'] + '.txt')) == binding['codeSha256'], 'evaluated compiled bytes')
    require(sealed[file]['codeSha256'] == binding['codeSha256'], 'later evaluated module matches startup seal')
    for script in binding['scripts']:
        require(scripts[script['scriptId']]['sourceSha256'] == script['sourceSha256'], 'V8 script identity')
        require(sha(inner / 'v8-sources' / (script['sourceSha256'] + '.txt')) == script['sourceSha256'], 'V8 script bytes')
require('sourceControls.writeRank' in by[164]['stack'] and str(SOURCES) in by[164]['stack'], 'positive actual source update stack')

outer = read(H / 'metadata-update-receiving-root-outer-return-v3.json')
require(outer['completionToolReturn']['exit_code'] == outer['actualOuterExitCode'] == 0 and outer['receivingChildExitCode'] == 0, 'separate actual outer0/child0')
require((outer['outerPid'], outer['outerPgid'], outer['receivingParentPid']) == (12461, 12461, 12597), 'original outer identities')
require(outer['nativeInvocationsThisAdmission'] == freeze['invocationsThisAdmission'] == 1 and not outer['retry'], 'recorded one invocation')
command = read(PREP / 'first-command.json')
launcher = (CAPTURE / 'outer/launcher-process.txt').read_text()
require(' '.join([command['executable'], *command['argv']]) in launcher, 'actual launcher command equals admitted direct zsh command')
absence = read(H / 'metadata-update-receiving-root-absence-v3.json')
require(len(absence['probes']) == 6 and absence['allAbsent'], 'six captured original-identity absences')
require({(p['kind'], p['value']) for p in absence['probes']} == {('pid', 12461), ('pid', 12597), ('pid', 12600), ('pid', 12603), ('pgid', 12461), ('pgid', 12600)}, 'captured absence identity set')
for probe in absence['probes']:
    require(probe['actualPsMatches'] == [] and probe['signalZero']['status'] == 'ESRCH' and probe['signalZero']['errno'] == 3, 'captured empty/ESRCH')
log = (CAPTURE / 'outer/outer-vitest.log').read_text()
require('1 passed | 19 skipped (20)' in log and "checks source followup 'scope' 'default' quarter 2" in log, 'exact selected receiving test passed')
reported = re.findall(r"^\s+'([a-z-]+)': 1,?$", log, re.MULTILINE)
require(len(reported) == 31 and set(reported) == set(prelaunch['canonicalProgram']['requiredReachStates']) == set(summary['metadataReachCountsObserved']), 'all31 required reach counters observed')
callsite = (SOURCES / 'packages/query-db-collection/tests/queued-answer-metadata-oracle.test.ts').read_text()
require(callsite.index('const outcome = await receiveProgressHistory(') < callsite.index('checkQueuedAnswerProgress(history, outcome)') < callsite.index('metadata.finish()'), 'parent outcome validation before metadata finish')
fixed = callsite[callsite.index('oracleReplayTest(it).each(metadataFollowupHistories)'):callsite.index('describe.each(metadataReceivingPaths)')]
require(fixed.index('await run(history, reach)') < fixed.index('reach.assertReached()'), 'fixed selected callback waits for run then asserts reach')

result = {
    'status': 'QUALIFIED ACTUAL OUTER0 / CHILD0; EXACT FIXED RECEIVING CASE PASSED',
    'auditKind': 'Pinned Python read/hash/JSON and independent captured-event accumulation only',
    'nativeLaunches': 0, 'processProbes': 0, 'sourceEdits': 0,
    'scriptSha256': sha(pathlib.Path(__file__)),
    'inputPins': {str(p): digest for p, digest in pins.items()},
    'rawMembers': members, 'priorFailedV2RawMembersPreserved': old_members,
    'sourceFilesRehashed': 589, 'productionFilesRehashed': 511,
    'namedDependencyOwnPayloadsRehashed': payloads, 'dependencyReuseLinksVerified': 4,
    'actualOuterExitCode': 0, 'receivingChildExitCode': 0,
    'selectedTestsPassed': 1, 'skippedTests': 19,
    'rawReceipts': 206, 'retainedOutcomeReceipts': 23,
    'receiptPhaseCounts': dict(counts), 'metadataReachCountersObserved': 31,
    'retainedFollowupBoundaries': [[162, 'followup-start'], [185, 'followup-publication']],
    'eventDerivedSnapshotsAndCompletePreviousValuesVerified': True,
    'boundModuleEntries': 815, 'startupSealedModules': 163,
    'evaluatedCuts': evaluated_cuts,
    'metadataFinishAndReachAssertionEvidence': 'Bound source order plus exact selected fixed-test pass, under existing source-to-parent invocation assumption. No separate finalizer or reach-assert runtime receipt.',
    'receivingGreenQualification': 'Exact scope/default positive-quarter2 fixed stable-metadata source-update case only; root classification remains required.',
    'productRedGreenCredit': False, 'bugClassClosureCredit': False,
    'newRuntimeAdmitted': False, 'canonicalImport': False, 'publishing': False,
    'limits': ['No native replay or TypeScript checker execution in this audit', 'Child startup V8/evaluated binding does not prove parent checker compiled bytes or invocation', 'Original target group convention lacks persisted initial actual getpgid', 'Stable output metadata and direct eager source-sync receiver only', 'No strict conflicting-cache progress, generated campaign, changing metadata, fetched marker transition, or production-mutant credit', 'Own payload maps for nine named packages are not complete transitive host/native/dist equivalence'],
}
output = REVIEW / 'metadata-update-receiving-actual-review-v3.json'
require(not output.exists(), 'additive audit destination unused')
output.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
print(json.dumps({'status': result['status'], 'audit': str(output), 'auditSha256': sha(output), 'scriptSha256': result['scriptSha256']}))
