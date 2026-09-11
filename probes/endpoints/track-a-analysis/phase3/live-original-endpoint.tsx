import { z } from 'zod'
import { query, mutation, useEndpointClient, useEndpointMutation } from './runtime'
import { db, todo, requireUser, beforeWrite } from './database.server'
import { asc, eq } from 'drizzle-orm'
import { useLiveQuery } from '@tanstack/react-db'
import { useEffect, useState } from 'react'
import './style.css'
export const listTodos=query({
 input:z.object({}),
 async handler(req,res){
  const user=await requireUser(req)
  const todos=await db.select({id:todo.id,text:todo.text,completed:todo.completed,createdAt:todo.createdAt})
   .from(todo).where(eq(todo.userId,user.id)).orderBy(asc(todo.createdAt),asc(todo.id))
  return res.json(todos)
 },
})
export const addTodo=mutation({
 input:z.object({id:z.string().uuid(),text:z.string().trim().min(1).max(200)}),
 onMutate({dbClient,input}){
  dbClient.collection(listTodos).insert({id:input.id,text:input.text,completed:false,createdAt:new Date()})
 },
 async handler(req,res){
  const user=await requireUser(req)
  await beforeWrite()
  const {id,text}=req.body
  const [created]=await db.insert(todo).values({id,userId:user.id,text,completed:false})
   .returning({id:todo.id,text:todo.text,completed:todo.completed,createdAt:todo.createdAt})
  return res.json(created)
 },
})
export function TodoApp(){
 const dbClient=useEndpointClient()
 const collection=dbClient.collection(listTodos)
 const {data:todos}=useLiveQuery(collection)
 const add=useEndpointMutation(addTodo)
 const [text,setText]=useState('')
 const [status,setStatus]=useState('Ready')
 useEffect(()=>{Object.assign(window,{todoProbe:{client:dbClient,collection,add:(input:{id:string;text:string})=>dbClient.run(addTodo,input),listTodos}});document.body.dataset.ready='true'},[dbClient,collection])
 return <main><header><span className="eyebrow">FIELD NOTES / 01</span><span className="scope">{dbClient.scope}'s notebook</span></header>
 <h1>A little less<br/><em>left to do.</em></h1><p className="intro">Write it down. Make room for what’s next.</p>
 <form onSubmit={async event=>{event.preventDefault();setStatus('Saving');const next=text;setText('');try{await add({id:crypto.randomUUID(),text:next});setStatus('Saved')}catch(error){setStatus(error instanceof Error?error.message:String(error))}}}>
 <label htmlFor="todo-input">One thing to do</label><div className="entry"><input id="todo-input" value={text} onChange={event=>setText(event.target.value)} placeholder="What’s on your mind?" required maxLength={200}/><button>Add task <span>↗</span></button></div></form>
 <div className="list-heading"><h2>Your list</h2><output id="status" aria-live="polite">{status}</output></div>
 <ul>{todos.map(row=><li key={row.id} data-id={row.id}><span className="circle"/><span>{row.text}</span><small>{collection.get(row.id)?'•':''}</small></li>)}</ul>
 {todos.length===0&&<p className="empty">A clean page. Start with one small thing.</p>}
 <footer>ONE COMPONENT · ENDPOINTS PROTOTYPE <a href={`/?scope=${dbClient.scope==='alice'?'bob':'alice'}`}>Open {dbClient.scope==='alice'?'Bob':'Alice'}’s notebook →</a></footer>
 </main>
}
