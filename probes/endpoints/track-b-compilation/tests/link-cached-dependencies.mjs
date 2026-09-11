// Optional offline host fallback used for this investigation. Does not copy credentials.
import {readFile,readdir,mkdir,symlink,realpath} from 'node:fs/promises'
const cache=process.argv[2]
if(!cache) throw Error('Pass the .pnpm cache directory (see README)')
const pkg=JSON.parse(await readFile('package.json','utf8'))
const entries=await readdir(cache)
for(const [name,version] of Object.entries({...pkg.dependencies,...pkg.devDependencies})){
 const prefix=name.replaceAll('/','+')+'@'+version
 const candidate=entries.find(e=>e===prefix||e.startsWith(prefix+'_'))
 if(!candidate)throw Error(`Missing cached ${name}@${version}`)
 const target=`node_modules/${name}`
 await mkdir(target.slice(0,target.lastIndexOf('/')),{recursive:true})
 try{await symlink(`${cache}/${candidate}/node_modules/${name}`,target)}catch(e){if(e.code!=='EEXIST')throw e}
 const installed=JSON.parse(await readFile(`${target}/package.json`,'utf8'))
 if(installed.version!==version)throw Error(`Unexpected ${name} ${installed.version}`)
 console.log(name,installed.version,await realpath(target))
}
