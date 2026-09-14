import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
const app=path.join(process.cwd(),'probes/endpoints/integrated-todo')
const { Evidence }=await import(pathToFileURL(path.join(app,'tests/oracles/evidence.mjs')))
const {parse}=await import(pathToFileURL(path.join(app,'node_modules/@babel/parser/lib/index.js')))
const read=name=>fs.readFile(path.join(app,'tests/oracles',name),'utf8')
const nodes=source=>{const result=[];const walk=x=>{if(!x||typeof x!=='object')return;if(x.type)result.push(x);for(const v of Object.values(x)){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v)}};walk(parse(source,{sourceType:'module'}));return result}
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}
const source=await read('concurrent.mjs'), ast=nodes(source)
// OG-02: actual route handler and intermediate assertion, with fulfillment held.
{
 const routeNode=ast.find(n=>n.type==='VariableDeclarator'&&n.id.name==='handleRoute')
 const ifNode=ast.find(n=>n.type==='IfStatement'&&source.slice(n.test.start,n.test.end)==='position < delivery.length - 1')
 assert.ok(routeNode&&ifNode)
 const held={arrived:false,release:defer()}, heldResponses=new Map([['token',held]]), wire=[], delivered=defer();let clientConsumed=false, credited=false
 const handle=new Function('heldResponses','wire',`return (${source.slice(routeNode.init.start,routeNode.init.end)})`)(heldResponses,wire)
 const response={async body(){return Buffer.from('data')}}
 const work=handle({request:()=>({method:()=> 'POST',resourceType:()=> 'fetch',postData:()=> 'token'}),async fetch(){return response},async fulfill(){await delivered.promise;clientConsumed=true}})
 while(!held.arrived)await Promise.resolve()
 held.release.resolve()
 const page={waitForTimeout:ms=>new Promise(r=>setTimeout(r,ms)),async evaluate(){return{token:{result:'pending'},sibling:{result:'pending'}}}}
 await new Function('page','assert','checkpoint','index',`return (async()=>${source.slice(ifNode.consequent.start,ifNode.consequent.end)})()`)(page,assert,async()=>{credited=true;assert.equal(clientConsumed,false)},0)
 assert.equal(credited,true);assert.equal(clientConsumed,false)
 console.log(JSON.stringify({id:'OG-02',checkpointCredited:credited,clientConsumed,fulfillment:'held explicitly beyond the actual 30ms delay'}))
 delivered.resolve();await work
}
// OG-04: actual checkpoint drains a publication then saves only the row failure.
{
 const n=ast.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='checkpoint'), e=new Evidence('OG-04')
 const expected=[[{id:'r',text:'right'}]], originalEvents=[{index:0,rows:[[{id:'r',text:'wrong'}]],changes:[{type:'update',key:'r',value:{id:'r',text:'wrong'}}]}], queue=structuredClone(originalEvents)
 const driver={reference:{async expected(){return expected}}}, page={async evaluate(){return queue.splice(0)}}
 const checkpoint=new Function('driver','program','page','evidence','folded','report',`return (${source.slice(n.start,n.end)})`)(driver,{},page,e,[new Map()],{})
 await assert.rejects(e.run({recipe:'generated input'},()=>checkpoint('delivered 0, sibling outcome pending')))
 assert.equal(queue.length,0)
 assert.equal('changes' in e.original.failure,false)
 assert.equal('index' in e.original.failure,false)
 assert.equal('events' in e.original,false)
 console.log(JSON.stringify({id:'OG-04',drainedEvents:originalEvents.length,failureKeys:Object.keys(e.original.failure),packet:e.original}))
}
// OG-09: exact driver's script-response handler converts a rejection to a fulfilled promise.
{
 const src=await read('driver.mjs'), a=nodes(src), n=a.find(n=>n.type==='CallExpression'&&src.slice(n.start,n.end).includes(".catch((error) => errors.push(error.message))")&&n.callee.type==='MemberExpression'&&n.callee.object.name==='page')
 assert.ok(n)
 const arrow=n.arguments[1],errors=[],responses=[],e=new Evidence('OG-09')
 const handler=new Function('errors','responses',`return (${src.slice(arrow.start,arrow.end)})`)(errors,responses)
 const response={request:()=>({resourceType:()=> 'script'}),status:()=>200,text:async()=>{throw Error('secondary scan failure')}}
 await assert.rejects(e.run({},async()=>{try{handler(response);e.check('rows',[99],[1],{checkpoint:'same-turn'})}finally{await e.settled('responses',responses)}}))
 assert.deepEqual(errors,['secondary scan failure']);assert.deepEqual(e.cleanupErrors,[])
 console.log(JSON.stringify({id:'OG-09',localErrors:errors,recordedCleanupErrors:e.cleanupErrors,primary:e.original.failure.law}))
}
// OG-09 loading subclaim: observe Node's actual detached-rejection event.
{
 const src=await read('loading.mjs'),a=nodes(src),n=a.find(n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.object.name==='page'&&src.slice(n.start,n.end).includes('pending.push('))
 assert.ok(n)
 const pending=[],wire=[],arrow=n.arguments[1],body=defer()
 let rejectBody
 const rejectingBody=new Promise((_,reject)=>{rejectBody=reject})
 const handler=new Function('pending','wire','gzipSync',`return (${src.slice(arrow.start,arrow.end)})`)(pending,wire,x=>x)
 const observed=new Promise(resolve=>process.once('unhandledRejection',reason=>resolve(reason.message)))
 handler({request:()=>({method:()=> 'POST',resourceType:()=> 'fetch',postData:()=>''}),body:()=>rejectingBody})
 rejectBody(Error('loading body failed'))
 const detached=await observed
 assert.equal(detached,'loading body failed')
 await Promise.allSettled(pending)
 console.log(JSON.stringify({id:'OG-09',runner:'loading',detachedRejection:detached,pending:pending.length}))
}
// OG-01: report projection omits named work/settlement assertions.
{
 const report=JSON.parse(await fs.readFile(path.join(app,'evidence/oracle-repair-compiled-final/report.json'),'utf8'))
 const laws=Object.keys(report.evidence.witnesses).map(k=>JSON.parse(k)[0])
 assert.ok(laws.every(l=>['reference-baseline','optimistic-rows','settled-rows'].includes(l)))
 assert.ok(report.operations>0&&report.resultReads>0)
 console.log(JSON.stringify({id:'OG-01',witnessedLaws:[...new Set(laws)],operations:report.operations,resultReads:report.resultReads,pruningWitness:false,settlementWitness:false}))
}
// OG-08: identical real Evidence provenance despite changed reference file identity.
{
 const tmp=await fs.mkdtemp('/tmp/og08-'),dir=path.join(tmp,'tests/oracles')
 try{
  await fs.mkdir(dir,{recursive:true})
  const current=new Evidence('OG-08')
  for(const name of Object.keys(current.provenance.sources)){
   const dst=path.resolve(dir,name);await fs.mkdir(path.dirname(dst),{recursive:true})
   if(name==='evidence.mjs')await fs.copyFile(path.resolve(app,'tests/oracles',name),dst)
   else await fs.symlink(path.resolve(app,'tests/oracles',name),dst)
  }
  await fs.symlink(path.join(app,'node_modules'),path.join(tmp,'node_modules'))
  const ref=path.join(dir,'reference.mjs');await fs.copyFile(path.join(app,'tests/oracles/reference.mjs'),ref)
  const {Evidence:Copy}=await import(pathToFileURL(path.join(dir,'evidence.mjs')))
  const before=new Copy('OG-08').provenance
  await fs.appendFile(ref,'\nexport const changedReferenceSemantics = true\n')
  const after=new Copy('OG-08').provenance
  assert.deepEqual(before,after)
  console.log(JSON.stringify({id:'OG-08',changedFile:'reference.mjs (disposable copy)',provenanceUnchanged:true,sourceHashes:Object.keys(before.sources).length}))
 }finally{await fs.rm(tmp,{recursive:true,force:true})}
}
// OG-10: sample the actual arbitrary; validate unconditional warm setup before actions.
{
 const src=await read('sql-effect-rules.mjs'),a=nodes(src),n=a.find(n=>n.type==='VariableDeclarator'&&n.id.name==='step'&&n.init)
 const {default:fc}=await import(pathToFileURL(path.join(app,'node_modules/fast-check/lib/esm/fast-check.js')))
 const arbitrary=new Function('fc',`return (${src.slice(n.init.start,n.init.end)})`)(fc)
 const sample=fc.sample(arbitrary,{seed:9142601,numRuns:1000})
 assert.ok(sample.every(v=>Object.keys(v).sort().join(',')==='kind,optimistic,value'))
 const preload=src.indexOf('await Promise.all(collections.map((c) => c.preload()))')
 assert.ok(preload>=0)
 assert.ok(preload<src.indexOf('for (const step of steps)'))
 console.log(JSON.stringify({id:'OG-10',samples:sample.length,fields:Object.keys(sample[0]),coldLifecycleCommands:0,allCollectionsPreloadedBeforeSteps:true}))
}
