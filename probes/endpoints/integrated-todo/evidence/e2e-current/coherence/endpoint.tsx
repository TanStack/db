import {z} from 'zod'
import {endpoints} from './runtime'
import {db,todo,requireUser,beforeWrite} from './database.server'
import {asc,eq,and} from 'drizzle-orm'
import {useDbClient,useLiveQuery} from '@tanstack/react-db'
import {useOracleProbe} from './oracle-probe'
export function TodoApp(){
  const dbClient=useDbClient()
  const {query,mutation}=endpoints(dbClient)
  
  const rows0 = query({
    input: z.object({}),
    async handler(req, res) {
      // ORACLE_SERVER_QUERY_7a0f9
      const user = await requireUser(req)
      const todos = await db.select({id:todo.id,text:todo.text,completed:todo.completed,createdAt:todo.createdAt})
        .from(todo).where(eq(todo.userId,user.id)).orderBy(asc(todo.createdAt),asc(todo.id))
      return res.json(todos)
    },
  })

  const rows1 = query({
    input: z.object({}),
    async handler(req, res) {
      // ORACLE_SERVER_QUERY_7a0f9
      const user = await requireUser(req)
      const todos = await db.select({id:todo.id,text:todo.text,completed:todo.completed,createdAt:todo.createdAt})
        .from(todo).where(eq(todo.userId,user.id)).orderBy(asc(todo.createdAt),asc(todo.id))
      return res.json(todos)
    },
  })
  const insert0 = mutation({
      input:z.object({id:z.string(),text:z.string(),completed:z.boolean(),createdAt:z.coerce.date(),token:z.string()}),
      onMutate({input}) { rows0.insert({id:input.id,text:input.text,completed:input.completed,createdAt:input.createdAt}) },
      async handler(req,res) {
        const user=await requireUser(req)
        const input=req.body
        await beforeWrite(input.token, 'ORACLE_SERVER_HANDLER_41e30')
        await db.insert(todo).values({id:input.id,text:input.text,completed:input.completed,createdAt:input.createdAt,userId:user.id})
        return res.json({ok:true})
      },
    })
const edit0 = mutation({
      input:z.object({id:z.string(),text:z.string(),completed:z.boolean(),createdAt:z.coerce.date(),token:z.string()}),
      onMutate({input}) { rows0.update(input.id,draft=>{draft.text=input.text}) },
      async handler(req,res) {
        const user=await requireUser(req)
        const input=req.body
        await beforeWrite(input.token, 'ORACLE_SERVER_HANDLER_41e30')
        await db.update(todo).set({text:input.text}).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))
        return res.json({ok:true})
      },
    })
const complete0 = mutation({
      input:z.object({id:z.string(),text:z.string(),completed:z.boolean(),createdAt:z.coerce.date(),token:z.string()}),
      onMutate({input}) { rows0.update(input.id,draft=>{draft.completed=input.completed}) },
      async handler(req,res) {
        const user=await requireUser(req)
        const input=req.body
        await beforeWrite(input.token, 'ORACLE_SERVER_HANDLER_41e30')
        await db.update(todo).set({completed:input.completed}).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))
        return res.json({ok:true})
      },
    })
const delete0 = mutation({
      input:z.object({id:z.string(),text:z.string(),completed:z.boolean(),createdAt:z.coerce.date(),token:z.string()}),
      onMutate({input}) { rows0.delete(input.id) },
      async handler(req,res) {
        const user=await requireUser(req)
        const input=req.body
        await beforeWrite(input.token, 'ORACLE_SERVER_HANDLER_41e30')
        await db.delete(todo).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))
        return res.json({ok:true})
      },
    })
const insert1 = mutation({
      input:z.object({id:z.string(),text:z.string(),completed:z.boolean(),createdAt:z.coerce.date(),token:z.string()}),
      onMutate({input}) { rows1.insert({id:input.id,text:input.text,completed:input.completed,createdAt:input.createdAt}) },
      async handler(req,res) {
        const user=await requireUser(req)
        const input=req.body
        await beforeWrite(input.token, 'ORACLE_SERVER_HANDLER_41e30')
        await db.insert(todo).values({id:input.id,text:input.text,completed:input.completed,createdAt:input.createdAt,userId:user.id})
        return res.json({ok:true})
      },
    })
const edit1 = mutation({
      input:z.object({id:z.string(),text:z.string(),completed:z.boolean(),createdAt:z.coerce.date(),token:z.string()}),
      onMutate({input}) { rows1.update(input.id,draft=>{draft.text=input.text}) },
      async handler(req,res) {
        const user=await requireUser(req)
        const input=req.body
        await beforeWrite(input.token, 'ORACLE_SERVER_HANDLER_41e30')
        await db.update(todo).set({text:input.text}).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))
        return res.json({ok:true})
      },
    })
const complete1 = mutation({
      input:z.object({id:z.string(),text:z.string(),completed:z.boolean(),createdAt:z.coerce.date(),token:z.string()}),
      onMutate({input}) { rows1.update(input.id,draft=>{draft.completed=input.completed}) },
      async handler(req,res) {
        const user=await requireUser(req)
        const input=req.body
        await beforeWrite(input.token, 'ORACLE_SERVER_HANDLER_41e30')
        await db.update(todo).set({completed:input.completed}).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))
        return res.json({ok:true})
      },
    })
const delete1 = mutation({
      input:z.object({id:z.string(),text:z.string(),completed:z.boolean(),createdAt:z.coerce.date(),token:z.string()}),
      onMutate({input}) { rows1.delete(input.id) },
      async handler(req,res) {
        const user=await requireUser(req)
        const input=req.body
        await beforeWrite(input.token, 'ORACLE_SERVER_HANDLER_41e30')
        await db.delete(todo).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))
        return res.json({ok:true})
      },
    })
  const result0=useLiveQuery(rows0)
const result1=useLiveQuery(rows1)
  useOracleProbe([rows0,rows1],{insert0,edit0,complete0,delete0,insert1,edit1,complete1,delete1})
  return <main><section data-query="0">{result0.data.map(row=><output key={row.id} data-row={row.id}>{row.text}</output>)}</section><section data-query="1">{result1.data.map(row=><output key={row.id} data-row={row.id}>{row.text}</output>)}</section></main>
}
