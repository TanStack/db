import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { count, eq, useLiveQuery } from '@tanstack/react-db'
import { itemsCollection, listsCollection } from '../db/collections'
import { useShopping } from '../db/ShoppingContext'

// Subcomponent that subscribes to the child aggregate collections for reactive counts
function ListCard({
  list,
  onPress,
  onDelete,
}: {
  list: {
    id: string
    name: string
    totalItems: any
    checkedItems: any
    uncheckedPreview: any
    $synced?: boolean
  }
  onPress: () => void
  onDelete: () => void
}) {
  // Subscribe to the child collections — this is the "includes" pattern for React
  const { data: totalData } = useLiveQuery(list.totalItems)
  const { data: checkedData } = useLiveQuery(list.checkedItems)
  const { data: uncheckedPreviewData } = useLiveQuery(list.uncheckedPreview)
  const totalCount = (totalData as any)?.[0]?.n ?? 0
  const checkedCount = (checkedData as any)?.[0]?.n ?? 0
  const uncheckedPreview =
    ((uncheckedPreviewData as any) as Array<{ text: string }> | undefined) ?? []
  const uncheckedCount = Math.max(0, totalCount - checkedCount)
  const remainingCount = Math.max(0, uncheckedCount - uncheckedPreview.length)
  const previewText = uncheckedPreview
    .map((item) => item.text.trim())
    .filter((text) => text.length > 0)
    .join(`, `)
  const [showSavingBadge, setShowSavingBadge] = useState(false)

  useEffect(() => {
    if (list.$synced !== false) {
      setShowSavingBadge(false)
      return
    }

    setShowSavingBadge(false)
    const timer = setTimeout(() => {
      setShowSavingBadge(true)
    }, 200)
    return () => {
      clearTimeout(timer)
    }
  }, [list.id, list.$synced])

  return (
    <TouchableOpacity
      style={styles.listCard}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.listContent}>
        <View style={styles.listHeaderRow}>
          <Text style={styles.listName}>{list.name}</Text>
          {showSavingBadge ? (
            <View style={styles.savingBadge}>
              <Text style={styles.savingBadgeText}>Saving</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.listCount}>
          {checkedCount}/{totalCount} items
        </Text>
        {uncheckedCount > 0 && previewText.length > 0 ? (
          <Text style={styles.previewText}>
            {previewText}
            {remainingCount > 0 ? ` and ${remainingCount} more` : ``}
          </Text>
        ) : totalCount > 0 ? (
          <Text style={styles.allDoneText}>All items checked</Text>
        ) : null}
      </View>
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={onDelete}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.deleteButtonText}>Delete</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  )
}

export function ListsScreen() {
  const router = useRouter()
  const [newListName, setNewListName] = useState(``)
  const {
    listActions,
    isInitialized,
    initError,
  } = useShopping()

  // ★ Includes query with aggregate subqueries: each list gets child collections
  // with computed counts. ListCard subscribes to them via useLiveQuery.
  const queryResult = useLiveQuery((q) =>
    q
      .from({ list: listsCollection })
      .select(({ list }) => ({
        id: list.id,
        name: list.name,
        createdAt: list.createdAt,
        $synced: list.$synced,
        totalItems: q
          .from({ item: itemsCollection })
          .where(({ item }) => eq(item.listId, list.id))
          .select(({ item }) => ({ n: count(item.id) })),
        uncheckedPreview: q
          .from({ item: itemsCollection })
          .where(({ item }) => eq(item.listId, list.id))
          .where(({ item }) => eq(item.checked, false))
          .select(({ item }) => ({
            id: item.id,
            text: item.text,
            createdAt: item.createdAt,
          }))
          .orderBy(({ item }) => item.createdAt, `asc`)
          .limit(3),
        checkedItems: q
          .from({ item: itemsCollection })
          .where(({ item }) => eq(item.listId, list.id))
          .where(({ item }) => eq(item.checked, true))
          .select(({ item }) => ({ n: count(item.id) })),
      }))
      .orderBy(({ list }) => list.createdAt, `desc`),
  )
  const lists = queryResult.data as unknown as Array<{
    id: string
    name: string
    createdAt: string
    $synced?: boolean
    totalItems: any
    uncheckedPreview: any
    checkedItems: any
  }>

  const handleAddList = async () => {
    if (!newListName.trim() || !listActions.addList) return
    await listActions.addList(newListName)
    setNewListName(``)
  }

  const handleDeleteList = (id: string, name: string) => {
    Alert.alert(`Delete "${name}"?`, `This will also delete all items.`, [
      { text: `Cancel`, style: `cancel` },
      {
        text: `Delete`,
        style: `destructive`,
        onPress: () => listActions.deleteList?.(id),
      },
    ])
  }

  if (initError) {
    return (
      <View style={styles.container}>
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{initError}</Text>
        </View>
      </View>
    )
  }

  if (!isInitialized) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Initializing...</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Add list input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={newListName}
          onChangeText={setNewListName}
          placeholder="New list name..."
          onSubmitEditing={handleAddList}
        />
        <TouchableOpacity
          style={[
            styles.addButton,
            !newListName.trim() && styles.addButtonDisabled,
          ]}
          onPress={handleAddList}
          disabled={!newListName.trim()}
        >
          <Text style={styles.addButtonText}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* Lists */}
      {lists.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No lists yet</Text>
        </View>
      ) : (
        <FlatList
          data={lists}
          keyExtractor={(item) => item.id}
          style={styles.list}
          renderItem={({ item: list }) => (
            <ListCard
              list={list}
              onPress={() => router.push(`/list/${list.id}`)}
              onDelete={() => handleDeleteList(list.id, list.name)}
            />
          )}
        />
      )}

      {/* Instructions */}
      <View style={styles.instructions}>
        <Text style={styles.instructionsTitle}>Features showcased:</Text>
        <Text style={styles.instructionsText}>
          1. Includes — item counts from nested child queries
        </Text>
        <Text style={styles.instructionsText}>
          2. Electric sync — real-time replication via shape streams
        </Text>
        <Text style={styles.instructionsText}>
          3. Offline transactions — works without network
        </Text>
        <Text style={styles.instructionsText}>
          4. SQLite persistence — data survives app restart
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
  centered: {
    flex: 1,
    justifyContent: `center`,
    alignItems: `center`,
    gap: 12,
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
  loadingText: {
    color: `#666`,
    fontSize: 14,
  },
  emptyText: {
    color: `#666`,
    fontSize: 16,
  },
  list: {
    flex: 1,
  },
  listCard: {
    flexDirection: `row`,
    alignItems: `center`,
    backgroundColor: `#fff`,
    borderWidth: 1,
    borderColor: `#e5e5e5`,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  listContent: {
    flex: 1,
  },
  listHeaderRow: {
    flexDirection: `row`,
    alignItems: `center`,
    gap: 8,
  },
  listName: {
    fontSize: 18,
    fontWeight: `600`,
    color: `#111`,
  },
  savingBadge: {
    backgroundColor: `#fef3c7`,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  savingBadgeText: {
    color: `#92400e`,
    fontSize: 11,
    fontWeight: `700`,
  },
  listCount: {
    fontSize: 14,
    color: `#666`,
    marginTop: 4,
  },
  previewText: {
    marginTop: 4,
    color: `#374151`,
    fontSize: 13,
  },
  allDoneText: {
    marginTop: 4,
    color: `#15803d`,
    fontSize: 12,
    fontWeight: `600`,
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
