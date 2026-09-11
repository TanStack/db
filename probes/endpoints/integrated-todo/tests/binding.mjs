import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
const url=process.env.PROBE_URL??'http://127.0.0.1:4193'
const label=process.env.PROBE_LABEL??'bound-dev'
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
 const page=await browser.newPage()
 await page.goto(url);await page.waitForFunction(()=>window.todoProbe)
 await page.evaluate(async()=>{await window.todoProbe.view.preload();window.previousBinding={...window.todoProbe}})
 await page.getByLabel('One thing to do').fill('Rerender keeps the same endpoints')
 const result=await page.evaluate(()=>({query:window.todoProbe.listTodos===window.previousBinding.listTodos,mutation:window.todoProbe.addTodo===window.previousBinding.addTodo,source:window.todoProbe.collection===window.previousBinding.collection,client:window.todoProbe.client===window.previousBinding.client,bareCollection:window.todoProbe.listTodos===window.todoProbe.view,sameWritableCollection:window.todoProbe.listTodos===window.todoProbe.collection,directWrite:(()=>{const tx=window.todoProbe.client.core.createTransaction({autoCommit:false,mutationFn:async()=>{}});tx.mutate(()=>window.todoProbe.listTodos.insert({id:crypto.randomUUID(),text:'Direct write',completed:false,createdAt:new Date()}));const direct=tx.mutations.every(m=>m.collection===window.todoProbe.listTodos)&&tx.mutations.length===1;tx.rollback();return direct})()}))
 assert.deepEqual(result,{query:true,mutation:true,source:true,client:true,bareCollection:true,sameWritableCollection:true,directWrite:true})
 await writeFile(`evidence/${label}-identity.json`,JSON.stringify({status:'PASS',url,...result},null,2))
 console.log('PASS stable bare collection, mutation, source and client across React rerender')
}finally{await browser.close()}
