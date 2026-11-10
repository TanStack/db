import { createClient } from '@supabase/supabase-js'
import { inject } from 'vitest'

/**
 * A service_role (admin) client, which bypasses RLS. Only the e2e setup and
 * seeding code uses it; the collections under test use the anon key.
 */
export const makeAdminClient = () =>
  createClient(inject('supabaseUrl'), inject('supabaseServiceRoleKey'), {
    auth: { persistSession: false },
  })

/**
 * Truncates the adapter's own test tables (restart identity) and re-seeds the
 * fixture rows in a single transactional round trip, so every test starts from
 * the same state: Alice (id 1, active) and Bob (id 2, inactive).
 *
 * This is opt-in per test file (via the `test` export of ./e2e.utils) rather
 * than a global `beforeEach`, so it never runs for suites that own different
 * tables, such as the shared @tanstack/db-collection-e2e suites.
 */
export const resetE2e = async (admin: ReturnType<typeof makeAdminClient>) => {
  const { error } = await admin.rpc('reset_e2e')
  if (error) {
    throw new Error(`e2e reset failed: ${error.message}`)
  }
}
