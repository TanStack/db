<script lang="ts">
  import DbProvider from '../src/DbProvider.svelte'
  import SsrDbQuery from './SsrDbQuery.svelte'
  import type { CollectionOptions, DbClient } from '@tanstack/db'
  import type { SsrHookFlags } from './ssr-test-utils'

  type Person = {
    id: string
    name: string
    sourcePayload: string
  }

  let {
    client,
    descriptor,
    onInitial,
    onSnapshot,
    onLaterInitial,
    onLaterSnapshot,
    registerLaterMount,
    hydrating = false,
    providerNesting = `none`,
  }: {
    client: DbClient
    onInitial?: (
      rows: Array<{ id: string; name: string }>,
      status: string,
      flags: SsrHookFlags,
    ) => void
    onSnapshot?: (
      rows: Array<{ id: string; name: string }>,
      status: string,
      flags: SsrHookFlags,
    ) => void
    onLaterInitial?: (
      rows: Array<{ id: string; name: string }>,
      status: string,
      flags: SsrHookFlags,
    ) => void
    onLaterSnapshot?: (
      rows: Array<{ id: string; name: string }>,
      status: string,
      flags: SsrHookFlags,
    ) => void
    registerLaterMount?: (mount: () => void) => void
    hydrating?: boolean
    providerNesting?: `none` | `inherit` | `marked`
    descriptor: CollectionOptions<Person, string>
  } = $props()
  let laterReader = $state(false)
  function registerLaterReader() {
    registerLaterMount?.(() => {
      laterReader = true
    })
  }
  registerLaterReader()
</script>

{#snippet readers()}
  <SsrDbQuery {descriptor} {onInitial} {onSnapshot} />
  {#if laterReader}
    <SsrDbQuery
      {descriptor}
      onInitial={onLaterInitial}
      onSnapshot={onLaterSnapshot}
    />
  {/if}
{/snippet}

<DbProvider {client} {hydrating}>
  {#if providerNesting === `inherit`}
    <DbProvider {client}>
      {@render readers()}
    </DbProvider>
  {:else if providerNesting === `marked`}
    <DbProvider {client} hydrating>
      {@render readers()}
    </DbProvider>
  {:else}
    {@render readers()}
  {/if}
</DbProvider>
