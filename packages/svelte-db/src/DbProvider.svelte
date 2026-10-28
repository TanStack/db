<script lang="ts">
  import { onMount } from 'svelte'
  import { setDbClientContext, useDbContext } from './db-context.js'
  import type { DbClient } from '@tanstack/db'
  import type { Snippet } from 'svelte'

  let {
    client,
    hydrating = useDbContext()?.hydrating ?? false,
    children,
  }: {
    client: DbClient
    /** Set for a root initialized with Svelte hydrate(); nested providers inherit. */
    hydrating?: boolean
    children?: Snippet
  } = $props()

  // The host supplies hydration intent. New children after this provider's
  // mount read live rows, even while transported server snapshots are retained.
  let initialHydration = true
  setDbClientContext(
    () => client,
    () => initialHydration && hydrating,
  )
  onMount(() => {
    initialHydration = false
  })
</script>

{@render children?.()}
