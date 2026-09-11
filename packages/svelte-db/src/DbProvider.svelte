<script lang="ts">
  import { setDbClientContext } from './db-context.js'
  import type { DbClient } from '@tanstack/db'
  import type { Snippet } from 'svelte'

  let {
    client,
    children,
  }: {
    client: DbClient
    children?: Snippet
  } = $props()

  setDbClientContext(() => client)
</script>

{@render children?.()}
