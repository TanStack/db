import { expectTypeOf, test } from 'vitest'
import { hasVirtualProps } from '../src/virtual-props.js'
import type { VirtualRowProps, WithVirtualProps } from '../src/virtual-props.js'

test(`the guard narrows to the complete virtual row shape`, () => {
  const value: unknown = {
    $hasPendingWrites: false,
    $origin: `remote`,
    $key: `row-1`,
    $collectionId: `collection-1`,
  }

  if (hasVirtualProps(value)) {
    const row: VirtualRowProps = value
    expectTypeOf(row.$hasPendingWrites).toEqualTypeOf<boolean>()
    // @ts-expect-error The removed alias is absent from guarded rows.
    row.$synced
  }
})

test(`collection-published rows guarantee the pending-write field`, () => {
  type PublishedRow = WithVirtualProps<{ id: string }, string>
  expectTypeOf<PublishedRow[`$hasPendingWrites`]>().toEqualTypeOf<boolean>()
})
