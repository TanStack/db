<script lang="ts">
  import { useLiveQuery } from '../src/useLiveQuery.svelte.js'
  import type { CollectionOptions } from '@tanstack/db'
  import type { SsrHookFlags } from './ssr-test-utils'

  type Person = {
    id: string
    name: string
    sourcePayload: string
  }

  let {
    descriptor,
    onInitial,
    onSnapshot,
  }: {
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
    descriptor: CollectionOptions<Person, string>
  } = $props()

  const people = useLiveQuery({
    query: (q) =>
      q.from({ people: descriptor }).select(({ people }) => ({
        id: people.id,
        name: people.name,
      })),
  })
  function reportInitial() {
    onInitial?.(
      people.data.map(({ id, name }) => ({ id, name })),
      people.status,
      {
        isReady: people.isReady,
        isError: people.isError,
        isLoading: people.isLoading,
        isIdle: people.isIdle,
      },
    )
  }
  reportInitial()
  $effect.pre(() => {
    onSnapshot?.(
      people.data.map(({ id, name }) => ({ id, name })),
      people.status,
      {
        isReady: people.isReady,
        isError: people.isError,
        isLoading: people.isLoading,
        isIdle: people.isIdle,
      },
    )
  })
</script>

<output data-status={people.status}>
  {#each people.data as person (person.id)}
    <span>{person.name}</span>
  {/each}
</output>
