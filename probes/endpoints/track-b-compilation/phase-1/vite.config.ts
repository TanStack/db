import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { endpointsProbe } from './transform.mjs'
export default defineConfig({plugins:[endpointsProbe(),tanstackStart({client:{entry:"./client.tsx"}}),react()]})
