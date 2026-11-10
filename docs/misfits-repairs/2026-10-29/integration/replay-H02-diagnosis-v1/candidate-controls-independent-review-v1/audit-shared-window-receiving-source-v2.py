"""Static read/hash/source/JSON transformations only; no TypeScript/JS/model import, product/test/native run, or process probe."""
import copy, datetime, difflib, hashlib, json, pathlib, re
O=pathlib.Path(__file__).resolve().parent
H=O.parent
Q=H/'candidate-controls-pagination-failed-peer-shared-receiving-successor-v1'
errors=[]
def sha(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def load(p): return json.loads(pathlib.Path(p).read_text())
def check(v,m):
    if not v: errors.append(m)
def fmap(root,entries,label):
    for name,value in entries.items():
        path=pathlib.Path(root)/name
        expected=value['sha256'] if isinstance(value,dict) else value
        try:
            check(sha(path)==expected,label+': '+str(path))
            if isinstance(value,dict): check(path.stat().st_size==value['bytes'],label+' bytes: '+str(path))
        except OSError as e: errors.append(label+': '+str(e))
    return len(entries)
known={'source-freeze-v1.json':'f85b261b1733c5581c0f8af8fbdff824b189b9b4517fda6b4cf397c1d2c8b193','packet-sha256-v1.json':'f64dae8f38429d6d5f6358fa2295c1b91b48f92a5f0ebdaae29b3153939628ef','report-v1.md':'c8ab425db65bbdef057a1456fb5d39bcea3991190b5469435d0d778cd2c869a0'}
fmap(Q,known,'known Q');packet=fmap(Q,load(Q/'packet-sha256-v1.json'),'Q packet')
f=load(Q/'source-freeze-v1.json');prior=load(f['priorSourceFreeze']);W=pathlib.Path(f['worktree'])
check(packet==126,'126 Q entries');check(sha(f['priorSourceFreeze'])==f['priorSourceFreezeSha256']=='cf550f0a80c400acb8a151f58f5692ba3f1442dc5122027b42b2160f76179eec','prior primary freeze')
current=fmap(W,f['sourceBindings'],'current596');copies=fmap(f['sourceCopyRoot'],f['sourceCopies'],'copies85')
check(current==f['sourceBindingCount']==596 and copies==85,'596bindings85copies')
check(f['productionFiles']==prior['productionFiles'] and len(f['productionFiles'])==f['productionCount']==511,'all511 production unchanged')
old=prior['sourceBindings'];new=f['sourceBindings'];deltas={p:{'before':h,'after':new.get(p)} for p,h in old.items() if new.get(p)!=h}
check(deltas==f['oldBindingDeltas'] and len(deltas)==8,'exact8 old deltas')
check(set(new)==set(old)|set(f['newBindings']) and len(f['newBindings'])==1 and all(new[p]==h for p,h in f['newBindings'].items()),'sole new companion binding')
check(f['instrumentFiles']|f['sharedInstrumentFiles']==f['sourceCopies'] and f['productionFiles']|f['sourceCopies']==new,'source groups cover exact map')
patch_checks=[]
for name,delta in deltas.items():
    b=Q/'before'/name;a=W/name;p=Q/'patches'/(name+'.patch')
    check(sha(b)==delta['before'] and sha(a)==delta['after'],'before/after delta '+name)
    actual=''.join(difflib.unified_diff(b.read_text().splitlines(keepends=True),a.read_text().splitlines(keepends=True),fromfile='before/'+name,tofile='after/'+name))
    check(actual==p.read_text(),'exact patch '+name);patch_checks.append(name)
preserved={}
for name,m in f['priorPacketsRehashed'].items():
    p=pathlib.Path(name);check(sha(p)==m['sha256'],'prior manifest '+name);data=load(p);entries=data.get('files',data)
    count=fmap(p.parent,entries,'preserved prior');check(count==m['entriesRehashed'],'preserved count '+name);preserved[name]=count
check(sorted(preserved.values())==[88,105,1975],'oldP105/S88/result1975')
operational=pathlib.Path(f['priorPrimaryOperationalStopResult']);check(sha(operational)==f['priorPrimaryOperationalStopResultSha256']=='6a3df64c714d54542e8c2cda8ea3b5def9b5c2ef8c35652d2e452ce5463c7d9d','prior operational freeze intact')
payloads=0
for package in f['packages'].values():
    check(sha(pathlib.Path(package['resolved'])/'package.json')==package['packageJsonSha256'],'package identity')
    payloads+=fmap(package['resolved'],package['regularPayloadFilesMap'],'old package payload')
check(len(f['packages'])==9 and payloads==2544,'nine prior packages2544 payloads')
check(sha(f['node']['executable'])==f['node']['sha256'],'Node unchanged')
check(sha(W/'pnpm-lock.yaml')==f['lockfiles']['repoPnpmLock'] and sha(W/'node_modules/.pnpm/lock.yaml')==f['lockfiles']['installedPnpmLock'],'two locks')
for name,m in f['dependencyReuseLinks'].items():
    p=W/name;check(p.is_symlink()==m['isSymlink'] and str(p.resolve())==m['resolved'],'reuse link '+name)
check(len(f['dependencyReuseLinks'])==4,'four links')
tb=load(Q/'static-tool-identity-before-v1.json');ta=load(Q/'static-tool-identity-after-v1.json')
check(sha(Q/'static-tool-identity-before-v1.json')==f['staticToolIdentityBeforeSha256']==ta['beforeSha256'] and sha(Q/'static-tool-identity-after-v1.json')==f['staticToolIdentityAfterSha256'] and ta['unchanged'],'static before/after identity')
for package in tb['packages'].values(): fmap(package['resolved'],package['regularPayloadFilesMap'],'static tool payload')
prettier=tb['prettier'];prettier_count=fmap(prettier['resolved'],prettier['regularPayloadFilesMap'],'prettier payload');check(prettier_count==ta['prettierPayloadFiles']==56,'prettier56')
check(ta['eslintPayloadFiles']==426 and ta['typescriptPayloadFiles']==132,'static ESLint426/TS132')

primary='packages/db/tests/query/pagination-oracle.property.test.ts'
history='packages/query-db-collection/tests/queued-answer-completion-baseline-history-oracle.ts'
model='packages/query-db-collection/tests/queued-answer-completion-oracle.ts'
driver='packages/query-db-collection/tests/queued-answer-completion-baseline-driver.ts'
parent='packages/query-db-collection/tests/queued-answer-completion-baseline.test.ts'
attachment='packages/query-db-collection/tests/queued-answer-completion-attachments.ts'
fixture='packages/query-db-collection/tests/queued-answer-completion-fixture.ts'
companion='packages/db/tests/query/pagination-window-publication-oracle.ts'
texts={name:(W/name).read_text() for name in [primary,history,model,driver,parent,attachment,fixture,companion]}
before={name:(Q/'before'/name).read_text() for name in deltas if name.endswith('.ts')}
def between(text,start,end): return text[text.index(start):text.index(end,text.index(start))]
reference_before=between(before[primary],'function referenceWindowRows(','\nfunction expectWindowRows(')
reference_after=between(texts[companion],'export function referenceWindowRows(','\n// A complete inline row')
check(reference_after.replace('export ','',1).rstrip()==reference_before.rstrip(),'reference function body moved byte-for-byte')
check('import type { PageRow }' in texts[companion] and all(s not in texts[companion] for s in ['from \'../../src','from \'@tanstack/db','from \'./pagination-oracle.property.test']),'shared model has no production/test registration import')
check(all(s in texts[companion] for s in ['new Set(facts.marked)','facts.roots.filter(({ id }) => !marked.has(id))','facts.children','child.parent === id','.sort((left, right) => left - right)','actual.window','actual.rows','declareOracle({']),'independent full-child facts and exact retained rows/window judgment')
check(re.findall(r'^const (\w+Runs) = (.+)$',before[primary],re.M)==re.findall(r'^const (\w+Runs) = (.+)$',texts[primary],re.M),'all primary budgets unchanged')
check('source-failed-peer-pending' not in texts[primary] and 'source-failure-handled' in texts[primary],'new unrun reach replaced with handled source failure')
primary_driver=between(texts[primary],'async function runJoinedWindowFailureScenario(','async function runPendingHistoryScenario(')
check('referenceJoinedWindowRows(' in primary_driver and 'children: [...children]' in primary_driver and '.orderBy(({ child }) => child.id)' in primary_driver,'primary full children and explicit order')
check('peerLoad.error.name === `AbortError`' in primary_driver and 'peerPending === peerRetired' in primary_driver,'primary unambiguous pending/retired premise')
check(primary_driver.index('expect(live.utils.lastSubsetError')<primary_driver.index('reach(`source-failure-handled`)')<primary_driver.index('checkRetained()',primary_driver.index('reach(`source-failure-handled`)'))<primary_driver.index('holding = false',primary_driver.index('reach(`source-failure-handled`)')),'handled failure comparison before release')
capture=between(primary_driver,'  const capture =','  let subscription:');check('expect(' not in capture and 'checkRetainedWindowSnapshot(' not in capture,'primary callback record only')
check(between(texts[model],'export function createCompletionModel(','function checkCompletionPublicState(')==between(before[model],'export function createCompletionModel(','function checkCompletionPublicState('),'entire existing model transitions/candidate checks unchanged')
check(between(texts[history],'export function constructCompletionBaselineProgram(','\n/**\n * A publication epoch')==between(before[history],'export function constructCompletionBaselineProgram(','\n/**\n * A publication epoch'),'existing constituent constructor unchanged')
check('return referenceJoinedWindowRows(facts, `asc`, window)' in texts[model],'completion finite model uses shared reference')
receive=between(texts[driver],'  const receiveBoundary =','  const armEpoch =')
check('admissionEvents.push' in receive and 'callbackCapture.capture' not in receive and 'epochModels' not in receive and 'checkRetainedWindowSnapshot(' not in receive and 'deliveryCheck(' not in receive,'child callback path raw record only')
check('window: readWindow()' in texts[fixture] and '...message' in texts[fixture] and 'previousValue:' in texts[fixture],'raw full messages/previous value/windows retained')
check('receiving fixture lost its ordered window' not in texts[attachment] and 'window,' in between(texts[attachment],'    recorder.event(`public-read`','    const status ='),'missing getWindow value recorded')
check(texts[driver].index('emit(`completion-baseline-checkpoint-captured`, common)')<texts[driver].index('closeEpoch()',texts[driver].index('emit(`completion-baseline-checkpoint-captured`, common)')),'physical snapshot emitted before semantic replay')
check(all(s in texts[driver] for s in ['const drainCaptured =','compare(() => callbackCapture.capture!','compare(() =>\n        deliveryCheck.checkpoint','completion-baseline-semantic-failure','completion-secondary-cleanup-error','liveCallbackComparison = false']),'child drains captured callbacks and preserves semantic/cleanup evidence')
check(all(s in texts[parent] for s in ['semanticErrors.push(new Error(context, { cause: error }))','workerErrors.length === 1','workerErrors[0]!.message === childSemanticFailure','semanticErrors.length > 0','const errors = [...semanticErrors, ...diagnostics]','{ cause: errors[0] }','secondaryChildErrors.push']),'parent retains mismatch through finalization; exact semantic marker plus independent mismatch')
check(all(s in texts[driver] for s in ['load.receipt !== binding.receipt','load.options !== binding.options','load.options.signal !== binding.signal','load.generation !== binding.generation','peer.request.appliedLoad !== peer.appliedLoad','error.name === `AbortError`','peerPending === peerRetired']),'child exact original peer recheck and AbortError classifier')
check(all(s in texts[parent] for s in ['stable(peer), stable(heldPeerProof)','peer.requestCancelled !== (peer.disposition === `retired`)','load.cancellationErrorName !== `AbortError`','settled.sequence !== load.settledAt','settled.sequence >= event.sequence']),'parent stable identity and prior settlement validation')
check('program.windowReceivingSchedule === `success`' in texts[driver] and '[program.answerScopes.failure, program.answerScopes.peer].every(' in texts[driver],'success waits for both exact held source scopes')
check('observation.firstFailureBarrier !==' in texts[parent] and 'program.windowReceivingSchedule === `failure-first`' in texts[parent],'parent binds special operation scope to recipe')
check(all(s in texts[model] for s in ['actual.outcome.state === `pending`','actual.outcome.state === `rejected`','actual.outcome.error === failureBarrier.error','original operation count at first failure barrier','unaffected operation result at first failure barrier']),'first barrier allows only pending or exact rejection for affected original operations')

# These are structural JSON source transformations, not expected-result/model runs.
# Source equality above binds the unchanged base constructor. The new constructor
# is read directly and its finite transformations are checked against frozen JSON.
offline=load(Q/'offline-program-authoring-v1.json');program_equality=[]
for item in offline['programs']:
    check(sha(item['sourceProgram'])==item['sourceProgramSha256'] and sha(item['program'])==item['programSha256'],'offline source/program identities')
    old_program=load(item['sourceProgram']);expected=copy.deepcopy(old_program);actual_program=load(item['program']);schedule=item['schedule']
    if schedule=='failure-first':
        boundary=next(i for i,step in enumerate(expected['steps']) if step.get('kind')=='baseline-observe' and step.get('boundary')=='source-failed-peer')
        expected['steps']=expected['steps'][:boundary+1];expected['sourceAnswerPremises']={}
        # Exact three authored epochs follow the retained source steps 0..6.
        expected['publicationEpochs']=old_program['publicationEpochs'][:3]
        check(expected['steps'][-1]=={'kind':'baseline-observe','boundary':'source-failed-peer'} and len(expected['steps'])==7,'failure stops at exact first barrier')
    else:
        expected['setup']['facts']['marked']=[x for x in expected['setup']['facts']['marked'] if x!=expected['selectedKeys']['pivot']]
        for step in expected['steps']:
            if step.get('kind')=='control' and step.get('control')=='begin-replay': step['control']='hold-demand-sources'
            if step.get('kind')=='semantic' and step.get('action',{}).get('type')=='source-answer': step['action']['facts']=copy.deepcopy(expected['setup']['facts'])
        for premise in expected['sourceAnswerPremises'].get('answer',[]):
            if premise['source']=='children':premise['since']='answer-release'
        # The success transformation changes neither step indexes nor cuts.
        check([x for x in expected['steps'] if x['kind']=='baseline-observe']==[x for x in old_program['steps'] if x['kind']=='baseline-observe'],'success epoch cuts unchanged')
        check(expected['selectedKeys']['pivot'] not in expected['setup']['facts']['marked'],'success pivot eligible')
    expected['windowReceivingSchedule']=schedule
    check(expected==actual_program,'exact semantic constructor transformation '+schedule)
    # Source authorCompletionBaselinePublicationEpochs is unchanged; its epoch
    # fields are directly reconciled with each retained observe index here.
    cuts=[(i,s['boundary']) for i,s in enumerate(actual_program['steps']) if s['kind']=='baseline-observe']
    check(actual_program['publicationEpochs'][0]=={'id':'initialization','kind':'initialization','fromStep':-1,'throughStep':-1},'initialization epoch '+schedule)
    from_step=0
    for number,(index,boundary) in enumerate(cuts,1):
        check(actual_program['publicationEpochs'][number]=={'id':str(number)+':'+boundary,'kind':'cleanup' if boundary=='cleanup-abandoned' else 'publication','fromStep':from_step,'throughStep':index},'authored epoch indexes '+schedule)
        from_step=index+1
    check(from_step==len(actual_program['steps']) and len(actual_program['publicationEpochs'])==len(cuts)+1,'all source steps close exactly '+schedule)
    program_equality.append({'schedule':schedule,'sourceProgramSha256':item['sourceProgramSha256'],'programSha256':item['programSha256'],'steps':len(actual_program['steps']),'epochs':len(actual_program['publicationEpochs']),'semanticConstructorEquality':'PASS by exact static source/JSON transformation; no import or model run'})

fixed=load(Q/'proposed-primary-fixed-red-command-v1.json');replay=load(Q/'proposed-primary-random-replay-template-v1.json')
check(fixed['args']==[str(pathlib.Path(f['packages']['vitest']['resolved'])/'vitest.mjs'),'run','--config','vite.config.ts','tests/query/pagination-oracle.property.test.ts','-t','retains complete windows across joined failure histories for a fixed seed','--maxWorkers=1','--no-file-parallelism'],'exact fixed selector/args')
check(replay['args']==[x.replace('for a fixed seed','for a random or replayed seed') for x in fixed['args']] and replay['environment']['TANSTACK_DB_ORACLE_PROPERTY']=='pagination.joined-window-failure' and '<actual FastCheck-reported' in replay['environment']['TANSTACK_DB_ORACLE_SEED'] and '<actual FastCheck-reported' in replay['environment']['TANSTACK_DB_ORACLE_PATH'],'explicit random replay template')
receiving=load(Q/'proposed-receiving-command-inputs-v1.json')
for item in receiving['proposals']:
    check(sha(item['recipe'])==item['recipeSha256'],'receiving recipe identity')
    recipe=load(item['recipe']);check(recipe['sourceFreezeSha256']==sha(Q/'source-freeze-v1.json') and sha(recipe['programFile'])==recipe['programSha256'],'receiving exact source/program')
    check(recipe['limits']=={'wallMs':60000,'nodeHeapMiB':384,'groupRssBytes':1073741824,'samplingMs':100},'unchanged receiving operational limits')
    check(not pathlib.Path(recipe['outputDirectory']).exists(),'receiving output not executed')
static=load(Q/'actual-static-tool-completions-v1.json')
check(all(static[k]['exit']==0 for k in ['prettierFinal','eslintFinal','typecheckFinal','sourceOracleFeedback']),'saved final static exit0')
check((Q/static['sourceOracleFeedback']['log']).read_text().strip()=='{}','saved source feedback{}')
check((Q/static['typecheckFinal']['log']).read_bytes()==b'','saved typecheck empty success')
eslint_log=(Q/static['eslintFinal']['log']).read_text();check('0 errors, 4 warnings' in eslint_log,'four nonfatal no-shadow warnings retained')
report_log=(Q/static['supplementalReportWorktreeDirectFeedback']['log']).read_text();check(static['supplementalReportWorktreeDirectFeedback']['exit']==1 and 'spawnSync git ENOBUFS' in report_log and "spawnargs: [ 'ls-files', '--others', '--exclude-standard' ]" in report_log,'saved report gate failed before lint')
check(static['requiredExactReportWorktreePnpmLint'].startswith('PENDING ROOT') and f['requiredReportWorktreeExactLint'],'exact report gate remains pending')
check(f['runtime']==0 and 'UNREACHED' in str(f['reaches']),'no source runtime/reach claim')
report=(Q/'report-v1.md').read_text();check('before the body' in report,'report-only historical body-execution overclaim preserved')
facts={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':__doc__,'knownQ':known,'reviewedBase':f['base'],'packetEntries':packet,'sourceBindings':current,'sourceCopies':copies,'unchangedProduction':511,'exactOldBindingDeltas':deltas,'newBindings':f['newBindings'],'exactPatchChecks':patch_checks,'priorPreservedEntries':preserved,'dependencyPackages':9,'dependencyPayloads':payloads,'PrettierPayloads':prettier_count,'node':1,'locks':2,'links':4,'offlinePrograms':program_equality,'staticRecords':static,'reportOnlyFinding':{'id':'H02-Q-REPORT-BODY-OVERCLAIM','status':'confirmed-open','claim':'prior cf550f stopped before the body','correction':'Body execution UNESTABLISHED; no selected report/reach/comparison retained. RSS cutoff supplies no product credit.','scope':'additive report erratum; bound source freeze/proposals need no change for this wording correction'},'priorAuditCorrection':{'staticReturn':'87cc6f exit1','priorFactsSha256':'a702f768ecf884b34d7e56b42989d8f6ab75c9f23b1a2f566fb8e4964fa579a4','reason':'The v1 raw-recording lexical guard matched the word checkpoint in a comment. Narrow it to semantic-check call tokens; no bound source changed.'},'sourceFindings':[],'executionLimits':{'sourceOnly':True,'runtimeAdmitted':False,'reportWorktreeExactLint':'pending ROOT','fullChildReceiving':'failure and success both required before production; both UNREACHED','firstFailureOperation':'pending or exact rejection only at recipe-bound first barrier; later settlement/retry open','peerDisposition':'no per-disposition reach minimum; actual pending/retired premise must be measured; legal retirement never becomes a product failure by itself','successCallbackWindow':'full child rows/event replicas checked; success callback window tuple not a new promised checkpoint; final settled window still checked','law16':'ordinary status/lazy-failure owner unchanged; source acceptance supplies no new law16 runtime credit','priorSingleton':'earlier first emitted root callback only; follow-on contaminated observations get no additional credit','candidateRaw20':'all UNREACHED','actualHelperNoActiveOperation':'required and UNREACHED','state14':'proposed/unadopted'},'allAuditChecksPass':not errors,'errors':errors,'productExecutions':0,'modelExecutions':0,'testExecutions':0,'nativeRunInvocations':0,'boundProgramImports':0,'processProbes':0}
path=O/'shared-window-receiving-source-independent-facts-v2.json';path.write_text(json.dumps(facts,indent=2)+'\n')
print(json.dumps({'facts':str(path),'factsSha256':sha(path),'packet':packet,'sources':current,'copies':copies,'payloads':payloads,'programs':program_equality,'errors':errors}))
raise SystemExit(1 if errors else 0)
