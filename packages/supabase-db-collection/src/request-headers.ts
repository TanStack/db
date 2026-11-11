import { VERSION } from './version'

/**
 * Header name and value used to identify requests made by this library.
 *
 * Chain `.setHeader(CLIENT_INFO_HEADER, CLIENT_INFO)` onto a
 * `PostgrestQueryBuilder`/`PostgrestFilterBuilder` call to stamp the
 * request. This intentionally REPLACES supabase-js's own default
 * `X-Client-Info` header (matching the `@supabase/ssr` convention) rather
 * than appending to or preserving it.
 */
export const CLIENT_INFO_HEADER = 'X-Client-Info'
export const CLIENT_INFO = `@tanstack/supabase-db-collection/${VERSION}`
