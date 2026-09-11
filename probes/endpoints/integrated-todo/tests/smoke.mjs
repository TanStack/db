import {chromium} from 'playwright'
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
const page=await browser.newPage();page.on('pageerror',e=>console.log('PAGE ERROR',e.message));page.on('console',m=>console.log(m.type(),m.text()))
await page.goto('http://127.0.0.1:4191');await page.waitForTimeout(4000);console.log(await page.locator('body').innerText());await browser.close()
