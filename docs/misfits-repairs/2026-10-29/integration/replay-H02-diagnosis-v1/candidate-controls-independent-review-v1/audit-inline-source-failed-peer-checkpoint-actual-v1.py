"""Static evidence audit only. Does not import/execute product, JS, or models."""
import collections, datetime, hashlib, json, pathlib, re
H=pathlib.Path(__file__).resolve().parent.parent
OUT=pathlib.Path(__file__).resolve().parent
I=H/'candidate-controls-source-failed-peer-checkpoint-successor-v1'
R=I/'runtime-output-v1/inline-source-failed-peer'; N=R/'receiving-artifacts'
F=I/'source-freeze-v1.json'
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
accepted={'recipe.json':'a454b52a8c6fae157b154d203ee7c976e93f6bb99e75e1565ac8982692038a45','source-freeze.json':'0a1978c5a8856da7aab49379462dd5f258f75b7ba910454eed320f3018f13779','baseline-program.json':'c5eef9f5c5bdce78790002f0a753684c6dfb3e42fb4b68f0b0b7d5fcbd07e9e7'}
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

packet_count=filemap(I,load(I/'packet-sha256-v1.json'),'successor-packet')
check(sha(I/'packet-sha256-v1.json')=='60a45f03547a64b44341b72b2a9cebe2f9c2f662efc014b613d0e840978427fd','exact packet manifest')
snapshot_count=filemap(freeze['frozenSourceRoot'],freeze['instrumentFiles']|freeze['sharedInstrumentFiles'],'source-snapshots')
record_count=filemap(freeze['frozenRecordRoot'],freeze['records'],'record-snapshots')
original_count=0
for name,m in freeze['checkpointRepair']['originalResultsPreserved'].items():
 path=pathlib.Path(name);check(sha(path)==m['sha256'],'original-manifest '+name);d=load(path);entries=d['files'] if 'resultAssetsChecked' in m else d;original_count+=filemap(path.parent,entries,'preserved-original')
raw=lines(N/'receipts.jsonl');program=load(R/'baseline-program.json');boundaries=[x['boundaryEvent'] for x in raw if x['phase']=='completion-boundary']
check(sha(I/'inline-source-failed-peer-result-freeze-v1.json')=='37065c97890248961352332dc1a85ac252ecc4d6cd673a98f2706167b617d4d6','exact current result freeze')
check([x['sequence'] for x in raw]==list(range(1,329)),'328 consecutive receipts');check([x['sequence'] for x in boundaries]==list(range(1,307)),'306 consecutive boundaries');check(raw[0]['program']==program,'exact authored program')
def event(boundary,source=None,load_id=None,request=None):
 return [x for x in raw if x.get('boundaryEvent',{}).get('boundary')==boundary and (source is None or x['boundaryEvent']['detail'].get('source')==source) and (load_id is None or x['boundaryEvent']['detail'].get('load')==load_id) and (request is None or x['boundaryEvent']['detail'].get('request')==request)]
initial=next(x for x in raw if x['phase']=='completion-baseline-view');baseline=initial['view']['roots']
check([x['id'] for x in baseline]==[1,2] and [x['children'] for x in baseline]==[[101,102],[201,202]],'complete prior baseline')
cuts=[x for x in raw if x['phase']=='completion-baseline-cut'];held=cuts[0]
check(held['sequence']==291 and held['boundary']=='held-window' and held['pendingProviderAnswers']==2,'both exact provider requests held at correct cut')
check(held['view']['roots']==held['view']['downstream']==baseline and held['view']['window']=={'offset':0,'limit':2} and held['view']['status']=='ready' and held['view']['requestErrors']==[],'held cut preserves complete settled window')
check(held['operations']==[{'operation':'window','returned':'promise','outcome':{'state':'pending'}}],'original imperative window pending')
held_requests=[]
for source,seq,retseq in [('marked',212,213),('children',240,241)]:
 req=event('provider-request',source,request=2);ret=event('source-load-return',source,load_id=2);check(len(req)==len(ret)==1 and req[0]['sequence']==seq and ret[0]['sequence']==retseq and req[0]['boundaryEvent']['detail']['requested']==[3] and req[0]['boundaryEvent']['detail']['initiatingLoad']==2 and req[0]['boundaryEvent']['detail']['signalPresent'] is True and ret[0]['boundaryEvent']['detail']['literalTrue'] is False,'exact held original request '+source);held_requests+=req
check(event('provider-answer-failed','marked',request=2)[0]['sequence']==293,'marked original request rejected after held cut')
failed=event('source-load-applied-settled','marked',load_id=2);check(len(failed)==1 and failed[0]['sequence']==294 and failed[0]['boundaryEvent']['detail']['outcome']=={'state':'rejected','error':'baseline-source'},'exact applied-load rejection')
check(event('baseline-source-failure-applied')[0]['sequence']==295,'driver exact-error receipt checks completed')
first=next(x for x in raw if x['phase']=='completion-baseline-delivery' and x['epoch']=='2:source-failed-peer');root_callback=event('root-callback')[-1]
wrong=baseline+[{'id':3,'rank':30,'children':[]}]
check(first['sequence']==302 and first['capturedAt']==286 and first['delivery']['layer']=='root' and first['delivery']['rows']==first['delivery']['read']==wrong and first['delivery']['changes']==[{'type':'insert','value':wrong[-1]}],'first bad root callback exact public content')
check(root_callback['sequence']==301 and root_callback['boundaryEvent']['sequence']==286 and len(root_callback['boundaryEvent']['detail']['read'])==3,'raw public read precedes live checker')
check(not event('provider-answer-executed','children',request=2) and not event('provider-answer-failed','children',request=2),'peer unanswered throughout')
peer_settlement=event('source-load-applied-settled','children',load_id=2);cleanupstart=event('cleanup-start')[0]
check(len(peer_settlement)==1 and peer_settlement[0]['sequence']==324>cleanupstart['sequence']==322>first['sequence'],'peer load not settled at first callback; rejects only during cleanup')
check(not any(x['sequence']<first['sequence'] and x.get('boundaryEvent',{}).get('boundary') in ['cleanup-start','source-load-aborted','source-load-released','real-root-subscriber-throw','flush-throw'] for x in raw),'no prior cleanup/known callback failure contaminates first callback')
check([x['action'] for x in raw if x['phase']=='completion-baseline-action']==[x['action'] for x in program['steps'] if x['kind']=='semantic'][:4],'four exact actions reached; source-answer not executed')
driver=(root/'packages/query-db-collection/tests/queued-answer-completion-baseline-driver.ts').read_text(); fixture=(root/'packages/query-db-collection/tests/queued-answer-completion-fixture.ts').read_text();checker=(root/'packages/query-db-collection/tests/queued-answer-completion-oracle.ts').read_text();parent=(root/'packages/query-db-collection/tests/queued-answer-completion-baseline.test.ts').read_text();supervisorsource=(root/'packages/query-db-collection/tests/queued-answer-completion-supervisor.ts').read_text()
check(driver.index('emit(`completion-baseline-delivery`,')<driver.index('deliveryCheck(expected, delivery)'),'delivery emitted before synchronous live checker')
check('read: live.toArray.map(rawRoot)' in fixture and 'equal(delivery.rows, rows, `callback has complete authored root content`)' in checker,'callback captured public read and exact comparator')
check('deliveryCheck(expectedModel, receipt.delivery as CompletionDelivery)' in parent and 'observe(receipt)' in supervisorsource and 'outcome.primaryObservationError ??=' in supervisorsource,'actual parent comparison control-flow source')
stderr=(N/'worker.stderr.log').read_text();check('[QueryCollection] Error observing query h02-completion-marked' in stderr and 'Unhandled Rejection' in stderr and 'callback has complete authored root content' in stderr and 'callbackCapture.capture' in stderr and 'CollectionConfigBuilder.failDemand' in stderr,'distinct expected source warning and live checker unhandled rejection')
check(event('flush-throw')[0]['sequence']==317>first['sequence'],'flush throw occurs after first bad callback')
followon=cuts[1];check(followon['sequence']==321 and followon['peerPending'] is True and followon['view']['roots']==wrong,'later cut retained but post-assertion contaminated')
supervisor=load(N/'supervisor.json');so=supervisor['outcome'];outer=load(R/'outcome.json');actualreturn=load(R/'executor-actual-tool-return-v1.json');check(actualreturn['actualCompletion']['chunk_id']==result['actualToolCompletionChunk']=='1cfb7b' and actualreturn['actualCompletion']['exit_code']==1 and actualreturn['nativeInvocations']==1 and actualreturn['exactExecCommand']['sandbox_permissions']=='require_escalated','exact once actual elevated launch/completion')
check(so['reason']=='observation' and so['signal']=='SIGKILL' and so['exitCode'] is None and so['cleanupErrors']==[] and 'callback has complete authored root content' in so['primaryObservationError'] and so['bindingStatus']=='bound','parent comparison rejected first callback then killed child')
check(supervisor['watchdogTrigger']=='observation' and supervisor['killAttempted'] is True and not supervisor['heapDiagnosticDetected'],'kill is comparison containment; no wall/RSS/heap trigger')
check(result['actualOuterExitCode']==result['parentTestChildExitCode']==1 and outer['identityMatched'] and outer['remainingGroup']==outer['cleanupErrors']==0 and outer['signal'] is None and not outer['heap'],'outer finite return/owned cleanup only')
absence=load(R/'executor-process-absence-v1.json');check(absence['psExitCode']==0 and absence['remainingNamedGroupRows']==[] and all(x['result']=='ESRCH' for x in absence['zeroSignalProbes']),'saved owned/named absence only')
check(raw[-2]['phase']=='worker-cleaned' and raw[-1]['phase']=='worker-error','positive fixture cleanup and final checker failure retained')
check(not any(x['phase']=='completion-host-error' for x in raw),'host recorder does not listen to unhandledRejection; stderr remains authoritative')
facts={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':'static read/hash/JSON/source only; no JS/product/model/native execution, probes, Git, install or canonical accounting edits','classification':'bounded product RED at first public root callback, before live checker throws; no bug-class closure','resultFreezeSha256':sha(I/'inline-source-failed-peer-result-freeze-v1.json'),'resultFiles':result_count,'packetEntries':packet_count,'sourceSnapshots':snapshot_count,'recordSnapshots':record_count,'preservedOriginalEntries':original_count,'currentSourceFiles':source_count,'payloadFiles':payload_count,'Node':1,'locks':2,'links':4,'v8CompiledBodies':len(scripts),'inventoryFacts':inventory_facts,'derivedBindingRows':len(derived),'requiredPrehistoryModules':len(required),'rawReceipts':len(raw),'boundaries':len(boundaries),'phaseCounts':dict(collections.Counter(x['phase'] for x in raw)),'completeBaseline':baseline,'heldCut':held,'heldRequests':held_requests,'exactFailedLoad':failed[0],'firstBadPublicCallback':root_callback,'firstBadNormalizedDelivery':first,'laterCutIndependentCredit':False,'laterDownstreamIndependentCredit':False,'liveCheckerInterference':'delivery emitted before synchronous callback check throws; unhandled test assertion and later flush-throw may disturb continuation; later cuts/outcomes do not independently establish product behavior','expectedSourceWarningDistinct':True,'nativeSupervisorOutcome':{k:v for k,v in so.items() if k!='receipts'},'outerOutcome':outer,'savedProcessAbsence':absence,'actualToolCompletionChunk':result['actualToolCompletionChunk'],'actualHelperNoActiveOperation':'required and UNREACHED','candidateRaw20':'all UNREACHED','state14':'proposed; not adopted','priorKillEperm':'separate unresolved historical containment issue; current elevated SIGKILL outcome does not prove earlier cause or general repair','runtimeExecutions':0,'errors':errors,'allAuditChecksPass':not errors}
p=OUT/'inline-source-failed-peer-checkpoint-actual-independent-facts-v1.json';p.write_text(json.dumps(facts,indent=2)+'\n');print(json.dumps({'artifact':str(p),'sha256':sha(p),'errors':errors,'files':result_count,'sources':source_count,'payloads':payload_count,'V8':len(scripts),'bindings':len(derived),'raw':len(raw)}))
