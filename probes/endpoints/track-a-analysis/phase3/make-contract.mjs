// Explicit binding tool for this reviewed local specimen; not schema discovery.
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {expectedSchema} from '../phase2/context.mjs'
const [appArg,outputArg]=process.argv.slice(2)
if(!appArg||!outputArg)throw Error('Usage: node make-contract.mjs ABS_INTEGRATED_APP ABS_OUTPUT_JSON')
const app=resolve(appArg),dependencies=[]
for(const [role,relative] of [['schema','src/database.server.ts'],['runtime','src/runtime.ts'],['compiler','transform.mjs']]) {
 const path=join(app,relative),source=await readFile(path)
 dependencies.push({role,path,sha256:createHash('sha256').update(source).digest('hex')})
}
const contract={format:'endpoints-analysis-contract/v1',endpoint:'listTodos',imports:{query:'./runtime',db:'./database.server',todo:'./database.server',requireUser:'./database.server',asc:'drizzle-orm',eq:'drizzle-orm',z:'zod'},schema:{identity:'integrated-todo-local-disposable',columns:expectedSchema},dependencies,scope:'Reviewed five-column Todo fixture; hashes bind known files, not arbitrary schema/module semantic discovery'}
await writeFile(resolve(outputArg),JSON.stringify(contract,null,2)+'\n')
