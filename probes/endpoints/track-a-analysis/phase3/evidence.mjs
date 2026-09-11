import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {isAbsolute} from 'node:path'
const hash=value=>createHash('sha256').update(value).digest('hex')
const gap=(code,reason)=>({status:'not checked',code,reason})
const columns=value=>JSON.stringify([...value].sort((a,b)=>a.name.localeCompare(b.name)))

// Consumes a caller-captured snapshot of the actual local specimen database.
// No application module is imported, and no second database is created here.
export async function verifyEvidence(source,contract,snapshot) {
 if(!snapshot?.instanceId||!snapshot.capturedAt||!snapshot.databaseVersion||!snapshot.endpointSourceHash||!Array.isArray(snapshot.schema)||!Array.isArray(snapshot.expectedSchema)||!Array.isArray(snapshot.indexes)) return gap('SNAPSHOT_NOT_CHECKED','running-app source/schema snapshot provenance is required')
 if(snapshot.endpointSourceHash!==hash(source)) return gap('STALE_RUNTIME_SOURCE','current source differs from the running app compiler receipt; rebuild and capture a new snapshot')
 if(!contract.schema?.identity||!Array.isArray(contract.schema.columns)||!Array.isArray(contract.dependencies)||!contract.dependencies.some(d=>d.role==='schema')) return gap('CONTRACT_NOT_CHECKED','declared schema and source dependency hashes are required')
 for(const dependency of contract.dependencies) {
  if(!isAbsolute(dependency.path)||typeof dependency.sha256!=='string') return gap('CONTRACT_NOT_CHECKED','dependency path must be absolute with SHA-256')
  let content
  try{content=await readFile(dependency.path)}catch{return gap('STALE_DEPENDENCY',`dependency unavailable: ${dependency.role}`)}
  if(hash(content)!==dependency.sha256)return gap('STALE_DEPENDENCY',`dependency changed: ${dependency.role}`)
 }
 if(columns(contract.schema.columns)!==columns(snapshot.expectedSchema)) return gap('SCHEMA_CONTRACT_MISMATCH','runtime Drizzle schema facts differ from the declared contract')
 return {status:'checked',context:{schemaIdentity:contract.schema.identity,expectedSchema:contract.schema.columns,schema:snapshot.schema,indexes:snapshot.indexes},provenance:{instanceId:snapshot.instanceId,capturedAt:snapshot.capturedAt,databaseVersion:snapshot.databaseVersion,endpointSourceHash:snapshot.endpointSourceHash,snapshotHash:hash(JSON.stringify(snapshot)),dependencies:contract.dependencies},query:snapshot.query}
}
