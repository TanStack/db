import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {fixtureContext,expectedSchema} from '../phase2/context.mjs'
import {adaptModule} from './adapter.mjs'
const here=fileURLToPath(new URL('.',import.meta.url)),dir=await mkdtemp(join(here,'cli-run-'))
const hash=s=>createHash('sha256').update(s).digest('hex')
const source=await readFile(join(here,'fixtures/endpoint.tsx'),'utf8'),file=join(dir,'endpoint.tsx'),schemaFile=join(dir,'schema.ts'),contractFile=join(dir,'contract.json'),snapshotFile=join(dir,'snapshot.json'),reportFile=join(dir,'report.json')
await writeFile(file,source);await writeFile(schemaFile,'test-only schema receipt')
const contract={endpoint:'listTodos',imports:{query:'./runtime',db:'./database.server',todo:'./database.server',requireUser:'./database.server',asc:'drizzle-orm',eq:'drizzle-orm',z:'zod'},schema:{identity:'test-only-disposable',columns:expectedSchema},dependencies:[{role:'schema',path:schemaFile,sha256:hash('test-only schema receipt')}]}
const context=await fixtureContext()
let snapshot={instanceId:'test-only-no-app-instance',capturedAt:new Date().toISOString(),databaseVersion:context.databaseVersion,endpointSourceHash:hash(source),expectedSchema,schema:context.schema,indexes:context.indexes,query:adaptModule(source,contract,'alice').input}
await writeFile(contractFile,JSON.stringify(contract));await writeFile(snapshotFile,JSON.stringify(snapshot))
const run=(command='check',extra=[])=>{const args=command==='check'?['--contract',contractFile,'--snapshot',snapshotFile]:['--diagnostic',reportFile];const result=spawnSync(process.execPath,[join(here,'cli.mjs'),command,'--file',file,...args,...extra],{encoding:'utf8'});return {exit:result.status,result:JSON.parse(result.stdout)}}

test('CLI repair requires new source receipt and matching query before clear',async()=>{
 const before=run();assert.equal(before.exit,1);assert.equal(before.result.check.code,'ENDPOINT_ORDER_NOT_TOTAL');assert.equal(before.result.runtimeComparison.status,'matched')
 await writeFile(reportFile,JSON.stringify(before.result));assert.equal(run('apply').exit,0)
 const stale=run();assert.equal(stale.exit,2);assert.equal(stale.result.check.code,'STALE_RUNTIME_SOURCE')
 const fixed=await readFile(file,'utf8')
 snapshot={...snapshot,endpointSourceHash:hash(fixed)};await writeFile(snapshotFile,JSON.stringify(snapshot))
 const staleQuery=run();assert.equal(staleQuery.result.check.code,'RUNTIME_QUERY_MISMATCH')
 snapshot={...snapshot,query:adaptModule(fixed,contract,'alice').input};await writeFile(snapshotFile,JSON.stringify(snapshot))
 const after=run();assert.equal(after.exit,0);assert.equal(after.result.status,'supported');assert.deepEqual(after.result.diagnostics,[])
 assert.equal(run('apply').result.code,'STALE_DIAGNOSTIC')
 await writeFile(join(here,'cli-results.json'),JSON.stringify({label:'Synthetic snapshot contract test, not running app evidence',before,stale,staleQuery,after},null,2)+'\n')
})
