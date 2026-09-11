import {readFile,writeFile,readdir,rm} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
const original=await readFile('src/endpoint.ts','utf8'), route=await readFile('src/routes/index.tsx','utf8')
const shared=await readFile('src/shared.ts','utf8')
const phase=process.env.EVIDENCE_PHASE??'green', results=[]
async function chunks(dir){return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?chunks(`${dir}/${e.name}`):e.name.endsWith('.js')?readFile(`${dir}/${e.name}`,'utf8'):''))).join('\n')}
try{
 await writeFile('src/probe-secret.server.ts',"console.log('SUFFIX_ONLY_SENTINEL')\n")
 for(const [name,source,page,marker,sharedSource] of [
  ['retained-helper',original+'\nexport const retained = database()\n',route.replace('{addTodo}','{addTodo,retained}').replace('<main>','<main>{retained}'),'DATABASE_ONLY_SENTINEL'],
  ['side-effect-import',"import './server-side-effect'\n"+original,route,'SIDE_EFFECT_ONLY_SENTINEL'],
  ['server-suffix',"import './probe-secret.server'\n"+original,route,'SUFFIX_ONLY_SENTINEL'],
  ['transitive-helper',original,route,'DATABASE_ONLY_SENTINEL',"import {database} from './server-helper'\nexport const shared=(text:string)=>database()+text\n"],
  ['transitive-side-effect',original,route,'SIDE_EFFECT_ONLY_SENTINEL',"import './server-side-effect'\n"+shared],
 ]){
  await writeFile('src/shared.ts',sharedSource??shared);await writeFile('src/endpoint.ts',source);await writeFile('src/routes/index.tsx',page)
  const built=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{encoding:'utf8'})
  await writeFile(`evidence/phase-2/${phase}-${name}.log`,built.stdout+built.stderr)
  const leaked=built.status===0&&(await chunks('dist/client')).includes(marker)
  // Safety must be established by a classified rejection, not by any build error.
  const safe=built.status!==0&&built.stderr.includes('ENDPOINT_SERVER_IMPORT_IN_CLIENT')
  results.push({name,buildExit:built.status,leaked,safe,status:safe?'pass':'fail'})
 }
}finally{await rm('src/probe-secret.server.ts',{force:true});await writeFile('src/shared.ts',shared);await writeFile('src/endpoint.ts',original);await writeFile('src/routes/index.tsx',route);await writeFile(`evidence/phase-2/${phase}-safety.json`,JSON.stringify(results,null,2))}
console.log(JSON.stringify(results,null,2));assert.ok(results.every(r=>r.safe),'Every unsafe import must fail with ENDPOINT_SERVER_IMPORT_IN_CLIENT')
