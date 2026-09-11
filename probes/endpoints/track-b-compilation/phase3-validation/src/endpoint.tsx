import {z} from 'zod'
import {query,mutation} from './runtime'
import {database,auth,revision} from './server-helper'
import {shared} from './shared'
import {useState,useEffect} from 'react'
export const listTodos=query({
 input:z.object({}),
 async handler(req,res){return res.json([{text:shared('list'),server:`QUERY_SERVER_ONLY_SENTINEL:${database()}:${req.scope}`}])},
})
export const addTodo=mutation({
 input:z.object({text:z.string().min(1)}),
 onMutate({input}){return `optimistic:${shared(input.text)}`},
 async handler(req,res){return res.json({text:shared(req.body.text),server:`MUTATION_SERVER_ONLY_SENTINEL:${database()}:${auth()}:${revision()}:${req.scope}`})},
})
export function Probe(){
 const [queryResult,setQuery]=useState(''),[result,setResult]=useState(''),[optimistic,setOptimistic]=useState('')
 useEffect(()=>{document.body.dataset.ready='true'},[])
 return <main><button onClick={async()=>{setOptimistic(addTodo.onMutate({input:{text:'test'}}));setQuery(JSON.stringify(await listTodos.rpc({data:{scope:'alice',input:{}}})));setResult(JSON.stringify(await addTodo.rpc({data:{scope:'alice',input:{text:'test'}}})))}}>Run</button><output id="optimistic">{optimistic}</output><output id="query">{queryResult}</output><output id="result">{result}</output></main>
}
