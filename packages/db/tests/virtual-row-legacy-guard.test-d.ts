import { expectTypeOf, test } from 'vitest'
import { hasVirtualProps } from '../src/virtual-props.js'
import type { VirtualRowProps, WithVirtualProps } from '../src/virtual-props.js'

test(`the legacy guard keeps its VirtualRowProps type contract`, () => {
  const value: unknown = {
    $synced: true,
    $origin: `remote`,
    $key: `row-1`,
    $collectionId: `collection-1`,
  }

  if (hasVirtualProps(value)) {
    const row: VirtualRowProps = value
    expectTypeOf(row.$hasPendingWrites).toEqualTypeOf<boolean | undefined>()
  }
})

test(`collection-published rows guarantee the new field`, () => {
  type PublishedRow = WithVirtualProps<{ id: string }, string>
  expectTypeOf<PublishedRow[`$hasPendingWrites`]>().toEqualTypeOf<boolean>()
})
