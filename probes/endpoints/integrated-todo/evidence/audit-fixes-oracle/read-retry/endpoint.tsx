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
        .from(todo).where(and(eq(todo.userId,user.id),eq(todo.completed,false))).orderBy(asc(todo.createdAt),asc(todo.id))
      return res.json(todos)
    },
  })
const insert0 = mutation({
      input:z.object({id:z.string(),text:z.string(),completed:z.boolean(),createdAt:z.coerce.date(),token:z.string(),actualEffect:z.enum(['same','flip','other','noop']),otherId:z.string().nullable(),failAfterCommit:z.boolean()}),
      onMutate({input}) { rows0.insert({id:input.id,text:input.text,completed:input.completed,createdAt:input.createdAt}) },
      async handler(req,res) {
        const user=await requireUser(req)
        const input=req.body
        await beforeWrite(input.token, 'ORACLE_SERVER_HANDLER_41e30')
        if(input.actualEffect!=='noop') {
          await db.insert(todo).values({id:input.id,text:input.text.trim(),completed:input.completed,createdAt:input.createdAt,userId:user.id})
          if(input.actualEffect==='flip') await db.update(todo).set({completed:!input.completed}).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))
          if(input.actualEffect==='other'&&input.otherId!==null) await db.update(todo).set({completed:input.completed,text:input.text}).where(and(eq(todo.id,input.otherId),eq(todo.userId,user.id)))
        }
        if(input.failAfterCommit) throw Error('oracle post-commit failure')
        return res.json({ok:true})
      },
    })
const edit0 = mutation({
      input:z.object({id:z.string(),text:z.string(),completed:z.boolean(),createdAt:z.coerce.date(),token:z.string(),actualEffect:z.enum(['same','flip','other','noop']),otherId:z.string().nullable(),failAfterCommit:z.boolean()}),
      onMutate({input}) { rows0.update(input.id,draft=>{draft.text=input.text}) },
      async handler(req,res) {
        const user=await requireUser(req)
        const input=req.body
        await beforeWrite(input.token, 'ORACLE_SERVER_HANDLER_41e30')
        if(input.actualEffect!=='noop') {
          await db.update(todo).set({text:input.text.trim()}).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))
          if(input.actualEffect==='flip') await db.update(todo).set({completed:!input.completed}).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))
          if(input.actualEffect==='other'&&input.otherId!==null) await db.update(todo).set({completed:input.completed,text:input.text}).where(and(eq(todo.id,input.otherId),eq(todo.userId,user.id)))
        }
        if(input.failAfterCommit) throw Error('oracle post-commit failure')
        return res.json({ok:true})
      },
    })
const complete0 = mutation({
      input:z.object({id:z.string(),text:z.string(),completed:z.boolean(),createdAt:z.coerce.date(),token:z.string(),actualEffect:z.enum(['same','flip','other','noop']),otherId:z.string().nullable(),failAfterCommit:z.boolean()}),
      onMutate({input}) { rows0.update(input.id,draft=>{draft.completed=input.completed}) },
      async handler(req,res) {
        const user=await requireUser(req)
        const input=req.body
        await beforeWrite(input.token, 'ORACLE_SERVER_HANDLER_41e30')
        if(input.actualEffect!=='noop') {
          await db.update(todo).set({completed:input.completed}).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))
          if(input.actualEffect==='flip') await db.update(todo).set({completed:!input.completed}).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))
          if(input.actualEffect==='other'&&input.otherId!==null) await db.update(todo).set({completed:input.completed,text:input.text}).where(and(eq(todo.id,input.otherId),eq(todo.userId,user.id)))
        }
        if(input.failAfterCommit) throw Error('oracle post-commit failure')
        return res.json({ok:true})
      },
    })
const delete0 = mutation({
      input:z.object({id:z.string(),text:z.string(),completed:z.boolean(),createdAt:z.coerce.date(),token:z.string(),actualEffect:z.enum(['same','flip','other','noop']),otherId:z.string().nullable(),failAfterCommit:z.boolean()}),
      onMutate({input}) { rows0.delete(input.id) },
      async handler(req,res) {
        const user=await requireUser(req)
        const input=req.body
        await beforeWrite(input.token, 'ORACLE_SERVER_HANDLER_41e30')
        if(input.actualEffect!=='noop') {
          await db.delete(todo).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))
          if(input.actualEffect==='flip') await db.update(todo).set({completed:!input.completed}).where(and(eq(todo.id,input.id),eq(todo.userId,user.id)))
          if(input.actualEffect==='other'&&input.otherId!==null) await db.update(todo).set({completed:input.completed,text:input.text}).where(and(eq(todo.id,input.otherId),eq(todo.userId,user.id)))
        }
        if(input.failAfterCommit) throw Error('oracle post-commit failure')
        return res.json({ok:true})
      },
    })
  
  useOracleProbe([rows0],{insert0,edit0,complete0,delete0},[])
  return <main></main>
}
