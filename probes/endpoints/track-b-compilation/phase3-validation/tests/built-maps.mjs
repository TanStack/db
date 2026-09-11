import {readFile,writeFile,readdir} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {TraceMap,originalPositionFor} from '@jridgewell/trace-mapping'
const phase=process.env.EVIDENCE_PHASE??'green'
const built=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{encoding:'utf8',env:{...process.env,PROBE_SOURCEMAP:'1'}})
await writeFile(`evidence/${phase}-maps-build.log`,built.stdout+built.stderr)
assert.equal(built.status,0,built.stderr)
async function files(dir){return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?files(`${dir}/${e.name}`):[`${dir}/${e.name}`]))).flat()}
const clientFiles=await files('dist/client'), leaks=[]
for(const path of clientFiles){if(!/\.(js|map)$/.test(path))continue;const source=await readFile(path,'utf8');if(/SERVER_ONLY_SENTINEL|DATABASE_ONLY_SENTINEL|AUTH_ONLY_SENTINEL/.test(source))leaks.push(path)}
const code=await readFile('src/endpoint.tsx','utf8'),correspondence=[]
function position(source,index){const lines=source.slice(0,index).split('\n');return {line:lines.length,column:lines.at(-1).length}}
for(const [directory,token] of [['dist/server','QUERY_SERVER_ONLY_SENTINEL'],['dist/server','MUTATION_SERVER_ONLY_SENTINEL'],['dist/client','optimistic:']]){
 const paths=await files(directory);let found=false
 for(const path of paths.filter(p=>p.endsWith('.js'))){const source=await readFile(path,'utf8'),index=source.indexOf(token);if(index<0)continue
  const map=new TraceMap(JSON.parse(await readFile(path+'.map','utf8')))
  const actual=originalPositionFor(map,position(source,index)),expected=position(code,code.indexOf(token))
  // Bundlers map the string to the enclosing literal token start, not each byte.
  assert.ok(actual.source.split('?')[0].endsWith('/src/endpoint.tsx'),JSON.stringify(actual));assert.equal(actual.line,expected.line)
  correspondence.push({path,token,expected,actual,scope:'exact authored line; bundler literal column may map to token start'});found=true;break
 }
 assert.ok(found,`Built ${directory} needs ${token}`)
}
const result={clientMaps:clientFiles.filter(p=>p.endsWith('.map')).length,clientLeaks:leaks,correspondence}
await writeFile(`evidence/${phase}-built-maps.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
assert.deepEqual(leaks,[],'Published client JS AND maps must exclude server implementation')
