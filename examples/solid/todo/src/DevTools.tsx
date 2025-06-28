import { useCollections } from "@tanstack/solid-db"
import { DiffView } from "./DiffView"
import type { Transaction } from "@tanstack/solid-db"
import { createMemo, createSignal, For } from "solid-js"

export function DevTools() {
  const collections = useCollections()
  const [selectedCollection, setSelectedCollection] = createSignal<
    string | null
  >(null)
  const [activeTab, setActiveTab] = createSignal<`state` | `transactions`>(
    `state`
  )
  const [expandedTransactions, setExpandedTransactions] = createSignal<
    Set<string>
  >(new Set())

  // Get the selected collection's data
  const selectedData = () =>
    selectedCollection() ? collections().get(selectedCollection) : null

  const collectionsArray = createMemo(() => Array.from(collections()))
  const selectedDataArray = createMemo(() => Array.from(selectedData().state))
  const selectedTransactions = createMemo(() =>
    [...selectedData().transactions.values()].reverse()
  )

  const toggleTransaction = (id: string) => {
    setExpandedTransactions((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div class="fixed bottom-0 left-0 right-0 h-1/2 bg-white border-t border-gray-200 flex">
      {/* Collections List */}
      <div class="w-64 border-r border-gray-200 overflow-auto">
        <div class="p-4 border-b border-gray-200">
          <h2 class="text-lg font-semibold">Collections</h2>
        </div>
        <div class="divide-y divide-gray-200">
          <For each={collectionsArray()}>
            {([id, { state }]) => (
              <button
                onClick={() => setSelectedCollection(id)}
                class={`w-full px-4 py-3 text-left hover:bg-gray-50 focus:outline-none ${
                  selectedCollection() === id ? `bg-blue-50` : ``
                }`}
              >
                <div class="font-medium">{id}</div>
                <div class="text-sm text-gray-500">
                  {state().size} item{state().size !== 1 ? `s` : ``}
                </div>
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Collection Details */}
      <div class="flex-1 overflow-hidden flex flex-col">
        {selectedCollection ? (
          <>
            <div class="p-4 border-b border-gray-200">
              <div class="flex items-center justify-between">
                <h2 class="text-lg font-semibold">
                  Collection: {selectedCollection()}
                </h2>
                <div class="flex space-x-1 bg-gray-100 p-1 rounded-lg">
                  <button
                    onClick={() => setActiveTab(`state`)}
                    class={`px-3 py-1 rounded ${
                      activeTab() === `state`
                        ? `bg-white shadow text-gray-900`
                        : `text-gray-600 hover:bg-gray-200`
                    }`}
                  >
                    State
                  </button>
                  <button
                    onClick={() => setActiveTab(`transactions`)}
                    class={`px-3 py-1 rounded ${
                      activeTab() === `transactions`
                        ? `bg-white shadow text-gray-900`
                        : `text-gray-600 hover:bg-gray-200`
                    }`}
                  >
                    Transactions
                  </button>
                </div>
              </div>
            </div>
            <div class="flex-1 overflow-auto">
              {activeTab() === `state` && selectedData() ? (
                <table class="min-w-full divide-y divide-gray-200">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Key
                      </th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody class="bg-white divide-y divide-gray-200">
                    <For each={selectedDataArray()}>
                      {([key, value]) => (
                        <tr>
                          <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {key}
                          </td>
                          <td class="px-6 py-4 whitespace-pre text-sm text-gray-500 font-mono">
                            {JSON.stringify(value, null, 2)}
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              ) : activeTab() === `transactions` && selectedData() ? (
                <table class="min-w-full divide-y divide-gray-200">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="w-8 px-6 py-3"></th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Time
                      </th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        ID
                      </th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        State
                      </th>
                      <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Mutations
                      </th>
                    </tr>
                  </thead>
                  <tbody class="bg-white divide-y divide-gray-200">
                    <For each={selectedTransactions()}>
                      {(transaction: Transaction) => (
                        <>
                          <tr
                            class={`${
                              expandedTransactions().has(transaction.id)
                                ? `bg-gray-50`
                                : `hover:bg-gray-50`
                            } cursor-pointer`}
                            onClick={() => toggleTransaction(transaction.id)}
                          >
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <span class="transform inline-block transition-transform">
                                {expandedTransactions().has(transaction.id)
                                  ? `▼`
                                  : `▶`}
                              </span>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {new Date(
                                transaction.createdAt
                              ).toLocaleTimeString()}
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">
                              {transaction.id.slice(0, 8)}...
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm">
                              <span
                                class={`px-2 py-1 rounded-full text-xs font-medium ${
                                  transaction.state === `persisting`
                                    ? `bg-yellow-100 text-yellow-800`
                                    : `bg-gray-100 text-gray-800`
                                }`}
                              >
                                {transaction.state}
                              </span>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {transaction.mutations.length} mutation
                              {transaction.mutations.length !== 1 ? `s` : ``}
                            </td>
                          </tr>
                          {expandedTransactions().has(transaction.id) && (
                            <tr class="bg-gray-50">
                              <td colSpan={5} class="px-6 py-4">
                                <div class="space-y-4">
                                  <For each={transaction.mutations}>
                                    {(mutation) => (
                                      <div class="border border-gray-200 rounded-lg bg-white p-4">
                                        <div class="flex items-center justify-between mb-2">
                                          <span
                                            class={`px-2 py-1 rounded-full text-xs font-medium ${
                                              mutation.type === `insert`
                                                ? `bg-green-100 text-green-800`
                                                : mutation.type === `update`
                                                  ? `bg-blue-100 text-blue-800`
                                                  : `bg-red-100 text-red-800`
                                            }`}
                                          >
                                            {mutation.type}
                                          </span>
                                          <span class="text-sm font-mono text-gray-500">
                                            key: {mutation.key}
                                          </span>
                                        </div>
                                        <DiffView
                                          oldValue={mutation.original}
                                          newValue={mutation.modified}
                                        />
                                      </div>
                                    )}
                                  </For>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )}
                    </For>
                  </tbody>
                </table>
              ) : null}
            </div>
          </>
        ) : (
          <div class="flex items-center justify-center h-full text-gray-500">
            Select a collection to view details
          </div>
        )}
      </div>
    </div>
  )
}
