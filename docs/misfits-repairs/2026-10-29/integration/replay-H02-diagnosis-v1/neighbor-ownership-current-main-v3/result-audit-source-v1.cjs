const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const W='/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-progress-main-v1'
const H='/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1'
const R=path.join(H,'neighbor-ownership-current-main-v3'),P=path.join(H,'prepared-neighbor-controls-v3')
const ts=require(path.join(W,'node_modules/typescript'))
const sha=b=>crypto.createHash('sha256').update(b).digest('hex')
const write=(name,v)=>fs.writeFileSync(path.join(R,name),typeof v==='string'?v:JSON.stringify(v,null,2)+'\n',{flag:'wx'})
const stdout=fs.readFileSync(path.join(R,'worker.stdout.log'),'utf8'),stderr=fs.readFileSync(path.join(R,'worker.stderr.log'),'utf8')
const outcome=JSON.parse(fs.readFileSync(path.join(R,'outcome.json')))
if(sha(Buffer.from(stdout))!==outcome.stdoutSha256||sha(Buffer.from(stderr))!==outcome.stderrSha256)throw Error('raw log digest mismatch')
function value(n){
 if(ts.isObjectLiteralExpression(n))return Object.fromEntries(n.properties.map(p=>{
  if(!ts.isPropertyAssignment(p))throw Error('non-data log property')
  const name=ts.isIdentifier(p.name)||ts.isStringLiteral(p.name)?p.name.text:undefined
  if(!name)throw Error('unexpected log key')
  return[name,value(p.initializer)]
 }))
 if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))return n.text
 if(ts.isNumericLiteral(n))return Number(n.text)
 if(ts.isIdentifier(n)&&n.text==='Infinity')return 'Infinity'
 throw Error('unexpected non-data log expression: '+n.getText())
}
const records=[...stdout.matchAll(/H02 ownership neighbor reach (\{[\s\S]*?\n\})\n/g)].map(m=>{
 const sf=ts.createSourceFile('captured-data.ts','const capture = '+m[1],ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
 if(sf.parseDiagnostics.length)throw Error('invalid captured data')
 const record=value(sf.statements[0].declarationList.declarations[0].initializer)
 return {...record,rawOffset:m.index,rawBytes:Buffer.byteLength(m[0]),rawSha256:sha(m[0])}
})
if(records.length!==42||new Set(records.map(x=>x.testName)).size!==42)throw Error('42 distinct actual payloads missing')
const passedLines=stdout.split('\n').filter(x=>/^ ✓ /.test(x))
if(passedLines.length!==42)throw Error('42 native passed names missing')
const passedNames=passedLines.map(x=>x.replace(/^ ✓ packages\/query-db-collection\/tests\/ownership-lifecycle.oracle.test.ts > /,'').replace(/ \d+ms$/,''))
if(new Set(passedNames).size!==42||records.some(x=>!passedNames.includes(x.testName)))throw Error('payload/native passed name mismatch')
const expected=[]
for(const peers of [0,1,2])for(const rows of [1,2]){
 expected.push({staleTime:'Infinity',refetch:'rejects',settles:'after-publication',peers,rows})
 for(const refetch of ['rejects','same-rows','empty'])for(const settles of ['while-held','after-publication'])expected.push({staleTime:0,refetch,settles,peers,rows})
}
const key=x=>JSON.stringify(x)
if(records.some((r,i)=>key(r.history)!==key(expected[i])))throw Error('actual histories/order do not cover unchanged finite grammar')
const common=['older-release-held','cached-reacquisition-held','older-release-published','all-peers-released','final-lease-released']
let fresh=0,stale=0
for(const r of records){
 if(r.sourceModule!=='file://'+W+'/packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts')throw Error('actual source path differs')
 const extra=r.history.staleTime==='Infinity'?'fresh-cache-without-refetch':'refetch-outcome-settled'
 const keys=[...common,extra]
 if(Object.keys(r.counts).length!==6||keys.some(k=>r.counts[k]!==1))throw Error('actual reach counts incomplete')
 if(extra==='fresh-cache-without-refetch')fresh++;else stale++
 const header='stdout | packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts > '+r.testName+'\n'
 if(!stdout.includes(header))throw Error('native stdout task header absent')
}
if(fresh!==6||stale!==36)throw Error('fresh/stale actual split mismatch')
const errBlocks=stderr.split(/(?=stderr \| )/).filter(x=>x.trim())
const expectedErrors=records.filter(x=>x.history.staleTime===0&&x.history.refetch==='rejects')
if(errBlocks.length!==12||expectedErrors.length!==12)throw Error('unexpected stderr count')
for(let i=0;i<errBlocks.length;i++){
 const b=errBlocks[i],r=expectedErrors[i],h=r.history
 if(!b.startsWith('stderr | packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts > '+r.testName+'\n'))throw Error('unexpected stderr task')
 if(!b.includes('[QueryCollection] Error observing query reacquired-lease-0-rejects-'+h.settles+'-'+h.peers+'-'+h.rows+',')||!b.includes('}: Error: refetch failed\n'))throw Error('unexpected stderr diagnostic')
 const lines=b.trim().split('\n')
 if(lines.length!==5||!lines[2].includes('at settleRefetch ('+W+'/packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts:5269:28)')||lines[3]!=='    at '+W+'/packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts:'+(h.settles==='while-held'?'5323':'5333')+':11'||!lines[4].includes('/@vitest/runner/dist/chunk-artifact.js:1903:20'))throw Error('unclassified stderr content')
}
if(outcome.exitCode!==0||outcome.signal!==null||outcome.heap||!outcome.identityMatched||outcome.remainingGroup!==0||outcome.cleanupErrors!==0||outcome.trigger||outcome.observationError)throw Error('operational result not clean')
if(!stdout.includes('Tests  42 passed | 220 skipped (262)'))throw Error('native summary mismatch')
const identityBefore=JSON.parse(fs.readFileSync(path.join(R,'identity-before.json'))),identityAfter=JSON.parse(fs.readFileSync(path.join(R,'identity-after.json')))
if(JSON.stringify(identityBefore)!==JSON.stringify(identityAfter)||identityAfter.diskSourcesMatched!==562||identityAfter.payloadFilesMatched!==2544||!identityAfter.nodeAndLocksAndLinksMatched)throw Error('identity result mismatch')
for(const file of ['final-group.json','final-group-before-cleanup.json'])if(JSON.parse(fs.readFileSync(path.join(R,file))).rows.length!==0)throw Error('group remains')
const absence=path.join(H,'neighbor-ownership-current-main-v3-root-process-absence-v1.json')
if(sha(fs.readFileSync(absence))!=='45bb5f2cbe6198f102c0b03848868ad69d9b188e5ecc84d3204505eb68b28907')throw Error('root absence digest mismatch')
write('captured-history-records-v1.json',{status:'42 actual raw stdout payloads parsed as data only; native passed names and headers matched',records,freshNoRefetch:fresh,staleRefetch:stale,countsPerHistory:6,rawStdoutSha256:outcome.stdoutSha256,parser:'TypeScript AST data-only object/string/number/Infinity parser; no eval',nativePassedNames:passedNames,expectedGrammarComparison:'42 actual payload histories/order equal unchanged 3 peers x2 row-count x(1 fresh+6 stale outcomes/cuts) grammar; expected table does not supply reach evidence'})
write('stderr-qualification-v1.json',{status:'full stderr classified; no extra bytes or blocks',bytes:Buffer.byteLength(stderr),sha256:outcome.stderrSha256,blocks:12,classification:'Expected intentionally rejected stale refetch diagnostics; all12 exact task names/history IDs and three stack lines match the unchanged rejection driver. No other stderr.',histories:expectedErrors.map(x=>x.history),limits:'Diagnostic path/stack evidence, not V8 byte binding.'})
for(const [source,dest] of [
 [H+'/neighbor-ownership-current-main-v3-parent-process.txt','parent-process.txt'],
 [H+'/neighbor-ownership-current-main-v3-parent.log','parent.stdout-stderr.log'],
 [H+'/neighbor-ownership-current-main-v3-root-admission-v1.json','root-admission-v1.json'],
 [absence,'root-process-absence-v1.json'],
 [H+'/prepared-neighbor-controls-v3-independent-source-acceptance-v1.md','independent-source-acceptance-v1.md'],
 [H+'/prepared-neighbor-controls-v3-independent-verification-v1.json','independent-source-verification-v1.json'],
 ['/private/tmp/h02-v3-ownership-audit.cjs','result-audit-source-v1.cjs'],
]) fs.copyFileSync(source,path.join(R,dest),fs.constants.COPYFILE_EXCL)
write('result-qualification-v1.json',{status:'Finite ownership neighbor passed with all42 actual names/sourceModule/testName/history/reach records; root acceptance pending',finiteHistories:42,nativePassed:42,nativeSkipped:220,actualPayloads:42,actualFreshNoRefetch:6,actualStaleRefetch:36,actualReachPerHistory:6,unchangedModelComparisonAndPremiseChecksPassed:true,identities:identityAfter,operational:{exitCode:0,heap:false,identityMatched:true,remainingGroup:0,cleanupErrors:0,elapsedMonotonicMs:outcome.elapsedMonotonicMs,maxSampledGroupRssBytes:outcome.maxSampledGroupRssBytes,outerPid:34351,outerPgid:34351,childPid:34421,childOriginalPgid:34421,rootAbsenceReceiptSha256:sha(fs.readFileSync(absence))},stderr:'12 expected intentionally rejected refetch diagnostics; full content classified separately',provenance:'Actual finally payload supplies bounded positive instrumentation/task/source-path observations for each history, backed by on-disk identity before/after. No ownership V8/compiled-byte source identity claim.',limits:'Finite existing ownership neighbor only; no generated new coverage, progress/nonempty-scope result, candidate reach, universal closure or future execution admission. Prior V2 qualifications unchanged.'})
write('handoff-v1.md','The admitted exact V3 ownership command passed once. Actual stdout retains42 distinct native passed names and42 finally payloads with exact sourceModule/currentTestName/history/counts; measured branch split6 fresh/no-refetch and36 stale/refetch, every history all six reaches once. The unchanged owner model comparisons and premise checks passed. Full stderr contains exactly12 intentional refetch rejection diagnostics from stale/rejects histories. Identity before/after matched562 source entries and2544 named-package own payload files. Wrapper reported no heap/identity/observation/cleanup issue and final original group empty. Root independently observed outer34351 and child34421 pid+pgid all absent.\n\nThis is finite ownership neighbor evidence with bounded positive instrumentation/task/path provenance, not V8 byte binding, new generated coverage, progress evidence, candidate activation, or universal closure. Root result acceptance remains separate. No next singleton or retry is admitted.\n')
const files={}
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.isFile()){const b=fs.readFileSync(p);files[path.relative(R,p)]={bytes:b.length,sha256:sha(b)}}else throw Error('nonregular archive entry')}}
walk(R)
write('packet-sha256-v1.json',{format:'relative-path bytes SHA256; excludes this manifest only',status:'frozen admitted V3 ownership finite result',members:Object.keys(files).length,bytes:Object.values(files).reduce((n,x)=>n+x.bytes,0),files:Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)))})
console.log(JSON.stringify({directory:R,manifestSha256:sha(fs.readFileSync(path.join(R,'packet-sha256-v1.json'))),members:Object.keys(files).length,bytes:Object.values(files).reduce((n,x)=>n+x.bytes,0),qualificationSha256:sha(fs.readFileSync(path.join(R,'result-qualification-v1.json'))),actualPayloads:records.length,fresh,stale,stderrBlocks:errBlocks.length}))
