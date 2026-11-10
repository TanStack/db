"""Pinned read/hash/JSON audit. No native test, process probe, or source edit."""

import collections
import hashlib
import json
import pathlib
import re

REVIEW = pathlib.Path(__file__).resolve().parent
H = REVIEW.parent
CAPTURE = H / 'metadata-update-receiving-actual-v2'
PREP = H / 'metadata-update-receiving-preparation-v2'
SOURCE_PACKET = H / 'metadata-update-source-v2'
SOURCES = SOURCE_PACKET / 'sources'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text())


def require(condition, label):
    if not condition:
        raise AssertionError(label)


pins = {
    H / 'metadata-update-receiving-result-freeze-v2.json': 'e490825ed92a6fa97891d2ab8b0414f65691bc06c214573e7ed119e9d236d9eb',
    CAPTURE / 'raw-manifest.json': '091d5b2cec5155f52003ee629758b2ce69e0bd20a6f56ea15eda012d15432803',
    CAPTURE / 'observation-summary.json': '94f40c67be0d699e27804a47c884bc7d4334c258b8f91f75c86c73ece99a610f',
    PREP / 'root-receiving-admission-v1.json': 'f76e6494649de37b01543151c6621f516184594b4a7bd96a2da2ddd009def5e6',
    PREP / 'packet-manifest.json': 'd019dfef5829b69817bcd8ae5c50c22aafc9ece643bac3ed816cb6169c82830a',
    PREP / 'binding.json': 'ec925ca31d325cadf8a28e597c1d6ea0185fe79b0e1d4ef8b97b5333e0f5f238',
    SOURCE_PACKET / 'source-freeze.json': '4ae26549a4edc1565ef08ca7f1b096f7b644b32773fa520d688431335aa5bd8a',
    SOURCE_PACKET / 'source-inventory.json': 'c5cdea6b41d82b331435162ea06b9254be96acff7b7450be79e0c37690cb74b2',
}
for path, expected in pins.items():
    require(sha(path) == expected, f'pinned digest: {path.name}')
freeze = read(H / 'metadata-update-receiving-result-freeze-v2.json')
for key in ['actualOuterReturn', 'innerIdentity', 'rootAbsence', 'sourceRecheck', 'rawManifest', 'observationSummary']:
    pointer = freeze[key]
    require(sha(pathlib.Path(pointer['path'])) == pointer['sha256'], f'freeze pointer: {key}')

manifest = read(CAPTURE / 'raw-manifest.json')
member_results = {}
for kind, expected_count, expected_bytes in [('inner', 1948, 31372571), ('outer', 3, 15840)]:
    members = manifest[f'{kind}Members']
    require(len(members) == expected_count, f'{kind} member count')
    require(sum(x['bytes'] for x in members.values()) == expected_bytes, f'{kind} byte count')
    for prefix in ['original', 'preserved']:
        root = pathlib.Path(manifest[f'{prefix}{kind.title()}Directory'])
        actual = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()}
        require(actual == set(members), f'{prefix} {kind} exact regular-file set')
        for relative, record in members.items():
            p = root / relative
            require(p.stat().st_size == record['bytes'], f'{prefix} {kind} bytes: {relative}')
            require(sha(p) == record['sha256'], f'{prefix} {kind} hash: {relative}')
    member_results[kind] = {'files': expected_count, 'bytes': expected_bytes, 'originalAndPreservedExact': True}

source_inventory = read(SOURCE_PACKET / 'source-inventory.json')
require(len(source_inventory) == 588, '588 frozen successor sources')
for relative, digest in source_inventory.items():
    require(sha(SOURCES / relative) == digest, f'frozen source: {relative}')
prelaunch = read(CAPTURE / 'outer/source-prelaunch.json')
recheck = read(H / 'metadata-update-receiving-source-recheck-v2.json')
require(prelaunch['identity'] == recheck['identity'], 'complete captured prelaunch/recheck identity agreement')
require(prelaunch['canonicalProgram'] == recheck['canonicalProgram'], 'captured canonical-program agreement')
source_freeze = read(SOURCE_PACKET / 'source-freeze.json')
require(len(source_freeze['productionFiles']) == 511, '511 frozen production files')
require(sum(len(p['regularPayloadFilesMap']) for p in source_freeze['packages'].values()) == 2544, '2544 declared named dependency payloads')
require(len(source_freeze['dependencyReuseLinks']) == 4, 'four declared dependency links')

inner = CAPTURE / 'inner'
history = read(inner / 'history.json')
canonical = json.dumps(history, sort_keys=True, separators=(',', ':')).encode()
require(hashlib.sha256(canonical).hexdigest() == freeze['canonicalProgramSha256'], 'canonical actual history digest')
require(history == prelaunch['canonicalProgram']['history'], 'actual history equals selected program')
identity = read(H / 'metadata-update-receiving-inner-identity-v2.json')
require(len(identity['candidates']) == 1 and identity['selected'] == identity['candidates'][0], 'one exact candidate, selected without mtime rule')
selected = identity['selected']
prepared = read(inner / 'prepared.json')
supervisor = read(inner / 'supervisor.json')
writer = read(inner / 'receipts.jsonl.writer.json')
for key, value in prepared.items():
    require(supervisor[key] == value, f'prepared/supervisor {key}')
require(prepared['cwd'] == str(SOURCES), 'prepared source root')
require(supervisor['pid'] == selected['supervisorLeaderPid'] == 52405, 'recorded receiving leader')
require(writer['pid'] == selected['receiptWriterPid'] == 52441, 'recorded writer')
require(writer['path'] == prepared['receiptTransport']['path'], 'writer transport path')
require(writer['flags'] == 'wx' and writer['regularFile'] and writer['mode'] == 384, 'writer exclusive regular transport')
require(read(inner / 'binding-verification.json')['status'] == 'bound', 'child binding status')
require(supervisor['phase'] == 'final-with-binding', 'final bound supervisor record')
require(supervisor['elapsedMs'] == 2451 and supervisor['maxSampledGroupRssBytes'] == 450707456, 'captured resource observations')
require(supervisor['killAttempted'] is False and supervisor['heapDiagnosticDetected'] is False, 'no supervisor kill or heap diagnostic')

receipts = [json.loads(line) for line in (inner / 'receipts.jsonl').read_text().splitlines()]
require(len(receipts) == 206, '206 raw receipts')
require([x['sequence'] for x in receipts] == list(range(1, 207)), 'contiguous receipt sequence')
require(receipts[0]['history'] == history and receipts[0]['cwd'] == str(SOURCES), 'worker-start actual program/root')
counts = collections.Counter(x['phase'] for x in receipts)
summary = read(CAPTURE / 'observation-summary.json')
require(dict(counts) == summary['receiptPhaseCounts'], 'phase counts from raw capture')
outcome = supervisor['outcome']
require({k: v for k, v in outcome.items() if k != 'receipts'} == freeze['receivingOutcome'], 'actual outcome agrees with freeze')
require(outcome['reason'] == 'exited' and outcome['exitCode'] == 0 and outcome['signal'] is None, 'child normal exit0')
require(outcome['keyCallbacks'] == counts['query-key-callback'] == 23, '23 real query-key callbacks')
require(outcome['cleanupErrors'] == [] and outcome['prefixViolations'] == outcome['warnings'] == 0, 'no diagnostic failures')
require('primaryObservationError' not in outcome, 'no primary realtime observation error')

supervisor_source = (SOURCES / 'packages/query-db-collection/tests/queued-answer-progress-supervisor.ts').read_text()
selection = re.search(r'if\s*\(\s*\[([^]]+)\]\.includes\(receipt.phase\)\s*\)', supervisor_source)
require(selection is not None, 'source retained-phase selector found')
phases = re.findall(r'`([^`]+)`', selection.group(1))
retained = [x for x in receipts if x['phase'] in phases]
require(retained == outcome['receipts'] and len(retained) == 21, 'exact 21-receipt retained outcome equals source selector')
require('followup-start' not in phases and 'followup-publication' not in phases and 'public-change' in phases, 'phase-erasing selector')

by_sequence = {x['sequence']: x for x in receipts}
for sequence, phase in [(88, 'reload-start'), (159, 'public-change'), (160, 'downstream-change'), (161, 'final-publication'), (162, 'followup-start'), (177, 'followup-source-applied'), (182, 'public-change'), (183, 'downstream-change'), (185, 'followup-publication'), (186, 'cleanup-start'), (206, 'worker-cleaned')]:
    require(by_sequence[sequence]['phase'] == phase, f'actual semantic ordering at {sequence}')
for sequence in [182, 183]:
    update = by_sequence[sequence]['changes']
    require(len(update) == 1 and update[0]['type'] == 'update', f'real same-key update at {sequence}')
    require(update[0]['key'] == update[0]['value']['$key'] == update[0]['previousValue']['$key'], f'retained event key at {sequence}')
    require(update[0]['value']['id'] == update[0]['previousValue']['id'] == 3, f'ordinary id at {sequence}')
    require(update[0]['value']['rank'] == 35 and update[0]['previousValue']['rank'] == 30, f'complete ordinary update/previous value at {sequence}')

# This is a pure explanation of the snapshot-phase rule, not execution of the
# TypeScript checker, its event checker, or a receiving fixture.
def snapshot_phase_walk(trace):
    prior, final = [(4, 40)], [(3, 30)]
    reloading = False
    published = False
    baseline = False
    for receipt in trace:
        phase = receipt['phase']
        if phase == 'followup-start':
            require(baseline, 'phase walk receives compared reload baseline')
            prior, final = final, [(3, 35)]
            published = False
        if phase == 'reload-start':
            reloading = True
        if phase == 'cleanup-start':
            reloading = False
        if phase == 'final-publication':
            baseline = True
        if phase != 'public-change' or not reloading:
            continue
        actual = [(r['id'], r['rank']) for r in receipt['rows']]
        is_final = actual == final
        expected = final if published or is_final else prior
        if actual != expected:
            return {'sequence': receipt['sequence'], 'actual': actual, 'expected': expected}
        published = published or is_final
    return None

require(snapshot_phase_walk(receipts) is None, 'raw trace keeps phase distinctions in pure snapshot explanation')
gap = snapshot_phase_walk(retained)
require(gap == {'sequence': 182, 'actual': [(3, 35)], 'expected': [(3, 30)]}, 'retained trace explains exact observed mismatch')

outer_return = read(H / 'metadata-update-receiving-root-outer-return-v2.json')
require(outer_return['completionToolReturn']['exit_code'] == outer_return['actualOuterExitCode'] == 1, 'actual outer tool exit1')
require((outer_return['outerPid'], outer_return['outerPgid'], outer_return['receivingParentPid']) == (52259, 52259, 52323), 'recorded original outer identities')
absence = read(H / 'metadata-update-receiving-root-absence-v2.json')
require(len(absence['probes']) == 6, 'six captured absence probes')
for probe in absence['probes']:
    require(probe['psMatches'] == [] and probe['status'] == 'empty-ESRCH' and probe['signalZeroError']['errno'] == 3, 'captured empty/ESRCH absence')
log = (CAPTURE / 'outer/outer-vitest.log').read_text()
require('1 failed | 19 skipped (20)' in log, 'one selected failed test, nineteen skipped')
require('every reload callback publishes one complete snapshot without regression' in log and 'rank: 35' in log and 'rank: 30' in log, 'actual outer mismatch')
reported = re.findall(r"^\s+'([a-z-]+)': 1,?$", log, re.MULTILINE)
require(len(reported) == 31 and set(reported) == set(freeze['metadataReachCountsObserved']), '31 observed reach counters')
callsite = (SOURCES / 'packages/query-db-collection/tests/queued-answer-metadata-oracle.test.ts').read_text()
require(callsite.index('checkQueuedAnswerProgress(history, outcome)') < callsite.index('metadata.finish()'), 'throw precedes explicit finish call')

result = {
    'status': 'QUALIFIED ACTUAL OUTER1 / CHILD0; CONFIRMED RETAINED-TRACE PHASE GAP',
    'auditKind': 'Pinned Python read/hash/JSON and pure snapshot-phase explanation only',
    'nativeLaunches': 0, 'processProbes': 0, 'sourceEdits': 0,
    'scriptSha256': sha(pathlib.Path(__file__)),
    'inputPins': {str(p): digest for p, digest in pins.items()},
    'rawMembers': member_results, 'sourceFilesRehashed': len(source_inventory),
    'actualOuterExitCode': 1, 'receivingChildExitCode': 0,
    'rawReceipts': 206, 'retainedOutcomeReceipts': 21,
    'omittedPhaseSequences': {'followup-start': 162, 'followup-publication': 185},
    'firstMisclassifiedCallback': gap,
    'metadataReachCountersObserved': len(reported),
    'workerCleanedComparedPublicationRuleObserved': True,
    'explicitMetadataFinishExecuted': False,
    'productRedGreenCredit': False, 'receivingGreenCredit': False,
    'correctionOrRuntimeAdmitted': False,
    'limits': ['No native replay or actual TypeScript checker execution in this audit', 'Child binding does not establish parent checker compiled bytes/invocation', 'Captured original childPid-as-group convention lacks initial actual getpgid', 'Stable metadata and direct eager source-sync receiver only'],
}
output = REVIEW / 'metadata-update-receiving-actual-review-v2.json'
output.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
print(json.dumps({'status': result['status'], 'audit': str(output), 'auditSha256': sha(output), 'scriptSha256': result['scriptSha256']}))
