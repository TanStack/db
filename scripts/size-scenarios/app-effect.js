// The typical app, plus an Effect that reacts to a live query.
import { createEffect } from '@tanstack/db'
import { todos } from './app.js'

export * from './app.js'

createEffect({
  query: (q) => q.from({ todo: todos }),
  onBatch: (batch) => console.log(batch),
})
