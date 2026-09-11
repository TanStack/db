import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
const label=process.env.PROBE_LABEL??'callback-green'
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
const result={}
try{
 const page=await browser.newPage();await page.goto(process.env.PROBE_URL??'http://127.0.0.1:4193');await page.waitForFunction(()=>window.todoProbe)
 result.partial=await page.evaluate(async()=>{
  const p=window.todoProbe;await p.collection.preload();const id=crypto.randomUUID();let called=false,error
  // Explicit fixture descriptor: test failure BEFORE network work may begin.
  const endpoint={kind:'mutation',id:'callback-throw-fixture',rpc:async()=>{called=true},onMutate({dbClient}){p.listTodos.insert({id,text:'Partial callback must roll back',completed:false,createdAt:new Date()});throw Error('Callback failed')}}
  try{await p.client.run(endpoint,{})}catch(e){error=e.message}
  return {state:p.client.lastTransaction.state,retained:p.collection.has(id),called,error}
 })
 assert.equal(result.partial.state,'failed');assert.equal(result.partial.retained,false);assert.equal(result.partial.called,false);assert.equal(result.partial.error,'Callback failed')
 result.empty=await page.evaluate(async()=>{const p=window.todoProbe;let called=false,error;try{await p.client.run({kind:'mutation',id:'empty-fixture',rpc:async()=>{called=true},onMutate(){}},{})}catch(e){error=e.message};return {state:p.client.lastTransaction.state,called,error}})
 assert.equal(result.empty.state,'failed');assert.equal(result.empty.called,false);assert.match(result.empty.error,/requires an optimistic target/)
 result.status='PASS'
}catch(error){result.status='FAIL';result.error=String(error);throw error}
finally{await writeFile(`evidence/${label}.json`,JSON.stringify(result,null,2));await browser.close()}
console.log(result)
