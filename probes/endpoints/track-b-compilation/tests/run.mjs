import {chromium} from 'playwright'
import {readFile,writeFile,readdir,rm} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
const files=['src/endpoint.ts','src/server-helper.ts','src/routes/index.tsx']
const original=Object.fromEntries(await Promise.all(files.map(async f=>[f,await readFile(f,'utf8')])))
const results=[]
const record=(test,data)=>{results.push({test,...data});console.log(test,JSON.stringify(data))}
const build=()=>execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})
async function chunks(dir){const entries=await readdir(dir,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?chunks(`${dir}/${e.name}`):e.name.endsWith('.js')?readFile(`${dir}/${e.name}`,'utf8'):''))).join('\n')}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
const page=await browser.newPage();const requests=[];page.on('response',r=>{if(r.url().includes('_serverFn')) requests.push({url:r.url(),status:r.status(),method:r.request().method(),body:r.request().postData(),headers:r.request().headers()})})
async function run(label,expected){await page.goto('http://127.0.0.1:4179');await page.waitForFunction(()=>document.body.dataset.ready==='true');await page.getByRole('button',{name:'Run'}).click();await page.waitForFunction(()=>document.querySelector('#result')?.textContent?.includes('SERVER_ONLY_SENTINEL'),{},{timeout:15000});const result=JSON.parse(await page.locator('#result').textContent());assert.ok(result.server.includes(expected),JSON.stringify(result));assert.equal(await page.locator('#optimistic').textContent(),'optimistic:shared:test');record(label,{status:'pass',result,request:requests.at(-1),optimistic:'optimistic:shared:test'})}
try{
 record('source',{sha256:createHash('sha256').update(original['src/endpoint.ts']).digest('hex'),declaration:'addTodo',generated:'addTodoRpc',location:'src/endpoint.ts:5-11',sourceMap:true})
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--noEmit']);record('types',{status:'pass'})
 await run('dev baseline','helper-v1:handler-v1')
 const oldRequest=requests.at(-1)
 async function replay(label){const response=await page.request.post(oldRequest.url,{data:oldRequest.body,headers:oldRequest.headers});record(label,{status:response.status()===200?'fail':'pass',httpStatus:response.status(),body:(await response.text()).slice(0,400)})}
 await writeFile('src/endpoint.ts',original['src/endpoint.ts'].replace('handler-v1','handler-v2'));await page.waitForTimeout(800);await run('dev handler edit','helper-v1:handler-v2')
 await writeFile('src/server-helper.ts',original['src/server-helper.ts'].replace('helper-v1','helper-v2'));await page.waitForTimeout(800);await run('dev helper edit','helper-v2:handler-v2')
 await writeFile('src/endpoint.ts',(await readFile('src/endpoint.ts','utf8')).replaceAll('addTodo','createTodo'));await writeFile('src/routes/index.tsx',original['src/routes/index.tsx'].replaceAll('addTodo','createTodo'));await page.waitForTimeout(800);await run('dev rename','helper-v2:handler-v2');await replay('old RPC after rename')
 await rm('dist',{recursive:true,force:true});await writeFile('evidence/phase-2/modified-build.log',build());const client=await chunks('dist/client'),server=await chunks('dist/server');assert.equal(client.includes('SENTINEL'),false);assert.ok(server.includes('helper-v2'));assert.equal(server.includes('handler-v1'),false);assert.equal(server.includes('addTodoRpc'),false);record('clean modified build',{status:'pass',clientSentinels:false,serverRequired:true,staleName:false})
 await writeFile('src/endpoint.ts','export const removed = true\n');await writeFile('src/routes/index.tsx',"import {createFileRoute} from '@tanstack/react-router'\nexport const Route=createFileRoute('/')({component:()=> <p>Endpoint removed</p>})\n");await page.waitForTimeout(800);await page.goto('http://127.0.0.1:4179');assert.ok((await page.locator('body').innerText()).includes('Endpoint removed'));await replay('old RPC after delete');await rm('dist',{recursive:true,force:true});await writeFile('evidence/phase-2/deleted-build.log',build());assert.equal((await chunks('dist/server')).includes('SERVER_ONLY_SENTINEL'),false);record('delete declaration dev and clean build',{status:'pass',staleServerImplementation:false})
}finally{for(const [f,s] of Object.entries(original))await writeFile(f,s);await browser.close();await writeFile('evidence/phase-2/results.json',JSON.stringify(results,null,2))}
await writeFile('evidence/phase-2/build.log',build())
