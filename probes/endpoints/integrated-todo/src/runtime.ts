import { DbClient, collectionOptions, type Transaction } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { QueryClient } from '@tanstack/query-core'
import type { z } from 'zod'
export type Todo={id:string;text:string;completed:boolean;createdAt:Date}
type Scope='alice'|'bob'
type SortField='createdAt'|'id'
type Rpc<I,O>=(args:{data:{scope:Scope;input:I}})=>Promise<O>
type Query<I,O extends Todo>={kind:'query';id:string;rpc:Rpc<I,O[]>}
type Mutation<I,O>={kind:'mutation';id:string;rpc:Rpc<I,O>;onMutate:(context:{dbClient:EndpointRuntime;input:I})=>void}
export function query<I,O extends Todo>(config:{input:z.ZodType<I>;handler(req:{body:I;scope:Scope},res:{json<T>(value:T):T}):Promise<O[]>}):Query<I,O>{throw Error('Compiler required')}
export function mutation<I,O>(config:{input:z.ZodType<I>;handler(req:{body:I;scope:Scope},res:{json<T>(value:T):T}):Promise<O>;onMutate(context:{dbClient:EndpointRuntime;input:I}):void}):Mutation<I,O>{throw Error('Compiler required')}
export function makeQuery<I,O extends Todo>(id:string,rpc:Rpc<I,O[]>):Query<I,O>{return {kind:'query',id,rpc}}
export function makeMutation<I,O>(id:string,rpc:Rpc<I,O>,onMutate:Mutation<I,O>['onMutate']):Mutation<I,O>{return {kind:'mutation',id,rpc,onMutate}}
function options(endpoint:Query<Record<string,never>,Todo>,scope:Scope,queryClient:QueryClient,order:ReadonlyArray<SortField>=[]){
 return collectionOptions(queryCollectionOptions({id:`${endpoint.id}:${scope}`,queryKey:[endpoint.id,scope],queryClient,
  queryFn:()=>endpoint.rpc({data:{scope,input:{}}}),getKey:(row:Todo)=>row.id,
  ...(order.length?{compare:(a:Todo,b:Todo)=>{
   for(const field of order){
    const left=field==='createdAt'?a.createdAt.getTime():a.id
    const right=field==='createdAt'?b.createdAt.getTime():b.id
    if(left<right)return -1
    if(left>right)return 1
   }
   return 0
  }}:{}),
  retry:false,staleTime:Infinity,gcTime:Infinity,
 }))
}
type TodosCollection=ReturnType<DbClient['collection']> & {utils:{refetch:(options:{throwOnError:boolean})=>Promise<unknown>}}
type QueryHandle=ReturnType<EndpointRuntime['collection']>
type BoundMutation<I,O>={rpc:Rpc<I,O>;onMutate:Mutation<I,O>['onMutate'];invoke:(input:I)=>Transaction}
class EndpointRuntime {
 readonly queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}})
 lastTransaction:Transaction|undefined
 private collections=new Map<string,ReturnType<typeof this.createCollection>>()
 private mutations=new Map<string,unknown>()
 constructor(readonly core:DbClient,readonly scope:Scope){}
 private createCollection(endpoint:Query<Record<string,never>,Todo>,order:ReadonlyArray<SortField>=[]){return this.core.collection(options(endpoint,this.scope,this.queryClient,order))}
 collection(endpoint:Query<Record<string,never>,Todo>,order:ReadonlyArray<SortField>=[]){
  let collection=this.collections.get(endpoint.id)
  if(!collection){collection=this.createCollection(endpoint,order);this.collections.set(endpoint.id,collection)}
  return collection
 }
 bindQuery(id:string,rpc:Rpc<Record<string,never>,Todo[]>,order:ReadonlyArray<SortField>):QueryHandle{
  return this.collection(makeQuery(id,rpc),order)
 }
 bindMutation<I,O>(id:string,rpc:Rpc<I,O>,onMutate:Mutation<I,O>['onMutate']):(input:I)=>Transaction{
  let entry=this.mutations.get(id) as BoundMutation<I,O>|undefined
  if(!entry){
   const bound:BoundMutation<I,O>={rpc,onMutate,invoke:input=>this.run({kind:'mutation',id,rpc:bound.rpc,onMutate:bound.onMutate},input)}
   entry=bound
   this.mutations.set(id,entry)
  }
  entry.rpc=rpc
  entry.onMutate=onMutate
  return entry.invoke
 }
 run<I,O>(endpoint:Mutation<I,O>,input:I):Transaction{
  const transaction=this.core.createTransaction({autoCommit:false,mutationFn:async({transaction})=>{
   const targets=new Set(transaction.mutations.map(mutation=>mutation.collection))
   await endpoint.rpc({data:{scope:this.scope,input}})
   await Promise.all([...targets].map(collection=>(collection as TodosCollection).utils.refetch({throwOnError:true})))
  }})
  this.lastTransaction=transaction
  try {
   transaction.mutate(()=>endpoint.onMutate({dbClient:this,input}))
  } catch(error) {
   transaction.rollback()
   void transaction.isPersisted.promise.catch(()=>{})
   throw error
  }
  if(transaction.mutations.length===0){transaction.rollback();void transaction.isPersisted.promise.catch(()=>{});throw Error('This prototype requires an optimistic target mutation')}
  void transaction.commit().catch(()=>{})
  return transaction
 }
}
const runtimes=new WeakMap<DbClient,EndpointRuntime>()
export function endpointRuntime(client:DbClient){
 let runtime=runtimes.get(client)
 if(!runtime){
  const scope=client.requireDependency<unknown>('endpointScope')
  if(scope!=='alice'&&scope!=='bob')throw Error('Invalid endpoint fixture scope')
  runtime=new EndpointRuntime(client,scope)
  runtimes.set(client,runtime)
 }
 return runtime
}

// Authored signatures; the compiler replaces declarations with bind calls.
function boundQuery<I,O extends Todo>(_config:Parameters<typeof query<I,O>>[0]):QueryHandle{throw Error('Compiler required')}
function boundMutation<I,O>(_config:{input:z.ZodType<I>;handler(req:{body:I;scope:Scope},res:{json<T>(value:T):T}):Promise<O>;onMutate(context:{input:I}):void}):(input:I)=>Transaction{throw Error('Compiler required')}
const boundDefinitions={query:boundQuery,mutation:boundMutation}
export function endpoints(_client:DbClient){return boundDefinitions}
export function bindQuery(client:DbClient,id:string,rpc:Rpc<Record<string,never>,Todo[]>,order:ReadonlyArray<SortField>){return endpointRuntime(client).bindQuery(id,rpc,order)}
export function bindMutation<I,O>(client:DbClient,id:string,rpc:Rpc<I,O>,onMutate:Mutation<I,O>['onMutate']){return endpointRuntime(client).bindMutation(id,rpc,onMutate)}
