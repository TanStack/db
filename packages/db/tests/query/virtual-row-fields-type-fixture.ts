// The row fixture that the virtual row field type tests share.
import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptions } from '../utils.js'

export type Profile = { label: string }
export type Row = {
  id: string
  profile: Profile
  optionalProfile?: Profile
  nullableProfile: Profile | null
  createdAt: Date
  tags: Array<string>
}

export const rows = createCollection(
  mockSyncCollectionOptions<Row>({
    id: `virtual-row-fields-type-oracle`,
    getKey: (row) => row.id,
    initialData: [],
  }),
)
