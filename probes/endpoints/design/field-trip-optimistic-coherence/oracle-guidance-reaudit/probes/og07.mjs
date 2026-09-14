import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
const app=path.join(process.cwd(),'probes/endpoints/integrated-todo')
const { Evidence }=await import(pathToFileURL(path.join(app,'tests/oracles/evidence.mjs')))
const { parse }=await import(pathToFileURL(path.join(app,'node_modules/@babel/parser/lib/index.js')))
const source=await fs.readFile(path.join(app,'tests/oracles/compiled-browser.mjs'),'utf8')
const imports=parse(source,{sourceType:'module'}).program.body.filter(n=>n.type==='ImportDeclaration')
let body=source
for(const n of imports.reverse())body=body.slice(0,n.start)+body.slice(n.end)
const output=await fs.mkdtemp('/tmp/og07-'), priorOutput=process.env.ENDPOINT_ORACLE_OUTPUT, priorExit=process.exitCode
process.env.ENDPOINT_ORACLE_OUTPUT=output
let reads=0, assertionReached=false
const page={on(){},async goto(){},async waitForFunction(){},async close(){},async evaluate(){
 if(reads++===0)return
 assertionReached=true
 return [[{id:'row',value:99}],[{id:'row',value:1}],[{id:'row',value:1}]]
}}
class Pg {async exec(){} async query(){return {rows:[{id:'row',value:1}]}} async close(){}}
class Driver {constructor(){this.evidence=new Evidence('OG-07');this.browser={async newPage(){return page}};this.counts={clientArtifacts:0}}
 async init(){} async prepare(){} async control(){return{trace:[]}} async close(){} }
try{
 const args={assert,mkdir:fs.mkdir,writeFile:fs.writeFile,resolve:path.resolve,join:path.join,PGlite:Pg,Driver,inspectSchema:async()=>({}),ddl:()=>'',endpointSource:()=>'',databaseSource:()=>'',tableName:()=>'',serviceSource:()=>'',console:{log(){}}}
 await new Function(...Object.keys(args),`return (async()=>{${body}\n})()`)(...Object.values(args))
 const report=JSON.parse(await fs.readFile(path.join(output,'report.json'),'utf8'))
 assert.equal(assertionReached,true);assert.equal(report.ok,false);assert.equal(report.outcome,'unclassified-failure');assert.equal(report.evidence.cases,0)
 assert.match(report.error,/99/)
 assert.equal((await fs.readdir(output)).includes('replay.json'),false)
 console.log(JSON.stringify({id:'OG-07',seam:'actual compiled-browser top-level runner; fake I/O returns a reached row mismatch',assertionReached,ok:report.ok,outcome:report.outcome,cases:report.evidence.cases,replaySaved:false,errorTextSaved:!!report.error}))
}finally{priorOutput===undefined?delete process.env.ENDPOINT_ORACLE_OUTPUT:process.env.ENDPOINT_ORACLE_OUTPUT=priorOutput;process.exitCode=priorExit;await fs.rm(output,{recursive:true,force:true})}
// Loading's actual catch block receives a structured row error but serializes only text.
{
 const src=await fs.readFile(path.join(app,'tests/oracles/loading.mjs'),'utf8')
 const ast=parse(src,{sourceType:'module'}).program
 const node=ast.body.find(n=>n.type==='TryStatement'&&n.handler)
 assert.ok(node)
 const evidence=new Evidence('OG-07-loading'),report={ok:true};let error
 try{evidence.check('collection-rows',[[{id:'r',text:'wrong'}]],[[{id:'r',text:'right'}]],{checkpoint:'settled'})}catch(caught){error=caught}
 assert.ok(error.oracle)
 new Function('error','report','console',`let failed=false;${src.slice(node.handler.body.start+1,node.handler.body.end-1)}`)(error,report,{error(){}})
 const output=await fs.mkdtemp('/tmp/og07-loading-'),savedExit=process.exitCode
 try{
  await evidence.finish(report,output,false)
  assert.equal(report.outcome,'unclassified-failure');assert.equal(evidence.original,undefined)
  assert.equal((await fs.readdir(output)).includes('replay.json'),false)
  console.log(JSON.stringify({id:'OG-07',runner:'loading actual catch + Evidence.finish',structuredFailureExisted:!!error.oracle,outcome:report.outcome,replaySaved:false,errorTextSaved:!!report.error}))
 }finally{process.exitCode=savedExit;await fs.rm(output,{recursive:true,force:true})}
}
