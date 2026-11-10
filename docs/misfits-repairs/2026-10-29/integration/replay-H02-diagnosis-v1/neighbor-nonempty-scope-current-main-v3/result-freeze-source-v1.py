import collections,datetime,hashlib,json,shutil
from pathlib import Path
W=Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-progress-main-v1')
H=Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1')
P=H/'prepared-neighbor-controls-v3';R=H/'neighbor-nonempty-scope-current-main-v3'
T=Path('/var/folders/zy/zxh2j5n97vq2tt8d8q7_1t5r0000gp/T/h02-progress-49739-8ac54aea-1c29-4636-b0b7-b0e05884c9b0')
sha=lambda b:hashlib.sha256(b).hexdigest()
hashfile=lambda p:sha(Path(p).read_bytes())
def write(name,v):
    with (R/name).open('x') as f:f.write(v if isinstance(v,str) else json.dumps(v,indent=2)+'\n')
def inventory(base):
    d={}
    for p in sorted(base.rglob('*')):
        assert not p.is_symlink(),p
        if p.is_file():d[str(p.relative_to(base))]={'bytes':p.stat().st_size,'sha256':hashfile(p)}
    return d
before=inventory(T);shutil.copytree(T,R/'receiving');after=inventory(T);copied=inventory(R/'receiving')
assert before==after==copied
write('actual-receiving-copy-verification-v1.json',{'originalDirectory':str(T),'canonicalOriginalDirectory':str(T.resolve()),'archiveDirectory':'receiving','members':len(before),'bytes':sum(v['bytes'] for v in before.values()),'allOriginalBytesMatchedBeforeAndAfterCopy':True,'files':before})
s=json.loads((T/'supervisor.json').read_text());o=s['outcome'];rows=[json.loads(x) for x in (T/'receipts.jsonl').read_text().splitlines()]
assert len(rows)==159 and [x['sequence'] for x in rows]==list(range(1,160))
assert all(x['h02'] is True for x in rows)
assert s['pid']==49741 and s['watchdogTrigger']=='observation' and s['latestGroupRows']==[]
assert o['reason']=='observation' and o['signal']=='SIGKILL' and o['primaryObservationError'].startswith('AssertionError: pending answer retains complete publication:')
assert o['bindingStatus']=='bound' and not o.get('bindingError')
assert s['heapDiagnosticDetected'] is False and not o['cleanupErrors'] and o['prefixViolations']==0 and o['warnings']==0
binding=json.loads((T/'binding-verification.json').read_text());assert binding['status']=='bound' and binding['receiptTransport']['count']==159
freeze=json.loads((P/'source-freeze-v3.json').read_text())
matched=0
for key in ['productionFiles','instrumentFiles','sharedInstrumentFiles']:
    for rel,digest in freeze[key].items():assert hashfile(W/rel)==digest,rel;matched+=1
write('source-identity-after-v1.json',{'mapEntries':matched,'allMatched':True,'productionIdentity':freeze['productionIdentity'],'sharedJudgmentSha256':freeze['exactSharedHelper']['sha256'],'limits':'Disk source map identity after run; actual receiving startup/binding inventory is archived separately.'})
for src,dest in [
 (H/'neighbor-nonempty-scope-current-main-v3-root-admission-v1.json','root-admission-v1.json'),
 (H/'neighbor-nonempty-scope-current-main-v3-root-process-absence-v1.json','root-process-absence-v1.json'),
 (P/'source-freeze-v3.json','source-freeze-v3.json'),
 (P/'launcher-nonempty-scope-v3.zsh','launcher-nonempty-scope-v3.zsh'),
 (H/'prepared-neighbor-controls-v3-independent-source-acceptance-v1.md','independent-source-acceptance-v1.md'),
 (H/'prepared-neighbor-controls-v3-independent-verification-v1.json','independent-source-verification-v1.json'),
 (Path('/private/tmp/h02-v3-scope-freeze.py'),'result-freeze-source-v1.py'),
]:shutil.copyfile(src,R/dest)
assert hashfile(R/'root-process-absence-v1.json')=='34ac660bb3466db4a41c9a88bd03cd652abea907701f9c8dadc3588e5c9e640e'
phaseCounts=dict(collections.Counter(x['phase'] for x in rows))
write('raw-receipt-inventory-v1.json',{'count':159,'contiguousSequences':True,'phaseCounts':phaseCounts,'file':'receiving/receipts.jsonl','sha256':hashfile(T/'receipts.jsonl'),'namedCuts':[x for x in rows if x['phase'] in ['initial-publication','reload-start','retained-publication','answer-queued','answer-executed','final-publication','cleanup-start','worker-cleaned']],'limits':'Raw recorded observations only. Declared oracle reaches/public judgments failed; later raw final-publication is not a passing checkpoint or cleanup evidence.'})
write('result-qualification-v1.json',{
 'status':'Observation/assertion instrument failure; no product classification, baseline GREEN or progress RED',
 'actualSelected':1,'nativeFailed':1,'nativeSkipped':4,'rawReceiptCount':159,
 'primaryCause':{'kind':'live observation callback assertion','diagnostic':o['primaryObservationError'],'lawCheckpoint':'pending answer retains complete publication','actualNonemptyRowFields':['id','rank','markers','$hasPendingWrites','$origin','$key','$collectionId'],'expectedModelRowFields':['id','rank','markers'],'classification':'Observation representation discrepancy needs independent contract/abstraction diagnosis; do not infer production defect from this assertion.'},
 'containment':{'reason':o['reason'],'watchdogTrigger':s['watchdogTrigger'],'killAttempted':s['killAttempted'],'childSignal':o['signal'],'childExitCode':o['exitCode'],'outerExitCode':1,'elapsedMs':s['elapsedMs'],'maxSampledGroupRssBytes':s['maxSampledGroupRssBytes'],'heapDiagnosticDetected':False,'remainingOriginalGroupRows':[],'cleanupErrors':o['cleanupErrors'],'originalOuterPid':49727,'originalOuterPgid':49727,'childPid':49741,'childOriginalPgid':49741,'rootIndependentPidAndPgidAbsenceReceiptSha256':hashfile(R/'root-process-absence-v1.json')},
 'binding':{'status':'bound','verificationFile':'receiving/binding-verification.json','startupSeal':'receiving/binding-seal.json','limits':'Bound actual receiving sources does not validate oracle row representation or the failed comparison.'},
 'reportedReach':{'nonempty-prior':0,'held-provider-read':0,'completed-enqueue':1,'answer-executed':1,'root-change':0,'downstream-change':0,'final-publication':0,'worker-cleaned':0},
 'rawLaterFacts':'Receipt159 final-publication was durably recorded before observation containment. No cleanup-start or worker-cleaned receipt exists. Raw final rows and metadata remain unchanged in the archive; no retrospective GREEN judgment.',
 'limits':'This consumed one admitted singleton. No retry, next runtime, source/model/grammar/comparison change, production edit or candidate activation is admitted. Prior ownership/V7/V2 archives retain their separate qualifications.'
})
write('handoff-v1.md','The admitted nonempty-scope singleton selected one actual test and failed its observation callback assertion. This result is an observation/assertion instrument failure with no product classification or baseline GREEN. The first failure diagnostic compares a nonempty full VirtualRow (id/rank/markers plus four virtual metadata fields) with the model\'s declared id/rank/markers row shape. Source/contract/abstraction diagnosis remains read-only.\n\nAll1943 original child files were copied with before/after byte verification. All159 raw receipts remain contiguous; later raw receipt159 records final-publication before containment, which is not a passed checkpoint. No cleanup-start/worker-cleaned receipt exists. The original primary callback error is separate from the resulting observation-trigger SIGKILL. No heap, prefix, warning or cleanup error was reported; source binding reports bound and all562 disk source entries match. Root independently observed original outer49727 and child49741 pid+pgid absent. No retry or next runtime is admitted.\n')
members=inventory(R)
write('packet-sha256-v1.json',{'format':'relative-path bytes SHA256; excludes this manifest only','status':'frozen observation/assertion instrument failure; no product classification','members':len(members),'bytes':sum(v['bytes'] for v in members.values()),'files':members})
print(json.dumps({'directory':str(R),'members':len(members),'bytes':sum(v['bytes'] for v in members.values()),'manifestSha256':hashfile(R/'packet-sha256-v1.json'),'qualificationSha256':hashfile(R/'result-qualification-v1.json'),'rawReceiptCount':len(rows),'childFiles':len(before),'childBytes':sum(v['bytes'] for v in before.values())}))
