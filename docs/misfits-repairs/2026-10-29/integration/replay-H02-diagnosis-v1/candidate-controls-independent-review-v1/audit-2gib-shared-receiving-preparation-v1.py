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
check({str(p.relative_to(N)) for p in N.rglob('*') if p.is_file()}==set(n['files'])|{'packet-manifest.json'},'N exact current file set')
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
# Pure source/AST comparison. Never import or evaluate these modules.
launch=(N/'launch.py').read_text();oldlaunch=(P/'launch.py').read_text();supervisor=(B/'supervisor-2gib.py').read_text()
lt=ast.parse(launch);st=ast.parse(supervisor)
actual_patch=''.join(difflib.unified_diff(oldlaunch.splitlines(keepends=True),launch.splitlines(keepends=True),fromfile='prior/launch.py',tofile='successor/launch.py'))
check(actual_patch==(N/'wrapper-explicit-successor-diff-v1.patch').read_text(),'exact complete wrapper diff')
design=load(B/'operational-successor-design-v1.json');original=pathlib.Path(design['originalSupervisor']['path']);check(sha(original)==design['originalSupervisor']['sha256']=='9566ec6fe9fdace272d8e204e3a8c86e407f8da50f4ffc11f7d5961bdd07cfb2','original supervisor frozen')
orig=original.read_text();check(orig.count('1073741824')==2 and orig.count('1 GiB sampled group RSS containment')==1,'exact old threshold occurrence counts')
check(orig.replace('1073741824','2147483648').replace('1 GiB sampled group RSS containment','2 GiB sampled group RSS containment')==supervisor,'threshold-only successor full-source equality')
check(sha(B/'supervisor-2gib.py')=='dbc0406d2118f5ad4ca93908d974b829b6bf3370015d27162c329fae323eb042','supervisor successor identity')
body=next(x for x in st.body if isinstance(x,ast.FunctionDef) and x.name=='run_one')
thresholds=[x for x in ast.walk(body) if isinstance(x,ast.Compare) and isinstance(x.left,ast.Name) and x.left.id=='rss']
check(len(thresholds)==1 and isinstance(thresholds[0].ops[0],ast.LtE) and thresholds[0].comparators[0].value==2147483648,'run_one exact <=2GiB AST predicate')
cases=load(B/'pure-boundary-results-v1.json')['cases'];check(cases==[{'rssBytes':i,'allowed':i<=2147483648} for i in [0,1073741824,1073741825,2147483647,2147483648,2147483649,3221225472]],'saved seven exact integer boundaries')
functions={x.name:ast.get_source_segment(launch,x) for x in lt.body if isinstance(x,ast.FunctionDef)}
v=functions['verify_inputs'];e=functions['execute'];loader=functions['load_supervisor'];capture=functions['capture_report']
check(e.index('verify_inputs(binding_sha)')<e.index('load_supervisor(binding)')<e.index('out.mkdir(mode=0o700)')<e.index('supervisor.run_one(recipe, out, binding_sha)'),'verify before import/output/run; one run_one')
check(e.count('supervisor.run_one(')==1 and 'supervisor.execute(' not in launch,'one primary only; never copied six-batch entry')
check(loader.index("digest(item['path'])")<loader.index('spec.loader.exec_module(supervisor)'),'supervisor rehash immediately before definitions import')
check(all(s in v for s in ["len(source['sourceBindings']) == 596","'toolchainRecovery'","payload_names(base) == set(expected)","recipe['argv'] == proposal['args'] + recipe['presentationArgs']","recipe['groupRssContainmentBytes'] == 2147483648"]),'exact bound source and successor preflight guards')
check(recipe['argv']==proposal['args']+recipe['presentationArgs'] and recipe['cwd']==proposal['workdir'] and recipe['executable']==proposal['executable'],'exact Q command plus presentation only')
check(recipe['presentationArgs']==['--reporter=default','--reporter=json','--outputFile.json='+recipe['expectedOutput']['path']],'exact reporter-only additions')
check(recipe['groupRssContainmentBytes']==2147483648 and recipe['outerWallContainmentMs']==30000 and recipe['samplingIntervalMs']==80 and recipe['inventoryTimeoutMs']==1000 and recipe['leaderReapTimeoutMs']==3000 and recipe['descendantCleanupWindowMs']==3000,'exact operational limits')
check(recipe['campaign']=={'seed':1665,'runs':8,'familySchedules':['failure-first','peer-first','success'],'noOtherCampaignAdmitted':True},'fixed seed1665/eight/three schedules')
check(recipe['environment']==dict(proposal['environment'],CI='1',NO_COLOR='1') and recipe['environment']=={'TANSTACK_DB_ORACLE_RUNS_MULTIPLIER':'1','CI':'1','NO_COLOR':'1'},'environment exact')
check("name.startswith(('H02_', 'VITEST_', 'TANSTACK_DB_ORACLE_'))" in e and "name in recipe['envUnset']" in e and 'NODE_OPTIONS' in recipe['envUnset'] and 'NODE_PATH' in recipe['envUnset'],'clear prefixes/options and preserve default heap')
check(all(s in capture for s in ['stat.S_ISREG(before.st_mode)','before.st_nlink == 1','before.st_size <= 16777216','len(selected) == 1 and len(executed) == 1 and selected[0] is executed[0]',"selected[0].get('ancestorTitles') == recipe['expectedOutput']['ancestorTitles']"]),'report freshness/bound/count/identity/ancestry')
check(recipe['expectedOutput']['title']=='retains complete windows across joined failure histories for a fixed seed' and recipe['expectedOutput']['ancestorTitles']==['pagination recomputation oracle','joined window failure for a fixed seed'],'exact selected title/ancestry')
check("if state['primaryFailure'] is not None:" in e and "supervisor.fail(outer, 'unchanged-supervisor-child-result'" in e and "return 0 if outer['status'] == 'child-zero-with-report' else 1" in e,'raw child failure propagates outer nonzero')
check('start_new_session=True' in supervisor and 'actual = os.getpgid(child.pid)' in supervisor and "state['pgidVerified'] = True" in supervisor and "os.killpg(state['pgid'], signal.SIGKILL)" in supervisor and 'child.wait(timeout=3)' in supervisor and "require(not state['remainingGroupRows'], 'original group absence unestablished')" in supervisor,'reviewed group lifecycle source preserved')
launch_proposal=load(N/'proposed-exact-one-launch-v1.json');check(launch_proposal['args']==[str(N/'launch.py'),'--execute-exact-one',n['bindingSha256']] and launch_proposal['sandbox_permissions']=='require_escalated' and launch_proposal['noAutomaticRetry'] and not launch_proposal['receivingCommandsAdmitted'],'exact proposed actual call/permission/one-shot/no receiving')
out=pathlib.Path(recipe['outputDirectory']);check(not os.path.lexists(out),'fresh runtime output absent')
# Q relocation is historical-only and not an operational input path in N.
mapfile=Q/'artifact-snapshot-relocation-v1/path-map-v1.json';pathmap=load(mapfile)
oldpath=pathmap['relocations'][0]['from'];newpath=pathmap['relocations'][0]['to']
all_n_text='\n'.join((N/name).read_text() for name in n['files'])
check(oldpath not in all_n_text and newpath not in all_n_text and 'packet-sha256-v1.json' not in all_n_text and 'packet-sha256-with-snapshot-relocation-v2.json' not in all_n_text,'N pins no relocated Q snapshot or Q packet manifest')
check(binding['sourceFreeze']['sha256']==sha(Q/'source-freeze-v1.json') and binding['proposedCommand']['sha256']==sha(Q/'proposed-primary-fixed-red-command-v1.json'),'N relevant Q pins unchanged after relocation; no rebind needed')
check(not n['runtimeAdmitted'] and n['runtimeInvocations']==0 and recipe['runtimeAdmission'].startswith('NOT ADMITTED'),'no claimed runtime admission')
ledger=O/'raw-items-ledger-v1.jsonl';check(len(ledger.read_bytes().splitlines())==107,'N received ledger retained')
facts={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':__doc__,'packetManifestSha256':sha(N/'packet-manifest.json'),'bindingSha256':sha(N/'binding.json'),'members':members,'memberBytes':n['memberBytes'],'sourceFreezeSha256':sha(Q/'source-freeze-v1.json'),'sourceBindings':source_count,'sourceCopies':copies,'unchangedProduction':len(f['productionFiles']),'namedPackageRoots':len(seen),'ownPayloadFiles':payloads,'ownPayloadBytes':payload_bytes,'declaredEdges':len(sup['resolutionEdges']),'absentOptionalOrPeer':len(sup['uninstalledDeclaredOptionalOrPeerDependencies']),'locks':2,'reuseLinks':4,'oldSupplementSha256':sha(N/'supplemental-tool-inputs.json'),'thresholdBoundaryCases':cases,'wrapperCompleteDiffSha256':sha(N/'wrapper-explicit-successor-diff-v1.patch'),'recoveryReceiptSha256':binding['toolchainRecovery']['sha256'],'QHistoricalRelocationAffectsN':False,'rebindNeeded':False,'runtimeOutputAbsent':not os.path.lexists(out),'sourceFindings':[],'explicitUnvalidatedControls':['No wrapper/parser mocked execution by reviewer','No native PGID/signal/reap/containment calibration by reviewer','No evaluated-source or undeclared dynamic-import binding','No actual selected-test count/report/reach/assertion from this preparation'],'preservedLimits':['Prior cf550f operational RSS stop only; body UNESTABLISHED','Inner completion-supervisor failed-kill path unvalidated separately','A38 metadata isolated and historical777 old shim hashes unknown','Q actual primary/failure+success receiving gates still pending','all20 candidate states and actual-helper/no-active-operation UNREACHED;state14 unadopted'],'allAuditChecksPass':not errors,'errors':errors,'productExecutions':0,'modelExecutions':0,'testExecutions':0,'nativeRunInvocations':0,'boundProgramImports':0,'processProbes':0,'runtimeAdmission':False,'slot2':'remains returned'}
p=O/'2gib-shared-receiving-preparation-independent-facts-v1.json';p.write_text(json.dumps(facts,indent=2)+'\n')
print(json.dumps({'facts':str(p),'sha256':sha(p),'roots':len(seen),'payloads':payloads,'sources':source_count,'copies':copies,'errors':errors}))
raise SystemExit(bool(errors))
