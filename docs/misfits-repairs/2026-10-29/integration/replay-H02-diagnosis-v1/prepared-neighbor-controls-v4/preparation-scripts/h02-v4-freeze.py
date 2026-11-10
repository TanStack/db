import copy,datetime,difflib,hashlib,json,shlex,shutil,subprocess
from pathlib import Path
W=Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-progress-main-v1')
H=Path('/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1')
V3=H/'prepared-neighbor-controls-v3';P=H/'prepared-neighbor-controls-v4'
sha=lambda b:hashlib.sha256(b).hexdigest();hashfile=lambda p:sha(Path(p).read_bytes())
def write(p,v):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('x') as f:f.write(v if isinstance(v,str) else json.dumps(v,indent=2)+'\n')
def compact(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
f=json.loads((V3/'source-freeze-v3.json').read_text());old=copy.deepcopy(f)
changed=['packages/query-db-collection/tests/queued-answer-progress-oracle.ts','packages/query-db-collection/tests/queued-answer-progress-neighbors.test.ts','scripts/h02-progress/checker-calibration.test.ts']
changes={};patch=''
for key in ['productionFiles','instrumentFiles','sharedInstrumentFiles']:
    for rel,digest in f[key].items():
        actual=hashfile(W/rel)
        if actual!=digest:
            assert key=='instrumentFiles' and rel in changed,rel
            changes[rel]={'beforeSha256':digest,'afterSha256':actual}
            a=(V3/'source'/rel).read_text();b=(W/rel).read_text()
            patch+=''.join(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile='v3/'+rel,tofile='v4/'+rel))
            f[key][rel]=actual
assert sorted(changes)==sorted(changed)
doc='docs/contributing/oracle-coverage.md';docBefore=subprocess.check_output(['git','show','HEAD:'+doc],cwd=W);docAfter=(W/doc).read_bytes()
changes[doc]={'beforeSha256':sha(docBefore),'afterSha256':sha(docAfter),'beforeAuthority':'clean current-main worktree HEAD; no prior local doc change'}
patch+=''.join(difflib.unified_diff(docBefore.decode().splitlines(True),docAfter.decode().splitlines(True),fromfile='v3/'+doc,tofile='v4/'+doc))
f['sharedInstrumentFiles'][doc]=sha(docAfter)
assert sha(compact(f['productionFiles']))==old['productionIdentity']
shutil.copytree(V3/'source',P/'source')
for rel in changes:
    dst=P/'source'/rel;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(W/rel,dst)
write(P/'instrument-overlay-v3-to-v4.patch',patch);write(P/'source-changes-v4.json',changes)
red=P/'red-original-sources/packages/query-db-collection/tests/queued-answer-progress-oracle.ts';red.parent.mkdir(parents=True);shutil.copyfile(V3/'source/packages/query-db-collection/tests/queued-answer-progress-oracle.ts',red)
sem=json.loads((P/'preserved-semantics-v4.json').read_text())
report=json.loads((P/'pure-checker-final-v4.report.json').read_text());assert report['numPassedTests']==17 and report['numFailedTests']==0
redcommand=json.loads((P/'pure-checker-red-command-v4.json').read_text());assert redcommand['exitCode']==1
assert '2 failed | 15 passed (17)' in (P/'pure-checker-red-v4.log').read_text()
f['at']=datetime.datetime.now(datetime.timezone.utc).isoformat();f['status']='V4 CHECKER OBSERVATION-ABSTRACTION CORRECTION; serial pure/static only; no receiving invocation admitted'
f['v3Predecessor']={'directory':str(V3),'manifestSha256':hashfile(V3/'packet-sha256-v3.json'),'sourceFreezeSha256':hashfile(V3/'source-freeze-v3.json'),'ownershipResult':'accepted bounded42 baseline remains independently qualified; not rerun','scopeResult':'observation/assertion instrument failure, all159rawreceipts/full1943childfiles preserved; no retrospective GREEN'}
f['neighborGate']['path']=str(P/'neighbor-contracts-v4.md')
f['nativeTitleSelection']['successorRegistrationIdentity']={'receipt':str(P/'preserved-semantics-v4.json'),'sha256':hashfile(P/'preserved-semantics-v4.json'),'result':'Actual paths initializer/native title expressions byte-identical to accepted V3; installed native calibration reused without a rerun. The callback now applies the common payload projection at its existing held-downstream comparison.'}
f['v3HistoricalPreparationValidation']=f.pop('preparationValidation')
f['preparationValidation']={'pureCheckerChecksPassed':17,'redOnUnchangedV3Checker':'2 legitimate virtual-enriched cases fail; 15 others pass','greenOnProjection':17,'staticTypecheckNodeHeapMiB':1536,'pureNodeAndWorkerHeapMiB':384,'typeOnlySpecMapping':'Existing installed spec1.1.0 declaration mapping inherited unchanged; no install','receivingInvocations':0,'productionChanged':False,'modelExpectedDataOrGrammarOrScheduleOrBudgetChanged':False,'driverRawRecorderChanged':False}
f['pureCalibrationLimits']='Current V4:17 pure checker calibrations only, with pure RED on unchanged V3 checker then GREEN. Prior V3 native title/selection and16+9 ownership/candidate calibrations are inherited and preserved, not rerun. No DB receiving, candidate reach or product verdict.'
f['observationAbstraction']={'authoredPayload':['id','rank','markers'],'oneActualProjection':'projectProgressRows/projectProgressRow; validates payload and preserves positions/multiplicity/markers; used at snapshots, downstream, event values/previous values, event-map comparisons and final/nonregression detection','rawVirtualMetadata':'all original raw row snapshots/change payloads remain unchanged in driver and receipts','publicContract':'docs/guides/live-queries.md#virtual-properties; VirtualRowProps in packages/db/src/virtual-props.ts','metadataOwner':'packages/db/tests/query/virtual-row-fields-oracle.test.ts','metadataReceivingLimit':'Real QueryClient reload/event temporal virtual-metadata coherence remains open under that owner; no known metadata counterexample is dismissed and no metadata closure claimed. No generated key encoding or Collection ID hardcoded.','scopeNote':'docs/contributing/oracle-coverage.md virtual-row-fields paragraph; explicit maintainer-directed2026-10-30 instrument correction','sharedJudgmentSha256':f['exactSharedHelper']['sha256'],'pureRedSourceSha256':hashfile(red),'modelAndGrammarIdentityReceipt':str(P/'preserved-semantics-v4.json')}
write(P/'source-freeze-v4.json',f);fh=hashfile(P/'source-freeze-v4.json')
ownership=json.loads((V3/'ownership-recipe-v3.json').read_text());ownership['sourceFreeze']=str(P/'source-freeze-v4.json');ownership['sourceFreezeSha256']=fh;ownership['outputDirectory']=ownership['outputDirectory'].replace('-v3','-v4');ownership['run']=False;ownership['invocationsAdmitted']=0
write(P/'ownership-recipe-v4.json',ownership)
finite=json.loads((V3/'finite-recipes-v3.json').read_text());finite['sourceFreeze']=str(P/'source-freeze-v4.json');finite['sourceFreezeSha256']=fh;syntax=[]
for r in finite['progressInvocations']:
    r['sourceFreeze']=str(P/'source-freeze-v4.json');r['sourceFreezeSha256']=fh;r['envSet']['H02_PROGRESS_SOURCE_FREEZE']=r['sourceFreeze'];r['launcher']=r['launcher'].replace('-v3','-v4');r['outputDirectory']=r['outputDirectory'].replace('-v3','-v4');assert not Path(r['outputDirectory']).exists()
    line=['env']
    for key in r['envUnset']:line+=['-u',key]
    line += [key+'='+value for key,value in r['envSet'].items()]+[r['executable']]+r['args']
    text='#!/bin/zsh\n# Exact one-run recipe; independent successor acceptance and separate root admission required.\nset -euo pipefail\ncd '+shlex.quote(str(W))+'\n/bin/ps -o pid=,pgid=,rss=,args= -p $$ > '+shlex.quote(r['outputDirectory']+'/launcher-process.txt')+'\nexec '+shlex.join(line)+' > '+shlex.quote(r['outputDirectory']+'/outer-vitest.log')+' 2>&1\n'
    write(r['launcher'],text);r['launcherSha256']=hashfile(r['launcher']);out=subprocess.run(['/bin/zsh','-n',r['launcher']],capture_output=True,text=True);assert out.returncode==0;syntax.append({'launcher':r['launcher'],'sha256':r['launcherSha256'],'exitCode':0})
oi=finite['ownershipInvocation'];oi['recipe']=str(P/'ownership-recipe-v4.json');oi['recipeSha256']=hashfile(P/'ownership-recipe-v4.json');oi['launcher']=oi['launcher'].replace('-v3','-v4');oi['parentCommand']=[x.replace(str(V3/'ownership-recipe-v3.json'),str(P/'ownership-recipe-v4.json')) for x in oi['parentCommand']]
write(oi['launcher'],(V3/'launcher-ownership-v3.zsh').read_text().replace('-v3','-v4'));oi['launcherSha256']=hashfile(oi['launcher']);out=subprocess.run(['/bin/zsh','-n',oi['launcher']],capture_output=True,text=True);assert out.returncode==0;syntax.append({'launcher':oi['launcher'],'sha256':oi['launcherSha256'],'exitCode':0})
finite['observationAbstraction']=f['observationAbstraction'];finite['preEditGate']='No actual receiving rerun until independent exact V4 source acceptance and separate singleton root admission. Accepted ownership42V3 remains separately qualified. Other baseline/candidate gates remain open.'
write(P/'finite-recipes-v4.json',finite);write(P/'launcher-syntax-v4.json',syntax)
write(P/'neighbor-contracts-v4.md',(V3/'neighbor-contracts-v3.md').read_text().replace('controls v3','controls v4')+'\nV4 corrects the checker observation abstraction only. Expected model payloads and all five histories/schedules/checkpoints/budgets are unchanged. One validating id/rank/markers projection now supplies every actual payload comparison, including the existing direct held-downstream judgment. The public VirtualRowProps remain completely recorded raw; metadata temporal reload coherence is separately open under its owner and the coverage map says so. Pure lawful enriched observations were RED against the unchanged V3 checker and all17 calibrations are GREEN after the correction; this is checker sensitivity, no DB receiving verdict. No V3 failure becomes retrospective GREEN.\n')
archives={}
for directory in ['prepared-current-main-v7','canonical-current-main-v7','prepared-neighbor-controls-v2','neighbor-ownership-current-main-v2','neighbor-nonempty-scope-current-main-v2','prepared-neighbor-controls-v3','neighbor-ownership-current-main-v3','neighbor-nonempty-scope-current-main-v3']:
    base=H/directory;choices=list(base.glob('packet-sha256-*.json'));assert len(choices)==1;manifest=choices[0];m=json.loads(manifest.read_text());actual=sorted(str(p.relative_to(base)) for p in base.rglob('*') if p.is_file() and p!=manifest);assert actual==sorted(m['files']),(directory,'inventory')
    for rel,row in m['files'].items():assert (base/rel).stat().st_size==row['bytes'] and hashfile(base/rel)==row['sha256'],(directory,rel)
    archives[directory]={'manifestSha256':hashfile(manifest),'members':m['members'],'bytes':m['bytes'],'allMembersRehashed':True}
write(P/'preserved-inputs-v4.json',{'archives':archives,'productionFiles':511,'productionIdentity':f['productionIdentity'],'sharedJudgment':f['exactSharedHelper'],'modelsGrammarSchedulesBudgetsRawDriverUnchanged':sem})
write(P/'static-validation-v4.json',{'status':'17pure checker controls and serial static checks passed; no receiving','pureRed':{'unchangedCheckerSourceSha256':hashfile(red),'legitimateEnrichedCasesFailed':2,'othersPassed':15,'log':'pure-checker-red-v4.log','limits':'Checker calibration only, no production RED'},'pureGreen':{'passed':17,'log':'pure-checker-final-v4.log','report':'pure-checker-final-v4.report.json','limits':'No product GREEN or retrospective V3result change'},'typecheck':True,'eslint':True,'changedLint':True,'prettier':True,'sourceFreezeSha256':fh,'receivingInvocations':0})
write(P/'observation-correction-v4.md','The V3 scope failure compares full public VirtualRows with the declared id/rank/markers model. VirtualRowProps and the live-query guide require the four public metadata fields; distinct projected root/downstream Collections legitimately have different Collection IDs. The driver spread preserved those fields, while the event-value adapter already projected only authored payload fields. The same observation abstraction is now applied at every snapshot, downstream, event-map and final/nonregression comparison, including the direct held-downstream comparison. Raw recorder bytes are unchanged.\n\nThe unchanged V3 checker rejects two legitimate virtual-enriched pure controls. The corrected checker passes all17 controls, including selected payload corruption, duplicate occurrences and multirow order corruption rejection. No production runtime was executed. Expected models, grammars, all five source titles/histories, schedules, checkpoints and budgets are byte-identical.\n\nThe metadata promise remains public and owned by virtual-row-fields-oracle.test.ts. Its existing witnesses do not establish temporal metadata coherence for this real QueryClient reload/event path; the coverage map explicitly retains that receiving gap. No generated Collection ID or key encoding is hardcoded. No V3 result is reclassified as GREEN and no product defect or closure is claimed.\n')
write(P/'handoff-v4.md','V4 source/pure/static preparation only; no receiving admitted. Live delta is the comparison adapter + one held-downstream call, three ordinary pure calibration tests, and an explicit coverage-map scope note. Production, raw driver, shared publication equality/model, expected payloads, five histories/schedules/checkpoints and budgets are unchanged. RED2/17 legitimate-enriched controls on V3 checker; GREEN17/17 after adapter; serial TypeScript, ESLint, changed lint, Prettier passed. Prior eight source/result archives rehashed unchanged.\n\nIndependent exact V4 source/recipe review and separate root singleton admission are required before any receiving. No retry, production/candidate edit, install, commit, push or PR is authorized.\n')
for name in ['h02-v4-static.cjs','h02-v4-preserved-semantics.cjs','h02-v4-freeze.py']:
    dest=P/'preparation-scripts'/name;dest.parent.mkdir(exist_ok=True);shutil.copyfile(Path('/private/tmp')/name,dest)
members={str(p.relative_to(P)):{'bytes':p.stat().st_size,'sha256':hashfile(p)} for p in sorted(P.rglob('*')) if p.is_file()}
write(P/'packet-sha256-v4.json',{'format':'relative-path bytes SHA256; excludes this manifest only','status':'frozen V4 oracle observation correction, pure/static only','members':len(members),'bytes':sum(v['bytes'] for v in members.values()),'files':members})
print(json.dumps({'directory':str(P),'members':len(members),'bytes':sum(v['bytes'] for v in members.values()),'manifestSha256':hashfile(P/'packet-sha256-v4.json'),'sourceFreezeSha256':fh,'finiteRecipesSha256':hashfile(P/'finite-recipes-v4.json'),'ownershipRecipeSha256':hashfile(P/'ownership-recipe-v4.json')}))
