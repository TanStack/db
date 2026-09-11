import type { z } from 'zod'
export function mutation<I,O>(config: {input:z.ZodType<I>;handler(req:{body:I},res:{json<T>(value:T):T}):Promise<O>;onMutate(input:I):string}) : ((input:I)=>Promise<O>) & {onMutate(input:I):string} {
 throw new Error('Compile-time fixture declaration must be transformed')
}
