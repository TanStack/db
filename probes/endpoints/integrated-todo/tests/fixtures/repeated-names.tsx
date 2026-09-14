import {z} from 'zod'
import {endpoints} from './runtime'
import {db,todo,requireUser} from './database.server'
import {asc,eq,and} from 'drizzle-orm'
export function makeActiveComponent(){
  function TodoApp(dbClient){const {query,mutation}=endpoints(dbClient);const rows = query({input:z.object({}),async handler(req,res){
  const user=await requireUser(req)
  const todos=await db.select({id:todo.id,text:todo.text,completed:todo.completed,createdAt:todo.createdAt}).from(todo).where(and(eq(todo.userId,user.id),eq(todo.completed,false))).orderBy(asc(todo.id))
  return res.json(todos)
}});return rows}
  return TodoApp
}
export function makeCompletedComponent(){
  function TodoApp(dbClient){const {query,mutation}=endpoints(dbClient);const rows = query({input:z.object({}),async handler(req,res){
  const user=await requireUser(req)
  const todos=await db.select({id:todo.id,text:todo.text,completed:todo.completed,createdAt:todo.createdAt}).from(todo).where(and(eq(todo.userId,user.id),eq(todo.completed,true))).orderBy(asc(todo.id))
  return res.json(todos)
}});return rows}
  return TodoApp
}
