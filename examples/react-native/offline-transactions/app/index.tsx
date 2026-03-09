import React, { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TodoList } from '../src/components/TodoList'
import { createTodos } from '../src/db/todos'
import type { TodosHandle } from '../src/db/todos'

export default function HomeScreen() {
  const [handle, setHandle] = useState<TodosHandle | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    let currentHandle: TodosHandle | null = null

    try {
      const h = createTodos()
      if (disposed as boolean) {
        h.close()
        return
      }
      currentHandle = h
      setHandle(h)
    } catch (err) {
      if (!(disposed as boolean)) {
        console.error(`Failed to initialize:`, err)
        setError(
          err instanceof Error ? err.message : `Failed to initialize`,
        )
      }
    }

    return () => {
      disposed = true
      currentHandle?.close()
    }
  }, [])

  if (error) {
    return (
      <SafeAreaView style={{ flex: 1 }} edges={[`bottom`]}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Initialization Error</Text>
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (!handle) {
    return (
      <SafeAreaView style={{ flex: 1 }} edges={[`bottom`]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Initializing...</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={[`bottom`]}>
      <TodoList collection={handle.collection} executor={handle.executor} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    padding: 16,
    backgroundColor: `#f5f5f5`,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: `bold`,
    color: `#111`,
    marginBottom: 16,
  },
  errorBox: {
    backgroundColor: `#fee2e2`,
    borderWidth: 1,
    borderColor: `#fca5a5`,
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    color: `#dc2626`,
    fontSize: 14,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: `center`,
    alignItems: `center`,
    gap: 12,
    backgroundColor: `#f5f5f5`,
  },
  loadingText: {
    color: `#666`,
    fontSize: 14,
  },
})
