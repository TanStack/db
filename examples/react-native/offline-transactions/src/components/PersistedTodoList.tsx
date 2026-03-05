import React, { useState } from 'react'
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useLiveQuery } from '@tanstack/react-db'
import type { Collection } from '@tanstack/db'
import type { PersistedTodo } from '../db/persisted-todos'

interface PersistedTodoListProps {
  collection: Collection<PersistedTodo, string>
}

export function PersistedTodoList({ collection }: PersistedTodoListProps) {
  const [newTodoText, setNewTodoText] = useState(``)
  const [error, setError] = useState<string | null>(null)

  const { data: todoList = [] } = useLiveQuery((q) =>
    q
      .from({ todo: collection })
      .orderBy(({ todo }) => todo.createdAt, `desc`),
  )

  const handleAddTodo = () => {
    if (!newTodoText.trim()) return

    try {
      setError(null)
      const now = new Date().toISOString()
      collection.insert({
        id: crypto.randomUUID(),
        text: newTodoText.trim(),
        completed: false,
        createdAt: now,
        updatedAt: now,
      })
      setNewTodoText(``)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to add todo`)
    }
  }

  const handleToggleTodo = (id: string) => {
    try {
      setError(null)
      collection.update(id, (draft) => {
        draft.completed = !draft.completed
        draft.updatedAt = new Date().toISOString()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to toggle todo`)
    }
  }

  const handleDeleteTodo = (id: string) => {
    try {
      setError(null)
      collection.delete(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to delete todo`)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SQLite Persistence Demo</Text>
      <Text style={styles.subtitle}>
        Collection data persisted to SQLite. Survives app restarts without
        server sync.
      </Text>

      {/* Persistence indicator */}
      <View style={styles.statusRow}>
        <View style={[styles.statusBadge, styles.active]}>
          <View style={[styles.statusDot, styles.activeDot]} />
          <Text style={styles.statusText}>SQLite Persistence Active</Text>
        </View>
        <View style={[styles.statusBadge, styles.countBadge]}>
          <Text style={styles.statusText}>
            {todoList.length} todo{todoList.length !== 1 ? `s` : ``}
          </Text>
        </View>
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
        />
        <TouchableOpacity
          style={[
            styles.addButton,
            !newTodoText.trim() && styles.addButtonDisabled,
          ]}
          onPress={handleAddTodo}
          disabled={!newTodoText.trim()}
        >
          <Text style={styles.addButtonText}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* Todo list */}
      {todoList.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            No todos yet. Add one above to get started!
          </Text>
          <Text style={styles.emptySubtext}>
            Try adding todos, then restart the app to see them persist
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
        <Text style={styles.instructionsText}>1. Add some todos</Text>
        <Text style={styles.instructionsText}>
          2. Close and reopen the app
        </Text>
        <Text style={styles.instructionsText}>
          3. Your todos are still here - persisted in SQLite!
        </Text>
        <Text style={styles.instructionsText}>
          4. No server needed - fully local persistence
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
  active: {
    backgroundColor: `#dcfce7`,
  },
  activeDot: {
    backgroundColor: `#22c55e`,
  },
  countBadge: {
    backgroundColor: `#e5e5e5`,
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
