import copy, datetime, difflib, hashlib, json, os, shlex, shutil, subprocess
from pathlib import Path
W=Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-progress-main-v1')
H=Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1')
V2=H/'prepared-neighbor-controls-v2'; P=H/'prepared-neighbor-controls-v3'
sha=lambda b:hashlib.sha256(b).hexdigest()
hashfile=lambda p:sha(Path(p).read_bytes())
def write(p,v):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('x') as f:f.write(v if isinstance(v,str) else json.dumps(v,indent=2)+'\n')
def compact(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
f=json.loads((V2/'source-freeze-v2.json').read_text()); before=copy.deepcopy(f)
changed=['packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts','scripts/h02-progress/ownership-neighbor.config.ts']
changes={};diff=''
for key in ['productionFiles','instrumentFiles','sharedInstrumentFiles']:
    for rel,old in f[key].items():
        actual=hashfile(W/rel)
        if actual!=old:
            assert rel in changed,(rel,old,actual)
            oldtext=(V2/'source'/rel).read_text();newtext=(W/rel).read_text()
            if rel.endswith('ownership-lifecycle.oracle.test.ts'):
                assert newtext.replace('          sourceModule: import.meta.url,\n          testName: expect.getState().currentTestName,\n','')==oldtext
            else:
                assert newtext.replace("    reporters: ['verbose'],\n    silent: false,\n",'')==oldtext
            changes[rel]={'beforeSha256':old,'afterSha256':actual}
            diff+=''.join(difflib.unified_diff(oldtext.splitlines(True),newtext.splitlines(True),fromfile='v2/'+rel,tofile='v3/'+rel))
            f[key][rel]=actual
assert sorted(changes)==sorted(changed)
assert sha(compact(f['productionFiles']))==before['productionIdentity']
assert hashfile(W/f['exactSharedHelper']['path'])==f['exactSharedHelper']['sha256']
shutil.copytree(V2/'source',P/'source')
for rel in changed:shutil.copyfile(W/rel,P/'source'/rel)
write(P/'source-changes-v3.json',changes);write(P/'instrument-overlay-v2-to-v3.patch',diff)
# Freeze the actual native formatter/matcher and utility own payloads too. The
# unchanged ownership parent already verifies every package map before/after.
S=W/'node_modules/.pnpm'
for key,relative in [('vitest-runner','@vitest+runner@4.1.12/node_modules/@vitest/runner'),('vitest-utils','@vitest+utils@4.1.12/node_modules/@vitest/utils')]:
    pkg=(S/relative).resolve();m={}
    for p in sorted(pkg.rglob('*')):
        if p.is_file() and not p.is_symlink():m[str(p.relative_to(pkg))]=hashfile(p)
    f['packages'][key]={'logical':str(S/relative),'resolved':str(pkg),'version':json.loads((pkg/'package.json').read_text())['version'],'packageJsonSha256':hashfile(pkg/'package.json'),'regularPayloadFiles':len(m),'regularPayloadIdentity':sha(compact(m)),'regularPayloadFilesMap':m}
nativepaths={
 'runner-formatter-matcher.js':Path(f['packages']['vitest-runner']['resolved'])/'dist/chunk-artifact.js',
 'utils-display.js':Path(f['packages']['vitest-utils']['resolved'])/'dist/display.js',
 'reporter-resolution.js':Path(f['packages']['vitest']['resolved'])/'dist/chunks/coverage.DM_a_rWm.js',
 'reporter-implementation.js':Path(f['packages']['vitest']['resolved'])/'dist/chunks/index.UpGiHP7g.js',
}
native={}
for name,p in nativepaths.items():
    dest=P/'native-installed-source'/name;dest.parent.mkdir(exist_ok=True);shutil.copyfile(p,dest)
    native[name]={'actualInstalledPath':str(p),'sha256':hashfile(p),'snapshot':str(dest)}
write(P/'native-installed-source-identities-v3.json',native)
nativeResult=json.loads((P/'native-calibration/bound-v1/native-selection-results.json').read_text())
assert len(nativeResult['results'])==5
for row in nativeResult['results']:assert row['selectedPassed']==1 and row['skipped']==4
for commandFile in (P/'native-calibration/bound-v1').glob('*.command.json'):
    command=json.loads(commandFile.read_text());assert command['identityMatched'] and command['identityBefore']==command['identityAfter']
    for file,digest in command['identityAfter'].items():assert hashfile(file)==digest
f['at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
f['status']='V3 ACTUAL MINIMAL INSTRUMENT CORRECTION; inert native and serial static validation only; no receiving invocation admitted'
f['v2Predecessor']={'directory':str(V2),'manifestSha256':hashfile(V2/'packet-sha256-v2.json'),'sourceFreezeSha256':hashfile(V2/'source-freeze-v2.json'),'v2OwnershipQualification':'finite command pass only; zero retained reach/name records; no accepted baseline GREEN','v2ScopeQualification':'all five skipped; no receiving child/history/product verdict'}
f['neighborGate']['path']=str(P/'neighbor-contracts-v3.md')
f['nativeTitleSelection']={'collectionReceipt':str(P/'native-calibration/bound-v1/native-collected-tasks.json'),'selectionReceipt':str(P/'native-calibration/bound-v1/native-selection-results.json'),'selectionReceiptSha256':hashfile(P/'native-calibration/bound-v1/native-selection-results.json'),'basis':'Actual unchanged source table/title extracted by TypeScript AST; inert callbacks, native installed registration and JSON fullName; each exact regex separately selected one of five. Native list display uses > while matcher/JSON fullName uses spaces.','positiveSelectionCounts':[1,1,1,1,1],'skippedCounts':[4,4,4,4,4],'oldPlainSelectorSelected':0,'installedSourceIdentities':native,'limits':'Inert test registration/capture only; no DB receiving/model/production import. Initial calibration retained separately; bound-v1 adds source identities before and after every command.'}
f['dependencyLimits']='Nine named runtime/tool packages have frozen own regular payload maps, including the actual installed @vitest/runner and @vitest/utils native formatter/matcher inputs. Installed pnpm lock and reuse links are frozen. Not a complete transitive preimage/host/native/dist equivalence claim.'
f['ownershipProvenance']='Exact on-disk source/Node/locks/reuse links/nine named package own payload maps before and after. Explicit verbose+silent:false retains existing finally console reach records; sourceModule/currentTestName supplies bounded positive actual instrumentation/task/source-path observation if retained by a future admitted run. No ownership V8/compiled-body binding claim; no observation of prior V2 effective reporter resolution.'
f['pureCalibrationLimits']='V3 serial pure checks: 16 ownership and 9 candidate instrument checks. Native inert registration: all 5 harmless callbacks then five exact singleton selectors (1 pass/4 skipped each), old plain selector (0 pass/5 skipped), with installed file identity before/after. No DB history or product GREEN. Historical V7 validation remains preserved, not rerun.'
f['preparationValidation'].update({'newPureOwnershipChecksPassed':16,'newPureCandidateInstrumentChecksPassed':9,'nativeInertPositiveSelectors':5,'nativeInertOldSelectorSelected':0,'receivingInvocations':0,'productionChanged':False,'modelOrGrammarOrBudgetChanged':False})
write(P/'source-freeze-v3.json',f);fh=hashfile(P/'source-freeze-v3.json')
def replace(v):
    if isinstance(v,str):return v.replace('-v2','-v3')
    if isinstance(v,list):return [replace(x) for x in v]
    if isinstance(v,dict):return {k:replace(x) for k,x in v.items()}
    return v
ownership=replace(json.loads((V2/'ownership-recipe-v2.json').read_text()));ownership['sourceFreezeSha256']=fh
ownership['provenance']=f['ownershipProvenance']
write(P/'ownership-recipe-v3.json',ownership)
finite=replace(json.loads((V2/'finite-recipes-v2.json').read_text()))
syntax=[]
for i,r in enumerate(finite['progressInvocations']):
    r['sourceFreezeSha256']=fh;r['args'][-1]=nativeResult['results'][i]['selector']
    r['nativeSelectionReceipt']={'file':str(P/'native-calibration/bound-v1/native-selection-results.json'),'sha256':f['nativeTitleSelection']['selectionReceiptSha256'],'entry':i,'selected':1,'skipped':4}
    assert not Path(r['outputDirectory']).exists()
    line=['env']
    for key in r['envUnset']:line+=['-u',key]
    line += [key+'='+value for key,value in r['envSet'].items()] + [r['executable']] + r['args']
    text='#!/bin/zsh\n# Exact one-run recipe; independent source acceptance and separate root admission required.\nset -euo pipefail\ncd '+shlex.quote(str(W))+'\n/bin/ps -o pid=,pgid=,rss=,args= -p $$ > '+shlex.quote(r['outputDirectory']+'/launcher-process.txt')+'\nexec '+shlex.join(line)+' > '+shlex.quote(r['outputDirectory']+'/outer-vitest.log')+' 2>&1\n'
    write(r['launcher'],text);r['launcherSha256']=hashfile(r['launcher'])
    out=subprocess.run(['/bin/zsh','-n',r['launcher']],capture_output=True,text=True);assert out.returncode==0,out.stderr
    syntax.append({'launcher':r['launcher'],'sha256':r['launcherSha256'],'exitCode':out.returncode})
oi=finite['ownershipInvocation'];oi['recipeSha256']=hashfile(P/'ownership-recipe-v3.json');oi['provenance']=f['ownershipProvenance']
ownerLauncher=(V2/'launcher-ownership-v2.zsh').read_text().replace('-v2','-v3');write(oi['launcher'],ownerLauncher);oi['launcherSha256']=hashfile(oi['launcher'])
out=subprocess.run(['/bin/zsh','-n',oi['launcher']],capture_output=True,text=True);assert out.returncode==0,out.stderr
syntax.append({'launcher':oi['launcher'],'sha256':oi['launcherSha256'],'exitCode':out.returncode})
finite['sourceFreezeSha256']=fh
finite['nativeSelectionReceipt']=f['nativeTitleSelection']
write(P/'finite-recipes-v3.json',finite);write(P/'launcher-syntax-v3.json',syntax)
contracts=(V2/'neighbor-contracts-v2.md').read_text().replace('controls v2','controls v3')
contracts+='\nV3 changes only the ownership reporter options and two finally-log provenance fields. Five native full-name selectors are calibrated from the unchanged actual table/title using harmless callbacks. Each selects exactly one native test. The old plain selector selects zero. This is instrument evidence only. All prior V2 results retain their qualifications. Ownership sourceModule/currentTestName is bounded positive instrumentation/task/path evidence, not V8 identity.\n'
write(P/'neighbor-contracts-v3.md',contracts)
# Re-read every immutable archive member and require the same member inventory.
archives={}
for directory,manifest in [('prepared-current-main-v7','packet-sha256-v7.json'),('canonical-current-main-v7','packet-sha256-v7.json'),('prepared-neighbor-controls-v2','packet-sha256-v2.json'),('neighbor-ownership-current-main-v2','packet-sha256-v1.json'),('neighbor-nonempty-scope-current-main-v2','packet-sha256-v1.json')]:
    base=H/directory
    if not (base/manifest).exists():
        choices=list(base.glob('packet-sha256-*.json'));assert len(choices)==1;manifest=choices[0].name
    m=json.loads((base/manifest).read_text());actual=sorted(str(p.relative_to(base)) for p in base.rglob('*') if p.is_file() and p.name!=manifest)
    assert actual==sorted(m['files']),(directory,'inventory differs')
    for rel,row in m['files'].items():assert (base/rel).stat().st_size==row['bytes'] and hashfile(base/rel)==row['sha256'],(directory,rel)
    archives[directory]={'manifest':manifest,'manifestSha256':hashfile(base/manifest),'members':m['members'],'bytes':m['bytes'],'allMembersRehashed':True}
write(P/'preserved-inputs-v3.json',{'archives':archives,'productionIdentity':f['productionIdentity'],'productionFiles':len(f['productionFiles']),'sharedJudgment':f['exactSharedHelper'],'ownerModelAndGrammarIdentities':f['ownerModelAndGrammarIdentities'],'modelAndGrammarAndScheduleAndBudgetsUnchanged':True})
write(P/'static-validation-v3.json',{'status':'serial pure/static and bound inert native calibration passed; no DB receiving','pureOwnershipChecks':16,'pureCandidateChecks':9,'typecheck':True,'eslint':True,'changedLint':True,'prettier':True,'unchangedOrdinaryOwnershipWarnings':2,'sourceFreezeSha256':fh,'nativeSelectionReceiptSha256':f['nativeTitleSelection']['selectionReceiptSha256'],'receivingInvocations':0,'limits':'Only inert registration and console retention were executed; no DB product verdict.'})
write(P/'handoff-v3.md','V3 corrects five exact native selectors and enables explicit verbose ownership capture. The only live edits are two reporter options and sourceModule/currentTestName fields on the existing finally payload. Production, owner model/grammar/schedule, shared comparison and budgets remain byte-identical to V2.\n\nNative harmless registration uses the actual AST-extracted table/title; bound native receipts show each new selector selects 1 pass/4 skipped and the old selector selects 0/5 skipped. Serial pure checks passed 16+9; full TypeScript, ESLint, changed lint and formatting passed with the same two ordinary warnings.\n\nV2 ownership remains a finite command pass with zero captured per-history reach; V2 scope remains skipped-all. Neither is accepted baseline GREEN. Prior archives are unchanged. Ownership future sourceModule/currentTestName is bounded positive instrumentation/task/source-path evidence, not V8 binding or observed V2 reporter resolution.\n\nIndependent exact source acceptance and separate root admission remain required before any further DB receiving invocation. No retry, production/model/grammar/budget edit, install, commit, push or PR is authorized by this packet. Candidate fixture attachments remain a later pre-production-edit gate.\n')
for name in ['h02-v3-native-prepare.cjs','h02-v3-native-run.cjs','h02-v3-static.cjs','h02-v3-freeze.py']:
    dest=P/'preparation-scripts'/name;dest.parent.mkdir(exist_ok=True);shutil.copyfile(Path('/private/tmp')/name,dest)
members={str(p.relative_to(P)):{'bytes':p.stat().st_size,'sha256':hashfile(p)} for p in sorted(P.rglob('*')) if p.is_file()}
write(P/'packet-sha256-v3.json',{'format':'relative-path bytes SHA256; excludes this manifest only','status':'frozen V3 source/static/inert packet; no receiving admission','members':len(members),'bytes':sum(x['bytes'] for x in members.values()),'files':members})
print(json.dumps({'directory':str(P),'members':len(members),'bytes':sum(x['bytes'] for x in members.values()),'manifestSha256':hashfile(P/'packet-sha256-v3.json'),'sourceFreezeSha256':fh,'finiteRecipesSha256':hashfile(P/'finite-recipes-v3.json'),'ownershipRecipeSha256':hashfile(P/'ownership-recipe-v3.json')}))
