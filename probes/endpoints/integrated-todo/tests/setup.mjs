// Investigation cache-backed setup; no network install or shared dependency edits.
import {readFile,readdir,mkdir,symlink,realpath} from 'node:fs/promises'
import {resolve} from 'node:path'
const base=resolve(import.meta.dirname,'..')
const pkg=JSON.parse(await readFile(`${base}/package.json`,'utf8'))
const [cache,analysisModules]=process.argv.slice(2)
if(!cache||!analysisModules)throw Error('Pass pnpm .pnpm cache and Track A node_modules paths.')
const destination=process.env.PROBE_NODE_MODULES??`${base}/node_modules`
const entries=await readdir(cache)
for(const [name,version]of Object.entries({...pkg.dependencies,...pkg.devDependencies})){
 const prefix=name.replaceAll('/','+')+'@'+version
 const matches=entries.filter(e=>e===prefix||e.startsWith(prefix+'_'))
 const entry=matches.find(e=>e.includes('react@19.2.4'))??matches[0]
 const source=entry?`${cache}/${entry}/node_modules/${name}`:`${analysisModules}/${name}`
 const installed=JSON.parse(await readFile(`${source}/package.json`,'utf8'))
 if(installed.version!==version)throw Error(`Expected ${name}@${version}, found ${installed.version}`)
 const target=`${destination}/${name}`
 await mkdir(target.slice(0,target.lastIndexOf('/')),{recursive:true})
 try{await symlink(await realpath(source),target)}catch(error){if(error.code!=='EEXIST')throw error}
 console.log(name,version,await realpath(target))
}
