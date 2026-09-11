import {z} from 'zod'
import {endpoints} from '../src/runtime'
import {DbClient,type Transaction} from '@tanstack/db'
const {query,mutation}=endpoints(new DbClient({endpointScope:'alice'}))
const list=query({input:z.object({}),async handler(_req,res){return res.json([{id:'id',text:'text',completed:false,createdAt:new Date()}])}})
list.insert({id:'id',text:'text',completed:false,createdAt:new Date()})
const add=mutation({input:z.object({text:z.string()}),onMutate({input}){const text:string=input.text;void text},async handler(req,res){return res.json({text:req.body.text})}})
const transaction:Transaction=add({text:'Typed task'})
transaction.isPersisted.promise
// @ts-expect-error an action returns a Transaction, not a Promise
add({text:'Typed task'}).then(()=>{})
// @ts-expect-error mutation input retains schema types
add({text:10})
// @ts-expect-error bound inserts require complete Todo rows
list.insert({text:'Missing key'})
// @ts-expect-error endpoints binds an actual DbClient
endpoints({})
