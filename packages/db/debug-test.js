import mitt from 'mitt'
import { createCollection } from './src/collection.js'

// Simple test to understand the timing issue
const emitter = mitt()
console.log('1. Creating emitter')

const collection = createCollection({
  id: 'test-collection',
  getKey: (item) => item.id,
  sync: {
    sync: ({ begin, write, commit }) => {
      console.log('4. Sync function called - setting up listener')
      emitter.on('sync', (changes) => {
        console.log('6. Event listener triggered with changes:', changes.length)
        begin()
        changes.forEach((change) => {
          write({
            type: change.type,
            value: change.changes,
          })
        })
        commit()
      })
    },
  },
})

console.log('2. Collection created, status:', collection.status)

console.log('3. Emitting sync event')
emitter.emit('sync', [
  {
    type: 'insert',
    changes: { id: '1', name: 'Test Item' },
  },
])

console.log('5. Accessing collection state to trigger sync')
console.log('Collection size:', collection.size)
console.log('Collection status:', collection.status)

console.log('7. Emitting another sync event')
emitter.emit('sync', [
  {
    type: 'insert',
    changes: { id: '2', name: 'Test Item 2' },
  },
])

console.log('8. Final collection size:', collection.size)