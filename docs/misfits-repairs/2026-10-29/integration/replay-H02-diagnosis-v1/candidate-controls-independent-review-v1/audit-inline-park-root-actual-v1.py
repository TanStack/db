"""Static evidence audit only. Does not import/execute product, JS, or models."""
import collections, datetime, hashlib, json, pathlib, re
H=pathlib.Path(__file__).resolve().parent.parent
OUT=pathlib.Path(__file__).resolve().parent
I=H/'candidate-controls-inline-park-root-successor-v1'
R=I/'runtime-output-v1/inline-park-root'; N=R/'receiving-artifacts'
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
freeze=load(F); root=pathlib.Path(freeze['worktree']); result=load(I/'inline-park-root-result-freeze-v1.json')
result_count=filemap(I,result['files'],'result-freeze')
accepted={'recipe.json':'75c504604c01c690dda2794de17a12691f598d200bc8dc3368826692c65fa10c','source-freeze.json':'aa5f26fac905f604b3a3d24f752b57bf9312e0de563cabf3a2e4a9672b49aeb3','baseline-program.json':'947022590b784aa2cf2783ee08a03053ef407da9f4e34beb15190dbf5c335664'}
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
raw=lines(N/'receipts.jsonl'); program=load(R/'baseline-program.json'); boundaries=[x['boundaryEvent'] for x in raw if x['phase']=='completion-boundary']
check([x['sequence'] for x in raw]==list(range(1,329)),'raw sequence'); check([x['sequence'] for x in boundaries]==list(range(1,304)),'boundary sequence')
check(raw[0]['phase']=='worker-start' and raw[0]['mode']=='baseline-constituent' and raw[0]['program']==program,'start program')
check([x['action'] for x in raw if x['phase']=='completion-baseline-action']==[x['action'] for x in program['steps'] if x['kind']=='semantic'],'exact actions')
check([x['boundary'] for x in raw if x['phase']=='completion-baseline-cut']==['held-output','public-state'],'cut order')
check([x['epoch'] for x in raw if x['phase']=='completion-baseline-epoch-start']==[x['id'] for x in program['publicationEpochs']],'epoch starts')
check([x['epoch'] for x in raw if x['phase']=='completion-baseline-epoch-end']==[x['id'] for x in program['publicationEpochs']],'epoch ends')
active=None; deliveries=[]
for x in raw:
    if x['phase']=='completion-baseline-epoch-start': check(active is None,'overlap epoch'); active=x['epoch']
    if x['phase']=='completion-baseline-epoch-end': check(active==x['epoch'],'wrong epoch end');active=None
    if x['phase']=='completion-baseline-delivery':
        check(active==x['epoch'],'unarmed delivery'); d=x['delivery'];check(d['rows']==d['read'],'callback/read mismatch'); b=boundaries[x['capturedAt']-1];check(b['boundary']==d['layer']+'-callback','captured callback boundary');deliveries.append(x)
    if x['phase'] in ['completion-baseline-view','completion-baseline-cut']: check(active is None,'cut inside epoch')
check(active is None,'open final epoch')
check(len(deliveries)==8,'delivery count')
for x in deliveries:
    d=x['delivery']; expected={'initialization':[10,10],'1:held-output':[9.9,10],'2:public-state':[11,11]}[x['epoch']]
    check([r['id'] for r in d['rows']]==[1,2] and [r['rank'] for r in d['rows']]==expected,'delivery rows/ranks')
    check([r['children'] for r in d['rows']]==[[101,102],[201,202]],'delivery child scope')
    if x['epoch']=='2:public-state':check(len(d['changes'])==2 and [c['previousValue']['rank'] for c in d['changes']]==[9.9,10] and all(c['type']=='update' for c in d['changes']),'settled atomic payload')
views=[x for x in raw if x['phase'] in ['completion-baseline-view','completion-baseline-cut']]
for x,expected in zip(views,[[10,10],[9.9,10],[11,11]]):
    v=x['view'];check(v['roots']==v['downstream'] and [r['rank'] for r in v['roots']]==expected and v['facades']==[] and v['window']=={'offset':0,'limit':2} and v['status']=='ready' and v['requestErrors']==[],'initial/held/settled public view')
check(views[1]['receipts']==[{'requirement':'selected','target':'root','role':'forward','returnedPromise':True,'pending':True}],'held real output receipt')
check(views[1]['operations']==[] and views[2]['operations']==[],'operations at cuts')
check(raw[-1]['phase']=='worker-cleaned' and sum(x['phase']=='worker-cleaned' for x in raw)==1,'positive worker cleaned')
check([x['boundary'] for x in boundaries[-3:]]==['cleanup-start','real-status-callback','cleanup-complete'],'positive cleanup boundaries')
check(not any(x['phase'] in ['warning','worker-error','completion-host-error','completion-worker-cleanup-failed'] for x in raw),'no raw errors')
stack=[]
for x in boundaries:
    if x['boundary']=='operator-enter': stack.append(x['detail'])
    if x['boundary']=='operator-return':check(bool(stack) and stack.pop()==x['detail'],'operator pair')
check(stack==[],'unreturned operator')
supervisor=load(N/'supervisor.json'); so=supervisor['outcome']; check(so['reason']=='exited' and so['exitCode']==0 and so['signal'] is None and so['cleanupErrors']==[] and so['bindingStatus']=='bound' and not so.get('primaryObservationError'),'receiving outcome')
outer=load(R/'outcome.json'); check(result['actualOuterExitCode']==0 and result['parentTestChildExitCode']==0 and outer['identityMatched'] and outer['remainingGroup']==0 and outer['cleanupErrors']==0,'outer result/identity/cleanup')
check((R/'worker.stderr.log').read_bytes()==b'' and (N/'worker.stderr.log').read_bytes()==b'','empty stderr')
facts={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':'static read/hash/JSON and source-control-flow audit; no JS, product, models, process probes, Git, or runtime execution','resultFreezeSha256':sha(I/'inline-park-root-result-freeze-v1.json'),'checkedResultFiles':result_count,'checkedCurrentSources':source_count,'checkedPayloadFiles':payload_count,'checkedNode':1,'checkedLocks':2,'checkedReuseLinks':4,'v8CompiledBodies':len(scripts),'v8PhaseCounts':dict(collections.Counter(x['phase'] for x in v8)),'inventories':inventory_facts,'derivedBindingRows':len(derived),'bindingKindCounts':dict(collections.Counter(x['kind'] for x in derived)),'prehistoryRequiredModules':len(required),'rawReceiptCount':len(raw),'rawPhaseCounts':dict(collections.Counter(x['phase'] for x in raw)),'boundaryCount':len(boundaries),'boundaryCounts':dict(collections.Counter(x['boundary'] for x in boundaries)),'exactActions':len([x for x in raw if x['phase']=='completion-baseline-action']),'publicationEpochs':3,'publicDeliveries':8,'publicCuts':2,'fixtureEstablishments':sum(x['boundary']=='fixture-established' for x in boundaries),'sourceAnswerPremises':program['sourceAnswerPremises'],'parentBindingLimit':'on-disk source identity only; actual successful parent test exit and frozen test control flow support invocation inference, not parent V8 source binding','errors':errors,'allChecksPass':not errors,'candidateRaw20':'all UNREACHED; no candidate reach inferred','state14':'proposed mapping; not adopted','noActiveOperationNeighbor':'required and UNREACHED','newRuntimeRuns':0}
p=OUT/'inline-park-root-actual-independent-facts-v1.json';p.write_text(json.dumps(facts,indent=2)+'\n');print(json.dumps({'facts':str(p),'sha256':sha(p),'errors':errors,'counts':{k:facts[k] for k in ['checkedResultFiles','checkedCurrentSources','checkedPayloadFiles','v8CompiledBodies','derivedBindingRows','rawReceiptCount','boundaryCount']}}))
