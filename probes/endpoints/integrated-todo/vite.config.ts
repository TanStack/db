import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { endpointsProbe, serverBoundary } from './transform.mjs'
import { todoTestHarness } from './tests/harness-plugin.mjs'
import {resolve} from 'node:path'
const repo=resolve(import.meta.dirname,'../../..')
const local=(name:string)=>resolve(import.meta.dirname,'node_modules',name)
export default defineConfig(({mode})=>({
 resolve:{alias:[

 ...['db','db-ivm','react-db','query-db-collection'].map(name=>({find:`@tanstack/${name}`,replacement:resolve(repo,`packages/${name}/src/index.ts`)})),
 ],dedupe:['react','react-dom','@tanstack/query-core','@tanstack/pacer-lite','fractional-indexing','sorted-btree','use-sync-external-store']},
 ssr:{noExternal:['@tanstack/db','@tanstack/db-ivm','@tanstack/react-db','@tanstack/query-db-collection']},
 build:{sourcemap:true},
 plugins:[...(mode==='browser-test'?[todoTestHarness()]:[]),serverBoundary(),endpointsProbe(),tanstackStart({client:{entry:'./client.tsx'}}),react()]
}))
