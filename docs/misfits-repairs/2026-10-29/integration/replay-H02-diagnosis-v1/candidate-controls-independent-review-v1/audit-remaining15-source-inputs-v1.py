"""Source/input evidence only; no constructor, compiler, JS, model, or native run."""
import collections,datetime,hashlib,json,pathlib
OUT=pathlib.Path(__file__).resolve().parent;H=OUT.parent
I=H/'candidate-controls-remaining-baselines-inputs-v1'; C=H/'candidate-controls-combined-source-v3'; OLD=H/'candidate-controls-baseline-batch-preparation-v1'; CHECK=H/'candidate-controls-remaining-baselines-input-checks-v1'
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def load(p):return json.loads(pathlib.Path(p).read_text())
errors=[]
def check(v,m):
 if not v:errors.append(m)
def fmap(base,entries,label):
 for p,e in entries.items():
  try:check(sha(pathlib.Path(base)/p)==e,f'{label}: {p}')
  except OSError as x:errors.append(f'{label}: {p}: {x}')
 return len(entries)
known={'input-freeze-v1.json':'7a819f08e33cd635c6479ba6f38c7d9471f322f38f60762b121be3e9859aa852','input-packet-sha256-v1.json':'0365e49182e79b8f6f7a2592bfacfd0c029699691a20cf5c28f5dc701344d4d9','selection-plan-v1.json':'af1220160208b119c76254ecadb5a0a4fffc104f5aba9a445f262a959bfcb80e','mandatory-first-baseline-gate-v1.json':'bc7f7f9a9c8b56c12c6e2cf9bf3d477c7feb31a42278338c7a74ffb4a3a655ef','static-input-validation-v1.json':'1fe2d7bfd5f4d0b8ac0defa1aba7505a0d6d84f8e4b40c63431cb46d9324fe23'}
fmap(I,known,'known-input-identities');f=load(I/'input-freeze-v1.json'); s=load(I/'selection-plan-v1.json');gate=load(I/'mandatory-first-baseline-gate-v1.json')
freezefiles=fmap(I,f['files'],'input-freeze-files');packetfiles=fmap(I,load(I/'input-packet-sha256-v1.json'),'input-packet')
combinedcount=fmap(C,load(C/'packet-sha256-v3.json'),'combined-packet');checkcount=fmap(CHECK,load(CHECK/'packet-sha256-v1.json'),'post-lint-packet')
check(sha(f['sourceFreeze'])==f['sourceFreezeSha256']=='aa5f26fac905f604b3a3d24f752b57bf9312e0de563cabf3a2e4a9672b49aeb3','source freeze');check(sha(f['sourcePacket'])==f['sourcePacketSha256']=='88c6716b78897a288e15925518388e6e99afec832b990012280d06d50ed358d0','source packet')
check(f['cells']==s['cells'],'selection/freeze same cell rows');old=load(OLD/'input-freeze-v1.json');expectedids=[c['id'] for c in old['cells'] if c['id']!='inline-park-root'];check([c['id'] for c in f['cells']]==expectedids,'original remaining order');check(len(set(expectedids))==15 and f['programs']==f['recipes']==15,'exact fifteen programs/recipes');check(s['excludedCell']=='inline-park-root' and s['admittedCells']==0,'excluded first/admitted0')
allowed={'bindingProfile','outputDirectory','programFile','sourceFreeze','sourceFreezeSha256'};limits={'wallMs':60000,'nodeHeapMiB':384,'groupRssBytes':1073741824,'samplingMs':100}; facts=[]
for c in f['cells']:
 p=pathlib.Path(c['programFile']);hp=pathlib.Path(c['historicalProgramFile']);r=pathlib.Path(c['recipeFile']);hr=pathlib.Path(c['historicalRecipeFile']);program=load(p);recipe=load(r);historical=load(hr)
 check(p.read_bytes()==hp.read_bytes() and sha(p)==c['programSha256']==c['historicalProgramSha256'],'exact program '+c['id']);check(sha(r)==c['recipeSha256'] and sha(hr)==c['historicalRecipeSha256'],'recipe hashes '+c['id'])
 changed={k for k in recipe.keys()|historical.keys() if recipe.get(k)!=historical.get(k)};check(changed==allowed and c['onlyRecipeChanges']==sorted(allowed),'only five recipe bindings '+c['id'])
 check(recipe['bindingProfile']=='completion-baseline-v1' and recipe['sourceFreeze']==f['sourceFreeze'] and recipe['sourceFreezeSha256']==f['sourceFreezeSha256'] and recipe['programFile']==str(p) and recipe['programSha256']==sha(p),'new bindings '+c['id'])
 leaf=pathlib.Path(recipe['outputDirectory']);check(str(leaf)==c['outputDirectory'] and leaf==I/'runtime-output-v1'/c['id'] and leaf.parent.is_dir() and not leaf.exists() and not leaf.is_symlink(),'fresh leaf '+c['id'])
 check(c['launchArgvIfSeparatelyAdmitted']==[recipe['executable'],str(pathlib.Path(recipe['worktree'])/'scripts/h02-progress/completion-parent.mjs'),str(r)],'exact argv '+c['id'])
 check(recipe['limits']==limits and recipe['gate']==c['gate']==program['gate'] and recipe['profile']==c['profile']==program['setup']['profile'] and program['parameters']==c['parameters'],'unchanged limits/semantics '+c['id'])
 construction=1+sum(x.get('kind')=='semantic' and x['action']['type']=='restart' for x in program['steps']);check(construction==c['fixtureConstructions'],'fixture count '+c['id'])
 check(c['runtimeAdmission'] is False,'no cell admission '+c['id'])
 facts.append({'id':c['id'],'ordinal':c['ordinal'],'profile':c['profile'],'gate':c['gate'],'programSha256':sha(p),'recipeSha256':sha(r),'onlyRecipeChanges':sorted(changed),'fixtureConstructions':construction,'epochCount':len(program['publicationEpochs']),'semanticActionCount':sum(x['kind']=='semantic' for x in program['steps']),'publicCuts':[x['boundary'] for x in program['steps'] if x['kind']=='baseline-observe'],'sourceAnswerRequirements':sorted(program['sourceAnswerPremises']),'freshOutputLeafAbsent':not leaf.exists(),'runtimeAdmission':False})
check([c['ordinal'] for c in f['cells']]==list(range(2,17)),'original ordinal2..16');check(collections.Counter(c['profile'] for c in facts)=={'inline':6,'facade':9},'six inline/nine facade');check(sum(c['fixtureConstructions'] for c in facts)==f['fixtureConstructionsIfAllSeparatelyAdmitted']==17,'17 total fixtures')
for obj in [f,s]:
 check(obj['limitsPerCell']==limits and obj['innerReceivingWallMs']==20000 and obj['workers']==1 and obj['serial'] is True and obj['stopOnFirstFailureOrUnreachedPremise'] is True and obj['automaticReruns']==obj['resourceIncreases']==obj['constructorCalls']==obj['compilerCalls']==0 and obj['runtimeAdmission'] is False,'serial unchanged bounded source scope')
check(all(v==0 for v in f['runtime'].values()),'zero runtime declared');check(f['mandatoryFirstBaselineGate']==s['mandatoryFirstBaselineGate']==gate,'same mandatory gate')
check(gate['firstBaselineId']=='inline-park-root' and gate['firstResultFreezeSha256']=='0780b64244c8ee668e5187aa65e4f762d501be12e54405cee216f993e04d6b50' and sha(gate['firstResultFreeze'])==gate['firstResultFreezeSha256'],'exact first result prerequisite')
for k in ['independentActualReviewRequired','explicitRootFirstBaselineClassificationRequired','classificationArtifactMustBindExactFirstResultFreeze','newBatchAdmissionMustPinClassificationPathAndSha256','remainingInputsIndependentStaticReviewRequired','separateRootRuntimeBatchAdmissionRequired','unresolvedPrerequisiteBlocksEveryCell','rootOwnsClassificationAndRuntimeAdmission']:check(gate[k] is True,'mandatory gate '+k)
check(gate['runtimeAdmission'] is False,'no gate admission')
archive=load(f['historicalArchiveBinding']['map']); amap={x['originalRelativePath']:x for x in archive['mapping']};ab=pathlib.Path(archive['archiveBase']); historicalcounts={}
for label,path,entries in [('freeze',OLD/'input-freeze-v1.json',old['files']),('packet',OLD/'input-packet-sha256-v1.json',load(OLD/'input-packet-sha256-v1.json'))]:
 for p,e in entries.items():
  target=ab/amap[p]['archiveRelativePath'] if p in amap else OLD/p;check(sha(target)==e,f'historical {label} {p}')
 historicalcounts[label]=len(entries)
for p,m in amap.items():check(not (OLD/p).exists() and sha(ab/m['archiveRelativePath'])==m['sha256'] and (ab/m['archiveRelativePath']).stat().st_size==m['bytes'],f'archive exact/old absent {p}')
check(len(amap)==8,'eight archive entries')
failed=load(OLD/'inline-park-root-result-freeze-v1.json');failedcount=fmap(failed['outputDirectory'],failed['assets'],'failed-result-preserved');success=load(gate['firstResultFreeze']);successcount=fmap(pathlib.Path(gate['firstResultFreeze']).parent,success['files'],'success-result-preserved')
cf=load(f['sourceFreeze']);root=pathlib.Path(cf['worktree']);sourcecount=fmap(root,cf['productionFiles']|cf['instrumentFiles']|cf['sharedInstrumentFiles'],'current-source');payloadcount=0
for p in cf['packages'].values():payloadcount+=fmap(p['resolved'],p['regularPayloadFilesMap'],'payload')
check(sha(cf['node']['executable'])==cf['node']['sha256'],'Node');check(sha(root/'pnpm-lock.yaml')==cf['lockfiles']['repoPnpmLock'] and sha(root/'node_modules/.pnpm/lock.yaml')==cf['lockfiles']['installedPnpmLock'],'two locks')
for p,m in cf['dependencyReuseLinks'].items():q=root/p;check(q.is_symlink()==m['isSymlink'] and str(q.resolve())==m['resolved'],'reuse '+p)
lint=load(CHECK/'lint-tool-returns-v1.json');check(lint['completion']['chunk_id']=='2f38d0' and lint['completion']['exit_code']==0 and (CHECK/'report-lint-v1.log').read_bytes()==b'','actual changed lint completion')
actualreview=OUT/'inline-park-root-actual-independent-review-v1.md';check(sha(actualreview)=='fff79e37fba837244a11410ca5a7ecf219ba62ccd16029e5942aef96d319a797','own completed first actual review')
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':'static read/hash/JSON input and preserved evidence audit only; no constructors/compiler/JS/model/pure/testcollection/native/runtime mutants/process probes/Git','inputFreezeSha256':sha(I/'input-freeze-v1.json'),'inputPacketSha256':sha(I/'input-packet-sha256-v1.json'),'inputFreezeFiles':freezefiles,'inputPacketEntries':packetfiles,'combinedPacketEntries':combinedcount,'postLintPacketEntries':checkcount,'historicalResolvedEntries':historicalcounts,'archiveEntries':len(amap),'failedResultAssets':failedcount,'successfulFirstResultFiles':successcount,'currentSources':sourcecount,'dependencyPayloads':payloadcount,'Node':1,'locks':2,'reuseLinks':4,'all15':facts,'profileCounts':dict(collections.Counter(c['profile'] for c in facts)),'fixturesIfAllAdmitted':17,'firstActualReviewSha256':sha(actualreview),'rootClassification':'required separately; this reviewer does not create or infer root classification','newBatchAdmission':'required separately, must pin root exact-result classification and this source-only review; no runtime admission here','candidateRaw20':'all UNREACHED','state14':'proposed; not adopted','actualHelperNoActiveOperationNeighbor':'required and UNREACHED','errors':errors,'allChecksPass':not errors,'newRuntimeExecutions':0}
p=OUT/'remaining15-source-inputs-independent-facts-v1.json';p.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'artifact':str(p),'sha256':sha(p),'errors':errors,'freezeFiles':freezefiles,'packetEntries':packetfiles,'combinedEntries':combinedcount,'cells':len(facts)}))
