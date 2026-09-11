import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {chromium} from '../../integrated-todo/node_modules/playwright/index.mjs'
const here=fileURLToPath(new URL('.',import.meta.url))
const app=resolve(here,'../../integrated-todo'),file=join(app,'src/endpoint.tsx'),contract=join(here,'live-contract.json')
const url=process.env.PROBE_URL??'http://127.0.0.1:4191'
const hash=s=>createHash('sha256').update(s).digest('hex')
const original=await readFile(file,'utf8')
const target='.orderBy(asc(todo.createdAt),asc(todo.id))'
assert.equal(original.split(target).length,2,'exactly one known list query order clause')
const bad=original.replace(target,'.orderBy(asc(todo.createdAt))')
const ledger={url,source:file,originalHash:hash(original),commands:[],steps:[],assumptions:['Read-only browser list query and GET evidence; no mutation/control POST','Actual local app receipt only; no deployment claim']}
const run=(args,expected)=>{ledger.commands.push([process.execPath,...args]);const p=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(p.status,expected,p.stderr||p.stdout);return p.stdout?JSON.parse(p.stdout):null}
const check=(snapshot,expected)=>run([join(here,'cli.mjs'),'check','--file',file,'--contract',contract,'--snapshot',snapshot],expected)
const save=async(name,value)=>{const path=join(here,name);await writeFile(path,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');return path}
let browser,page
async function capture(name,expectedSource) {
 await page.goto(url,{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>window.todoProbe)
 await page.evaluate(()=>window.todoProbe.collection.preload())
 // A fresh navigation should execute the fresh handler; refuse stale server receipts.
 let snapshot
 for(let i=0;i<40;i++){
  const response=await page.request.get(`${url}/probe-control`);assert.equal(response.status(),200)
  snapshot=await response.json()
  if(snapshot.endpointSourceHash===hash(expectedSource)&&snapshot.query)break
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.todoProbe);await page.evaluate(()=>window.todoProbe.collection.preload())
 }
 assert.equal(snapshot.endpointSourceHash,hash(expectedSource),'running handler must carry current original source receipt')
 return save(name,snapshot)
}
try {
 run([join(here,'make-contract.mjs'),app,contract],0)
 await save('live-original-endpoint.tsx',original)
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
 ledger.browserVersion=browser.version();page=await browser.newPage();page.setDefaultTimeout(20000)
 await writeFile(file,bad)
 ledger.steps.push({name:'introduce missing tie-breaker',sourceHash:hash(bad)})
 const badSnapshot=await capture('live-bad-snapshot.json',bad)
 const diagnostic=check(badSnapshot,1);assert.equal(diagnostic.check.code,'ENDPOINT_ORDER_NOT_TOTAL');assert.equal(diagnostic.runtimeComparison.status,'matched')
 const diagnosticFile=await save('live-diagnostic.json',diagnostic)
 ledger.steps.push({name:'actual bad handler SQL and schema yield source-located diagnostic',sourceHash:diagnostic.source.sha256,range:diagnostic.diagnostics[0].range,instanceId:diagnostic.provenance.instanceId})
 const applied=run([join(here,'cli.mjs'),'apply','--file',file,'--diagnostic',diagnosticFile],0)
 await save('live-applied.json',applied)
 const fixed=await readFile(file,'utf8');assert.equal(fixed,bad.replace('.orderBy(asc(todo.createdAt))','.orderBy(asc(todo.createdAt), asc(todo.id))'))
 const stale=check(badSnapshot,2);assert.equal(stale.check.code,'STALE_RUNTIME_SOURCE');await save('live-stale-snapshot-check.json',stale)
 ledger.steps.push({name:'guarded repair applied; old running snapshot refused',sourceHash:hash(fixed),code:stale.check.code})
 const fixedSnapshot=await capture('live-fixed-snapshot.json',fixed)
 const cleared=check(fixedSnapshot,0);assert.equal(cleared.status,'supported');assert.equal(cleared.runtimeComparison.status,'matched');assert.deepEqual(cleared.diagnostics,[])
 await save('live-cleared.json',cleared)
 ledger.steps.push({name:'new real handler query and snapshot clear diagnostic',sourceHash:cleared.source.sha256,instanceId:cleared.provenance.instanceId})
 // The repair uses spaced arguments; restore original whitespace byte-for-byte.
 await writeFile(file,original)
 const finalSnapshot=await capture('live-final-snapshot.json',original)
 const final=check(finalSnapshot,0);assert.equal(final.status,'supported');assert.equal(final.runtimeComparison.status,'matched');assert.equal(await readFile(file,'utf8'),original)
 await save('live-final-check.json',final)
 ledger.steps.push({name:'original bytes restored and actual current app rechecked',sourceHash:hash(original),instanceId:final.provenance.instanceId})
 ledger.status='PASS'
}catch(error){ledger.status='FAIL';ledger.error=String(error);throw error}
finally{await writeFile(file,original);await browser?.close();await save('live-repair-results.json',ledger)}
console.log(JSON.stringify(ledger,null,2))
