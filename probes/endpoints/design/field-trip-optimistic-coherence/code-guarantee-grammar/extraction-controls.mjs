// Analysis controls for Design Grammar run26. No application modules are executed.
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
import {inspectSchema} from '../../../integrated-todo/schema-snapshot.mjs'
import {transformBoundEndpoints} from '../../../integrated-todo/bound-transform.mjs'
import {databaseSource} from '../../../integrated-todo/tests/fixtures/compiler-source.mjs'
const require=createRequire(new URL('../../../integrated-todo/package.json',import.meta.url))
const {parse}=require('@babel/parser')
const {PGlite}=require('@electric-sql/pglite')
const root=await realpath(await mkdtemp(join(tmpdir(),'code-grammar-')))
const pg=new PGlite()
const cases=[
 {id:'pure-helper',service:`export async function helper(){return db.select().from(a)}`,known:true},
 {id:'opaque-prefix',service:`import {authorize} from 'opaque';export async function helper(){await authorize();return db.select().from(a)}`,known:false,reason:'External call'},
 {id:'opaque-suffix',service:`import {authorize} from 'opaque';export async function helper(){const rows=await db.select().from(a);await authorize();return rows}`,known:false,reason:'External call'},
 {id:'query-write',service:`export async function helper(){await db.update(b).set({value:1});return db.select().from(a)}`,known:false,reason:'Effectful query'},
 {id:'two-read-helper',service:`export async function helper(){await db.select().from(b);return db.select().from(a)}`,known:true,count:2},
 {id:'permission-named-pure-helper',service:`async function authorize(){return db.select().from(b)}export async function helper(){await authorize();return db.select().from(a)}`,known:true,count:2},
]
function normalized(node){return JSON.stringify(node,(key,value)=>['start','end','loc','extra','leadingComments','trailingComments','innerComments'].includes(key)?undefined:value)}
function allNodes(node,out=[]){if(!node||typeof node!=='object')return out;if(node.type)out.push(node);for(const [k,v] of Object.entries(node)){if(['loc','extra'].includes(k))continue;if(Array.isArray(v))v.forEach(x=>allNodes(x,out));else if(v&&typeof v==='object')allNodes(v,out)}return out}
try{
 await mkdir(join(root,'src'))
 await writeFile(join(root,'src/database.server.ts'),databaseSource)
 await pg.exec('CREATE TABLE a(id text PRIMARY KEY,value integer);CREATE TABLE b(id text PRIMARY KEY,value integer)')
 const snapshot=await inspectSchema(sql=>pg.query(sql),'src/database.server.ts')
 const results=[]
 for(const c of cases){
  const service=`import {db,a,b} from './database.server';${c.service}`
  await writeFile(join(root,'src/service.server.ts'),service)
  const code=`import {z} from 'zod';import {endpoints} from './runtime';import {helper} from './service.server';export function App(client){const {query,mutation}=endpoints(client);const rows=query({input:z.object({}),schema:z.object({id:z.string(),value:z.number()}),async handler(req,res){return res.json(await helper())}});return rows}`
  const ast=parse(code,{sourceType:'module'})
  const result=transformBoundEndpoints(code,join(root,'src/endpoint.tsx'),ast,{root,snapshot})
  const diagnostic=result.dependencyDiagnostics[0]
  assert.equal(diagnostic.dependencies!==null,c.known)
  if(c.reason)assert.match(diagnostic.reason,new RegExp(c.reason))
  if(c.known)assert.equal(diagnostic.dependencies.length,c.count??1)
  const original=allNodes(ast).find(n=>n.type==='ObjectMethod'&&n.key?.name==='handler').body
  const registry=parse(result.registryCode,{sourceType:'module'})
  const preserved=allNodes(registry).some(n=>n.type==='FunctionExpression'&&normalized(n.body)===normalized(original))
  assert.equal(preserved,true)
  results.push({id:c.id,service,dependencies:diagnostic.dependencies?.map(d=>d.slice(d.indexOf(':')+1))??null,reason:diagnostic.reason,handlerBodyPreserved:preserved})
 }
 assert.deepEqual(results.find(r=>r.id==='two-read-helper').dependencies,results.find(r=>r.id==='permission-named-pure-helper').dependencies)
 await writeFile(new URL('./control-results.json',import.meta.url),JSON.stringify({scope:'Compiler/schema controls only; not application auth execution or full-stack oracle',results},null,2)+'\n')
 console.log(JSON.stringify(results.map(({service,...r})=>r),null,2))
}finally{await pg.close();await rm(root,{recursive:true,force:true})}
