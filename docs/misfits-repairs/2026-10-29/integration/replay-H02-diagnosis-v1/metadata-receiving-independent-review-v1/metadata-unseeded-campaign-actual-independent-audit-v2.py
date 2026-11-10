"""Independent fixed-campaign audit: saved files only; no native imports or probes."""
import collections
import hashlib
import json
import pathlib
import re
REVIEW = pathlib.Path(__file__).resolve().parent
H = REVIEW.parent
CAPTURE = H / 'metadata-unseeded-campaign-actual-v1'
PREP = H / 'metadata-unseeded-campaign-preparation-v1'
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



pins = {
 H / 'metadata-unseeded-campaign-result-freeze-v1.json': '954704f4509f4519152957251e141ed26f4c5eb0015a3d00a84c4cc6e7b9ed4e',
 CAPTURE / 'report.md': '3742d75fb4c02826a39b31a038b79980dd5c503cada8a7897d00f681e6e0ccd0',
 CAPTURE / 'capture-manifest.json': 'b81adaa66434a99417456d9b4179ef14e1bcb77c07c677dfc0e2e058f19426e5',
 CAPTURE / 'raw-manifest.json': 'c3c1a5a73875be4f2b54c4084c1583b5dd3c50d1225404fec2f503c80f64b76d',
 CAPTURE / 'observation-summary.json': '540df58376dd1a2daa4f62bb436ffb23e35e2b523e177e7e467cba00742ade83',
 H / 'metadata-unseeded-campaign-root-admission-v1.json': '4b2084f7333bd92d94a1dc9337dab31352ac894988aa83393d419c476eabfbb9',
 PREP / 'binding.json': 'a95dc1d31f59c4c6c39b44864a8f528dcc93583b361eb3f62a62ca4db7e27e34',
 PREP / 'packet-manifest.json': '001d61d33d25af42ab5afb0c178840eb3f4ccdb9b14c71b8c43a0ca1a121d7f2',
 PREP / 'first-command.json': 'edf6678933aa512bdcf6ca69ec38322d7a816a63960f93d0b9fb1133082c1eea',
 PACKET / 'source-freeze.json': 'd651df85eb08ff46d8e68bd01b6fcc644f18a6a8efbb4b52ef557af0fd6a2fcd',
 PACKET / 'source-inventory.json': '3c8ece36701d450758587bd16dbf691b5e700668bc0be32ae2f20af8bc8bfb84',
 PACKET / 'packet-manifest.json': 'e7574c41407e9e5b7fecfa181abc7f22b7ed4e2dcc48a7ab19860180a49bc00a',
 H / 'metadata-update-receiving-result-freeze-v2.json': 'e490825ed92a6fa97891d2ab8b0414f65691bc06c214573e7ed119e9d236d9eb',
 H / 'metadata-update-source-v2/source-freeze.json': '4ae26549a4edc1565ef08ca7f1b096f7b644b32773fa520d688431335aa5bd8a',
 H / 'metadata-update-receiving-actual-v2/raw-manifest.json': '091d5b2cec5155f52003ee629758b2ce69e0bd20a6f56ea15eda012d15432803',
 REVIEW / 'metadata-unseeded-campaign-preparation-independent-review-v1.md': 'e3066d7a6022d9c4268033e0edcb283a04a28d56814f8dadee413ced31a07f5b',
}
for p, expected in pins.items(): require(sha(p) == expected, 'pin ' + str(p))
freeze = read(H / 'metadata-unseeded-campaign-result-freeze-v1.json')
for name, record in read(CAPTURE / 'capture-manifest.json')['evidenceFiles'].items():
 p = CAPTURE / name
 require(sha(p) == record['sha256'] and p.stat().st_size == record['bytes'], 'capture evidence ' + name)
for packet in [PREP, PACKET]:
 for name, record in read(packet / 'packet-manifest.json')['artifacts'].items():
  p = packet / name
  require(sha(p) == record['sha256'] and p.stat().st_size == record['bytes'], 'packet member ' + name)
admission = read(H / 'metadata-unseeded-campaign-root-admission-v1.json')
require(admission['slot'] == 4 and admission['maxInvocations'] == 1 and admission['campaign'] == {'property':'query.queued-answer-metadata.scope.default','suppliedSeed':None,'numRuns':8,'multiplier':1,'displayName':'queued-answer metadata receiving > generated \'scope\' \'default\' > checks the unseeded generated campaign or selected replay'}, 'exact unseeded admission')
for name in ['proposal','review','independentAudit']: pointer(admission[name], 'admission '+name)
for name,digest in admission['packetPins'].items(): require(sha(pathlib.Path(name)) == digest, 'admission packet pin')
binding = read(PREP / 'binding.json')
for name, digest in binding['files'].items(): require(sha(PREP / name) == digest, 'prep file ' + name)
for name, digest in binding['externalInputs'].items(): require(sha(pathlib.Path(name)) == digest, 'external input ' + name)
recovery_paths = [pathlib.Path(p) for p, d in binding['externalInputs'].items() if d == 'c02badc1d10295180a8cc560c8aa1057af3bede2f5b5dc7df7d35791dbf23406']
require(len(recovery_paths) == 1 and 'c02badc1d10295180a8cc560c8aa1057af3bede2f5b5dc7df7d35791dbf23406' == 'c02badc1d10295180a8cc560c8aa1057af3bede2f5b5dc7df7d35791dbf23406', 'shared recovery pin')
recovery = read(recovery_paths[0])
for name in ['actualRepair','postAudit','closeout','formattingAccount']: pointer(recovery[name], 'recovery ' + name)
for name,digest in read(CAPTURE / 'prelaunch-pins.json')['pins'].items(): require(sha(pathlib.Path(name)) == digest, 'prelaunch pin')

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
manifest = read(CAPTURE / 'raw-manifest.json')
require(len(manifest) == 15587 and sum(x['bytes'] for x in manifest.values()) == 251024553, 'raw count and bytes')
raw_roots = [CAPTURE / 'raw-histories', CAPTURE / 'raw-outer']
require({str(p.relative_to(CAPTURE)) for root in raw_roots for p in root.rglob('*') if p.is_file()} == set(manifest), 'exact preserved file set')
original_sets = collections.defaultdict(set)
for name, record in manifest.items():
 preserved, original = CAPTURE / name, pathlib.Path(record['original'])
 require(preserved.is_file() and original.is_file() and not preserved.is_symlink() and not original.is_symlink(), 'raw regular file')
 for p in [preserved, original]:
  require(p.stat().st_size == record['bytes'] and sha(p) == record['sha256'], 'raw hash and bytes ' + str(p))
 root = original.parents[1] if name.startswith('raw-histories/') and len(pathlib.Path(name).parts) > 3 else original.parent
 # Group using the explicitly preserved UUID directory, regardless of nesting.
 if name.startswith('raw-histories/'):
  relative = pathlib.Path(name).parts[2:]
  root = original
  for _ in relative: root = root.parent
 else: relative = (original.name,)
 original_sets[root].add(str(pathlib.Path(*relative)))
for root, names in original_sets.items():
 require({str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()} == names, 'exact original file set ' + str(root))
require(sum(n.startswith('raw-histories/') for n in manifest) == 15584 and sum(n.startswith('raw-outer/') for n in manifest) == 3, 'inner outer split')
old_capture = H / 'metadata-update-receiving-actual-v2'
old_members = raw_members(read(old_capture / 'raw-manifest.json'), old_capture, {'inner': (1948,31372571), 'outer': (3,15840)})

initial = read(CAPTURE / 'actual-initial-exec-return.json')
final = read(CAPTURE / 'actual-final-exec-return.json')
command = read(PREP / 'first-command.json')
expected_command = ' '.join([command['executable'], *command['argv']])
require(initial['invocation']['cmd'] == expected_command and initial['invocation']['workdir'] == str(H) and initial['invocation']['sandbox_permissions'] == 'require_escalated', 'actual admitted command and permission')
require(initial['actualToolReturn']['chunk_id'] == '6e3e50' and initial['actualToolReturn']['session_id'] == final['sessionId'] == 94881, 'actual initial session')
require(final['actualToolReturn']['chunk_id'] == '59a0d2' and final['actualToolReturn']['exit_code'] == 0, 'actual outer completion')
require((CAPTURE / 'raw-outer/launcher-process.txt').read_text().split()[:2] == ['99756','99756'] and expected_command in (CAPTURE / 'raw-outer/launcher-process.txt').read_text(), 'actual original launcher')
require(freeze['nativeCampaignInvocations'] == 1 and freeze['retried'] is False, 'one recorded invocation')
prelaunch = read(CAPTURE / 'raw-outer/source-prelaunch.json')
require(prelaunch['bindingSha256'] == pins[PREP / 'binding.json'] and prelaunch['seed'] is None and prelaunch['numRuns'] == 8 and prelaunch['multiplier'] == 1, 'actual prelaunch pins')
baseline = prelaunch['receivingEvidenceBaseline']
require(len(baseline['members']) == 24, '24 older baseline candidates')
expected_directories = {pathlib.Path(r['original']).parents[len(pathlib.Path(n).parts)-3] for n,r in manifest.items() if n.startswith('raw-histories/')}
# Independently collect only original parent99770 UUID directories. Existing
# contents are read; no file timestamp selects the result.
temporary = pathlib.Path(baseline['temporaryRoot'])
parent_candidates = {p for p in temporary.iterdir() if re.fullmatch(r'h02-progress-99770-[0-9a-f-]+', p.name) and p.is_dir()}
require(parent_candidates == expected_directories and len(parent_candidates) == 8, 'all and only eight parent-attributed original paths')
summary = read(CAPTURE / 'observation-summary.json')
require(len(summary['histories']) == 8 and len({x['originalDirectory'] for x in summary['histories']}) == 8, 'eight distinct summary UUIDs')
by_original = {x['originalDirectory']: x for x in summary['histories']}
selector = (SOURCES / 'packages/query-db-collection/tests/queued-answer-progress-receipts.ts').read_text()
phases = re.findall(r'`([^`]+)`', selector[selector.index('return ['):])
histories = []
lifecycle=read(CAPTURE/'actual-outer-lifecycle-observation.json')
require(lifecycle['originalPid']==lifecycle['originalPgid']==lifecycle['actualGetpgid']==99756 and lifecycle['getpgidError'] is None and lifecycle['actualPsReturncode']==0 and lifecycle['actualPsStderr']=='', 'actual live postlaunch outer getpgid')
lifecycle_rows=[row.strip().split(None,4) for row in lifecycle['matchingOriginalGroupRows']]
require(len(lifecycle_rows)==4 and all(len(row)==5 for row in lifecycle_rows), 'four complete observed lifecycle rows')
observed={int(row[0]):{'ppid':int(row[1]),'pgid':int(row[2]),'rssKiB':int(row[3]),'args':row[4]} for row in lifecycle_rows}
require(len(observed)==4 and set(observed)=={99756,99770,99769,241} and all(row['pgid']==99756 for row in observed.values()), 'exact observed original outer group')
require(observed[99770]['ppid']==99756 and observed[99769]['ppid']==99756 and observed[241]['ppid']==99770, 'actual parent PPID and observed members')
require('vitest.mjs run --config scripts/h02-progress/vitest.config.ts' in observed[99756]['args'] and observed[99770]['args'].endswith('/vitest/dist/workers/forks.js') and 'esbuild --service=' in observed[99769]['args'] and observed[241]['args']=='/bin/ps -axo pid=,pgid=,rss=,args=', 'actual observed command roles')
processes = [('outer',99756,99756),('receiving-parent',99770,99756)]
for row in lifecycle_rows:
    pid=int(row[0])
    if pid not in {99756,99770}: processes.append(('actual-outer-group-observed-member',pid,int(row[2])))
for original in sorted(parent_candidates):
 inner = CAPTURE / 'raw-histories' / original.name
 history = read(inner / 'history.json')
 require(original.name not in baseline['members'], 'new UUID beyond passive baseline')
 require(history == {**{'cacheIdentity':'scope','includes':True,'kind':'query','metadataKeys':'default','nonemptyPrior':True,'scheduler':'microtask','window':True}, **{k:history[k] for k in ['keyShift','rankScale','metadataFollowupQuarter']}}, 'exact history fields')
 require(0 <= history['keyShift'] <= 20 and 1 <= history['rankScale'] <= 20 and history['metadataFollowupQuarter'] in [1,2,3], 'legal generated facts')
 prepared, supervisor = read(inner / 'prepared.json'), read(inner / 'supervisor.json')
 writer = read(inner / 'receipts.jsonl.writer.json')
 for k,v in prepared.items(): require(supervisor[k] == v, 'prepared supervisor ' + k)
 require(prepared['cwd'] == str(SOURCES) and pathlib.Path(prepared['directory']).resolve() == original.resolve() and pathlib.Path(prepared['historyPath']).resolve() == (original/'history.json').resolve(), 'exact source history path')
 require(writer['path'] == prepared['receiptTransport']['path'] and pathlib.Path(writer['path']).resolve() == (original/'receipts.jsonl').resolve() and writer['regularFile'] and writer['flags']=='wx' and writer['mode']==384, 'exclusive writer transport')
 require(prepared['limits'] == {'wallMs':20000,'groupRssBytes':1073741824,'nodeHeapMiB':384,'postEnqueueWindowMs':1000}, 'unchanged limits')
 require(supervisor['phase']=='final-with-binding' and not supervisor['killAttempted'] and not supervisor['latestGroupRows'] and not supervisor['heapDiagnosticDetected'], 'normal final supervisor')
 outcome = supervisor['outcome']
 require(outcome['reason']=='exited' and outcome['exitCode']==0 and outcome['signal'] is None and outcome['bindingStatus']=='bound', 'independent child0')
 require(outcome['prefixViolations']==outcome['warnings']==0 and outcome['cleanupErrors']==[] and not outcome.get('primaryObservationError'), 'no child observer failure')
 receipts = [json.loads(x) for x in (inner/'receipts.jsonl').read_text().splitlines()]
 require(len(receipts)==206 and [x['sequence'] for x in receipts]==list(range(1,207)), '206 raw contiguous receipts')
 require(receipts[0]['history']==history and receipts[0]['cwd']==str(SOURCES), 'actual worker history')
 counts = collections.Counter(r['phase'] for r in receipts)
 require(outcome['keyCallbacks']==counts['query-key-callback']==23, '23 key callbacks')
 retained = [r for r in receipts if r['phase'] in phases]
 require(retained==outcome['receipts'] and len(retained)==23, 'exact retained projection')
 require([(r['sequence'],r['phase']) for r in retained]==[(1,'worker-start'),(4,'metadata-identities'),(5,'source-establishing-receipt'),(9,'source-stack'),(83,'public-change'),(84,'downstream-change'),(85,'downstream-change'),(86,'public-change'),(87,'initial-publication'),(88,'reload-start'),(134,'retained-publication'),(152,'answer-queued'),(153,'answer-executed'),(159,'public-change'),(160,'downstream-change'),(161,'final-publication'),(162,'followup-start'),(164,'source-stack'),(182,'public-change'),(183,'downstream-change'),(185,'followup-publication'),(186,'cleanup-start'),(206,'worker-cleaned')], 'full retained source-order')
 by = {r['sequence']:r for r in receipts}
 require(by[134]['pendingProviderAnswers']>0 and by[152]['enqueueReturned'] is True, 'held provider and completed enqueue')
 require([(by[n]['phase']) for n in [175,176,177,181,184]]==['acquisition-accepted','followup-source-accepted','followup-source-applied','followup-acquisition-settled','followup-settled'], 'source application and complete acquisition order')
 require(by[175]['attempt']==by[181]['attempt']==12 and by[181]['outcome']=='fulfilled' and by[184]['attempts']==[[12,'fulfilled']], 'one fulfilled followup acquisition')
 require(by[184]['rootSubscriptionStatus']==by[184]['downstreamSubscriptionStatus']=='ready' and not by[184]['rootLoadingSubset'] and not by[184]['downstreamLoadingSubset'] and by[184]['rootCallbacks']==by[184]['downstreamCallbacks']==1, 'complete settled callback cut')
 # Reconstruct all public states from complete messages, including reload and
 # empty batches; never infer prior values from the final summary.
 states = {'public-change':{},'downstream-change':{}}
 for receipt in receipts:
  phase=receipt['phase']
  if phase not in states: continue
  state=states[phase]
  for change in receipt['changes']:
   key=change['key']
   require(key==change['value']['$key'], 'event key and row key')
   if change['type']=='insert':
    require(key not in state, 'insert absent'); state[key]=change['value']
   elif change['type']=='delete':
    require(state.get(key)==change['value'], 'complete deleted value'); del state[key]
   else:
    require(change['type']=='update' and state.get(key)==change['previousValue'], 'complete update previous value'); state[key]=change['value']
  require(len(receipt['entries'])==len({key for key,_ in receipt['entries']}), 'unique callback entry keys')
  require(state==dict(receipt['entries']) and receipt['rows']==[v for _,v in receipt['entries']], 'event-derived callback entries and rows')
 ids=by[4]
 def verify_publication(n, offset, rank):
  pub=by[n]
  require(len(pub['rows'])==len(pub['downstream'])==1, 'one row per publication output')
  for rows_name, entries_name, id_name in [('rows','entries','rootId'),('downstream','downstreamEntries','downstreamId')]:
   row=pub[rows_name][0]; entries=pub[entries_name]
   # Ordinary rows are specified independently. Keys stay opaque and bind
   # to the complete observed entries rather than a compiler encoding rule.
   require(row['id']==offset+history['keyShift'] and row['rank']==rank and row['markers']==[], 'ordinary publication row')
   require(entries==[[row['$key'],row]] and row['$collectionId']==ids[id_name] and row['$origin']=='remote' and row['$hasPendingWrites'] is False, 'complete publication metadata')
  root, downstream=pub['rows'][0],pub['downstream'][0]
  require({k:downstream[k] for k in ['observedKey','observedCollectionId','observedOrigin','observedPending']}==dict(zip(['observedKey','observedCollectionId','observedOrigin','observedPending'],[root['$key'],root['$collectionId'],root['$origin'],root['$hasPendingWrites']])), 'selected upstream metadata consumed downstream')
 for n in [87,134]: verify_publication(n,4,4*history['rankScale'])
 verify_publication(161,3,3*history['rankScale'])
 verify_publication(185,3,(3+history['metadataFollowupQuarter']/4)*history['rankScale'])
 for n, baseline_name in [(182,'rows'),(183,'downstream')]:
  changes=by[n]['changes']; require(len(changes)==1 and changes[0]['type']=='update', 'one actual followup update')
  change=changes[0]
  require([change['previousValue']]==by[161][baseline_name] and [change['value']]==by[185][baseline_name], 'exact full previous/current followup values')
  require(change['key']==change['previousValue']['$key']==change['value']['$key'], 'stable followup key')
  require({k:v for k,v in change['previousValue'].items() if k!='rank'}=={k:v for k,v in change['value'].items() if k!='rank'}, 'all non-rank fields stable')
 require(by[183]['upstreamEntries']==by[182]['entries'] and by[185]['entries']==by[182]['entries'] and by[185]['downstreamEntries']==by[183]['entries'], 'callback/final reads agree')
 require(by[185]['ready'] and not by[185]['syncError'], 'ready final publication')
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

 record=by_original[str(original)]
 require(record['history']==history and record['detachedLeaderPid']==supervisor['pid'] and record['receiptWriterPid']==writer['pid'], 'summary identity matches raw')
 require(record['files']==1948 and record['bytes']==sum(r['bytes'] for n,r in manifest.items() if n.startswith('raw-histories/'+original.name+'/')), 'per-history files and bytes')
 require(record['elapsedMs']==supervisor['elapsedMs'] and record['maxSampledGroupRssBytes']==supervisor['maxSampledGroupRssBytes'], 'raw resource summary')
 histories.append({'uuid':original.name,'history':history,'leader':supervisor['pid'],'writer':writer['pid'],'receipts':206,'retained':23,'evaluatedCuts':evaluated_cuts,'bindings':len(verification['bindings']),'elapsedMs':supervisor['elapsedMs'],'maxSampledGroupRssBytes':supervisor['maxSampledGroupRssBytes']})
 processes.extend([('detached-leader',supervisor['pid'],supervisor['pid']),('receipt-writer',writer['pid'],None)])

identities=read(CAPTURE/'original-process-identities.json')['processes']
require([(r['role'],r['pid'],r['groupTarget']) for r in identities]==processes, 'all20 original PID roles and group targets')
pids={p for _,p,_ in processes}; groups={g for _,_,g in processes if g is not None}
require(len(pids)==20 and len(groups)==9, '20 unique PIDs nine group targets')
absence=read(CAPTURE/'actual-original-identity-absence.json')
require(absence['originalPidCount']==20 and absence['originalTargetGroupCount']==9 and len(absence['probes'])==29 and absence['groupPsReturncode']==0 and absence['groupPsStderr']=='', 'complete captured absence checks')
require({p['target'] for p in absence['probes'] if p['kind']=='original-pid'}==pids, 'exact absence PIDs')
require({p['target'] for p in absence['probes'] if p['kind']!='original-pid'}==groups, 'exact absence target groups')
for probe in absence['probes']:
 require(probe['actualSignalZero']['errno']==3 and probe['actualSignalZero']['result']=='absent', 'captured signal zero ESRCH')
 if probe['kind']=='original-pid':
  ps=probe['actualPs']; require(ps=={'argv':['/bin/ps','-o','pid=,pgid=,args=','-p',str(probe['target'])],'returncode':1,'stderr':'','stdout':''}, 'captured empty PID ps')
 else: require(probe['actualPsGroupRows']==[], 'captured empty group ps')
require(lifecycle['originalLauncherRecord']==(CAPTURE/'raw-outer/launcher-process.txt').read_text(), 'live lifecycle points to original launcher record')
log=(CAPTURE/'raw-outer/outer-vitest.log').read_text()
title=command['selection']['displayName']
require(len(re.findall(r'^ ✓ .* > '+re.escape(title)+r' \d+ms$',log,re.M))==1 and 'Tests  1 passed | 19 skipped (20)' in log and '(with seed=' not in log, 'exact unsuffixed selected native pass')
blocks=re.findall(r'H02 metadata receiving reach \{.*?counts: \{(.*?)\n  \}\n\}',log,re.S)
require(len(blocks)==8, 'eight actual cumulative reach blocks')
required=read(PREP/'evidence-requirements.json')['reach']['states']; require(len(required)==31, '31 required states')
cumulative=[]
for ordinal,block in enumerate(blocks,1):
 pairs=re.findall(r"'([^']+)': (\d+)",block)
 require(len(pairs)==31 and {k for k,_ in pairs}==set(required) and {int(v) for _,v in pairs}=={ordinal}, 'all31 cumulative counters at ordinal '+str(ordinal))
 cumulative.append({k:int(v) for k,v in pairs})
require(summary['cumulativeReach']==cumulative and summary['minimumInSource']==1, 'summary matches cumulative native observations')
callsite=(SOURCES/'packages/query-db-collection/tests/queued-answer-metadata-oracle.test.ts').read_text()
require(callsite.index('reach.beginHistory()')<callsite.index('const outcome = await receiveProgressHistory(')<callsite.index('checkQueuedAnswerProgress(history, outcome)')<callsite.index('metadata.finish()'), 'perhistory source order')
unseeded=callsite[callsite.index('`checks the unseeded generated campaign or selected replay`'):]
require(unseeded.index('await fc.assert(')<unseeded.index('await run(historyOf(facts), reach)')<unseeded.index('oraclePropertyOptions(8, property)')<unseeded.index('reach.assertReached()'), 'serial awaited unseeded source order')
config=(SOURCES/'packages/db/tests/oracle-config.ts').read_text()
require('if (replaySeed === undefined) return { numRuns }' in config and 'return oracleRandomParameters(oracleRuns(baseRuns), replay, property)' in config, 'no seed/path supplied with cleared replay inputs')
recipe=read(PREP/'recipe.json')
require({'TANSTACK_DB_ORACLE_SEED','TANSTACK_DB_ORACLE_PATH','TANSTACK_DB_ORACLE_PROPERTY','TANSTACK_DB_ORACLE_CALIBRATION'} <= set(recipe['envUnset']) and recipe['envSet']['TANSTACK_DB_ORACLE_RUNS_MULTIPLIER']=='1', 'actual admitted recipe clears replay controls and pins multiplier')
require(freeze['suppliedSeed'] is summary['suppliedSeed'] is None and freeze['chosenSeed'] is summary['chosenSeed'] is None and not freeze['replayed'] and final['continuationIndex']==freeze['actualOuter']['continuations']==1, 'unavailable success seed/no replay and complete continuation record')
reach=(SOURCES/'packages/db/tests/oracle-reach.ts').read_text()
require('minimum = 1' in reach and 'current = new Set()' in reach and 'if (current.has(state)) return' in reach and 'counts.set(state, counts.get(state)! + 1)' in reach, 'once-per-history cumulative reach source semantics')
python=read(CAPTURE/'python-postcheck.json'); original_python=read(H/'metadata-update-native-preparation-v1/binding.json')['python']
require(python['sha256']==original_python['sha256'] and sha(pathlib.Path(python['path']))==python['sha256'], 'original bound Python binary')
post=read(CAPTURE/'source-tool-postcheck.json')
require((post['sourceMembers'],post['productionMembers'],post['namedOwnPayloadHashes'],post['reuseLinks'])==(589,511,2544,4) and post['sourceFreezeSha256']==pins[PACKET/'source-freeze.json'], 'source postcheck identity')
require(max(h['maxSampledGroupRssBytes'] for h in histories)==freeze['maxSampledGroupRssBytes']==489455616 and all(h['elapsedMs']<20000 and h['maxSampledGroupRssBytes']<1073741824 for h in histories), 'reported resources within unchanged sampled limits')
result={
 'status':'QUALIFIED: EXACT UNSEEDED SCOPE/DEFAULT CAMPAIGN, OUTER0 AND EIGHT CHILD0',
 'auditKind':'Independent saved-file read/hash/JSON, event accumulation and static source-order audit',
 'nativeLaunches':0,'processProbes':0,'sourceEdits':0,'suppliedSeed':None,'chosenSeed':None,'chosenSeedEvidence':'Successful unchanged unseeded logging exposes no internal seed. No seed inferred; no replay claimed.','scriptSha256':sha(pathlib.Path(__file__)),
 'inputPins':{str(p):v for p,v in pins.items()},'rawFiles':15587,'rawBytes':251024553,
 'originalAndPreservedExact':True,'priorFailedV2RawPreserved':old_members,
 'sourceFilesRehashed':589,'productionFilesRehashed':511,'namedOwnPayloadsRehashed':payloads,'reuseLinksVerified':4,
 'actualOuterExitCode':0,'receivingChildExitCodes':[0]*8,'passedNativeTests':1,'skippedNativeTests':19,
 'distinctHistories':histories,'cumulative31StateCounts':list(range(1,9)),'finalEveryStateCount':8,'sourceMinimumUnchanged':1,
 'completePublicEventAccumulationVerified':True,'originalPidsAbsentInCapturedProbes':20,'originalTargetGroupsAbsentInCapturedProbes':9,
 'finishQualification':'Exact frozen parent run/check/finish ordering plus selected fixed-campaign pass under existing source-to-parent invocation assumption. No dedicated finish/assert receipt or new parent checker V8 provenance.',
 'productRedGreenCredit':False,'bugClassClosureCredit':False,'newRuntimeAdmitted':False,'canonicalImport':False,'publishing':False,
 'limits':['No native replay, config/model/checker import, or new process probe in this audit','No direct UUID-to-console-ordinal receipt; cumulative inference rests on serial awaited campaign and eight independent raw paths','Actual live postlaunch outer getpgid and receiving parent PPID observed; no initial detached-group getpgid; inner detached-target identity convention retained','Stable output metadata/direct eager source sync only; no changing metadata, fetched marker, held-reload followup, conflicting-cache progress, authored key, no-op or mutant credit','Child compiled/evaluated binding is not precise runtime coverage and does not prove parent checker compilation or invocation','Named package own maps do not prove complete transitive host/native/dist equivalence; native coverage/typecheck remain false; prior standalone noEmit only','Prior v2 recorder failure is preserved and supplies no product RED']}
output=REVIEW/'metadata-unseeded-campaign-actual-independent-audit-v2.json'
require(not output.exists(),'additive audit output unused')
output.write_text(json.dumps(result,indent=2,sort_keys=True)+'\n')
print(json.dumps({'status':result['status'],'auditSha256':sha(output),'scriptSha256':result['scriptSha256'],'output':str(output)}))
