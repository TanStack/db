import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
 const page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];let request
 page.on('pageerror',e=>errors.push(e.message))
 page.on('response',r=>{if(r.url().includes('_serverFn'))request={url:r.url(),status:r.status(),method:r.request().method(),body:r.request().postData(),headers:r.request().headers()}})
 await page.goto(process.env.PROBE_URL ?? 'http://127.0.0.1:4179');await page.waitForFunction(()=>document.body.dataset.ready==='true');await page.getByRole('button',{name:'Run'}).click()
 await page.waitForFunction(()=>document.querySelector('#result')?.textContent?.includes('SERVER_ONLY_SENTINEL'),{},{timeout:15000})
 const optimistic=await page.locator('#optimistic').textContent(),result=JSON.parse(await page.locator('#result').textContent())
 assert.equal(optimistic,'optimistic:shared:test');assert.equal(result.text,'shared:test');assert.ok(result.server.includes('helper-v1:handler-v1'));assert.deepEqual(errors,[]);assert.equal(request.status,200);assert.equal(request.method,'POST')
 const bad=await page.request.post(request.url,{data:request.body.replace('"s":"test"','"s":""'),headers:request.headers});const badBody=await bad.text();assert.ok(badBody.includes('Too small'));assert.equal(badBody.includes('SERVER_ONLY_SENTINEL'),false)
 console.log(JSON.stringify({browser:browser.version(),optimistic,result,request:{url:request.url,status:request.status,method:request.method},invalidInput:{httpStatus:bad.status(),schemaError:true,handlerResult:false},errors},null,2))
}finally{await browser.close()}
