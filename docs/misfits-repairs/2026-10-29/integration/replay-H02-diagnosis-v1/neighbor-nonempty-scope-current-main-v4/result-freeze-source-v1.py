import collections,hashlib,json,shutil
from pathlib import Path
W=Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-progress-main-v1')
H=Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1')
P=H/'prepared-neighbor-controls-v4';R=H/'neighbor-nonempty-scope-current-main-v4'
T=Path('/var/folders/zy/zxh2j5n97vq2tt8d8q7_1t5r0000gp/T/h02-progress-88883-9900f05d-10e6-4fba-8ae2-1ea2e7e221bc')
sha=lambda b:hashlib.sha256(b).hexdigest();hashfile=lambda p:sha(Path(p).read_bytes())
def write(name,v):
    with (R/name).open('x') as f:f.write(v if isinstance(v,str) else json.dumps(v,indent=2)+'\n')
def inventory(base):
    d={}
    for p in sorted(base.rglob('*')):
        assert not p.is_symlink(),p
        if p.is_file():d[str(p.relative_to(base))]={'bytes':p.stat().st_size,'sha256':hashfile(p)}
    return d
before=inventory(T);shutil.copytree(T,R/'receiving');assert before==inventory(T)==inventory(R/'receiving')
write('actual-receiving-copy-verification-v1.json',{'originalDirectory':str(T),'canonicalOriginalDirectory':str(T.resolve()),'archiveDirectory':'receiving','members':len(before),'bytes':sum(v['bytes'] for v in before.values()),'allOriginalBytesMatchedBeforeAndAfterCopy':True,'files':before})
s=json.loads((T/'supervisor.json').read_text());o=s['outcome'];a=[json.loads(x) for x in (T/'receipts.jsonl').read_text().splitlines()]
assert len(a)==176 and [x['sequence'] for x in a]==list(range(1,177)) and all(x['h02'] is True for x in a)
assert s['pid']==88884 and not s['killAttempted'] and not s.get('watchdogTrigger') and not s['latestGroupRows'] and not s['heapDiagnosticDetected']
assert o['reason']=='exited' and o['exitCode']==0 and o['signal'] is None and o['bindingStatus']=='bound'
assert not o.get('primaryObservationError') and not o.get('bindingError') and not o['cleanupErrors'] and not o['prefixViolations'] and not o['warnings']
binding=json.loads((T/'binding-verification.json').read_text());assert binding['status']=='bound' and not binding['failures'] and binding['receiptTransport']['count']==176
seal=json.loads((T/'binding-seal.json').read_text());assert all(seal[k] is True for k in ['sealed','skipAllPausesAcknowledged','debuggerDisableAcknowledged','inspectorDisconnectedBeforeHistory'])
history=json.loads((T/'history.json').read_text());assert history=={'kind':'query','scheduler':'microtask','cacheIdentity':'scope','includes':True,'window':True,'nonemptyPrior':True,'keyShift':0,'rankScale':10}
assert a[0]['phase']=='worker-start' and a[0]['history']==history
outer=(R/'outer-vitest.log').read_text();assert 'Tests  1 passed | 4 skipped (5)' in outer and 'H02 finite neighbor reach' not in outer
assert (T/'worker.stderr.log').read_bytes()==b''
reloads=[x['sequence'] for x in a if x['phase']=='reload-start'];cleanups=[x['sequence'] for x in a if x['phase']=='cleanup-start'];assert reloads==[87] and cleanups==[160]
reaches={
 'nonempty-prior':[x['sequence'] for x in a if x['phase']=='initial-publication' and isinstance(x.get('rows'),list) and len(x['rows'])>0],
 'held-provider-read':[x['sequence'] for x in a if x['phase']=='retained-publication' and x.get('reason')=='provider-hold-before-release' and x.get('pendingProviderAnswers',0)>0],
 'completed-enqueue':[x['sequence'] for x in a if x['phase']=='answer-queued' and x.get('enqueueReturned') is True],
 'answer-executed':[x['sequence'] for x in a if x['phase']=='answer-executed'],
 'root-change':[x['sequence'] for x in a if x['phase']=='public-change' and reloads[0]<x['sequence']<cleanups[0]],
 'downstream-change':[x['sequence'] for x in a if x['phase']=='downstream-change' and reloads[0]<x['sequence']<cleanups[0]],
 'final-publication':[x['sequence'] for x in a if x['phase']=='final-publication'],
 'worker-cleaned':[x['sequence'] for x in a if x['phase']=='worker-cleaned'],
}
assert reaches=={'nonempty-prior':[86],'held-provider-read':[133],'completed-enqueue':[151],'answer-executed':[152],'root-change':[157],'downstream-change':[158],'final-publication':[159],'worker-cleaned':[176]}
write('reach-reconstruction-v1.json',{'status':'All eight source-declared finite reaches reconstructed once from complete contiguous raw receipts','history':history,'counts':{k:len(v) for k,v in reaches.items()},'receiptSequences':reaches,'reloadStartSequence':87,'cleanupStartSequence':160,'heldProviderAnswers':3,'rawReceiptFile':'receiving/receipts.jsonl','rawReceiptSha256':hashfile(T/'receipts.jsonl'),'basis':'Same source runner predicates and reload-start to cleanup-start event cut. Live exact native test passed its original assertReached(); console was suppressed, so raw receipts retain the measured witnesses. This static audit does not create new receiving execution.'})
# Audit the named payload cuts and event operation observations. The live run
# already applied the unchanged shared judgment and V4 adapter at these cuts;
# this is a trace qualification, not another model or a receiving rerun.
project=lambda rows:[{k:row[k] for k in ['id','rank','markers']} for row in rows]
prior=[{'id':4,'rank':40,'markers':[]}];final=[{'id':3,'rank':30,'markers':[]}]
byseq={x['sequence']:x for x in a}
assert project(byseq[86]['rows'])==prior
assert project(byseq[133]['rows'])==project(byseq[133]['downstream'])==prior and byseq[133]['pendingProviderAnswers']==3
assert project(byseq[157]['rows'])==project(byseq[158]['rows'])==project(byseq[159]['rows'])==project(byseq[159]['downstream'])==final
assert byseq[159]['ready'] is True and byseq[159]['syncError'] is False
for seq in [157,158]:
    changes=byseq[seq]['changes'];assert len(changes)==2
    assert sorted((x['type'],x['value']['id']) for x in changes)==[('delete',4),('insert',3)]
    assert all(x['value']['rank']==10*x['value']['id'] and x['value']['markers']==[] for x in changes)
    assert all(all(field in x['value'] for field in ['$hasPendingWrites','$origin','$key','$collectionId']) for x in changes)
for seq in [86,133,157,158,159]:
    for field in ['rows','downstream']:
        if field in byseq[seq]:assert all(all(name in row for name in ['$hasPendingWrites','$origin','$key','$collectionId']) for row in byseq[seq][field])
write('public-comparison-qualification-v1.json',{'status':'Live root/downstream payload and event comparisons passed at all original cuts; trace values audited without altering raw metadata','priorPayload':prior,'finalPayload':final,'initialSequence':86,'heldSequence':133,'reloadRootEventSequence':157,'reloadDownstreamEventSequence':158,'finalSequence':159,'eventTransitions':'Both event batches remove prior row4 and install final row3; each callback read is the complete final ordered payload. Opposite within-batch operation order is preserved raw.','liveEvidence':'Outer exact finite test passed, primaryObservationError absent, worker normal exit0, all eight assertReached predicates satisfied. Original shared checkReplayPublication/model remain unchanged; V4 adapter observes authored payload.','rawMetadata':'All four public VirtualRowProps remain on raw snapshots and change values. Actual values are retained, not copied into model expectations.','limits':'This payload evidence does not establish temporal virtual-metadata coherence or exact generated key encoding; that receiving gap remains in coverage map under virtual-row-fields owner.'})
f=json.loads((P/'source-freeze-v4.json').read_text());sources=0;payloads=0
for key in ['productionFiles','instrumentFiles','sharedInstrumentFiles']:
    for rel,digest in f[key].items():assert hashfile(W/rel)==digest,rel;sources+=1
assert hashfile(f['node']['executable'])==f['node']['sha256']
assert hashfile(W/'pnpm-lock.yaml')==f['lockfiles']['repoPnpmLock'] and hashfile(W/'node_modules/.pnpm/lock.yaml')==f['lockfiles']['installedPnpmLock']
for rel,row in f['dependencyReuseLinks'].items():assert (W/rel).is_symlink()==row['isSymlink'] and str((W/rel).resolve())==row['resolved']
for pkg in f['packages'].values():
    for rel,digest in pkg['regularPayloadFilesMap'].items():assert hashfile(Path(pkg['resolved'])/rel)==digest;payloads+=1
write('source-identity-after-v1.json',{'sourceMapEntries':sources,'namedPackagePayloadFiles':payloads,'allMatched':True,'nodeLocksAndReuseLinksMatched':True,'productionIdentity':f['productionIdentity'],'sharedJudgmentSha256':f['exactSharedHelper']['sha256'],'limits':'Disk identity after run; actual compiled/evaluated/V8 source binding records are separately retained with their limits.'})
for src,dest in [
 (H/'neighbor-nonempty-scope-current-main-v4-root-admission-v1.json','root-admission-v1.json'),
 (H/'neighbor-nonempty-scope-current-main-v4-root-process-absence-v1.json','root-process-absence-v1.json'),
 (P/'source-freeze-v4.json','source-freeze-v4.json'),
 (P/'launcher-nonempty-scope-v4.zsh','launcher-nonempty-scope-v4.zsh'),
 (H/'prepared-neighbor-controls-v4-independent-source-acceptance-v1.md','independent-source-acceptance-v1.md'),
 (H/'prepared-neighbor-controls-v4-independent-verification-v1.json','independent-source-verification-v1.json'),
 (Path('/private/tmp/h02-v4-scope-freeze.py'),'result-freeze-source-v1.py'),
]:shutil.copyfile(src,R/dest)
assert hashfile(R/'root-process-absence-v1.json')=='7e3c91b1c4aa47f6a7ca7afd1e89c614573cedae0d28d17eab7113a41f610f09'
write('result-qualification-v1.json',{'status':'Finite nonempty scope-key payload publication control passed with all eight measured reaches; independent root result acceptance pending','finiteHistories':1,'nativePassed':1,'nativeSkipped':4,'actualHistory':history,'nativeNameCapture':'Successful verbose name/finally console suppressed by unchanged default reporter. Frozen calibrated exact selector plus one-pass/four-skip native summary and actual raw worker history identify this singleton; no captured verbose task-name claim.','rawReceipts':176,'allEightReachCounts':{k:len(v) for k,v in reaches.items()},'rawMetadataPreserved':True,'liveSharedPayloadAndEventComparisonsPassed':True,'binding':{'status':'bound','bindings':len(binding['bindings']),'failures':[],'startupSealed':True,'inspectorDisconnectedBeforeHistory':True,'inventories':['evaluated-pre-history.json','evaluated-driver-start.json','evaluated-final-publication.json','evaluated-after-all.json'],'limits':binding['limits']},'operational':{'outerExitCode':0,'childExitCode':0,'signal':None,'reason':'exited','killAttempted':False,'heap':False,'observationError':None,'cleanupErrors':[],'remainingGroupRows':[],'elapsedMs':s['elapsedMs'],'maxSampledGroupRssBytes':s['maxSampledGroupRssBytes'],'outerPid':88862,'outerPgid':88862,'childPid':88884,'childOriginalPgid':88884,'rootAbsenceReceiptSha256':hashfile(R/'root-process-absence-v1.json')},'sourceIdentityAfter':{'sourceMapEntries':sources,'namedPackagePayloadFiles':payloads,'nodeLocksAndReuseLinksMatched':True},'limits':'One finite scope-key nonempty path; no conflicting-subscription cache progress result, generated closure, exact compiler key law, temporal virtual-metadata coherence or candidate reach. Prior V3failure remains immutable; no next invocation/retry/production edit admitted.'})
write('handoff-v1.md','The admitted exact V4 nonempty-scope command passed once. All176contiguous raw receipts are retained with full public metadata and the1945original child files. The eight source-declared reaches each occur once:86initial nonempty,133held provider root/downstream,151queued,152executed,157root callback,158downstream callback,159final publication,176worker cleaned. Reload event cuts are strictly87reload-start to160cleanup-start. Live unchanged shared model/judgment with the V4 observation adapter passed root/downstream payload and event comparisons; no primary observation error occurred. Successful console/name output was suppressed, so reach is reconstructed from original raw predicates/receipts, not fabricated console.\n\nBinding reports bound with648inventory bindings and no failures; startup inspector disconnected before history, final/after-all inventories retained. Normal child/outer exit0, no kill/heap/cleanup error; original group empty. Root independently observed outer88862 and child88884 pid+pgid absent. All563source entries,2544named-package payload files, Node/locks/reuse links matched after the run.\n\nThis is finite scope-key payload evidence. Public metadata temporal coherence, conflicting-subscription progress, generated closure and candidate states remain separate/open. No retrospective V3GREEN or next runtime is authorized. Independent root acceptance remains required.\n')
members=inventory(R)
write('packet-sha256-v1.json',{'format':'relative-path bytes SHA256; excludes this manifest only','status':'frozen exact V4 nonempty-scope finite payload result','members':len(members),'bytes':sum(v['bytes'] for v in members.values()),'files':members})
print(json.dumps({'directory':str(R),'members':len(members),'bytes':sum(v['bytes'] for v in members.values()),'manifestSha256':hashfile(R/'packet-sha256-v1.json'),'qualificationSha256':hashfile(R/'result-qualification-v1.json'),'reachSha256':hashfile(R/'reach-reconstruction-v1.json'),'receipts':176,'childFiles':len(before),'childBytes':sum(v['bytes'] for v in before.values())}))
