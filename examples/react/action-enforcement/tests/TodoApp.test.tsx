import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { TodoApp } from '../src/features/todos/TodoApp'
import * as actions from '../src/db/actions/todoActions'
import * as api from '../src/db/server/fakeTodoApi'

// These component witnesses own the example's form and draft behavior. The
// Collection and framework oracles do not own application input state. They
// drive the real actions and fake API, advancing its explicit 80/120 ms delays
// with a virtual clock. Assertions run after the transaction settles and React
// publishes the resulting render; they make no cross-framework claim.
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function mount() {
  vi.useFakeTimers()
  render(<TodoApp />)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(80)
  })
  expect(
    (screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled,
  ).toBe(false)
  return screen.getByPlaceholderText('Add a todo') as HTMLInputElement
}

for (const draft of ['submitted todo', 'newer unsent draft', '']) {
  test(`successful add preserves the current draft: ${JSON.stringify(draft)}`, async () => {
    const input = await mount()
    const add = vi.spyOn(actions, 'addTodo')
    fireEvent.change(input, { target: { value: 'submitted todo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(add).toHaveBeenCalledWith('submitted todo')
    expect(add.mock.results[0].value.state).toBe('persisting')
    fireEvent.change(input, { target: { value: draft } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(add.mock.results[0].value.state).toBe('completed')
    expect(input.value).toBe(draft === 'submitted todo' ? '' : draft)
  })
}

for (const draft of ['submitted todo', 'newer unsent draft']) {
  test(`failed add retains the current draft: ${JSON.stringify(draft)}`, async () => {
    const input = await mount()
    let rejectCreate!: (error: Error) => void
    vi.spyOn(api, 'createTodo').mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectCreate = reject
      }),
    )
    fireEvent.change(input, { target: { value: 'submitted todo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.change(input, { target: { value: draft } })
    await act(async () => {
      rejectCreate(new Error('Create failed'))
    })
    expect(screen.getByText('Create failed')).toBeDefined()
    expect(input.value).toBe(draft)
  })
}

test('native form submission adds a todo', async () => {
  const input = await mount()
  const add = vi.spyOn(actions, 'addTodo')
  expect(input.form).not.toBeNull()
  expect(screen.getByRole('button', { name: 'Add' }).getAttribute('type')).toBe(
    'submit',
  )
  fireEvent.change(input, { target: { value: 'keyboard submission' } })
  fireEvent.submit(input.form!)
  expect(add).toHaveBeenCalledTimes(1)
  expect(add).toHaveBeenCalledWith('keyboard submission')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
  expect(add.mock.results[0].value.state).toBe('completed')
  expect(input.value).toBe('')
})

for (const elapsed of [0, 40, 119]) {
  test(`new row cannot toggle before creation completes at ${elapsed} ms`, async () => {
    const input = await mount()
    const add = vi.spyOn(actions, 'addTodo')
    const toggle = vi.spyOn(actions, 'toggleTodo')
    const text = `pending creation at ${elapsed} ms`
    fireEvent.change(input, { target: { value: text } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(elapsed)
    })
    const row = screen.getByText(text).closest('li')!
    const button = row.querySelector('button')!
    const settledRow = screen
      .getByText('Review action-only mutation boundaries')
      .closest('li')!
    expect(add.mock.results[0].value.state).toBe('persisting')
    expect(settledRow.querySelector('button')!.disabled).toBe(false)
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(toggle).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200 - elapsed)
    })
    expect(add.mock.results[0].value.state).toBe('completed')
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)
    expect(row.classList.contains('done')).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160)
    })
    expect(toggle.mock.results[0].value.state).toBe('completed')
    expect(button.disabled).toBe(false)
    expect(row.classList.contains('done')).toBe(true)
  })
}
