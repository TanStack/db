export const specimen = `import {z} from 'zod'
import {endpoints} from './runtime'
import {db,items,requireUser} from './database.server'
import {asc,eq,and,or,gt,isNull} from 'drizzle-orm'
function App(dbClient){
 const {query,mutation}=endpoints(dbClient)
 const rows=query({input:z.object({}),async handler(req,res){
  const user=await requireUser(req)
  const todos=await db.select({id:items.id,text:items.text,completed:items.completed,createdAt:items.createdAt,score:items.score,label:items.label})
   .from(items).where(and(eq(items.userId,user.id),or(gt(items.score,0),isNull(items.score)))).orderBy(asc(items.createdAt),asc(items.id))
  return res.json(todos)
 }})
 return rows
}`
