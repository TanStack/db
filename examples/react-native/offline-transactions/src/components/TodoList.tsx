import React, { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { useLiveQuery } from '@tanstack/react-db'
import {
  todoCollection,
  createOfflineExecutor,
  createTodoActions,
} from '../db/todos'

export function TodoList() {
  const [newTodoText, setNewTodoText] = useState(``)
  const [error, setError] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [offline, setOffline] = useState<ReturnType<
    typeof createOfflineExecutor
  > | null>(null)
  const [initError, setInitError] = useState<string | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)

  // Initialize offline executor
  useEffect(() => {
    console.log(`[TodoList] Initializing...`)
    try {
      const executor = createOfflineExecutor()
      setOffline(executor)
      setIsInitialized(true)
      console.log(`[TodoList] Executor created successfully`)

      return () => {
        executor.dispose()
      }
    } catch (err) {
      console.error(`[TodoList] Failed to create executor:`, err)
      setInitError(err instanceof Error ? err.message : `Failed to initialize`)
      setIsInitialized(true)
    }
  }, [])

  // Create actions based on offline executor
  const actions = useMemo(() => createTodoActions(offline), [offline])

  // Use live query to get todos
  const queryResult = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .orderBy(({ todo }) => todo.createdAt, `desc`),
  )
  const todoList = queryResult.data ?? []
  const isLoading = queryResult.isLoading

  useEffect(() => {
    console.log(`[TodoList] Query state:`, {
      todoCount: todoList.length,
      isLoading,
    })
  }, [todoList.length, isLoading])

  // Monitor network status
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected =
        state.isConnected === true && state.isInternetReachable !== false
      setIsOnline(connected)

      if (connected && offline) {
        offline.notifyOnline()
      }
    })

    return () => unsubscribe()
  }, [offline])

  // Monitor pending transactions
  useEffect(() => {
    if (!offline) return

    const interval = setInterval(() => {
      setPendingCount(offline.getPendingCount())
    }, 100)

    return () => clearInterval(interval)
  }, [offline])

  const handleAddTodo = async () => {
    if (!newTodoText.trim() || !actions.addTodo) return

    try {
      setError(null)
      await actions.addTodo(newTodoText)
      setNewTodoText(``)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to add todo`)
    }
  }

  const handleToggleTodo = async (id: string) => {
    if (!actions.toggleTodo) return

    try {
      setError(null)
      await actions.toggleTodo(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to toggle todo`)
    }
  }

  const handleDeleteTodo = async (id: string) => {
    if (!actions.deleteTodo) return

    try {
      setError(null)
      await actions.deleteTodo(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to delete todo`)
    }
  }

  // Show init error if any
  if (initError) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Initialization Error</Text>
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{initError}</Text>
        </View>
      </View>
    )
  }

  // Show loading while initializing
  if (!isInitialized) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Offline Transactions Demo</Text>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Initializing...</Text>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Offline Transactions Demo</Text>
      <Text style={styles.subtitle}>TanStack DB on React Native</Text>

      {/* Debug info */}
      <Text style={{ fontSize: 12, color: `#666`, marginBottom: 8 }}>
        Init: {isInitialized ? `yes` : `no`} | Offline: {offline ? `yes` : `no`}{' '}
        | Loading: {isLoading ? `yes` : `no`} | Todos: {todoList.length}
      </Text>

      {/* Status indicators */}
      <View style={styles.statusRow}>
        <View
          style={[
            styles.statusBadge,
            isOnline ? styles.online : styles.offline,
          ]}
        >
          <View
            style={[
              styles.statusDot,
              isOnline ? styles.onlineDot : styles.offlineDot,
            ]}
          />
          <Text style={styles.statusText}>
            {isOnline ? `Online` : `Offline`}
          </Text>
        </View>

        <View
          style={[
            styles.statusBadge,
            offline?.isOfflineEnabled ? styles.enabled : styles.disabled,
          ]}
        >
          <View
            style={[
              styles.statusDot,
              offline?.isOfflineEnabled
                ? styles.enabledDot
                : styles.disabledDot,
            ]}
          />
          <Text style={styles.statusText}>
            {offline?.isOfflineEnabled ? `Offline Mode` : `Online Only`}
          </Text>
        </View>

        {pendingCount > 0 && (
          <View style={[styles.statusBadge, styles.pending]}>
            <ActivityIndicator size="small" color="#b45309" />
            <Text style={styles.statusText}>{pendingCount} pending</Text>
          </View>
        )}
      </View>

      {/* Error display */}
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Add new todo */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={newTodoText}
          onChangeText={setNewTodoText}
          placeholder="Add a new todo..."
          onSubmitEditing={handleAddTodo}
          editable={!isLoading}
        />
        <TouchableOpacity
          style={[
            styles.addButton,
            (!newTodoText.trim() || isLoading) && styles.addButtonDisabled,
          ]}
          onPress={handleAddTodo}
          disabled={!newTodoText.trim() || isLoading}
        >
          <Text style={styles.addButtonText}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* Todo list */}
      {isLoading && todoList.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading todos...</Text>
        </View>
      ) : todoList.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No todos yet. Add one above!</Text>
          <Text style={styles.emptySubtext}>
            Try going offline to test offline mode
          </Text>
        </View>
      ) : (
        <FlatList
          data={todoList}
          keyExtractor={(item) => item.id}
          style={styles.list}
          renderItem={({ item: todo }) => (
            <View style={styles.todoItem}>
              <TouchableOpacity
                style={[
                  styles.checkbox,
                  todo.completed && styles.checkboxChecked,
                ]}
                onPress={() => handleToggleTodo(todo.id)}
              >
                {todo.completed && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
              <View style={styles.todoContent}>
                <Text
                  style={[
                    styles.todoText,
                    todo.completed && styles.todoTextCompleted,
                  ]}
                >
                  {todo.text}
                </Text>
                <Text style={styles.todoDate}>
                  {new Date(todo.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDeleteTodo(todo.id)}
              >
                <Text style={styles.deleteButtonText}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      {/* Instructions */}
      <View style={styles.instructions}>
        <Text style={styles.instructionsTitle}>Try this:</Text>
        <Text style={styles.instructionsText}>
          1. Add some todos while online
        </Text>
        <Text style={styles.instructionsText}>2. Enable airplane mode</Text>
        <Text style={styles.instructionsText}>
          3. Add more todos (queued locally)
        </Text>
        <Text style={styles.instructionsText}>
          4. Disable airplane mode to sync
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: `#f5f5f5`,
  },
  title: {
    fontSize: 24,
    fontWeight: `bold`,
    color: `#111`,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: `#666`,
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: `row`,
    flexWrap: `wrap`,
    gap: 8,
    marginBottom: 16,
  },
  statusBadge: {
    flexDirection: `row`,
    alignItems: `center`,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: `500`,
  },
  online: {
    backgroundColor: `#dcfce7`,
  },
  onlineDot: {
    backgroundColor: `#22c55e`,
  },
  offline: {
    backgroundColor: `#fee2e2`,
  },
  offlineDot: {
    backgroundColor: `#ef4444`,
  },
  enabled: {
    backgroundColor: `#dbeafe`,
  },
  enabledDot: {
    backgroundColor: `#3b82f6`,
  },
  disabled: {
    backgroundColor: `#e5e5e5`,
  },
  disabledDot: {
    backgroundColor: `#737373`,
  },
  pending: {
    backgroundColor: `#fef3c7`,
  },
  errorBox: {
    backgroundColor: `#fee2e2`,
    borderWidth: 1,
    borderColor: `#fca5a5`,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: `#dc2626`,
    fontSize: 14,
  },
  inputRow: {
    flexDirection: `row`,
    gap: 8,
    marginBottom: 16,
  },
  input: {
    flex: 1,
    backgroundColor: `#fff`,
    borderWidth: 1,
    borderColor: `#d1d5db`,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  addButton: {
    backgroundColor: `#3b82f6`,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    justifyContent: `center`,
  },
  addButtonDisabled: {
    opacity: 0.5,
  },
  addButtonText: {
    color: `#fff`,
    fontWeight: `600`,
    fontSize: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: `center`,
    alignItems: `center`,
    gap: 12,
  },
  loadingText: {
    color: `#666`,
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: `center`,
    alignItems: `center`,
  },
  emptyText: {
    color: `#666`,
    fontSize: 16,
  },
  emptySubtext: {
    color: `#999`,
    fontSize: 12,
    marginTop: 4,
  },
  list: {
    flex: 1,
  },
  todoItem: {
    flexDirection: `row`,
    alignItems: `center`,
    backgroundColor: `#fff`,
    borderWidth: 1,
    borderColor: `#e5e5e5`,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: `#d1d5db`,
    borderRadius: 4,
    justifyContent: `center`,
    alignItems: `center`,
  },
  checkboxChecked: {
    backgroundColor: `#22c55e`,
    borderColor: `#22c55e`,
  },
  checkmark: {
    color: `#fff`,
    fontSize: 14,
    fontWeight: `bold`,
  },
  todoContent: {
    flex: 1,
  },
  todoText: {
    fontSize: 16,
    color: `#111`,
  },
  todoTextCompleted: {
    textDecorationLine: `line-through`,
    color: `#999`,
  },
  todoDate: {
    fontSize: 12,
    color: `#999`,
    marginTop: 2,
  },
  deleteButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  deleteButtonText: {
    color: `#dc2626`,
    fontSize: 14,
  },
  instructions: {
    backgroundColor: `#f0f0f0`,
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
  },
  instructionsTitle: {
    fontWeight: `600`,
    color: `#111`,
    marginBottom: 8,
  },
  instructionsText: {
    color: `#666`,
    fontSize: 13,
    marginBottom: 2,
  },
})
