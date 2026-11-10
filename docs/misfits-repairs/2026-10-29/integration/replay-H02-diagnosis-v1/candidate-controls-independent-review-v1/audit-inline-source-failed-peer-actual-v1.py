"""Static evidence audit only. Does not import/execute product, JS, or models."""
import collections, datetime, hashlib, json, pathlib, re
H=pathlib.Path(__file__).resolve().parent.parent
OUT=pathlib.Path(__file__).resolve().parent
I=H/'candidate-controls-remaining-baselines-inputs-v1'
R=I/'runtime-output-v1/inline-source-failed-peer'; N=R/'receiving-artifacts'
F=H/'candidate-controls-combined-source-v3/source-freeze-v3.json'
def sha(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def load(p): return json.loads(pathlib.Path(p).read_text())
def lines(p): return [json.loads(x) for x in pathlib.Path(p).read_text().splitlines() if x]
errors=[]
def check(ok, message):
    if not ok: errors.append(message)
def filemap(base, entries, label):
    for p,e in entries.items():
        try: check(sha(pathlib.Path(base)/p)==e, f'{label}: {p}')
        except OSError as e: errors.append(f'{label}: {p}: {e}')
    return len(entries)
freeze=load(F); root=pathlib.Path(freeze['worktree']); result=load(I/'inline-source-failed-peer-result-freeze-v1.json')
result_count=filemap(I,result['files'],'result-freeze')
accepted={'recipe.json':'6a9ed9c54037bea6067dd707c2b17ac79b958bf6d66bad403cb8e94d2d6964a0','source-freeze.json':'aa5f26fac905f604b3a3d24f752b57bf9312e0de563cabf3a2e4a9672b49aeb3','baseline-program.json':'c5eef9f5c5bdce78790002f0a753684c6dfb3e42fb4b68f0b0b7d5fcbd07e9e7'}
filemap(R,accepted,'accepted-snapshots')
source_map=freeze['productionFiles']|freeze['instrumentFiles']|freeze['sharedInstrumentFiles']
source_count=filemap(root,source_map,'current-source'); payload_count=0
for p in freeze['packages'].values(): payload_count+=filemap(p['resolved'],p['regularPayloadFilesMap'],'dependency-payload')
check(sha(freeze['node']['executable'])==freeze['node']['sha256'],'selected-Node')
check(sha(root/'pnpm-lock.yaml')==freeze['lockfiles']['repoPnpmLock'],'repo-lock')
check(sha(root/'node_modules/.pnpm/lock.yaml')==freeze['lockfiles']['installedPnpmLock'],'installed-lock')
for p,m in freeze['dependencyReuseLinks'].items():
    q=root/p; check(q.is_symlink()==m['isSymlink'] and str(q.resolve())==m['resolved'],f'reuse-link: {p}')
v8=lines(N/'v8-binding.jsonl'); scripts=[x for x in v8 if x['phase']=='v8-compiled-script']
for x in scripts: check(sha(N/'v8-sources'/f"{x['sourceSha256']}.txt")==x['sourceSha256'],f"V8 body {x['scriptId']}")
ack=[x for x in v8 if x['phase']=='inspector-ack']; check([x['method'] for x in ack]==['Debugger.setSkipAllPauses','Debugger.enable','Debugger.disable'],'ack ordering')
check(all('error' not in x for x in ack),'ack errors')
skip=next(j for j,x in enumerate(v8) if x['phase']=='inspector-ack'); disable=next(j for j,x in enumerate(v8) if x.get('method')=='Debugger.disable'); disconnect=next(j for j,x in enumerate(v8) if x['phase']=='inspector-disconnected-before-history')
check(disconnect>disable and all(skip<j<disable for j,x in enumerate(v8) if x['phase']=='v8-compiled-script'),'compiler/disable/disconnect order')
seal=load(N/'binding-seal.json'); check(seal['selectedRoot']==str(root) and all(seal[k] is True for k in ['sealed','skipAllPausesAcknowledged','debuggerDisableAcknowledged','inspectorDisconnectedBeforeHistory']),'seal values')
check(seal['inventorySha256']==sha(N/'evaluated-pre-history.json'),'seal inventory hash')
check(not any(x['phase']=='v8-source-error' for x in v8),'V8 source error')
approved=freeze['instrumentFiles']|freeze['sharedInstrumentFiles']; derived=[]; inventory_facts={}
for name in ['evaluated-pre-history.json','evaluated-after-all.json']:
    inventory=load(N/name); check(inventory['selectedRoot']==str(root),f'inventory root {name}'); selected=0; ext=0
    for m in inventory['inventory']:
        file=m.get('file','').split('?')[0]; rel=file[len(str(root))+1:] if file.startswith(str(root)+'/') else None
        package=bool(re.search(r'/packages/(?:db|db-ivm|query-db-collection)/',file or m['id'])); prod=bool(re.search(r'/packages/(?:db|db-ivm|query-db-collection)/src/',file)); inst=rel in approved; im='/scripts/h02-progress/' in (file or m['id'])
        if not (package or inst or im): ext+=1; continue
        selected+=1; check(rel is not None and (prod or inst),f'unapproved module {file}')
        expected=freeze['receivingProductionFiles'].get(rel) if prod else approved.get(rel)
        check(expected is not None and m.get('sourceSha256')==expected,f'original module bytes {name}: {rel}')
        code=m.get('codeSha256'); check(bool(code),f'no loader {rel}')
        if not code: continue
        loader=(N/'evaluated-sources'/f'{code}.txt').read_text(); check(hashlib.sha256(loader.encode()).hexdigest()==code,f'loader {rel}')
        matches=[]
        for x in scripts:
            if x['url'] not in [file,'file://'+file,m['url']]: continue
            body=(N/'v8-sources'/f"{x['sourceSha256']}.txt").read_text()
            if loader in body: matches.append({k:x[k] for k in ['scriptId','sourceSha256']})
        check(bool(matches),f'no exact loader-to-V8 match {rel}')
        sealed=[s for s in seal['bindings'] if s['file']==file and s['codeSha256']==code]
        check(len(sealed)==1 and any(s in sealed[0]['scripts'] for s in matches),f'no exact sealed match {rel}')
        derived.append({'inventory':name,'relative':rel,'kind':'production' if prod else 'instrument','evaluated':m.get('evaluated') is True,'codeSha256':code,'scripts':matches})
    inventory_facts[name]={'allModules':len(inventory['inventory']),'selectedModules':selected,'externalOrNonselected':ext,'sha256':sha(N/name)}
actual=load(N/'binding-verification.json')
sortkey=lambda x:(x['inventory'],x['relative'])
check(sorted(derived,key=sortkey)==sorted(actual['bindings'],key=sortkey),'derived 338 binding rows differ from verifier output')
check(actual['status']=='bound' and actual['bindingProfile']=='completion-baseline-v1' and actual['failures']==[],'binding verdict')
verifier=(root/'scripts/h02-progress/verify-bindings.mjs').read_text(); required=re.findall(r'`([^`]+)`',verifier.split('const completionInstruments = [',1)[1].split(']',1)[0])+['packages/db/src/index.ts','packages/db-ivm/src/index.ts','packages/query-db-collection/src/query.ts']
check(len(required)==20,'17+3 required modules')
for r in required: check(any(x['inventory']=='evaluated-pre-history.json' and x['relative']==r and x['evaluated'] for x in derived),f'required prehistory evaluated {r}')
raw=lines(N/'receipts.jsonl');program=load(R/'baseline-program.json');boundaries=[x['boundaryEvent'] for x in raw if x['phase']=='completion-boundary']
check(sha(I/'inline-source-failed-peer-result-freeze-v1.json')=='029a8eb1cf46e59d84cdf6d52cb7f56837b962b829922672e76630df26b49957','failed exact freeze')
check([x['sequence'] for x in raw]==list(range(1,299)),'298 raw sequence');check([x['sequence'] for x in boundaries]==list(range(1,283)),'282 boundary sequence');check(raw[0]['program']==program,'exact authored input program')
cut=next(x for x in raw if x['phase']=='completion-baseline-cut');check(cut['sequence']==207 and cut['boundary']=='held-window' and cut['pendingProviderAnswers']==0,'primary cut missing held-provider premise');check(cut['operations']==[{'operation':'window','returned':'promise','outcome':{'state':'pending'}}],'original window promise genuinely pending')
check(cut['view']['roots']==cut['view']['downstream'] and [x['id'] for x in cut['view']['roots']]==[1,2] and [x['rank'] for x in cut['view']['roots']]==[10,20] and cut['view']['window']=={'offset':0,'limit':2} and cut['view']['requestErrors']==[],'prior complete public window preserved')
actions=[x for x in raw if x['phase']=='completion-baseline-action'];check([x['action'] for x in actions]==[x['action'] for x in program['steps'] if x['kind']=='semantic'][:3],'only first three exact actions reached')
workererrors=[x for x in raw if x['phase']=='worker-error'];check(len(workererrors)==1 and workererrors[0]['sequence']==298 and 'actual held provider answers' in workererrors[0]['message'],'primary worker error')
cleanupstart=next(x for x in raw if x.get('boundaryEvent',{}).get('boundary')=='cleanup-start');cleanupdone=next(x for x in raw if x.get('boundaryEvent',{}).get('boundary')=='cleanup-complete');check(cleanupstart['sequence']==208 and cleanupdone['sequence']==296 and raw[-2]['phase']=='worker-cleaned','positive fixture cleanup before worker rethrow')
rootsanswer=next(x for x in raw if x.get('boundaryEvent',{}).get('boundary')=='provider-answer-executed' and x['boundaryEvent']['detail']['source']=='roots' and x['boundaryEvent']['detail']['request']==3);check(rootsanswer['sequence']==198<cut['sequence'],'root finite answer ran before premature cut')
held=[]
for source in ['marked','children']:
 x=next(x for x in raw if x.get('boundaryEvent',{}).get('boundary')=='provider-request' and x['boundaryEvent']['detail']['source']==source and x['boundaryEvent']['detail']['requested']==[3]);check(x['sequence']>cleanupstart['sequence'],'selected child demand only during teardown '+source);check(not any(y.get('boundaryEvent',{}).get('boundary') in ['provider-answer-executed','provider-answer-failed'] and y['boundaryEvent']['detail']['source']==source and y['boundaryEvent']['detail']['request']==x['boundaryEvent']['detail']['request'] for y in raw),'held selected request never answered '+source);held.append(x)
check([x['sequence'] for x in held]==[216,244],'exact delayed held scopes')
check(not any(x.get('boundaryEvent',{}).get('boundary') in ['baseline-source-failure-applied','baseline-source-answer-release','baseline-source-answer-provenance'] for x in raw),'failure/recovery premises unexercised')
supervisor=load(N/'supervisor.json');so=supervisor['outcome'];outer=load(R/'outcome.json');check(so['reason']=='observation' and so['exitCode']==1 and so['signal'] is None and 'actual held provider answers' in so['primaryObservationError'] and so['bindingStatus']=='bound','parent independent comparison reports same premise')
check(supervisor['killAttempted'] is True and supervisor['watchdogTrigger']=='observation' and so['cleanupErrors']==['Error: kill EPERM'],'secondary supervisor group kill denial retained')
check(result['actualOuterExitCode']==result['parentTestChildExitCode']==1 and outer['identityMatched'] and outer['remainingGroup']==outer['cleanupErrors']==0 and outer['signal'] is None and not outer['heap'],'outer returned and owned cleanup verified')
absence=load(R/'executor-process-absence-v1.json');check(absence['psExitCode']==0 and absence['remainingNamedGroupRows']==[] and all(x['result']=='ESRCH' for x in absence['zeroSignalProbes']),'saved owned/named absence')
check(not any(x['phase']=='completion-host-error' for x in raw),'no injected source failure/host error reached')
facts={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':'static immutable-result/source/hash/JSON read only; no product/JS/model/native or process probe','classification':'fixture premise/checkpoint failure; no product RED/GREEN','resultFreezeSha256':sha(I/'inline-source-failed-peer-result-freeze-v1.json'),'resultFiles':result_count,'currentSourceFiles':source_count,'payloadFiles':payload_count,'Node':1,'locks':2,'links':4,'v8CompiledBodies':len(scripts),'inventoryFacts':inventory_facts,'derivedBindingRows':len(derived),'requiredPrehistoryModules':len(required),'rawReceipts':len(raw),'boundaries':len(boundaries),'phaseCounts':dict(collections.Counter(x['phase'] for x in raw)),'heldCut':cut,'rootAnswerBeforeCut':rootsanswer,'cleanupStart':cleanupstart,'delayedHeldRequestsDuringTeardown':held,'cleanupComplete':cleanupdone,'workerError':workererrors[0],'nativeSupervisorOutcome':{k:v for k,v in so.items() if k!='receipts'},'outerOutcome':outer,'actualToolCompletionChunk':result['actualToolCompletionChunk'],'savedProcessAbsence':absence,'sourceRepairProposal':'source-failed-peer request-window path waits using existing hostTurn/waitFor until BOTH exact selected failure and peer requests exist with live original promise receipts; retain held/source-failed-peer/model/publication ownership assertions','legalCacheLimit':'an implementation can lawfully answer from cache or batch scopes differently; absent exact fixture requests remain unsupported/unreached, never an obligation to fetch','cleanupEPERMLimit':'secondary native supervisor group-kill denial is real, not erased by successful fixture cleanup or outer owned absence; OS cause and failure-path containment not established','errors':errors,'allAuditChecksPass':not errors,'candidateRaw20':'all UNREACHED','state14':'proposed; not adopted','actualHelperNoActiveOperation':'required and UNREACHED','runtimeExecutions':0}
p=OUT/'inline-source-failed-peer-actual-independent-facts-v1.json';p.write_text(json.dumps(facts,indent=2)+'\n');print(json.dumps({'artifact':str(p),'sha256':sha(p),'errors':errors,'files':result_count,'v8':len(scripts),'bindings':len(derived),'raw':len(raw)}))
