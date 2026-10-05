import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
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
    const button = within(row).getByRole('button') as HTMLButtonElement
    const settledRow = screen
      .getByText('Review action-only mutation boundaries')
      .closest('li')!
    expect(add.mock.results[0].value.state).toBe('persisting')
    expect(
      (within(settledRow).getByRole('button') as HTMLButtonElement).disabled,
    ).toBe(false)
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

// Admission law: one add may be pending per mounted form. Repeated submit
// events cannot create another action until that add fulfills or rejects.
// The create barrier controls settlement independently of React's render cut.
for (const outcome of ['success', 'failure'] as const) {
  for (const burst of ['same render', 'separate renders'] as const) {
    test(`add admission reopens after ${outcome} with submits in ${burst}`, async () => {
      const input = await mount()
      const form = input.form!
      const button = screen.getByRole('button', {
        name: 'Add',
      }) as HTMLButtonElement
      const add = vi.spyOn(actions, 'addTodo')
      const createTodo = api.createTodo
      let finishCreate!: () => void
      let rejectCreate!: (error: Error) => void
      const barrier = new Promise<void>((resolve, reject) => {
        finishCreate = resolve
        rejectCreate = reject
      })
      const create = vi
        .spyOn(api, 'createTodo')
        .mockImplementationOnce(async (payload) => {
          await barrier
          return createTodo(payload)
        })
      const submitted = `admission ${outcome} ${burst}`
      const nextDraft = `${submitted} next`
      fireEvent.change(input, { target: { value: submitted } })
      if (burst === 'same render') {
        act(() => {
          fireEvent.submit(form)
          fireEvent.submit(form)
        })
      } else {
        fireEvent.submit(form)
        fireEvent.submit(form)
      }
      expect(add).toHaveBeenCalledTimes(1)
      expect(create).toHaveBeenCalledTimes(1)
      expect(button.disabled).toBe(true)
      expect(input.disabled).toBe(false)
      fireEvent.change(input, { target: { value: nextDraft } })
      fireEvent.submit(form)
      expect(add).toHaveBeenCalledTimes(1)
      await act(async () => {
        if (outcome === 'success') finishCreate()
        else rejectCreate(new Error('Create failed'))
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(button.disabled).toBe(false)
      expect(input.value).toBe(nextDraft)
      if (outcome === 'failure')
        expect(screen.getByText('Create failed')).toBeDefined()
      fireEvent.click(button)
      expect(add).toHaveBeenCalledTimes(2)
      expect(add).toHaveBeenLastCalledWith(nextDraft)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(add.mock.results[1].value.state).toBe('completed')
      expect(button.disabled).toBe(false)
      expect(input.value).toBe('')
      const persisted = api.listTodos()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(80)
      })
      const texts = (await persisted).map((todo) => todo.text)
      expect(texts.filter((text) => text === submitted)).toHaveLength(
        outcome === 'success' ? 1 : 0,
      )
      expect(texts.filter((text) => text === nextDraft)).toHaveLength(1)
    })
  }
}

test('synchronous validation failure permits a corrected submission', async () => {
  const input = await mount()
  const button = screen.getByRole('button', {
    name: 'Add',
  }) as HTMLButtonElement
  fireEvent.change(input, { target: { value: '   ' } })
  fireEvent.submit(input.form!)
  expect(screen.getByText('Todo text is required')).toBeDefined()
  expect(button.disabled).toBe(false)
  fireEvent.change(input, { target: { value: 'corrected submission' } })
  fireEvent.click(button)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
  expect(input.value).toBe('')
  expect(button.disabled).toBe(false)
  expect(screen.queryByText('Todo text is required')).toBeNull()
})

// Toggle failure follows the add path's error contract: restore the prior row,
// show the failure, then allow retry. Hold the provider promise so the pending
// and rejected checkpoints do not depend on elapsed time. The two directions
// distinguish rollback from an unconditional reset to incomplete.
test('failed toggles report the error, roll back both directions, and allow retry', async () => {
  const input = await mount()
  const text = 'toggle failure and retry'
  fireEvent.change(input, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
  const row = screen.getByText(text).closest('li')!
  const button = within(row).getByRole('button') as HTMLButtonElement
  const toggle = vi.spyOn(actions, 'toggleTodo')
  const persistToggle = vi.spyOn(api, 'toggleTodo')
  for (const completed of [false, true]) {
    let rejectToggle!: (error: Error) => void
    persistToggle.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectToggle = reject
      }),
    )
    expect(row.classList.contains('done')).toBe(completed)
    fireEvent.click(button)
    expect(persistToggle).toHaveBeenCalledTimes(completed ? 3 : 1)
    expect(button.disabled).toBe(true)
    expect(row.classList.contains('done')).toBe(!completed)
    await act(async () => {
      rejectToggle(new Error('Toggle failed'))
    })
    expect(toggle.mock.results.at(-1)!.value.state).toBe('failed')
    expect(row.classList.contains('done')).toBe(completed)
    expect(button.disabled).toBe(false)
    expect(screen.getByText('Toggle failed')).toBeDefined()
    fireEvent.click(button)
    expect(screen.queryByText('Toggle failed')).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160)
    })
    expect(toggle.mock.results.at(-1)!.value.state).toBe('completed')
    expect(row.classList.contains('done')).toBe(!completed)
    expect(button.disabled).toBe(false)
    const persisted = api.listTodos()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80)
    })
    expect(
      (await persisted).find((todo) => todo.text === text)?.completed,
    ).toBe(!completed)
  }
})
