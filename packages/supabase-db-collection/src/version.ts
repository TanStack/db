// Injected at build time by the `define` in vite.config.ts from package.json.
declare const __SUPABASE_DB_COLLECTION_VERSION__: string

export const VERSION: string = __SUPABASE_DB_COLLECTION_VERSION__
