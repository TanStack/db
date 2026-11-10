import collections,hashlib,json,shutil
from pathlib import Path
W=Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-progress-main-v1')
H=Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1')
P=H/'prepared-neighbor-controls-v4';R=H/'neighbor-nonempty-conflict-current-main-v4'
T=Path('/var/folders/zy/zxh2j5n97vq2tt8d8q7_1t5r0000gp/T/h02-progress-11701-6f0e34c7-6dc3-45ba-b081-0ed38e8294fa')
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
assert len(a)==70961 and [x['sequence'] for x in a]==list(range(1,70962)) and all(x['h02'] is True for x in a)
byseq={x['sequence']:x for x in a};history=json.loads((T/'history.json').read_text());expectedHistory=json.loads((H/'neighbor-nonempty-conflict-current-main-v4-root-admission-v1.json').read_text())['actualHistoryRequired'];assert history==expectedHistory and a[0]['history']==history
assert s['pid']==11702 and s['killAttempted'] is True and s['watchdogTrigger']=='post-enqueue-window' and not s['latestGroupRows'] and not s['heapDiagnosticDetected']
assert o['reason']=='wall' and o['exitCode'] is None and o['signal']=='SIGKILL' and o['bindingStatus']=='bound'
assert not o.get('primaryObservationError') and not o.get('bindingError') and not o['cleanupErrors'] and o['prefixViolations']==0 and o['warnings']==0
assert s['maxSampledGroupRssBytes']==691273728 and s['maxSampledGroupRssBytes']<1024**3
assert (T/'worker.stderr.log').read_bytes()==b''
phases=collections.Counter(x['phase'] for x in a)
assert phases['conflicting-cache-premise']==phases['answer-queued']==1
assert all(phases[k]==0 for k in ['answer-executed','final-publication','cleanup-start','worker-cleaned','worker-error','warning'])
premise=byseq[182];queued=byseq[184];assert premise['phase']=='conflicting-cache-premise' and queued['phase']=='answer-queued'
assert queued['kind']=='resolving-conflict' and queued['enqueueReturned'] is True and queued['scheduler']==history['scheduler']
assert queued['atom']==premise['pendingAtom'] and queued['key']==premise['pendingKey']
assert queued['cachedVersion']==premise['cached']['version'] and queued['emptyVersion']==premise['emptySibling']['answer']['version']
observed=premise['observed']
assert observed['pending'] is True and observed['aborted'] is False and observed['physicalQueriesCurrent'] is True
assert observed['pendingPhysicalQuery']==observed['currentPhysicalQuery'] and observed['siblingPhysicalQuery']==observed['siblingAnswerPhysicalQuery'] and observed['pendingPhysicalQuery']!=observed['siblingPhysicalQuery']
assert observed['pendingStatus']=='success' and observed['pendingFetchStatus']=='fetching' and observed['siblingStatus']=='success'
assert observed['pendingScope']==observed['siblingScope']==[premise['pivot']] and observed['pendingOwner']!=observed['siblingOwner']
assert observed['pendingActualCount']==observed['pendingStartCount'] and observed['siblingActualCount']>observed['siblingStartCount']
assert premise['cached']['backendVersion']==0 and premise['cached']['rows']==[premise['pivot']]
assert premise['emptySibling']['answer']['backendVersion']==1 and premise['emptySibling']['answer']['rows']==observed['siblingRows']==[]
post=s['postEnqueue'];assert post['conflictSequence']==182 and post['queuedSequence']==184 and post['receiptCount']==70961 and post['lastSequence']==70961 and post['postEnqueueWindowMs']==1000
assert 'executedSequence' not in post
binding=json.loads((T/'binding-verification.json').read_text());assert binding['status']=='bound' and not binding['failures'] and binding['receiptTransport']['count']==70961
seal=json.loads((T/'binding-seal.json').read_text());assert all(seal[k] is True for k in ['sealed','skipAllPausesAcknowledged','debuggerDisableAcknowledged','inspectorDisconnectedBeforeHistory'])
outer=(R/'outer-vitest.log').read_text();assert 'Tests  1 failed | 4 skipped (5)' in outer and 'bounded queued-answer progress failure after reached premise:' in outer and "name: 'nonempty conflicting replay'" in outer
prior=[{'id':4,'rank':40,'markers':[]}];project=lambda rows:[{k:row[k] for k in ['id','rank','markers']} for row in rows]
assert byseq[108]['phase']=='initial-publication' and project(byseq[108]['rows'])==prior
assert byseq[164]['phase']=='retained-publication' and byseq[164]['reason']=='provider-hold-before-release' and byseq[164]['pendingProviderAnswers']==4 and project(byseq[164]['rows'])==project(byseq[164]['downstream'])==prior
assert byseq[183]['phase']=='retained-publication' and project(byseq[183]['rows'])==prior
reaches={'nonempty-prior':[108],'held-provider-read':[164],'conflicting-cache-premise':[182],'completed-enqueue':[184],'answer-executed':[],'final-publication':[],'worker-cleaned':[]}
write('bounded-progress-gate-v1.json',{'status':'All admitted finite bounded-progress RED gate conditions met; independent root acceptance pending','history':history,'measuredConflict':premise,'exactCompletedResolvingEnqueue':queued,'ordering':{'conflictSequence':182,'completedEnqueueSequence':184,'lastFinalDrainSequence':70961,'receiptsAfterCompletedEnqueue':70961-184},'executionObservation':{'answerExecutedReceipts':0,'finalDrainCompleteContiguousCount':70961,'matchingAndOtherExecutionAbsent':True},'firstContainment':{'watchdogTrigger':s['watchdogTrigger'],'reason':o['reason'],'configuredWindowMs':1000,'postEnqueue':post,'firstTriggerPersistence':'Frozen supervisor kill() sets watchdogTrigger only before first killAttempted; later calls cannot replace it. Final supervisor preserves that first trigger. No separate transient before-kill snapshot was retained by this supervisor; final scalar/raw evidence and frozen source define this qualification.'},'excludedFailureChecks':{'heap':False,'rssExceeded':False,'observationError':None,'bindingError':None,'recordingFailure':False,'stderrBytes':0,'cleanupErrors':[],'remainingOriginalGroupRows':[]},'bindingStatus':'bound','limits':'Finite observed non-execution during admitted post-enqueue window, not infinite execution or a numerical product deadline. Forced termination does not establish direct adapter cleanup or final publication. No broader contract closure.'})
write('reach-and-retention-v1.json',{'sourceDeclaredStates':list(reaches),'counts':{k:len(v) for k,v in reaches.items()},'receiptSequences':reaches,'heldProviderAnswers':4,'priorPayload':prior,'retentionReceipts':[byseq[108],byseq[164],byseq[183]],'liveComparisonEvidence':'No primary observation error; V4 validating payload/shared publication checks accepted every reached root snapshot and held downstream comparison before the bounded progress error. Original raw metadata remains in every record.','limits':'Only four of seven finite states reached; final publication and driver cleanup are unestablished. No reload event after initial publication is claimed. Temporal metadata coherence remains separately open.'})
f=json.loads((P/'source-freeze-v4.json').read_text());sources=0;payloads=0
for key in ['productionFiles','instrumentFiles','sharedInstrumentFiles']:
    for rel,digest in f[key].items():assert hashfile(W/rel)==digest,rel;sources+=1
for pkg in f['packages'].values():
    for rel,digest in pkg['regularPayloadFilesMap'].items():assert hashfile(Path(pkg['resolved'])/rel)==digest;payloads+=1
assert hashfile(f['node']['executable'])==f['node']['sha256'] and hashfile(W/'pnpm-lock.yaml')==f['lockfiles']['repoPnpmLock'] and hashfile(W/'node_modules/.pnpm/lock.yaml')==f['lockfiles']['installedPnpmLock']
for rel,row in f['dependencyReuseLinks'].items():assert (W/rel).is_symlink()==row['isSymlink'] and str((W/rel).resolve())==row['resolved']
write('source-identity-after-v1.json',{'sourceMapEntries':sources,'namedPackagePayloadFiles':payloads,'allMatched':True,'nodeLocksAndReuseLinksMatched':True,'productionIdentity':f['productionIdentity'],'sharedJudgmentSha256':f['exactSharedHelper']['sha256'],'limits':'Disk identity before/after is separate from retained actual compiled/evaluated/V8 binding inventories.'})
for src,dest in [
 (H/'neighbor-nonempty-conflict-current-main-v4-root-admission-v1.json','root-admission-v1.json'),
 (H/'neighbor-nonempty-conflict-current-main-v4-root-process-absence-v1.json','root-process-absence-v1.json'),
 (P/'source-freeze-v4.json','source-freeze-v4.json'),
 (P/'launcher-nonempty-conflict-v4.zsh','launcher-nonempty-conflict-v4.zsh'),
 (H/'prepared-neighbor-controls-v4-independent-source-acceptance-v1.md','independent-source-acceptance-v1.md'),
 (H/'prepared-neighbor-controls-v4-independent-verification-v1.json','independent-source-verification-v1.json'),
 (Path('/private/tmp/h02-v4-conflict-freeze.py'),'result-freeze-source-v1.py'),
]:shutil.copyfile(src,R/dest)
assert hashfile(R/'root-process-absence-v1.json')=='05a891e582a8d6f50f12e0c29c313fb7df82f230fc632e5bcc227e39b2b6bb5a'
write('result-qualification-v1.json',{'status':'Qualified finite bounded queued-answer progress RED under exact admitted gate; independent root result acceptance pending','finiteHistories':1,'nativeFailed':1,'nativeSkipped':4,'capturedNativeName':'queued-answer receiving neighbors > checks receiving neighbor \'nonempty conflicting replay\'','actualHistory':history,'rawReceiptCount':70961,'partialReachCounts':{k:len(v) for k,v in reaches.items()},'measuredConflictSequence':182,'completedResolvingEnqueueSequence':184,'matchingExecutionThroughFinalDrain':False,'firstKillTrigger':'post-enqueue-window','reason':'wall','bindingStatus':'bound','bindings':len(binding['bindings']),'bindingLimits':binding['limits'],'operational':{'outerExitCode':1,'childSignal':'SIGKILL','childExitCode':None,'heap':False,'observationError':None,'cleanupErrors':[],'remainingGroupRows':[],'elapsedMs':s['elapsedMs'],'maxSampledGroupRssBytes':s['maxSampledGroupRssBytes'],'outerPid':11686,'outerPgid':11686,'childPid':11702,'childOriginalPgid':11702,'rootAbsenceReceiptSha256':hashfile(R/'root-process-absence-v1.json')},'sourceIdentityBeforeAndAfter':{'sources':sources,'packagePayloads':payloads,'nodeLocksAndLinksMatched':True},'limits':'Finite admitted non-execution witness, not proof of infinite execution or product deadline. Direct adapter cleanup/final publication not reached. Metadata temporal coherence, broader histories, candidate20states and other receiving controls remain separate. No retry, later recipe, source or production edit admitted.'})
write('handoff-v1.md','The exact admitted V4 nonempty-conflict singleton produced the intended bounded progress failure. Actual nonempty prior and held provider reads passed payload retention comparisons. Measured physical-Query conflict182 precedes exact completed resolving enqueue184; no answer-executed receipt exists through complete final drain70961. First containment trigger is post-enqueue-window and reason wall. Binding reports bound; no heap/RSS/observation/recording/setup/binding/cleanup failure; original group empty and root independently observed original outer11686/child11702 pid+pgid absent. All563source entries/2544package payloads/Node/locks/links match before and after.\n\nThe1944original child files and all70961rawreceipts are copied with before/after identity. Partial reaches nonempty, held, conflict and completed enqueue each1; execution, final-publication and worker-cleaned each0. Full raw public metadata is preserved. Startup/driver/premise inventories and raw compiled-source evidence remain with their stated limits. No separate transient first-kill snapshot was retained; final supervisor preserves its source-sticky first trigger.\n\nThis is finite bounded non-execution evidence under the accepted admission gate, not proof of infinity or a numeric product deadline. Forced containment establishes no direct adapter cleanup or final publication. Independent root acceptance remains required. No next recipe, retry, candidate or source/production change is admitted.\n')
members=inventory(R)
write('packet-sha256-v1.json',{'format':'relative-path bytes SHA256; excludes this manifest only','status':'frozen exact V4 nonempty-conflict bounded progress RED witness','members':len(members),'bytes':sum(v['bytes'] for v in members.values()),'files':members})
print(json.dumps({'directory':str(R),'members':len(members),'bytes':sum(v['bytes'] for v in members.values()),'manifestSha256':hashfile(R/'packet-sha256-v1.json'),'qualificationSha256':hashfile(R/'result-qualification-v1.json'),'gateSha256':hashfile(R/'bounded-progress-gate-v1.json'),'receipts':len(a),'childFiles':len(before),'childBytes':sum(v['bytes'] for v in before.values())}))
