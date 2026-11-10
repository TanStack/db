"""Static evidence audit only. Does not import/execute product, JS, or models."""
import collections, datetime, hashlib, json, pathlib, re
H=pathlib.Path(__file__).resolve().parent.parent
OUT=pathlib.Path(__file__).resolve().parent
I=H/'candidate-controls-remaining-baselines-inputs-v1'
R=I/'runtime-output-v1/inline-held-window'; N=R/'receiving-artifacts'
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
freeze=load(F); root=pathlib.Path(freeze['worktree']); result=load(I/'inline-held-window-result-freeze-v1.json')
result_count=filemap(I,result['files'],'result-freeze')
accepted={'recipe.json':'3c5a479f46ade8f48ba5fe07cc0035c3ee8743b481be783fca835ae11f879412','source-freeze.json':'aa5f26fac905f604b3a3d24f752b57bf9312e0de563cabf3a2e4a9672b49aeb3','baseline-program.json':'a4f1a52748536423af49b5f9c346128c64c95ea88f8fa9bbdaff384224aeca14'}
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
admission=I/'root-serial-batch-admission-v1.json';check(sha(admission)=='cdfed5d69ec3a3ec5cc6b105cffb54393d3a7f60a3c56b755c641eef5316c919','root batch admission')
for v in load(admission).values():
 if isinstance(v,dict) and 'path' in v and 'sha256' in v:check(sha(v['path'])==v['sha256'],'batch prerequisite '+v['path'])
raw=lines(N/'receipts.jsonl'); program=load(R/'baseline-program.json');boundaries=[x['boundaryEvent'] for x in raw if x['phase']=='completion-boundary']
check([x['sequence'] for x in raw]==list(range(1,445)),'raw444 sequence');check([x['sequence'] for x in boundaries]==list(range(1,len(boundaries)+1)),'boundary sequence')
check(raw[0]['phase']=='worker-start' and raw[0]['mode']=='baseline-constituent' and raw[0]['program']==program,'exact start program')
check([x['action'] for x in raw if x['phase']=='completion-baseline-action']==[x['action'] for x in program['steps'] if x['kind']=='semantic'],'exact four actions')
check([x['epoch'] for x in raw if x['phase']=='completion-baseline-epoch-start']==[x['id'] for x in program['publicationEpochs']],'exact epoch starts');check([x['epoch'] for x in raw if x['phase']=='completion-baseline-epoch-end']==[x['id'] for x in program['publicationEpochs']],'exact epoch ends')
active=None;deliveries=[]
for x in raw:
 if x['phase']=='completion-baseline-epoch-start':check(active is None,'overlap epoch');active=x['epoch']
 if x['phase']=='completion-baseline-epoch-end':check(active==x['epoch'],'wrong epoch end');active=None
 if x['phase']=='completion-baseline-delivery':
  check(active==x['epoch'],'unarmed callback');d=x['delivery'];check(d['rows']==d['read'],'callback/read agree');check(boundaries[x['capturedAt']-1]['boundary']==d['layer']+'-callback','exact captured boundary');deliveries.append(x)
 if x['phase'] in ['completion-baseline-view','completion-baseline-cut']:check(active is None,'cut outside epoch')
check(active is None and len(deliveries)==6,'epochs close/six deliveries');check(not any(x['epoch']=='1:held-window' for x in deliveries),'no held-window callback')
views=[x for x in raw if x['phase'] in ['completion-baseline-view','completion-baseline-cut']];check(len(views)==3,'three views')
for x,ids,ranks in zip(views,[[1,2],[1,2],[1,2,3]],[[10,10],[10,10],[10,10,20]]):
 v=x['view'];check(v['roots']==v['downstream'] and [r['id'] for r in v['roots']]==ids and [r['rank'] for r in v['roots']]==ranks and v['facades']==[] and v['requestErrors']==[] and v['status']=='ready','public view contents')
check(views[1]['boundary']=='held-window' and views[1]['view']['window']=={'offset':0,'limit':2} and views[1]['operations']==[{'operation':'window','returned':'promise','outcome':{'state':'pending'}}] and views[1]['pendingProviderAnswers']==1,'held prior window/real pending promise and provider')
check(views[2]['boundary']=='completed-window' and views[2]['view']['window']=={'offset':0,'limit':3} and views[2]['operations']==[{'operation':'window','returned':'promise','outcome':{'state':'fulfilled'}}],'completed chosen window and promise')
for x in deliveries:
 d=x['delivery'];ids=[r['id'] for r in d['rows']];check(ids==([1,2] if x['epoch']=='initialization' else [1,2,3]),'callback exact ids')
 if x['epoch']=='2:completed-window':check(d['changes']==[{'type':'insert','value':{'id':3,'rank':20,'children':[301,302]}}],'atomic insert third root')
settlements={(b['detail']['source'],b['detail']['load']):b for b in boundaries if b['boundary']=='source-load-applied-settled'}
providers={(b['detail']['source'],b['detail']['request']):b for b in boundaries if b['boundary']=='provider-request'}
answers={(b['detail']['source'],b['detail']['request']):b for b in boundaries if b['boundary']=='provider-answer-executed'}
release=[b for b in boundaries if b['boundary']=='baseline-source-answer-release'];applied=[b for b in boundaries if b['boundary']=='baseline-source-answer-applied'];proofs=[b for b in boundaries if b['boundary']=='baseline-source-answer-provenance'];check(len(release)==len(applied)==len(proofs)==1,'single release/applied/provenance')
for proof in proofs:
 d=proof['detail'];premises=program['sourceAnswerPremises'][d['requirement']];expected=sorted((p['source'],k) for p in premises for k in p['requiredKeys']);check(sorted((w['source'],w['key']) for w in d['witnesses'])==expected,'authored exact provenance domains')
 for w in d['witnesses']:
  request=providers[(w['source'],w['request'])];answer=answers[(w['source'],w['request'])];premise=next(p for p in premises if p['source']==w['source']);rd=request['detail'];ad=answer['detail'];check(request['sequence']<answer['sequence']<proof['sequence'] and w['key'] in rd['requested'] and set(rd['requested'])<=set(premise['permittedKeys']),'request/answer authored scope')
  if premise['since']=='answer-release':check(answer['sequence']>d['releasedAt'],'answer after exact release')
  for l in w['loads']:
   settled=settlements[(w['source'],l)];check(answer['sequence']<settled['sequence']<proof['sequence'] and settled['detail']['outcome']=={'state':'fulfilled'} and l==rd['initiatingLoad'],'exact request applied settlement')
  check(bool(w['loads']),'nonempty provenance loads')
  expectedrows=[x for x in program['changedFacts'][w['source']] if (x if isinstance(x,int) else x['id'] if w['source']=='roots' else x['parent'])==w['key']]
  actualrows=[x for x in ad['rows'] if (x['id'] if w['source']=='roots' else x['rowId'] if w['source']=='marked' else x['parent'])==w['key']]
  if w['source']=='marked':actualrows=[x['rowId'] for x in actualrows]
  check(actualrows==expectedrows,'actual provider facts match authored required domain')
for b in applied:
 for l in b['detail']['loads']:
  settled=settlements[(l['source'],l['load'])];check(settled['sequence']==l['settledAt']<b['sequence'] and settled['detail']['outcome']=={'state':'fulfilled'},'released demand exact applied before model credit')
semantic=next(x for x in raw if x['phase']=='completion-baseline-action' and x['action']['type']=='source-answer');proofraw=next(x for x in raw if x.get('boundaryEvent',{}).get('boundary')=='baseline-source-answer-provenance');check(proofraw['sequence']<semantic['sequence'],'provenance before source-answer model credit')
check(raw[-1]['phase']=='worker-cleaned' and sum(x['phase']=='worker-cleaned' for x in raw)==1,'one positive worker cleaned');check([x['boundary'] for x in boundaries[-3:]]==['cleanup-start','real-status-callback','cleanup-complete'],'positive cleanup boundaries')
check(not any(x['phase'] in ['warning','worker-error','completion-host-error','completion-worker-cleanup-failed'] for x in raw),'no errors')
stack=[]
for b in boundaries:
 if b['boundary']=='operator-enter':stack.append(b['detail'])
 if b['boundary']=='operator-return':check(bool(stack) and stack.pop()==b['detail'],'operator pair')
check(not stack,'operator stack empty')
so=load(N/'supervisor.json')['outcome'];outer=load(R/'outcome.json');check(so['reason']=='exited' and so['exitCode']==0 and so['signal'] is None and so['cleanupErrors']==[] and so['bindingStatus']=='bound' and not so.get('primaryObservationError'),'native completed cleanly')
check(result['actualOuterExitCode']==result['parentTestChildExitCode']==0 and outer['identityMatched'] and outer['remainingGroup']==outer['cleanupErrors']==0 and outer['signal'] is None and not outer['heap'] and outer['cleanupDiagnostics']==[],'outer complete/identity/cleanup')
absence=load(R/'executor-process-absence-v1.json');check(absence['psExitCode']==0 and absence['remainingNamedGroupRows']==[] and all(x['result']=='ESRCH' for x in absence['zeroSignalProbes']),'saved named-owned absence only')
check((R/'worker.stderr.log').read_bytes()==(N/'worker.stderr.log').read_bytes()==b'','empty stderr')
facts={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':'static evidence read/hash/JSON only; no product/JS/model/native execution or process probes','cell':'inline-held-window','resultFreezeSha256':sha(I/'inline-held-window-result-freeze-v1.json'),'rootBatchAdmissionSha256':sha(admission),'resultFiles':result_count,'sourceFiles':source_count,'payloadFiles':payload_count,'Node':1,'locks':2,'links':4,'v8CompiledBodies':len(scripts),'inventoryFacts':inventory_facts,'derivedBindingRows':len(derived),'requiredPrehistoryModules':len(required),'rawReceipts':len(raw),'boundaries':len(boundaries),'phaseCounts':dict(collections.Counter(x['phase'] for x in raw)),'boundaryCounts':dict(collections.Counter(x['boundary'] for x in boundaries)),'sourceReleaseAppliedAndProvenance':{'release':release,'applied':applied,'provenance':proofs},'actualToolCompletionChunk':result['actualToolCompletionChunk'],'errors':errors,'allChecksPass':not errors,'candidateRaw20':'all UNREACHED','state14':'proposed; not adopted','actualHelperNoActiveOperation':'required and UNREACHED','parentProofBoundary':'on-disk identity plus successful exact test/control-flow inference; no parent V8 binding','runtimeExecutions':0}
p=OUT/'inline-held-window-actual-independent-facts-v1.json';p.write_text(json.dumps(facts,indent=2)+'\n');print(json.dumps({'artifact':str(p),'sha256':sha(p),'errors':errors,'resultFiles':result_count,'v8Bodies':len(scripts),'bindings':len(derived),'raw':len(raw),'boundaries':len(boundaries)}))
