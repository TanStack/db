// Bounded calculation requested during design. No application state is touched.
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import os from 'node:os'
const require = createRequire(new URL('../integrated-todo/package.json', import.meta.url))
const { PGlite } = require('@electric-sql/pglite')
const words = 'review write test update finish check send prepare discuss sketch record compare design build publish clean read repair validate document schedule draft plan explore'.split(' ')
function row(index) {
  const hex = createHash('sha256').update(String(index)).digest('hex')
  const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`
  const text = Array.from({length:12}, (_,i)=>words[parseInt(hex.slice(i*2,i*2+2),16)%words.length]).join(' ')
  return { id, text, completed:index%3===0, createdAt:new Date(Date.UTC(2026,0,1,0,0,index)).toISOString() }
}
function bytes(value) {
  const body = JSON.stringify(value)
  return {json:Buffer.byteLength(body),gzip:gzipSync(body).length}
}
async function sample(fn) {
  for(let i=0;i<3;i++)await fn()
  const timings=[]
  for(let i=0;i<21;i++){const start=performance.now();await fn();timings.push(performance.now()-start)}
  timings.sort((a,b)=>a-b)
  return {medianMs:timings[10],p95Ms:timings[19],samples:timings.length}
}
const output={
  kind:'local measurement plus network model, not a browser/protocol benchmark',
  measuredAt:new Date().toISOString(),node:process.version,pglite:JSON.parse(await readFile(new URL('../integrated-todo/node_modules/@electric-sql/pglite/package.json',import.meta.url),'utf8')).version,
  host:{platform:os.platform(),arch:os.arch(),cpu:os.cpus()[0]?.model},
  assumptions:{
    rows:[100,1000,10000],warmup:3,samples:21,indexes:['primary key(id)'],
    text:'12 deterministically chosen words from a 24-word vocabulary; synthetic, compression may be optimistic',
    payload:'plain JSON or gzip body only; excludes Start serialization, request bodies, headers and framing',
    networkRTTms:[5,50,150],bandwidthMbps:[10,100],
    clientApply:'unmeasured; break-even examples initially assume equal client apply costs',
    serverTiming:'single local warm in-memory PGlite, includes JS result decoding; not deployed PG, ORM, network or concurrent load',
  },measurements:[],networkBounds:[],
}
const pg=new PGlite()
try{
  await pg.exec('CREATE TABLE todo(id text PRIMARY KEY,text text NOT NULL,completed boolean NOT NULL,created_at timestamptz NOT NULL)')
  for(const count of output.assumptions.rows){
    const rows=Array.from({length:count},(_,i)=>row(i))
    await pg.exec('TRUNCATE todo')
    await pg.query('INSERT INTO todo SELECT id,text,completed,"createdAt" FROM jsonb_to_recordset($1::jsonb) AS x(id text,text text,completed boolean,"createdAt" timestamptz)',[JSON.stringify(rows)])
    const all='SELECT id,text,completed,created_at AS "createdAt" FROM todo ORDER BY created_at,id'
    const active='SELECT id,text,completed,created_at AS "createdAt" FROM todo WHERE NOT completed ORDER BY created_at,id'
    const measurement={count,fullQuery:await sample(()=>pg.query(all)),filteredQuery:await sample(()=>pg.query(active)),oneRowUpdateReturning:await sample(()=>pg.query('UPDATE todo SET completed=NOT completed WHERE id=$1 RETURNING id,text,completed,created_at AS "createdAt"',[rows[0].id])),fullPayload:bytes({rows}),oneRowPayload:bytes({mutationId:'m1',baseRevision:1,revision:2,upserts:[rows[0]],deletes:[]})}
    output.measurements.push(measurement)
    for(const rtt of output.assumptions.networkRTTms)for(const mbps of output.assumptions.bandwidthMbps){
      const bytesPerMs=mbps*125
      const savedTransferMs=(measurement.fullPayload.gzip-measurement.oneRowPayload.gzip)/bytesPerMs
      output.networkBounds.push({count,rttMs:rtt,bandwidthMbps:mbps,encoding:'gzip',savedTransferMs,extraServerWorkBudgetVsInlineFullMs:savedTransferMs,extraServerWorkBudgetVsClientRefetchMs:rtt+savedTransferMs})
    }
  }
}finally{await pg.close()}
await writeFile(new URL('./performance-measurements.json',import.meta.url),JSON.stringify(output,null,2)+'\n')
console.log(JSON.stringify(output,null,2))
