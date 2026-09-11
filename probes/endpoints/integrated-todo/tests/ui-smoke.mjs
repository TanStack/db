import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
const url=process.env.PROBE_URL??'http://127.0.0.1:4191',label=process.env.PROBE_LABEL??'dev'
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
 const page=await browser.newPage();page.setDefaultTimeout(15000)
 await page.request.post(`${url}/probe-control`,{data:{reset:true,writeDelay:0,readDelay:0,rejectWrite:false,failNextRead:false}})
 await page.goto(url);await page.getByLabel('One thing to do').waitFor();assert.equal(await page.evaluate(()=>Object.hasOwn(window,'todoProbe')),false)
 const text=`Put the kettle on · ${label}`
 await page.getByLabel('One thing to do').fill(text)
 await page.getByRole('button',{name:'Add task'}).click()
 await page.waitForFunction(()=>document.querySelector('#status').textContent==='Saved')
 assert.equal(await page.getByText(text,{exact:true}).count(),1)
 const snapshot=await(await page.request.post(`${url}/probe-control`,{data:{}})).json()
 assert.ok(snapshot.rows.some(row=>row.text===text&&row.user_id==='alice'))
 await page.screenshot({path:`evidence/${label}-ui.png`,fullPage:true})
 await writeFile(`evidence/${label}-ui.json`,JSON.stringify({url,status:'PASS',browser:browser.version(),formSubmitted:true,serverRow:snapshot.rows.find(row=>row.text===text)},null,2))
 console.log('PASS actual form submit → Saved → PostgreSQL row',url)
}finally{await browser.close()}
