"""Independent static U/V source/mapping audit. No bound module or program runs."""
import datetime, difflib, hashlib, json, os
from pathlib import Path
O=Path(__file__).resolve().parent;H=O.parent
U=H/'candidate-controls-pagination-qualified-peer-diagnostics-source-v1'
V=H/'candidate-controls-pagination-qualified-peer-receiving-operational-preparation-v1'
S=H/'candidate-controls-pagination-receiving-checkpoint-peer-diagnostics-successor-v1'
D=H/'candidate-controls-pagination-shared-window-receiving-operational-preparation-v1'
E=H/'candidate-controls-pagination-shared-window-failure-receiving-runtime-v1'
Q=H/'candidate-controls-pagination-failed-peer-shared-receiving-successor-v1'
N=H/'candidate-controls-pagination-2gib-shared-receiving-containment-v1'
errors=[]
def check(v,m):
 if not v:errors.append(m)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def pairs(xs):
 d={}
 for k,v in xs:
  if k in d:raise ValueError('duplicate JSON key '+k)
  d[k]=v
 return d
def load(p):return json.loads(Path(p).read_text(),object_pairs_hook=pairs,parse_constant=lambda x:(_ for _ in ()).throw(ValueError(x)))
def bound(p,h):check(sha(p)==h,'hash '+str(p))
def fmap(root,m):
 for name,v in m.items():
  p=Path(root)/name;bound(p,v['sha256'] if isinstance(v,dict) else v)
  if isinstance(v,dict):check(p.stat().st_size==v['bytes'],'size '+str(p))
def packet(root,digest,count):
 bound(root/'packet-manifest-v1.json',digest);m=load(root/'packet-manifest-v1.json');fmap(root,m['files']);check(len(m['files'])==count,'members '+str(root))
 actual={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()}
 if root==D:
  extras=actual-set(m['files'])-{'packet-manifest-v1.json'}
  preserved=load(E/'raw-copy-verification-v1.json')['copies']
  origin_map={i['origin']:i for i in preserved}
  check(len(extras)==14,'D fourteen historical post-freeze additions')
  for name in extras:
   if name=='root-exact-one-failure-receiving-admission-v1.json':bound(root/name,'61d6c5fee04057a468647bc392127d43f5f092708e287aa3b43cd932be439769')
   else:
    item=origin_map.get(str(root/name));check(item is not None,'D addition belongs to sealed E origin map '+name)
    if item:bound(root/name,item['sha256']);check((root/name).read_bytes()==Path(item['copy']).read_bytes(),'D original remains exact E copy '+name)
  check(set(m['files']).issubset(actual),'D sealed members remain present')
 else:check(actual==set(m['files'])|{'packet-manifest-v1.json'},'closure '+str(root))
 for name in m['files']:
  if name.endswith('.json'):load(root/name)
 return m
um=packet(U,'bc7c1ad1828d056fcf57aac1fdf6038bbc9a564d622cff75c262b9e8a1d97ca0',90)
vm=packet(V,'d9cfd4cf3abbc8b1b41d148067eced85af9c8711907bd051aba1a41aff5e26a5',14)
sm=packet(S,'a56541c3188c6a8348aa1187575e0192410dc3e8d86d1a9697628dc4a9312d25',120)
dm=packet(D,'b392686f0a401be65ca4c364efe54310e4ec454204f59f18859b7883cd0d6403',21)
ef=load(E/'result-freeze-v1.json');bound(E/'result-freeze-v1.json','5dd02625d22a6f096470737b3d09a447cf89c985d91f819e5e30cdda5c5e7b8a');check(len(ef['files'])==1996,'E1996');fmap(E,ef['files'])
rel={i['from']:i['to'] for i in load(Q/'artifact-snapshot-relocation-v1/path-map-v1.json')['relocations']}
for name,count,mapping in [('packet-sha256-v1.json',126,rel),('packet-sha256-with-snapshot-relocation-v2.json',133,{})]:
 m=load(Q/name);check(len(m)==count,'Q count '+name);fmap(Q,{mapping.get(k,k):v for k,v in m.items()})
u=load(U/'source-freeze-v1.json');s=load(S/'source-freeze-v1.json');d=load(D/'source-freeze-receiving-v1.json');q=load(Q/'source-freeze-v1.json')
b=load(V/'inert-control-v1/source-freeze-v1.json.txt');plan=load(V/'inert-materialization-plan-v1.json');compiler=load(V/'proposed-minimum-compile-gate-v1.json');cfg=load(V/'inert-control-v1/typecheck.tsconfig.json.txt')
for path,h in [('source-freeze-v1.json','37e2dcffb845cdbb771fd6d67a117b5cc8b988ff998663a26edd24d697d0f187'),('report-v1.md','cd6cdbebfc1c01cda29815af0a27d73f0c3a7227b2c20fdef8dfb08c0c85a3f4')]:bound(U/path,h)
for path,h in [('report-v1.md','4405bc415a1afe38577f76355a9433a280643363bad2538ab9dff5062670c724'),('inert-control-v1/source-freeze-v1.json.txt','54d74f31100cae71aeef5139a6c47dc93c9bc35e5fb10cc7537083b55eb86fca'),('inert-materialization-plan-v1.json','0f81439c660770d62b2a96fdebcf8de70c51258501d29c77fd836db9755a1b26'),('proposed-minimum-compile-gate-v1.json','5804ede864ce3adfd596453fc8bba1b5f7ec03d8d1bb672f30ef1ed7980ac6da')]:bound(V/path,h)
W=Path(u['acceptedActiveWorktree']);R=Path(__file__).resolve().parents[5]
for key,orig in [('acceptedActiveSourceBindingsUnchanged',q['sourceBindings']),('acceptedSourceCopiesUnchanged',q['sourceCopies']),('acceptedProductionFilesUnchanged',q['productionFiles'])]:check(u[key]==orig and s[key]==orig,'unchanged accepted map '+key)
fmap(W,q['sourceBindings']);fmap(q['sourceCopyRoot'],q['sourceCopies'])
check(len(q['sourceBindings'])==596 and len(q['sourceCopies'])==85 and len(q['productionFiles'])==511,'accepted map sizes')
copy=load(U/'copy-prefix-map-v1.json');check(copy['copyCount']==len(copy['copies'])==85,'U85copy map');changed=[]
for item in copy['copies']:
 name=item['canonicalRelativePath'];p=U/item['inactiveCopyRelativePath'];origin=Path(item['origin'])
 check(item['inactiveCopyRelativePath']=='sources/'+name+'.txt' and item['proposedRuntimeRelativePath']==name and origin==S/('sources/'+name+'.txt'),'explicit U copy geometry '+name)
 bound(origin,item['originSha256']);bound(p,u['inactiveCopies'][name]);check(u['inactiveCopyFiles'][name]=={'path':str(p),'sha256':sha(p)},'U explicit suffix record '+name)
 if p.read_bytes()!=origin.read_bytes():changed.append(name)
driver='packages/query-db-collection/tests/queued-answer-completion-baseline-driver.ts';check(changed==[driver],'only U driver comment changed')
old=(S/('sources/'+driver+'.txt')).read_text();new=(U/('sources/'+driver+'.txt')).read_text()
a='      // A diagnostic failure cannot replace the original binding-guard error\n      // or introduce a new binding predicate. Keep it separately on stderr.'
z='      // The helper suppresses direct diagnostic capture exceptions and\n      // best-effort logs them separately. Receipt-sink failures remain\n      // operational faults under unchanged transport/teardown; this packet\n      // claims no unconditional preservation of the original terminal error.'
check(old.count(a)==new.count(z)==1 and new.replace(z,a)==old,'U exact comment-only reversal')
patch=''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='sealed-S/'+driver,tofile='inactive-U/'+driver));check(patch==(U/'qualified-comment-change-v1.diff.txt').read_text(),'U exact diff')
expected=dict(q['sourceBindings']);expected[driver]=sha(U/('sources/'+driver+'.txt'));check(u['proposedSourceBindings']==b['sourceBindings']==expected,'exact source596 with one proposed driver')
check(b['productionFiles']==q['productionFiles'] and set(b['instrumentFiles']).isdisjoint(b['sharedInstrumentFiles']) and set(b['productionFiles']).isdisjoint(set(b['instrumentFiles'])|set(b['sharedInstrumentFiles'])),'disjoint maps')
check({**b['productionFiles'],**b['instrumentFiles'],**b['sharedInstrumentFiles']}==expected and (len(b['instrumentFiles']),len(b['sharedInstrumentFiles']))==(62,23),'source union511+62+23')
check(b['sourceCopies']==u['inactiveCopies'] and b['sourceCopyFiles']==u['inactiveCopyFiles'],'explicit U support map used')
check(b['completionInstrumentFiles']=={name:expected[name] for name in d['completionInstrumentFiles']} and len(b['completionInstrumentFiles'])==18,'exact completion18')
check(b['receivingProductionFiles']==d['receivingProductionFiles'] and len(b['receivingProductionFiles'])==161,'exact receiving161')
qualification=load(u['rootQualification']['path']);bound(u['rootQualification']['path'],u['rootQualification']['sha256'])
claim=qualification['qualification']['replacementClaim'];check(u['diagnostics']==u['qualificationClaim']==b['diagnosticFaultQualification']==claim,'exact qualified claim')
check(claim in (U/'report-v1.md').read_text() and claim in (V/'report-v1.md').read_text(),'reports qualified')
for item in [u['predecessorS'],u['rootQualification'],u['independentSourceReview'],b['qualifiedSourcePacket'],b['operationalPredecessorD'],b['historicalOperationalQualification']]:bound(item['path'],item['sha256'])
root=Path(plan['proposedRoot']);code=Path(plan['proposedCodeRoot']);control=Path(plan['proposedControlRoot'])
check(code==root/'code' and control==root/'control' and b['worktree']==str(code),'fresh root geometry')
for p in [root,code,control]:check(not os.path.lexists(p),'fresh prefix absent '+str(p))
check(len(plan['regularCodeAndLockFiles'])==597 and len(plan['regularControlFiles'])==6 and len(plan['dependencyReuseSymlinks'])==4,'597/6/4 plan')
code_map={};targets=[]
for item in plan['regularCodeAndLockFiles']:
 name=item['runtimeRelativePath'];p=Path(item['runtimePath']);check(not Path(name).is_absolute() and '..' not in Path(name).parts and p==code/name,'code target path '+name);bound(item['from'],item['fromSha256']);code_map[name]=item['fromSha256'];targets.append(p)
 if name in q['productionFiles']:check(item['role']=='unchanged-production' and Path(item['from'])==W/name,'production copy origin '+name)
 elif name in u['inactiveCopies']:check(item['role']=='qualified-inactive-support-copy' and item['from']==u['inactiveCopyFiles'][name]['path'],'support copy origin '+name)
 else:check(name=='pnpm-lock.yaml' and item['role']=='repository-lock-tool-input','sole lock extra')
check(code_map=={**expected,'pnpm-lock.yaml':b['lockfiles']['repoPnpmLock']},'exact597 code map')
controls={}
for item in plan['regularControlFiles']:
 p=Path(item['runtimePath']);check(p.is_relative_to(control) and p!=control,'control inside root');bound(item['from'],item['fromSha256']);controls[str(p)]=item;targets.append(p)
expected_controls=[control/'typecheck.tsconfig.json',control/'source-freeze-v1.json',*[control/f'{kind}/{name}.json' for kind in ['programs','recipes'] for name in ['inline-window-failure-first','inline-window-success']]]
check(set(controls)=={str(p) for p in expected_controls},'exact six control destinations')
links={}
for item in plan['dependencyReuseSymlinks']:
 name=item['runtimeRelativePath'];p=Path(item['runtimePath']);check(p==code/name and item['expectedIsSymlink'] and item['target']==b['dependencyReuseLinks'][name]['resolved'],'exact proposed reuse link '+name);links[p]=Path(item['target']);targets.append(p)
check(len(set(targets))==607,'607 unique file/control/link targets')
for p in targets:
 for link in links:
  check(p==link or not p.is_relative_to(link),'no regular target nested under reuse symlink')
ancestor_dirs={parent for p in targets for parent in p.parents if parent==root or parent.is_relative_to(root)}
check(not set(targets)&ancestor_dirs,'file/link versus directory geometry disjoint')
check(b['node']==d['node'] and b['lockfiles']==d['lockfiles'] and b['dependencyReuseLinks']==d['dependencyReuseLinks'],'same Node locks links')
bound(b['node']['executable'],b['node']['sha256']);bound(W/'pnpm-lock.yaml',b['lockfiles']['repoPnpmLock']);bound(W/'node_modules/.pnpm/lock.yaml',b['lockfiles']['installedPnpmLock'])
for name,item in b['packages'].items():
 previous=d['packages'][name];check({k:v for k,v in item.items() if k not in ['logical','historicalLogical']}=={k:v for k,v in previous.items() if k!='logical'},'same package payload '+name)
 logical=Path(item['logical']);matches=[link for link in links if logical.is_relative_to(link)];check(len(matches)>=1,'logical package under explicit reuse link '+name)
 if matches:
  link=max(matches,key=lambda p:len(p.parts));check(str((links[link]/logical.relative_to(link)).resolve())==item['resolved'],'logical resolution under proposed symlink '+name)
sup=load(N/'supplemental-tool-inputs.json');bound(N/'supplemental-tool-inputs.json','cd7eda6b0e649cb2aa019b83dac04f7821d52e34d0c62de144ac6d280636ba50')
seen=set();payloads=0
for item in list(b['packages'].values())+sup['packages']:
 p=Path(item['resolved'])
 if str(p) in seen:continue
 seen.add(str(p));expected_files=item['regularPayloadFilesMap'];actual=set()
 for directory,dirs,files in os.walk(p,followlinks=False):
  dirs[:]=[x for x in dirs if x!='node_modules' and not (Path(directory)/x).is_symlink()]
  for name in files:
   f=Path(directory)/name
   if f.is_file() and not f.is_symlink():actual.add(str(f.relative_to(p)))
 check(actual==set(expected_files),'exact own payload closure '+str(p));fmap(p,expected_files);payloads+=len(expected_files)
check((len(seen),payloads)==(255,11974),'finite255/11974 closure')
check(len(sup['resolutionEdges'])==405 and len(sup['uninstalledDeclaredOptionalOrPeerDependencies'])==112,'finite405/112 closure')
for edge in sup['resolutionEdges']:check(str(Path(edge['logical']).resolve())==edge['resolved'],'resolution edge '+edge['logical'])
for item in sup['uninstalledDeclaredOptionalOrPeerDependencies']:
 p=Path(item['from']);check(not any((q/'node_modules'/item['dependency']).exists() for q in [p,*p.parents]),'optional-peer absence '+item['dependency'])
check(compiler['command']=={'executable':b['node']['executable'],'args':[compiler['compilerEntry']['path'],'--project',str(control/'typecheck.tsconfig.json'),'--noEmit','--incremental','false','--pretty','false','--listFiles'],'cwd':str(code)},'minimum exact compiler argv')
bound(compiler['compilerEntry']['path'],compiler['compilerEntry']['sha256']);check(compiler['compilerEntry']['version']=='5.9.3' and compiler['compilerEntry']['fullPackagePayloadIdentity']==b['packages']['typescript']['regularPayloadIdentity'],'compiler payload identity')
check(cfg['extends']==str(code/'packages/db/tsconfig.json') and cfg['compilerOptions']=={'rootDir':str(code),'noEmit':True,'incremental':False,'typeRoots':[str(code/'node_modules/@types')],'types':['node']},'minimum no relaxed compiler settings')
entries=compiler['entryFiles'];check(len(entries)==7 and cfg['include']==[i['path'] for i in entries],'exact seven compiler entries')
for item in entries:check(code_map[str(Path(item['path']).relative_to(code))]==item['sha256'],'compiler entry source pin')
check('independently fixed' in compiler['containment'] and not compiler['executed'] and not compiler['receivingAuthorityAfterPass'],'compile containment deferred to exact separate admission')
proposals=[]
for name,schedule,gate in [('inline-window-failure-first','failure-first','source-failed-peer'),('inline-window-success','success','held-window')]:
 rp=V/f'inert-control-v1/recipes/{name}.json.txt';pp=V/f'inert-control-v1/programs/{name}.json.txt';recipe=load(rp);program=load(pp);previous=load(D/f'frozen-inputs-v1/recipes/{name}.json')
 check(set(recipe)==set(previous) and {k for k in recipe if recipe[k]!=previous[k]}=={'worktree','sourceFreeze','sourceFreezeSha256','programFile','outputDirectory'},'exact five recipe changes '+name)
 check(pp.read_bytes()==(D/f'frozen-inputs-v1/programs/{name}.json').read_bytes() and program['windowReceivingSchedule']==schedule and program['gate']==gate,'exact D program '+name)
 check(recipe['sourceFreeze']==str(control/'source-freeze-v1.json') and recipe['sourceFreezeSha256']==sha(V/'inert-control-v1/source-freeze-v1.json.txt') and recipe['programFile']==str(control/f'programs/{name}.json') and recipe['programSha256']==sha(pp),'recipe control binding '+name)
 proposal=load(V/f'proposed-exact-{name}-command-v1.json');proposals.append(proposal)
 check(proposal['executable']==b['node']['executable'] and proposal['args']==[str(code/'scripts/h02-progress/completion-parent.mjs'),str(control/f'recipes/{name}.json')] and proposal['cwd']==str(code),'receiving argv '+name)
 check(recipe['limits']==previous['limits'] and recipe['args']==previous['args'],'unchanged receiving limits/selection '+name)
 output=Path(proposal['outputRoot']);check(not os.path.lexists(output) and recipe['outputDirectory']==str(output/'parent-command'),'fresh separate output parent '+name)
 check(proposal['recipe']['sha256']==sha(rp) and proposal['recipe']['program']['sha256']==sha(pp),'proposal recipe/program hashes '+name)
 check(proposal['actualToolRequirement']=={'sandbox_permissions':'require_escalated','yield_time_ms':1000,'maxInvocations':'one only if separately admitted'} and not proposal['executed'],'separate exact receiving actual requirement '+name)
check(proposals[0]['outputRoot']!=proposals[1]['outputRoot'],'distinct failure success roots')
check(plan['stages']==['independent operational source review','separate ROOT materialization-only admission','materialize and freeze exact copy/link/tool identities','separate ROOT compile-only admission for minimum compiler gate','independent/root compile result review','separate exact one failure receiving admission','independent/root failure actual-result classification','separate success receiving admission if ROOT explicitly grants it'],'eight explicit separate stages')
check(not plan['executed'] and not b['runtimeMaterialized'] and b['runtime']==b['compile']==0,'inert states')
ledger=O/'raw-items-ledger-v1.jsonl';check(len(ledger.read_bytes().splitlines())==123 and sha(ledger)=='c245c8e85f6538cf34063eda634cfce1e1bb77fd1a8c71badf564e4fa8a60b75','123row ledger prefix')
facts={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':__doc__,'UManifest':sha(U/'packet-manifest-v1.json'),'VManifest':sha(V/'packet-manifest-v1.json'),'USealedMembers':90,'VSealedMembers':14,'SSealedMembers':120,'DSealedMembers':21,'DHistoricalPostFreezeAdditions':14,'priorAuditFailure':'v1 incorrectly applied pre-run D directory closure to known later admission and E-sealed runtime originals; failed v1 preserved','ESealedMembers':1996,'QHistoricalMappedMembers':126,'QLiteralMembers':133,'WActiveBindings':596,'QSupportCopies':85,'productionEntries':511,'proposedSources':596,'proposedCodeLockFiles':597,'proposedControlFiles':6,'proposedLinks':4,'distinctTargets':len(set(targets)),'derivedAncestorDirectories':len(ancestor_dirs),'UChangedCopies':changed,'UExecutableStatementChanges':0,'completionSubset':18,'receivingProductionSubset':161,'namedPackageRoots':len(seen),'ownPayloadFiles':payloads,'resolutionEdges':405,'optionalPeerAbsences':112,'compilerEntries':7,'compilerInvocations':0,'diagnosticRuntime':0,'newMaterialization':0,'runtimeImports':0,'nativeInvocations':0,'processProbes':0,'runtimeAdmission':False,'compilerContainment':'still requires separate exact admission selection','productCredit':False,'allAuditChecksPass':not errors,'errors':errors,'slot2':'return after report','ledgerPrefixRows':123,'ledgerPrefixSha256':sha(ledger)}
out=O/'qualified-operational-source-independent-facts-v2.json'
with out.open('x') as f:json.dump(facts,f,indent=2);f.write('\n')
print(json.dumps({'facts':str(out),'sha256':sha(out),'errors':errors,'packageRoots':len(seen),'payloads':payloads,'targets':len(set(targets)),'ancestorDirectories':len(ancestor_dirs)}));raise SystemExit(bool(errors))
