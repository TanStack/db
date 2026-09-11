import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import {tanstackStart} from '@tanstack/react-start/plugin/vite'
import {endpointsProbe,serverBoundary} from './transform.mjs'
export default defineConfig({build:{sourcemap:true},plugins:[serverBoundary({serverModules:['src/server-helper.ts','src/server-side-effect.ts']}),endpointsProbe(),tanstackStart({client:{entry:'./client.tsx'}}),react()]})
