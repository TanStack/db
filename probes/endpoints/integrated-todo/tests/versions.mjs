import {readFile,realpath,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const pkg=JSON.parse(await readFile('package.json','utf8'))
const packages={}
for(const name of Object.keys({...pkg.dependencies,...pkg.devDependencies})){
 const path=await realpath(`node_modules/${name}`)
 packages[name]={version:JSON.parse(await readFile(`${path}/package.json`,'utf8')).version,path}
}
const sourcePackages={}
for(const name of ['db','db-ivm','query-db-collection','react-db'])sourcePackages[name]={version:JSON.parse(await readFile(`../../../packages/${name}/package.json`,'utf8')).version,source:`packages/${name}/src/index.ts`}
const files={}
for(const file of ['transform.mjs','vite.config.ts','src/endpoint.tsx','src/runtime.ts','src/database.server.ts','tests/browser.mjs'])files[file]=createHash('sha256').update(await readFile(file)).digest('hex')
const result={node:process.version,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),packages,sourcePackages,files}
await writeFile('evidence/versions.json',JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
