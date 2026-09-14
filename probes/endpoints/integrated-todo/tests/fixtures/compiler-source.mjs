export const source = `import {z} from 'zod';import {endpoints} from './runtime';import {db,a,b} from './database.server';import {eq} from 'drizzle-orm';
export function App(dbClient){const {query,mutation}=endpoints(dbClient);
const list=query({input:z.object({}),schema:z.object({id:z.string(),value:z.number()}),async handler(req,res){return res.json(await db.select().from(b))}});
const change=mutation({input:z.object({value:z.number().int()}),onMutate({input}){list.update('row',d=>{d.value=input.value})},async handler(req,res){await db.update(a).set({value:req.body.value}).where(eq(a.id,'row'));return res.json({ok:true})}});return {list,change}}`
export const databaseSource = `import {drizzle} from 'drizzle-orm/pglite';import {pgTable,text,integer} from 'drizzle-orm/pg-core';
export const db=drizzle(globalThis.pg);export const a=pgTable('a',{id:text('id').primaryKey(),value:integer('value')});export const b=pgTable('b',{id:text('id').primaryKey(),value:integer('value')})`
