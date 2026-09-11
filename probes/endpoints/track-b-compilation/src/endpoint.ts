import { z } from 'zod'
import { mutation } from './runtime'
import { database, auth, revision } from './server-helper'
import { shared } from './shared'
export const addTodo = mutation({
 input:z.object({text:z.string().min(1)}),
 onMutate(input) { return `optimistic:${shared(input.text)}` },
 async handler(req,res) {
  return res.json({text:shared(req.body.text),server:`SERVER_ONLY_SENTINEL:${database()}:${auth()}:${revision()}:handler-v1`})
 }
})
