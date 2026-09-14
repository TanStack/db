// Renders the SUT only. Reference SQL lives in reference.mjs and never imports this.
export const markers = [
  'ORACLE_SERVER_HANDLER_41e30',
  'ORACLE_SERVER_QUERY_7a0f9',
  'ORACLE_DATABASE_ONLY_06ca2',
]

export function renderProgram({
  orders,
  filters = [],
  unsubscribed = [],
  canonicalize = false,
  gced = [],
  repeatedNames = false,
}) {
  const queries = orders.map(
    (order, i) => `
  const rows${i} = query({
    input: z.object({}),
    async handler(req, res) {
      // ${markers[1]}
      const user = await requireUser(req)
      const todos = await db.select({id:todo.id,text:todo.text,completed:todo.completed,createdAt:todo.createdAt})
        .from(todo).where(${filters[i] === undefined || filters[i] === null ? 'eq(todo.userId,user.id)' : `and(eq(todo.userId,user.id),eq(todo.completed,${filters[i]}))`}).orderBy(${order.map((field) => `asc(todo.${field})`).join(',')})
      return res.json(todos)
    },
  })`,
  )

  const mutations = orders.flatMap((_, i) =>
    ['insert', 'edit', 'complete', 'delete'].map((kind) => {
      const optimistic = {
        insert: `rows${i}.insert({id:input.id,text:input.text,completed:input.completed,createdAt:input.createdAt})`,
        edit: `rows${i}.update(input.id,draft=>{draft.text=input.text})`,
        complete: `rows${i}.update(input.id,draft=>{draft.completed=input.completed})`,
        delete: `rows${i}.delete(input.id)`,
      }[kind]
      const statement = {
        insert: `db.insert(todo).values({id:input.id,text:${canonicalize ? 'input.text.trim()' : 'input.text'},completed:input.completed,createdAt:input.createdAt,userId:user.id})`,
        edit: `db.update(todo).set({text:${canonicalize ? 'input.text.trim()' : 'input.text'}}).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))`,
        complete: `db.update(todo).set({completed:input.completed}).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))`,
        delete: `db.delete(todo).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))`,
      }[kind]
      return `const ${kind}${i} = mutation({
      input:z.object({id:z.string(),text:z.string(),completed:z.boolean(),createdAt:z.coerce.date(),token:z.string(),actualEffect:z.enum(['same','flip','other','noop']),otherId:z.string().nullable(),failAfterCommit:z.boolean()}),
      onMutate({input}) { ${optimistic} },
      async handler(req,res) {
        const user=await requireUser(req)
        const input=req.body
        await beforeWrite(input.token, '${markers[0]}')
        if(input.actualEffect!=='noop') {
          await ${statement}
          if(input.actualEffect==='flip') await db.update(todo).set({completed:!input.completed}).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))
          if(input.actualEffect==='other'&&input.otherId!==null) await db.update(todo).set({completed:input.completed,text:input.text}).where(and(eq(todo.id,input.otherId),eq(todo.userId,user.id)))
        }
        if(input.failAfterCommit) throw Error('oracle post-commit failure')
        return res.json({ok:true})
      },
    })`
    }),
  )

  // Distinct lexical scopes deliberately repeat every local declaration name.
  const local = (source, i) =>
    source.replaceAll(
      new RegExp(`(rows|insert|edit|complete|delete)${i}\\b`, 'g'),
      '$1',
    )
  const factories = repeatedNames
    ? orders
        .map((_, i) =>
          `
function scope${i}(){
  function TodoApp(dbClient){
    const {query,mutation}=endpoints(dbClient)
    ${local(queries[i], i)}
    ${mutations
      .slice(i * 4, i * 4 + 4)
      .map((source) => local(source, i))
      .join('\n')}
    return {rows,insert,edit,complete,delete:deleteAction}
  }
  return TodoApp
}`.replace('const delete =', 'const deleteAction ='),
        )
        .join('\n')
    : ''
  const declarations = repeatedNames
    ? orders
        .map(
          (_, i) =>
            `const {rows:rows${i},insert:insert${i},edit:edit${i},complete:complete${i},delete:delete${i}}=scope${i}()(dbClient)`,
        )
        .join('\n')
    : `const {query,mutation}=endpoints(dbClient)\n${queries.join('\n')}\n${mutations.join('\n')}`
  return `import {z} from 'zod'
import {endpoints} from './runtime'
import {db,todo,requireUser,beforeWrite} from './database.server'
import {asc,eq,and} from 'drizzle-orm'
import {useDbClient,useLiveQuery} from '@tanstack/react-db'
import {useOracleProbe} from './oracle-probe'
${factories}
export function TodoApp(){
  const dbClient=useDbClient()
  ${declarations}
  ${orders.map((_, i) => (unsubscribed.includes(i) || gced.includes(i) ? '' : `const result${i}=useLiveQuery(rows${i})`)).join('\n')}
  useOracleProbe([${orders.map((_, i) => `rows${i}`).join(',')}],{${orders.flatMap((_, i) => ['insert', 'edit', 'complete', 'delete'].map((k) => `${k}${i}`)).join(',')}},${JSON.stringify(gced)})
  return <main>${orders.map((_, i) => (unsubscribed.includes(i) || gced.includes(i) ? '' : `<section data-query="${i}">{result${i}.data.map(row=><output key={row.id} data-row={row.id}>{row.text}</output>)}</section>`)).join('')}</main>
}
`
}

// No oracle/model code is installed in the browser. It exposes only SUT values.
export const browserProbe = `import {useEffect} from 'react'
import {useDbClient} from '@tanstack/react-db'
import {endpointRuntime} from './runtime'
export function useOracleProbe(collections,actions,gced=[]){
 const runtime=endpointRuntime(useDbClient())
 useEffect(()=>{
 const plain=row=>{const {$collectionId,$key,$origin,$synced,...data}=row;return {...data,createdAt:row.createdAt.toISOString()}}
  const outcomes={}
  const events=[]
  const observers=[]
  const snapshot=()=>collections.map(c=>Array.from(c.values(),plain))
  const value={
   ready:async()=>{await Promise.all(collections.map(c=>c.preload()));for(const i of gced)await collections[i].cleanup()},snapshot,
   invoke(name,input){
    const started=performance.now()
    const tx=actions[name]({...input,createdAt:new Date(input.createdAt)})
    outcomes[input.token]={state:tx.state,result:'pending'}
    void tx.isPersisted.promise.then(()=>{outcomes[input.token]={state:tx.state,result:'fulfilled',elapsedMs:performance.now()-started}},e=>{outcomes[input.token]={state:tx.state,result:'rejected',error:String(e)}})
    return {isPromise:typeof tx.then==='function',hasPersistence:!!tx.isPersisted?.promise,rows:snapshot()}
   },outcomes,refresh:()=>Promise.all(collections.filter((_,i)=>!gced.includes(i)).map(c=>c.utils.refetch({throwOnError:true}))),errors:()=>[...runtime.readErrors.values()],subscriberCounts:()=>collections.map(c=>c.subscriberCount),
   observe(){collections.forEach((c,index)=>observers.push(c.subscribeChanges(changes=>events.push({index,changes:changes.map(change=>({type:change.type,key:change.key,value:plain(change.value)})),rows:snapshot()}),{includeInitialState:false})))},
   drainEvents(){return events.splice(0)},
  }
  window.endpointOracle=value
  return ()=>{observers.forEach(observer=>observer.unsubscribe());if(window.endpointOracle===value)delete window.endpointOracle}
 },[...collections,...Object.values(actions)])
}
`

// Real application PGlite and Drizzle, with only write/read completion gated.
export const databaseFixture = `import {PGlite} from '@electric-sql/pglite'
import {drizzle} from 'drizzle-orm/pglite'
import {pgTable,text,boolean,timestamp} from 'drizzle-orm/pg-core'
const marker='${markers[2]}'
export const pg=new PGlite()
export const todo=pgTable('todo',{id:text('id').primaryKey(),text:text('text').notNull(),completed:boolean('completed').notNull(),createdAt:timestamp('created_at').notNull(),userId:text('user_id').notNull()})
export const db=drizzle(pg)
const ready=pg.exec('/* '+marker+' */ CREATE TABLE todo(id text PRIMARY KEY,text text NOT NULL,completed boolean NOT NULL,created_at timestamp NOT NULL,user_id text NOT NULL)')
let armed=null
const gates=new Map()
let readGate=null
const events=[]
const witnesses=new Set()
function gate(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});void promise.catch(()=>{});return {promise,resolve,reject}}
export async function requireUser(req){
 await ready
 if(req.kind==='query'&&readGate){const held=readGate;events.push('read:waiting');await held.promise}
 return {id:req.scope}
}
export async function beforeWrite(token,witness){
 witnesses.add(witness)
 if(!gates.has(token))throw Error('Unexpected oracle write token')
 const held=gates.get(token)
 events.push('write:waiting:'+token)
 await held.promise
 events.push('write:released:'+token)
}
export async function control(input){
 await ready
 if(input.command==='reset'){
  for(const held of gates.values())held.resolve()
  readGate?.resolve();readGate=null;gates.clear();armed=null;events.length=0
  await pg.exec('DELETE FROM todo')
  for(const row of input.rows??[])await pg.query('INSERT INTO todo VALUES ($1,$2,$3,$4,$5)',[row.id,row.text,row.completed,row.createdAt,row.scope])
 }
 if(input.command==='arm'){
  if(!input.append){events.length=0;readGate=gate()}
  armed=input.token;gates.set(armed,gate())
 }
 if(input.command==='write'){
  const held=gates.get(input.token)
  if(input.reject){held.reject(Error('oracle write rejected'))}
  else held.resolve()
 }
 if(input.command==='read'){
  const held=readGate;readGate=input.next?gate():null
  if(input.reject)held?.reject(Error('oracle read rejected'));else held?.resolve()
 }
 return {events:[...events],rows:(await pg.query('SELECT id,text,completed,created_at,user_id FROM todo ORDER BY id')).rows,witnessCount:witnesses.size}
}
export async function evidence(){return {witnessCount:witnesses.size}}
`
