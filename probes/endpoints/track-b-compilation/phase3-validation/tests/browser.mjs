import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
 const page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[],requests=[]
 page.on('pageerror',error=>errors.push(error.message))
 page.on('response',response=>{if(response.url().includes('_serverFn/'))requests.push({status:response.status(),url:response.url(),method:response.request().method()})})
 await page.goto(process.env.PROBE_URL??'http://127.0.0.1:4291');await page.waitForFunction(()=>document.body.dataset.ready==='true');await page.getByRole('button',{name:'Run'}).click()
 await page.waitForFunction(()=>document.querySelector('#result')?.textContent?.includes('MUTATION_SERVER_ONLY_SENTINEL'))
 const query=JSON.parse(await page.locator('#query').textContent()),mutation=JSON.parse(await page.locator('#result').textContent()),optimistic=await page.locator('#optimistic').textContent()
 assert.equal(query[0].text,'shared:list');assert.ok(query[0].server.includes('QUERY_SERVER_ONLY_SENTINEL:DATABASE_ONLY_SENTINEL:alice'))
 assert.equal(mutation.text,'shared:test');assert.ok(mutation.server.includes('MUTATION_SERVER_ONLY_SENTINEL:DATABASE_ONLY_SENTINEL:AUTH_ONLY_SENTINEL:helper-v1:alice'))
 assert.equal(optimistic,'optimistic:shared:test');assert.deepEqual(errors,[]);assert.equal(requests.length,2);assert.ok(requests.every(r=>r.status===200&&r.method==='POST'))
 console.log(JSON.stringify({browser:browser.version(),query,mutation,optimistic,requests,errors},null,2))
}finally{await browser.close()}
