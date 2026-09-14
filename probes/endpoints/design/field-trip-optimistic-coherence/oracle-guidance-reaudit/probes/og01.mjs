import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
const source=await readFile('probes/endpoints/integrated-todo/tests/oracles/compiled-dependencies.mjs','utf8')
const start=source.indexOf('          assert.equal(\n            reads,'), end=source.indexOf('          report.operations++',start)+'          report.operations++'.length
assert.ok(start>=0&&end>start)
const body=source.slice(start,end)
for(const reads of [1,0]){
 const report={resultReads:0,skippedReads:0,operations:0}
 const run=()=>new Function('assert','reads','expectedReads','program','step','report',body)(assert,reads,1,{count:3},{kind:'update'},report)
 if(reads===1)run();else assert.throws(run,/compiled read count/)
 assert.equal(report.operations,reads===1?1:0)
 console.log(JSON.stringify({id:'OG-01',seam:'exact compiled-runner pruning assertion through operation counter',reads,operations:report.operations,comparisonHadToPassBeforeCounter:true}))
}
