import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {fixtureContext,expectedSchema} from '../phase2/context.mjs'
const {verifyEvidence}=await import(process.env.PHASE3_BASELINE==='1'?'./evidence-red-baseline.mjs':'./evidence.mjs')
const source='a fixture source',hash=s=>createHash('sha256').update(s).digest('hex')
const dir=await mkdtemp(fileURLToPath(new URL('./evidence-run-',import.meta.url)))
const schemaPath=join(dir,'database.server.ts');await writeFile(schemaPath,'trusted schema source')
const context=await fixtureContext()
const contract={schema:{identity:'integrated-todo-local',columns:expectedSchema},dependencies:[{role:'schema',path:schemaPath,sha256:hash('trusted schema source')}]}
const snapshot={instanceId:'test-instance',capturedAt:'2026-09-10T00:00:00Z',databaseVersion:context.databaseVersion,endpointSourceHash:hash(source),expectedSchema,schema:context.schema,indexes:context.indexes,query:{sql:'placeholder',params:['alice']}}
test('evidence uses supplied app snapshot rather than creating a second database',async()=>{
 const result=await verifyEvidence(source,contract,snapshot)
 assert.equal(result.status,'checked');assert.equal(result.provenance.instanceId,'test-instance');assert.deepEqual(result.context.schema,snapshot.schema)
})
test('changed current source rejects stale running-app source receipt',async()=>{
 assert.equal((await verifyEvidence(source+'\n',contract,snapshot)).code,'STALE_RUNTIME_SOURCE')
})
test('changed schema source rejects the stale declared dependency',async()=>{
 assert.equal((await verifyEvidence(source,{...contract,dependencies:[{...contract.dependencies[0],sha256:'old'}]},snapshot)).code,'STALE_DEPENDENCY')
})
test('expected schema mismatch and missing runtime provenance cannot pass',async()=>{
 assert.equal((await verifyEvidence(source,contract,{...snapshot,expectedSchema:[]})).code,'SCHEMA_CONTRACT_MISMATCH')
 assert.equal((await verifyEvidence(source,contract,{...snapshot,instanceId:undefined})).code,'SNAPSHOT_NOT_CHECKED')
})
