import type {z} from 'zod'
type Request<I>={body:I;scope:'alice'|'bob';kind:string;endpointSourceHash:string}
type Json={json<T>(value:T):T}
type Rpc<I,O>=(args:{data:{scope:'alice'|'bob';input:I}})=>Promise<O>
// Explicit fixture stubs: transport descriptors and callback only, no DB lifecycle.
export function query<I,O>(config:{input:z.ZodType<I>;handler(req:Request<I>,res:Json):Promise<O>}):{rpc:Rpc<I,O>}{throw Error('Compiler required')}
export function mutation<I,O>(config:{input:z.ZodType<I>;handler(req:Request<I>,res:Json):Promise<O>;onMutate(context:{input:I}):string}):{rpc:Rpc<I,O>;onMutate(context:{input:I}):string}{throw Error('Compiler required')}
export const makeQuery=<I,O>(id:string,rpc:Rpc<I,O>)=>({id,rpc})
export const makeMutation=<I,O>(id:string,rpc:Rpc<I,O>,onMutate:(context:{input:I})=>string)=>({id,rpc,onMutate})
