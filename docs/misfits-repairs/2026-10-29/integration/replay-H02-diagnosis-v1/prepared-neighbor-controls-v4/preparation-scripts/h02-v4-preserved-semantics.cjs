const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const W='/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-progress-main-v1'
const H='/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1'
const P=path.join(H,'prepared-neighbor-controls-v4'),V3=path.join(H,'prepared-neighbor-controls-v3')
const ts=require(path.join(W,'node_modules/typescript')),sha=s=>crypto.createHash('sha256').update(s).digest('hex')
function declarations(file,names){
 const text=fs.readFileSync(file,'utf8'),sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),out={}
 function visit(n){
  if((ts.isVariableDeclaration(n)||ts.isFunctionDeclaration(n))&&n.name&&names.includes(n.name.getText(sf)))out[n.name.getText(sf)]=n.getText(sf)
  if(names.includes('nativeTitle')&&ts.isCallExpression(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(sf)==='it.each')out.nativeTitle=n.arguments[0].getText(sf)
  ts.forEachChild(n,visit)
 }
 visit(sf);if(Object.keys(out).length!==names.length)throw Error('declaration absent '+file)
 return out
}
const groups=[['packages/query-db-collection/tests/queued-answer-progress-oracle.ts',['queuedAnswerExample','progressExamples','progressHistoryArbitrary','progressHistoryFamily','progressFacts','modelProgressValue']],['packages/query-db-collection/tests/queued-answer-progress-neighbors.test.ts',['paths','nativeTitle']]]
const result={kind:'static declaration identity only; no runtime',unchanged:{}}
for(const [relative,names] of groups){
 const before=declarations(path.join(V3,'source',relative),names),after=declarations(path.join(W,relative),names)
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('semantic source declaration changed')
 result.unchanged[relative]=Object.fromEntries(names.map(name=>[name,{sha256:sha(after[name]),byteIdentical:true}]))
}
const f=JSON.parse(fs.readFileSync(path.join(V3,'source-freeze-v3.json')))
for(const relative of ['packages/query-db-collection/tests/queued-answer-progress-driver.ts','packages/db/tests/query/load-subset-retained-publication-oracle.ts','packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts','scripts/h02-progress/vitest.config.ts','scripts/h02-progress/receiving-monitor.mjs','scripts/h02-progress/ownership-parent.mjs']){
 const actual=sha(fs.readFileSync(path.join(W,relative)))
 if(actual!==f.instrumentFiles[relative])throw Error('preserved source changed '+relative)
 result.unchanged[relative]={sha256:actual,byteIdentical:true}
}
fs.writeFileSync(path.join(P,'preserved-semantics-v4.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify(result))
