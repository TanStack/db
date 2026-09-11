// Deliberate integration mutant: drop settlement's awaited collection refetch.
// The browser test itself must fail on premature settlement.
import {readFile,writeFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
const path='src/runtime.ts',source=await readFile(path,'utf8')
const needle='await Promise.all([...targets].map(collection=>(collection as TodosCollection).utils.refetch({throwOnError:true})))'
if(!source.includes(needle))throw Error('Regression seam changed')
try{
 await writeFile(path,source.replace(needle,'// Intentional red mutant: no refetch before settlement.'))
 const result=spawnSync(process.execPath,['tests/browser.mjs'],{env:{...process.env,PROBE_LABEL:'red-no-refetch'},encoding:'utf8'})
 await writeFile('evidence/red-no-refetch.log',result.stdout+result.stderr)
 if(result.status===0)throw Error('False green: missing refetch was accepted')
 const report=JSON.parse(await readFile('evidence/red-no-refetch-browser.json','utf8'))
 if(!report.error?.includes('AssertionError'))throw Error(`Not a semantic regression: ${report.error}`)
 console.log('PASS: browser regression rejects missing refetch',report.error)
}finally{await writeFile(path,source)}
