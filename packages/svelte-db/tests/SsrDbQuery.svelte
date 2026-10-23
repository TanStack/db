<script lang="ts">
  import { useLiveQuery } from '../src/useLiveQuery.svelte.js'
  import type { CollectionOptions } from '@tanstack/db'

  type Person = {
    id: string
    name: string
    sourcePayload: string
  }

  let {
    descriptor,
    onInitial,
  }: {
    onInitial?: (
      rows: Array<{ id: string; name: string }>,
      status: string,
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
    )
  }
  reportInitial()
</script>

<output data-status={people.status}>
  {#each people.data as person (person.id)}
    <span>{person.name}</span>
  {/each}
</output>
