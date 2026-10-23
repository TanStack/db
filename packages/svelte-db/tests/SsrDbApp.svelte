<script lang="ts">
  import DbProvider from '../src/DbProvider.svelte'
  import SsrDbQuery from './SsrDbQuery.svelte'
  import type { CollectionOptions, DbClient } from '@tanstack/db'

  type Person = {
    id: string
    name: string
    sourcePayload: string
  }

  let {
    client,
    descriptor,
    onInitial,
  }: {
    client: DbClient
    onInitial?: (
      rows: Array<{ id: string; name: string }>,
      status: string,
    ) => void
    descriptor: CollectionOptions<Person, string>
  } = $props()
</script>

<DbProvider {client}>
  <SsrDbQuery {descriptor} {onInitial} />
</DbProvider>
