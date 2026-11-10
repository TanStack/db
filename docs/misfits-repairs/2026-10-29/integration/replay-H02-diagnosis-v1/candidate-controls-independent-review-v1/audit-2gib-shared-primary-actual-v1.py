"""Independent static source/byte/JSON/AST audit only. No bound script import, process probe, native/test/model execution."""
import ast,datetime,difflib,hashlib,json,os,pathlib
O=pathlib.Path(__file__).resolve().parent;H=O.parent
N=H/'candidate-controls-pagination-2gib-shared-receiving-containment-v1'
B=H/'candidate-controls-pagination-2gib-containment-preparation-v1'
P=H/'candidate-controls-pagination-failed-peer-containment-preparation-v1'
Q=H/'candidate-controls-pagination-failed-peer-shared-receiving-successor-v1'
errors=[]
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def load(p):return json.loads(pathlib.Path(p).read_text())
def check(v,m):
 if not v:errors.append(m)
def fmap(root,items,label):
 for n,m in items.items():
  p=pathlib.Path(root)/n;d=m['sha256'] if isinstance(m,dict) else m
  try:
   check(sha(p)==d,label+' bytes '+str(p))
   if isinstance(m,dict):check(p.stat().st_size==m['bytes'],label+' size '+str(p))
  except OSError as e:errors.append(label+' '+str(e))
 return len(items)
check(sha(N/'packet-manifest.json')=='439cdcb6df9125142fece28cf55f834b60d071d57fb8b6498c2d4d1f7feca2f1','N exact manifest')
n=load(N/'packet-manifest.json');binding=load(N/'binding.json');recipe=load(N/'run-recipe.json')
check(sha(N/'binding.json')==n['bindingSha256']=='9c8dfceab5666c6d242002858a852ad4e05e33e6a147598730958025042b8faf','N exact binding')
members=fmap(N,n['files'],'N members');check(members==n['members']==10 and sum(p['bytes'] for p in n['files'].values())==n['memberBytes']==1562990,'N member counts/bytes')
check({str(p.relative_to(N)) for p in N.rglob('*') if p.is_file()}==set(n['files'])|{'packet-manifest.json','root-exact-one-primary-admission-v1.json'},'N exact current file set')
fmap(N,binding['files'],'binding own inputs')
for k in ['supervisor','proposedCommand','sourceFreeze','ps','toolchainRecovery']:
 i=binding[k];check(sha(i['path'])==i['sha256'],'external '+k);check(n['externalBindings'][k]==i,'manifest external '+k)
check(sha(binding['python']['executable'])==binding['python']['sha256'],'Python binary')
f=load(binding['sourceFreeze']['path']);W=pathlib.Path(f['worktree']);proposal=load(binding['proposedCommand']['path'])
source_count=fmap(W,f['sourceBindings'],'active596');copies=fmap(f['sourceCopyRoot'],f['sourceCopies'],'copied85')
check(source_count==596 and copies==85 and len(f['productionFiles'])==511,'Q596/85/511')
check(binding['sourceFreeze']['sha256']=='f85b261b1733c5581c0f8af8fbdff824b189b9b4517fda6b4cf397c1d2c8b193','same reviewed Q source')
check(sha(f['node']['executable'])==f['node']['sha256'],'Node binary')
check(sha(W/'pnpm-lock.yaml')==f['lockfiles']['repoPnpmLock'] and sha(W/'node_modules/.pnpm/lock.yaml')==f['lockfiles']['installedPnpmLock'],'two locks')
for name,i in f['dependencyReuseLinks'].items():
 p=W/name;check(p.is_symlink()==i['isSymlink'] and str(p.resolve())==i['resolved'],'reuse link '+name)
check(len(f['dependencyReuseLinks'])==4,'four reuse links')
sup=load(N/'supplemental-tool-inputs.json');check(sha(N/'supplemental-tool-inputs.json')==sha(P/'supplemental-tool-inputs.json')=='cd7eda6b0e649cb2aa019b83dac04f7821d52e34d0c62de144ac6d280636ba50','old finite map identical')
seen=set();payloads=0;payload_bytes=0
for i in list(f['packages'].values())+sup['packages']:
 logical=pathlib.Path(i['logical']);logical=logical if logical.is_absolute() else W/logical
 check(str(logical.resolve())==i['resolved'],'package resolved '+str(logical))
 base=pathlib.Path(i['resolved'])
 if str(base) in seen:continue
 seen.add(str(base));expected=i['regularPayloadFilesMap'];actual=set()
 for directory,dirs,files in os.walk(base,followlinks=False):
  dirs[:]=[d for d in dirs if d!='node_modules' and not (pathlib.Path(directory)/d).is_symlink()]
  for name in files:
   p=pathlib.Path(directory)/name
   if p.is_file() and not p.is_symlink():actual.add(str(p.relative_to(base)))
 check(actual==set(expected),'exact own payload set '+str(base))
 for name,d in expected.items():
  p=base/name;check(sha(p)==d,'payload bytes '+str(p));payload_bytes+=p.stat().st_size
 payloads+=len(expected)
check(len(seen)==255 and payloads==11974,'255 roots11974 payloads')
for edge in sup['resolutionEdges']:check(str(pathlib.Path(edge['logical']).resolve())==edge['resolved'],'resolution edge '+edge['logical'])
check(len(sup['resolutionEdges'])==405,'405 edges')
for i in sup['uninstalledDeclaredOptionalOrPeerDependencies']:
 base=pathlib.Path(i['from']);check(not any((ancestor/'node_modules'/i['dependency']).exists() for ancestor in [base,*base.parents]),'optional/peer still absent '+i['dependency'])
check(len(sup['uninstalledDeclaredOptionalOrPeerDependencies'])==112,'112 absences')
# Frozen actual result audit; no native actions or bound imports.
R=H/'candidate-controls-pagination-2gib-shared-receiving-primary-red-runtime-v1'
admission=N/'root-exact-one-primary-admission-v1.json'
check(sha(admission)=='0182ee6c9441fc3adcba427c221b101575ae7bdc5c162a9f12e51b87857771d7','exact root admission')
admit=load(admission)
for pin in admit['pins']:check(sha(pin['path'])==pin['sha256'],'root admission pin '+pin['path'])
check(admit['slot']==2 and admit['noAutomaticRetry'] and not admit['receivingAdmitted'] and not admit['randomCampaignAdmitted'] and not admit['productionEditAuthorized'],'root scope')
check(sha(R/'result-freeze-v1.json')=='ec7775de91e14a892dbfe17360cd8d2b73fb2766a0919605c66ee71561a09669','exact actual freeze')
freeze=load(R/'result-freeze-v1.json');asset_count=fmap(R,freeze['members'],'actual frozen assets')
check(asset_count==freeze['memberCount']==16 and sum(x['bytes'] for x in freeze['members'].values())==freeze['memberBytes']==3499565,'16 assets3499565 bytes')
check({str(p.relative_to(R)) for p in R.rglob('*') if p.is_file()}==set(freeze['members'])|{'result-freeze-v1.json'},'exact current result file set')
for key,value in [('admissionSha256',sha(admission)),('preparedManifestSha256',sha(N/'packet-manifest.json')),('bindingSha256',sha(N/'binding.json')),('sourceFreezeSha256',sha(Q/'source-freeze-v1.json'))]:check(freeze[key]==value,'result '+key)
tool=load(R/'actual-tool-return-v1.json');out=load(R/'outer-final.receipt.json');pre=load(R/'outer-pre.receipt.json');child=load(R/'00-final.receipt.json');outcome=load(R/'actual-outcome-v1.json');post=load(R/'source-tool-postcheck-v1.json')
check(tool['initialChunk']=='e84e86' and tool['sessionId']==26998 and tool['finalChunk']=='4a9657' and tool['actualOuterExitCode']==1 and tool['sandbox_permissions']=='require_escalated' and tool['launchAttempts']==1 and not tool['normalizationApplied'],'actual true outer return exact elevated once')
check(freeze['actualOuterExitCode']==freeze['actualChildExitCode']==child['exitCode']==1,'outer/child1 preserved')
check(out['command']==recipe and child['argv']==[recipe['executable']]+recipe['argv'] and child['cwd']==recipe['cwd'],'exact actual command')
check(out['bindingSha256']==child['bindingSha256']==sha(N/'binding.json'),'actual binding')
check(out['identityBefore']==out['identityAfter']==pre['identityBefore'],'before/after identities equal')
check(out['identityBefore']=={'sourceFiles':596,'copiedSources':85,'namedPackageRoots':255,'namedPackagePayloads':11974,'sourceFreezeSha256':sha(Q/'source-freeze-v1.json'),'nodeSha256':f['node']['sha256']},'positive finite identity record')
check(post['sourceFreezeSha256']==sha(Q/'source-freeze-v1.json') and post['bindingSha256']==sha(N/'binding.json') and post['sourceBindings']==596 and post['sourceCopies']==85 and post['namedPackageRoots']==255 and post['namedOwnPayloadFiles']==11974 and post['dependencyResolutionEdges']==405 and post['absentOptionalOrPeers']==112 and post['locksVerified']==2 and post['reuseLinksVerified']==4 and post['PythonNodeAndPsVerified'] and post['outerBeforeAfterEqual'],'saved postcheck exact positive')
# A preserved wrapper failure is not silently repaired by this JSON audit.
expected_secondary=[{'phase':'report-capture','error':'report does not identify exactly the selected executed fixed campaign'}]
check(out['status']=='stopped-nonzero' and out['report'] is None and out['secondaryFailures']==expected_secondary,'capture secondary/null report remain')
check(child['primaryFailure']=={'phase':'native-list','error':'native list abnormal/nonzero exit'} and child['secondaryFailures']==[],'child nonzero is primary; no secondary child cleanup error')
check(out['primaryFailure']=={'phase':'unchanged-supervisor-child-result','error':str({'phase':'native-list','error':'native list abnormal/nonzero exit'})},'outer primary preserves child')
# Raw result identity is established from exact file, title, ancestry and one execution.
raw=load(R/'vitest-report.json');assertions=[(module,a) for module in raw['testResults'] for a in module.get('assertionResults',[])]
executed=[(m,a) for m,a in assertions if a.get('status') not in ['pending','skipped','todo','disabled']]
base_title=recipe['expectedOutput']['title'];ancestors=recipe['expectedOutput']['ancestorTitles'];suffix_title=base_title+' (with seed=1665)'
base_matches=[(m,a) for m,a in assertions if a.get('title')==base_title]
suffix_matches=[(m,a) for m,a in assertions if a.get('title')==suffix_title and a.get('ancestorTitles')==ancestors]
check(len(raw['testResults'])==1 and len(assertions)==281 and len(executed)==1 and not base_matches and len(suffix_matches)==1 and suffix_matches[0][1] is executed[0][1],'exact raw selected identity; qualifier defect independently visible')
module,a=executed[0]
check(module['name']==str(W/'packages/db/tests/query/pagination-oracle.property.test.ts') and a['status']=='failed' and a['ancestorTitles']==ancestors and a['title']==suffix_title and a['fullName']==' '.join(ancestors+[suffix_title]),'one executed failed exact module/title/ancestry')
check(raw['success'] is False and raw['numTotalTests']==281 and raw['numFailedTests']==1 and raw['numPendingTests']==280 and raw['numPassedTests']==0,'raw aggregate counts')
check(len(a['failureMessages'])==1,'one assertion failure message');failure=a['failureMessages'][0]
import re
match=re.search(r'Counterexample: (\[.*\])\nShrunk (\d+) time\(s\)',failure);scenario=json.loads(match.group(1))[0]
check(scenario=={'rankOffset':0,'rankStep':1,'direction':'asc','initialLimit':1,'pivotMarked':False,'tailCount':2,'tailMarked':False} and match.group(2)=='4','exact reduced legal scenario/four shrink steps')
check('Property failed after 1 tests' in failure and '{ seed: 1665, path: "0:0:0:0:0", endOnFailure: true }' in failure,'seed/path/first generated input')
line=next(line for line in failure.splitlines() if line.startswith('Got error: atomic window publication at primary callback: expected rows '))
left,right=line.removeprefix('Got error: atomic window publication at primary callback: expected rows ').split(', got ',1)
expected_rows=json.loads(left);actual_rows=json.loads(right)
# Manual law reconstruction: three ascending unmarked roots; settled width1
# owes root1 with both authored children. New root2 is private while child load waits.
check(expected_rows==[{'id':1,'rank':0,'children':[101,102]}] and actual_rows==[{'id':1,'rank':0,'children':[101,102]},{'id':2,'rank':1,'children':[]}],'exact public-row mismatch and manually reconstructed lawful baseline')
check(all(s in failure for s in ['pagination-window-publication-oracle.ts:98:11','pagination-oracle.property.test.ts:2600:7','pagination-oracle.property.test.ts:2719:9','optimistic-history-oracle.ts:622:14','pagination-oracle.property.test.ts:2777:5']),'exact body/checker/cut/family/cleanup stack')
stdout=(R/'stdout.log').read_text();stderr=(R/'stderr.log').read_text()
diags=re.findall(r'pagination joined-window-failure callback checkpoint \{(.*?)\n\}',stdout,re.S)
check(len(diags)==5,'five callback diagnostics initial+shrink attempts')
for i,d in enumerate(diags):
 check(all(s in d for s in ["schedule: 'failure-first'",'sourceFailureApplied: true','peerPending: true','peerAborted: false','callbacks: 1',"boundary: 'callback'",'window: { offset: 0, limit: 1 }','afterFailureRequest: true']),'callback premise '+str(i))
check('failedScope: [ 2 ]' in diags[-1] and 'peerScope: [ 2 ]' in diags[-1],'final exact pivot2 scopes')
counts=re.findall(r"'joined-window-held': (\d+),\s+'source-failure-handled': (\d+),\s+'failed-window-retained': (\d+),\s+'retry-published': (\d+),\s+'successful-window-published': (\d+)",stdout)
check(counts==[(str(i),str(i),'0','0','0') for i in range(1,6)],'incremental five invocation reach diagnostics; not eight normal runs')
check('failed-window-retained (0), retry-published (0), successful-window-published (0)' in stderr and 'Failed Suites 1' in stderr and 'Failed Tests 1' in stderr,'afterAll reach failure retained separately from assertion')
check('History and cleanup failed' not in failure and 'History cleanup failed' not in failure,'raw primary not replaced by history-cleanup aggregate')
check('Coverage enabled with istanbul' in stdout and 'expo/tsconfig.base' in stderr,'ordinary coverage and nonfatal workspace scan diagnostics preserved')
# Read exact bound source statements for the named observation and recording path.
primary=(W/'packages/db/tests/query/pagination-oracle.property.test.ts').read_text();lines=primary.splitlines();shared=(W/'packages/db/tests/query/pagination-window-publication-oracle.ts').read_text()
check(lines[2667].strip()=='reach(`joined-window-held`)' and lines[2668].strip()=='checkRetained()' and lines[2702].strip()=='reach(`source-failure-handled`)' and lines[2718].strip()=='checkRetained()' and lines[2719].strip()=='holding = false','actual source line/cut before peer release')
check("new Set(facts.marked)" in shared and '.filter((child) => child.parent === id)' in shared and "if (!isDeepStrictEqual(actual.rows, expected.rows))" in shared,'independent model and exact row judgment still bound')
check('if (schedule === `peer-first`) await peer.answer(peerLoad)' in primary and 'source-failure-handled' in primary,'actual first schedule scope')
plugin=next(i for i in sup['packages'] if i['resolved'].endswith('/node_modules/@fast-check/vitest'))
pluginpath=pathlib.Path(plugin['resolved'])/'lib/vitest-fast-check.js';plugintext=pluginpath.read_text();check('testFn(`${label} (with seed=${customParams.seed})`' in plugintext,'bound installed plugin authors exact seed suffix')
# Native cleanup evidence is read, never reproduced with probes.
check(child['pid']==child['pgid']==41300 and child['pgidVerified'] and out['outerPid']==out['outerPgid']==41290,'exact positively verified original identities')
check(child['elapsedMs']==6002 and child['samples']==43 and child['maxSampledGroupRssBytes']==1891565568<2147483648,'sampled timing/resource summary')
check(child['killAttempts']==[{'targetPgid':41300,'signal':'SIGKILL','result':'already absent'}] and child['remainingGroupRows']==[],'conditional cleanup attempt ESRCH; no delivered resource kill')
pidpost=load(R/'original-id-postcheck-v1.json');cleanup_tool=load(R/'cleanup-tool-return-v1.json')
check([(i['kind'],i['id'],i['probeSignal'],i['result'],i['errno']) for i in pidpost['checks']]==[('pid',41290,0,'absent',3),('pid',41300,0,'absent',3),('pgid',41290,0,'absent',3),('pgid',41300,0,'absent',3)],'all four named IDs absent via retained ESRCH')
check(not pidpost['mutationSignalsSent'] and pidpost['namedPidInventory']['returnCode']==1 and pidpost['namedPidInventory']['stdout']==pidpost['namedPidInventory']['stderr']=='','retained exact named PID inventory empty')
check(cleanup_tool['chunk']=='172375' and cleanup_tool['exitCode']==0 and cleanup_tool['sandbox_permissions']=='require_escalated' and cleanup_tool['targetLaunchesAdded']==0 and not cleanup_tool['mutationSignalsSent'],'actual saved cleanup tool')
for name in ['pre-spawn','spawn','group-verified','failure','final']:
 r=load(R/('00-'+name+'.receipt.json'));check(r['phase']==name and r['bindingSha256']==sha(N/'binding.json'),'phase receipt '+name)
check(load(R/'00-group-verified.receipt.json')['pgidVerified'] and load(R/'00-failure.receipt.json')['primaryFailure']==child['primaryFailure'],'positive PGID and first nonzero retained before cleanup')
check(outcome['sourceToolPostcheck']=='PASS' and outcome['launchAttempts']==1 and not outcome['automaticRetry'],'author outcome preserves once/postcheck/no retry')
facts={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':'Static read/hash/JSON/source reasoning only; no new native/test/model execution, bound import or process probe.','resultFreezeSha256':sha(R/'result-freeze-v1.json'),'assetCount':asset_count,'assetBytes':freeze['memberBytes'],'rawReportSha256':sha(R/'vitest-report.json'),'rawReportBytes':(R/'vitest-report.json').stat().st_size,'admissionSha256':sha(admission),'actualTool':tool,'outerExit':1,'childExit':1,'wrapperQualifier':{'baseTitleMatches':len(base_matches),'seedSuffixedExactAncestryMatches':len(suffix_matches),'nonSkippedExecuted':len(executed),'secondaryPreserved':out['secondaryFailures'],'reportField':out['report'],'classifierChanged':False},'assertion':{'module':module['name'],'title':a['title'],'ancestorTitles':a['ancestorTitles'],'status':a['status'],'seed':1665,'path':'0:0:0:0:0','generatedFailureIndex':1,'shrinks':4,'reducedInput':scenario,'expectedRows':expected_rows,'actualRows':actual_rows,'cut':'captured first post-failure public callback, replayed at handled-failure barrier before peer release','sourceLine':2719,'checkerLine':98},'diagnostics':{'callbackCuts':len(diags),'finalFailedAndPeerScope':[2],'schedule':'failure-first','peerPending':True,'peerAborted':False,'sourceFailureApplied':True,'afterFailureRequest':True,'firstCallbackWindow':{'offset':0,'limit':1},'reachCountersAfterInitialAndShrinks':[list(map(int,c)) for c in counts],'normalEightRunReachCredit':False,'laterReachFailurePreserved':True},'sourceIdentity':{'freeze':sha(Q/'source-freeze-v1.json'),'active':source_count,'copies':copies,'production':len(f['productionFiles']),'roots':len(seen),'payloads':payloads,'edges':405,'absentOptionalPeer':112,'locks':2,'links':4,'currentHashChecksPass':not errors,'beforeAfterSavedEqual':out['identityBefore']==out['identityAfter'],'postSavedPass':post['status']},'cleanup':{'outerPidPgid':41290,'childPidPgid':41300,'positivePgid':True,'elapsedMs':6002,'samples':43,'peakSampledGroupRssBytes':1891565568,'thresholdBytes':2147483648,'killAttempts':child['killAttempts'],'remainingGroupRows':[],'allFourSavedNamedIdChecks':'ESRCH','nativeProbesByReviewer':0,'limits':'Named original IDs/groups only; no escaped daemon census or per-resource exact-once proof'},'classification':'BOUNDED PRODUCT RED at intended controlled primary callback observation; independent of preserved wrapper report-capture defect','openInstrumentFinding':{'id':'H02-N-SEED-SUFFIX-REPORT-QUALIFIER','status':'confirmed-open','cause':'Bound installed @fast-check/vitest appends seed suffix; prepared exact base title matches zero actual assertions.','repairScope':'Future separately reviewed operational successor must derive exact seeded identity and calibrate positive/negative report shapes; no current classifier/source/result changed.'},'limits':['One first generated case plus four shrink attempts; not all eight runs','No peer-first/success/retry/settlement result','No random campaign or checked replay executed','No new real QueryClient receiving/full-child success witness','No hostile mutant/closure/production edit authority','Initial unshrunk input not retained as full verbose trace','First callback row mismatch only; later cuts and separate settled-window assertion get no independent failure credit','Finite expected source/tool identity is not runtime evaluated-source proof','All20 candidate states and actual-helper/no-active-operation remain UNREACHED;state14 unadopted;metadata separate'],'allAuditChecksPass':not errors,'errors':errors,'newProductExecutions':0,'newModelExecutions':0,'newTestExecutions':0,'newNativeRunInvocations':0,'newBoundProgramImports':0,'newProcessProbes':0,'slot2':'return after report'}
p=O/'2gib-shared-primary-actual-independent-facts-v1.json';p.write_text(json.dumps(facts,indent=2)+'\n')
print(json.dumps({'facts':str(p),'factsSha256':sha(p),'assets':asset_count,'sources':source_count,'payloads':payloads,'classification':facts['classification'],'errors':errors}))
raise SystemExit(bool(errors))
