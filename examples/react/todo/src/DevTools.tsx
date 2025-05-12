import React, { useState } from "react"
import { useCollections } from "@tanstack/react-db"
import { DiffView } from "./DiffView"
import type { Transaction } from "@tanstack/react-db"

export function DevTools() {
  const collections = useCollections()
  const [selectedCollection, setSelectedCollection] = useState<string | null>(
    null
  )
  const [activeTab, setActiveTab] = useState<`state` | `transactions`>(`state`)
  const [expandedTransactions, setExpandedTransactions] = useState<Set<string>>(
    new Set()
  )

  // Get the selected collection's data
  const selectedData = selectedCollection
    ? collections.get(selectedCollection)
    : null

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
    <div className="fixed bottom-0 left-0 right-0 h-1/2 bg-white border-t border-gray-200 flex">
      {/* Collections List */}
      <div className="w-64 border-r border-gray-200 overflow-auto">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Collections</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {Array.from(collections).map(([id, { state }]) => (
            <button
              key={id}
              onClick={() => setSelectedCollection(id)}
              className={`w-full px-4 py-3 text-left hover:bg-gray-50 focus:outline-none ${
                selectedCollection === id ? `bg-blue-50` : ``
              }`}
            >
              <div className="font-medium">{id}</div>
              <div className="text-sm text-gray-500">
                {state.size} item{state.size !== 1 ? `s` : ``}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Collection Details */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {selectedCollection ? (
          <>
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  Collection: {selectedCollection}
                </h2>
                <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
                  <button
                    onClick={() => setActiveTab(`state`)}
                    className={`px-3 py-1 rounded ${
                      activeTab === `state`
                        ? `bg-white shadow text-gray-900`
                        : `text-gray-600 hover:bg-gray-200`
                    }`}
                  >
                    State
                  </button>
                  <button
                    onClick={() => setActiveTab(`transactions`)}
                    className={`px-3 py-1 rounded ${
                      activeTab === `transactions`
                        ? `bg-white shadow text-gray-900`
                        : `text-gray-600 hover:bg-gray-200`
                    }`}
                  >
                    Transactions
                  </button>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {activeTab === `state` && selectedData ? (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Key
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {Array.from(selectedData.state).map(([key, value]) => (
                      <tr key={key}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {key}
                        </td>
                        <td className="px-6 py-4 whitespace-pre text-sm text-gray-500 font-mono">
                          {JSON.stringify(value, null, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : activeTab === `transactions` && selectedData ? (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="w-8 px-6 py-3"></th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Time
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        ID
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        State
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Mutations
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {[...selectedData.transactions.values()]
                      .reverse()
                      .map((transaction: Transaction) => (
                        <React.Fragment key={transaction.id}>
                          <tr
                            className={`${
                              expandedTransactions.has(transaction.id)
                                ? `bg-gray-50`
                                : `hover:bg-gray-50`
                            } cursor-pointer`}
                            onClick={() => toggleTransaction(transaction.id)}
                          >
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <span className="transform inline-block transition-transform">
                                {expandedTransactions.has(transaction.id)
                                  ? `▼`
                                  : `▶`}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {new Date(
                                transaction.createdAt
                              ).toLocaleTimeString()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">
                              {transaction.id.slice(0, 8)}...
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              <span
                                className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  transaction.state === `persisting`
                                    ? `bg-yellow-100 text-yellow-800`
                                    : `bg-gray-100 text-gray-800`
                                }`}
                              >
                                {transaction.state}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {transaction.mutations.length} mutation
                              {transaction.mutations.length !== 1 ? `s` : ``}
                            </td>
                          </tr>
                          {expandedTransactions.has(transaction.id) && (
                            <tr className="bg-gray-50">
                              <td colSpan={5} className="px-6 py-4">
                                <div className="space-y-4">
                                  {transaction.mutations.map(
                                    (mutation, index) => (
                                      <div
                                        key={index}
                                        className="border border-gray-200 rounded-lg bg-white p-4"
                                      >
                                        <div className="flex items-center justify-between mb-2">
                                          <span
                                            className={`px-2 py-1 rounded-full text-xs font-medium ${
                                              mutation.type === `insert`
                                                ? `bg-green-100 text-green-800`
                                                : mutation.type === `update`
                                                  ? `bg-blue-100 text-blue-800`
                                                  : `bg-red-100 text-red-800`
                                            }`}
                                          >
                                            {mutation.type}
                                          </span>
                                          <span className="text-sm font-mono text-gray-500">
                                            key: {mutation.key}
                                          </span>
                                        </div>
                                        <DiffView
                                          oldValue={mutation.original}
                                          newValue={mutation.modified}
                                        />
                                      </div>
                                    )
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            Select a collection to view details
          </div>
        )}
      </div>
    </div>
  )
}
