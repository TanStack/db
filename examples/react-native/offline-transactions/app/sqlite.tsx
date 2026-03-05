import React, { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PersistedTodoList } from '../src/components/PersistedTodoList'
import {
  
  createPersistedTodoCollection
} from '../src/db/persisted-todos'
import type {PersistedTodosHandle} from '../src/db/persisted-todos';

export default function SQLiteScreen() {
  const [handle, setHandle] = useState<PersistedTodosHandle | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    let currentHandle: PersistedTodosHandle | null = null

    try {
      const h = createPersistedTodoCollection()
      if (disposed as boolean) {
        h.close()
        return
      }
      currentHandle = h
      setHandle(h)
    } catch (err) {
      if (!(disposed as boolean)) {
        console.error(`Failed to initialize SQLite persistence:`, err)
        setError(
          err instanceof Error
            ? err.message
            : `Failed to initialize persistence`,
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
          <Text style={styles.errorTitle}>Persistence Unavailable</Text>
          <Text style={styles.errorSubtitle}>
            SQLite persistence could not be initialized.
          </Text>
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
          <Text style={styles.loadingText}>
            Initializing SQLite persistence...
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={[`bottom`]}>
      <PersistedTodoList collection={handle.collection} />
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
    marginBottom: 4,
  },
  errorSubtitle: {
    fontSize: 14,
    color: `#666`,
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
