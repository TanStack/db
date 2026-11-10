"""Static read/hash/source/JSON only; no test, JavaScript, model, product, native or process probe."""
import datetime,difflib,hashlib,json,pathlib,re
O=pathlib.Path(__file__).resolve().parent;H=O.parent;P=H/'candidate-controls-pagination-failed-peer-source-preparation-v1'
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def load(p):return json.loads(pathlib.Path(p).read_text())
errors=[]
def check(v,m):
 if not v:errors.append(m)
def fmap(root,entries,label):
 for p,h in entries.items():
  try:check(sha(pathlib.Path(root)/p)==h,f'{label}: {p}')
  except OSError as e:errors.append(f'{label}: {p}: {e}')
 return len(entries)
known={'packet-sha256-v1.json':'2a6e992f2e25fa4dcbfb05456924bfb597bd583a59234a8b445b95a139773a75','source-freeze-v1.json':'cf550f0a80c400acb8a151f58f5692ba3f1442dc5122027b42b2160f76179eec','report-v1.md':'632f936b9ee3759ea62de0befabadfe50f77c1b91bd614fd901b38bb04136b61'}
fmap(P,known,'known packet');packet_count=fmap(P,load(P/'packet-sha256-v1.json'),'packet')
f=load(P/'source-freeze-v1.json');prior=load(f['priorSourceFreeze']);W=pathlib.Path(f['worktree']);old=prior['productionFiles']|prior['instrumentFiles']|prior['sharedInstrumentFiles'];new=f['sourceBindings']
check(sha(f['priorSourceFreeze'])==f['priorSourceFreezeSha256']=='0a1978c5a8856da7aab49379462dd5f258f75b7ba910454eed320f3018f13779','prior freeze identity')
source_count=fmap(W,new,'current source');copy_count=fmap(f['sourceCopyRoot'],f['sourceCopies'],'source snapshots');check(source_count==595 and copy_count==84,'595/84 bindings')
check(f['productionFiles']==prior['productionFiles'] and len(f['productionFiles'])==f['productionCount']==511,'511 production unchanged')
deltas={p:{'before':h,'after':new.get(p)} for p,h in old.items() if new.get(p)!=h};check(deltas==f['oldBindingDeltas'] and list(deltas)==['packages/db/tests/oracle-config.ts'],'only one old binding delta')
check(set(new)==set(old)|set(f['primaryAndSupportFilesAddedToBinding']) and len(set(new)-set(old))==11 and all(new[p]==h for p,h in f['primaryAndSupportFilesAddedToBinding'].items()),'exact eleven additive source inputs')
primary='packages/db/tests/query/pagination-oracle.property.test.ts';config='packages/db/tests/oracle-config.ts';check(new[primary]=='6f26a439c6bcf949364e6c32c238a72b98d1d29d929c355622e32232c56e4f32' and new[config]=='2549b168c978ab0d6adfabf95cf02ac70b54097b4ee4261d7c45f6a304ca9827','actual primary/config hashes')
check(sha(W/'packages/query-db-collection/tests/queued-answer-completion-baseline-driver.ts')==f['baselineDriverUnchangedSha256']=='9237bde4da2d85ba933d3eee1ad11929c747196c7d3d5580a3b2cd2bad08cc3c','baseline driver unchanged')
text=(W/primary).read_text();before=(P/'before/pagination-oracle.property.test.ts.txt').read_text();config_before=(P/'before/oracle-config.ts.txt').read_text();config_after=(W/config).read_text()
check(sha(P/'before/pagination-oracle.property.test.ts.txt')==f['primaryBeforeSha256']=='bfba1333632e92a233a937a248dc50dd32fc0126bfbc9c5380e543142ebd11ce','primary before snapshot')
for b,a,name,path in [(before,text,'pagination-oracle.property.test-v1.patch',primary),(config_before,config_after,'oracle-config-v1.patch',config)]:
 diff=''.join(difflib.unified_diff(b.splitlines(keepends=True),a.splitlines(keepends=True),fromfile=f'before/{path}',tofile=f'after/{path}'));check(diff==(P/name).read_text(),'exact patch '+name)
check(config_after==config_before.replace('  `pagination.pending-mutation`,\n','  `pagination.pending-mutation`,\n  `pagination.joined-window-failure`,\n'),'registry addition only')
old_budgets=re.findall(r'^const (\w+Runs) = (.+)$',before,re.M);new_budgets=re.findall(r'^const (\w+Runs) = (.+)$',text,re.M);check(old_budgets==new_budgets,'pre-existing run budgets unchanged')
record_counts={};prior_records=0
for name,m in f['priorPacketsRehashed'].items():
 path=pathlib.Path(name);check(sha(path)==m['sha256'],'prior preserved manifest');d=load(path);entries=d['files'] if 'files' in d else d;c=fmap(path.parent,entries,'prior packet/result');check(c==m['entriesRehashed'],'prior entry count');record_counts[name]=c;prior_records+=c
payloads=0
for package in f['packages'].values():
 check(sha(pathlib.Path(package['resolved'])/'package.json')==package['packageJsonSha256'],'selected package identity');payloads+=fmap(package['resolved'],package['regularPayloadFilesMap'],'dependency payload')
check(payloads==2544 and len(f['packages'])==9,'nine packages/2544 payloads');check(sha(f['node']['executable'])==f['node']['sha256'],'selected Node');check(sha(W/'pnpm-lock.yaml')==f['lockfiles']['repoPnpmLock'] and sha(W/'node_modules/.pnpm/lock.yaml')==f['lockfiles']['installedPnpmLock'],'two locks')
for p,m in f['dependencyReuseLinks'].items():q=W/p;check(q.is_symlink()==m['isSymlink'] and str(q.resolve())==m['resolved'],'reuse link '+p)
start=text.index('async function runJoinedWindowFailureScenario(');end=text.index('async function runPendingHistoryScenario(',start);driver=text[start:end];capture=driver[driver.index('  const capture ='):driver.index('  let subscription:')]
check('expect(' not in capture and 'live.toArray.map(projectPageRow)' in capture and 'window: window && { ...window }' in capture,'nonthrowing source-level public recorder; absence preserved')
checkpoint=['failedLoad.deferred.reject(failure)','await failedLoad.receipt','expect(rejected, `original failed applied-load error`).toBe(failure)','expect(live.utils.lastSubsetError, `exact source failure handled`)','expect(peerLoad.outcome).toBeUndefined()','reach(`source-failed-peer-pending`)','console.info(`pagination joined-window-failure callback checkpoint`','checkRetained()','holding = false','await peer.answer(peerLoad)','await observedOperation']
# Follow the failure branch so the earlier held-cut comparison cannot satisfy the post-rejection check.
failurebranch=driver[driver.index('      if (schedule !== `success`)'):];positions=[];cursor=0
for token in checkpoint:
 idx=failurebranch.find(token,cursor);check(idx>=0,'failure checkpoint ordered token '+token);positions.append(idx);cursor=idx+len(token) if idx>=0 else cursor
check('const receipt = original.call(source._sync, options)' in driver and 'entry.options === options && entry.receipt === undefined' in driver and 'return receipt' in driver,'same options/source-load return identity; observers do not replace receipt')
check('load.receipt !== true' in driver and 'load.outcome === undefined' in driver and '!load.options.signal?.aborted' in driver and 'toHaveLength(1)' in driver,'pending original dependent premises')
check('`exact failed demand`' in driver and '`exact pending peer demand`' in driver and driver.count('.toStrictEqual([pivot])')==2,'both finite hypothetical root scope comparisons')
check('if (schedule === `peer-first`) await peer.answer(peerLoad)' in driver and 'schedule of [`failure-first`, `peer-first`, `success`] as const' in driver,'three schedules preserved')
check('if (load.options.signal?.aborted)' in driver and 'load.deferred.resolve()' in driver and 'await apply(load.options)' in driver and 'await load.receipt' in driver,'applied receipts and obsolete answer controls')
check('return withHistoryCleanup(' in driver and all(s in driver for s in ['() => subscription?.unsubscribe()','() => live.cleanup()','() => observedOperation','() => filter.restore()','() => peer.restore()','() => roots.source.cleanup()']),'cleanup steps and wrapper restoration present')
check('const baseline = referenceWindowRows(' in driver and 'const complete = referenceWindowRows(' in driver and 'truth.filter(({ id }) => !marked.some(({ rowId }) => rowId === id))' in driver,'independent finite value judgments')
registration=text[text.index('  // A translated/scaled finite source'):text.index('  fcTest.prop([pendingHistoryScenarioArbitrary]',text.index('  // A translated/scaled finite source'))]
check('seed: 1665' in registration and 'numRuns: transitionScenarioRuns' in registration and 'oracleRandomParameters(\n        transitionScenarioRuns,' in registration,'same fixed/random budget and parameters')
check('reach.beginHistory()' in registration and 'if (started) reach.assertReached()' in registration and 'counts: Object.fromEntries(reach.counts())' in registration,'declared reach/count/final assertion')
check('oracleReplayTest(fcTest)' in registration and 'oracleReplayTest(fcTest, `pagination.joined-window-failure`)' in registration and 'oracleReplayTest(it)' in registration,'new family/pin replay guards')
check('runJoinedWindowFailureScenario(' in registration and 'initialLimit: 2' in registration and 'pivotMarked: true' in registration and 'tailCount: 4' in registration and 'tailMarked: true' in registration,'fixed H02 shape uses shared driver without expected result')
command=load(P/'proposed-primary-red-command-v1.json');a=command['args'];check(command['executable']==f['node']['executable'] and a[0]==str(pathlib.Path(f['packages']['vitest']['resolved'])/'vitest.mjs') and command['workdir']==str(W/'packages/db'),'exact executable/workdir/CLI identity');check(a==[a[0],'run','--config','vite.config.ts','tests/query/pagination-oracle.property.test.ts','-t','retains complete windows across joined failure histories for a fixed seed','--maxWorkers=1','--no-file-parallelism'],'exact proposed fixed family argv');check(command['environment']=={'TANSTACK_DB_ORACLE_RUNS_MULTIPLIER':'1'} and len(command['requiredUnsetEnvironment'])==4,'multiplier/replay environment')
vite=(W/'packages/db/vite.config.ts').read_text();check('enabled: true' in vite and 'provider: `istanbul`' in vite and 'typecheck: { enabled: true' in vite and 'setupFiles: [`./tests/test-setup.ts`]' in vite,'ordinary package setup retained')
static=load(P/'actual-static-tool-completions-v1.json');check(all(static[k]['exit']==0 for k in ['prettierFinal','eslintDefaultHeapV2','eslintFinal','typecheckFinal','sourceOracleFeedbackFinal','reportWorktreeRequiredLint']),'saved final static returns');check(static['eslintCappedOriginal']['exit']==134 and static['typecheckV1']['exit']==static['typecheckV2']['exit']==2,'older failed static returns retained')
for k in ['eslintFinal','typecheckFinal']:check((P/static[k]['log']).read_bytes()==b'','saved empty static log '+k)
check((P/static['sourceOracleFeedbackFinal']['log']).read_text().strip()=='{}','saved source feedback report');check('overlapped briefly' in static['serialSchedulingException'],'static scheduling exception retained')
check(f['runtime']==0 and 'UNREACHED' in f['reaches'] and 'NOT ADMITTED' in command['runtimeAdmission'],'no runtime/reach/admission claim')
# Source-only enforcement limits, not product experiments.
replay_only_new=len(re.findall(r'oracleReplayTest\(',text))==3
successbranch=driver[driver.index('      } else {\n        holding = false'):]
limits={'fullChildPayloadCompared':False,'downstreamOrEventReplicaCompared':False,'failureRole':'anti-join only; include failure remains another planned dimension','normalReplayNeedsExplicitTestNameFilter':replay_only_new,'normalReplayReason':'older tests in this same file do not use oracleReplayTest; only new fixed/random/pin registrations do','receivingSuccessor':'required and not prepared/run here','outerContainment':'not prepared/admitted by this source packet','runActual':'all primary reaches UNREACHED; source-only success is not product GREEN'}
facts={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':__doc__,'knownHashes':known,'packetEntries':packet_count,'sourceBindings':source_count,'sourceCopies':copy_count,'unchangedProduction':511,'priorSourceKeys':len(old),'oldBindingDeltas':deltas,'addedSourceInputs':list(f['primaryAndSupportFilesAddedToBinding']),'preservedPriorPacketResultEntries':prior_records,'preservedPriorCounts':record_counts,'dependencyPackages':9,'dependencyPayloads':payloads,'Node':1,'locks':2,'links':4,'budgetsUnchanged':old_budgets,'orderedFailureCheckpointPositions':positions,'exactProposedRed':command,'sourceOnlyLimits':limits,'staticRecords':static,'allAuditChecksPass':not errors,'errors':errors,'productExecutions':0,'nativeExecutions':0,'modelExecutions':0,'processProbes':0,'primaryReach':'UNREACHED','candidateRaw20':'all UNREACHED','actualHelperNoActiveOperation':'required and UNREACHED','state14':'proposed/unadopted'}
p=O/'pagination-failed-peer-source-independent-facts-v1.json';p.write_text(json.dumps(facts,indent=2)+'\n');print(json.dumps({'artifact':str(p),'sha256':sha(p),'errors':errors,'packetEntries':packet_count,'sourceBindings':source_count,'copies':copy_count,'productionUnchanged':511,'payloads':payloads,'preservedPriorEntries':prior_records}))
