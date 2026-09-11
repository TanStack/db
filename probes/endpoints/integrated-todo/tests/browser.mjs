import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
const url=process.env.PROBE_URL??'http://127.0.0.1:4193'
const label=process.env.PROBE_LABEL??'dev'
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
const evidence={url,browser:browser.version(),checks:[]}
const page=await browser.newPage();page.setDefaultTimeout(15000)
const errors=[];page.on('pageerror',e=>errors.push(e.message))
const control=async(data={})=>{const r=await page.request.post(`${url}/probe-control`,{data});assert.equal(r.status(),200);return r.json()}
const state=()=>page.evaluate(()=>({state:window.todoProbe.client.lastTransaction?.state,rows:[...window.todoProbe.collection.values()].map(x=>({id:x.id,text:x.text})),outcome:window.outcome}))
const start=async(id,text)=>page.evaluate(({id,text})=>{window.outcome='pending';const transaction=window.todoProbe.add({id,text});window.actionReturn={hasThen:typeof transaction.then==='function',sameTransaction:transaction===window.todoProbe.client.lastTransaction,hasPersistencePromise:Boolean(transaction.isPersisted?.promise)};(transaction.isPersisted?.promise??transaction).then(()=>window.outcome='resolved',e=>window.outcome=e.message)},{id,text})
const until=async(fn)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('Polling deadline')}
try{
 await control({reset:true,readDelay:0,writeDelay:0,rejectWrite:false,failNextRead:false})
 await page.goto(url);await page.waitForFunction(()=>window.todoProbe);await page.evaluate(()=>window.todoProbe.collection.preload())
 // Another actual scoped DB client in the same browser ensures targeting is observable.
 const bobPage=await browser.newPage();await bobPage.goto(`${url}/?scope=bob`);await bobPage.waitForFunction(()=>window.todoProbe);await bobPage.evaluate(()=>window.todoProbe.collection.preload())
 const before=await control();const bobReads=before.events.filter(x=>x==='query:bob').length
 await control({writeDelay:700,readDelay:700})
 const id=crypto.randomUUID();await start(id,'Keep the useful things')
 assert.deepEqual(await page.evaluate(()=>window.actionReturn),{hasThen:false,sameTransaction:true,hasPersistencePromise:true})
 evidence.checks.push({name:'action synchronously returns the actual Transaction, not a promise'})
 await until(async()=>(await state()).rows.some(x=>x.id===id))
 const optimistic=await state();assert.equal(optimistic.outcome,'pending');assert.equal(optimistic.state,'persisting')
 assert.equal((await control()).rows.some(x=>x.id===id),false)
 await until(async()=>(await control()).rows.some(x=>x.id===id))
 const refetch=await state();assert.equal(refetch.outcome,'pending');assert.equal(refetch.state,'persisting');assert.ok(refetch.rows.some(x=>x.id===id))
 await page.waitForFunction(()=>window.outcome==='resolved')
 assert.equal((await state()).state,'completed');assert.equal((await state()).rows.filter(x=>x.id===id).length,1)
 const after=await control();assert.equal(after.events.filter(x=>x==='query:bob').length,bobReads)
 assert.equal(await bobPage.evaluate(()=>window.todoProbe.collection.size),0)
 evidence.checks.push({name:'delayed write/refetch preserves optimistic transaction; correct target',optimistic,refetch,settled:await state(),sql:after.sql})
 await control({writeDelay:100,readDelay:0,rejectWrite:true})
 const rejected=crypto.randomUUID();await start(rejected,'This will roll back');await page.waitForFunction(()=>window.outcome!=='pending')
 assert.equal((await state()).state,'failed');assert.equal((await state()).rows.some(x=>x.id===rejected),false);assert.equal((await control()).rows.some(x=>x.id===rejected),false)
 evidence.checks.push({name:'server rejection rolls back actual DB transaction',state:await state()})
 await control({rejectWrite:false,writeDelay:100,failNextRead:true})
 const failedRead=crypto.randomUUID();await start(failedRead,'Committed, then read failed');await page.waitForFunction(()=>window.outcome!=='pending')
 const failure=await state();assert.equal(failure.state,'failed');assert.equal(failure.rows.some(x=>x.id===failedRead),false)
 assert.equal((await control()).rows.some(x=>x.id===failedRead),true)
 await page.evaluate(()=>window.todoProbe.collection.utils.refetch({throwOnError:true}))
 assert.equal((await state()).rows.some(x=>x.id===failedRead),true)
 evidence.checks.push({name:'post-write refetch failure rejects, rollback hides row until recovery, server write remains',failure,recovered:await state()})
 await control({writeDelay:0})
 const invalid=crypto.randomUUID();await start(invalid,'');await page.waitForFunction(()=>window.outcome!=='pending')
 assert.equal((await state()).state,'failed');assert.equal((await control()).rows.some(x=>x.id===invalid),false)
 evidence.checks.push({name:'runtime schema rejects empty text and rolls back',state:await state()})
 await page.reload();await page.waitForFunction(()=>window.todoProbe);await page.evaluate(()=>window.todoProbe.collection.preload())
 assert.equal((await state()).rows.some(x=>x.id===id),true)
 await writeFile(`evidence/${label}-schema.json`,JSON.stringify(await (await page.request.get(`${url}/probe-control`)).json(),null,2))
 await page.screenshot({path:`evidence/${label}.png`,fullPage:true})
 assert.deepEqual(errors,[])
 evidence.checks.push({name:'server persistence survives browser reload',rows:(await state()).rows})
 evidence.status='PASS'
} catch(error){evidence.status='FAIL';evidence.error=String(error);throw error}
finally{await writeFile(`evidence/${label}-browser.json`,JSON.stringify(evidence,null,2));await browser.close()}
console.log(JSON.stringify(evidence,null,2))
