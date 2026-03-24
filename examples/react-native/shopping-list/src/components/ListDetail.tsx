import React, { useEffect, useState } from 'react'
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { eq, useLiveQuery  } from '@tanstack/react-db'
import { itemsCollection } from '../db/collections'
import { useShopping } from '../db/ShoppingContext'

interface ListDetailProps {
  listId: string
}

type ListItemRow = {
  id: string
  listId: string
  text: string
  checked: boolean
  createdAt: string
  $synced?: boolean
}

function ItemRow({
  item,
  onToggle,
  onDelete,
}: {
  item: ListItemRow
  onToggle: () => void
  onDelete: () => void
}) {
  const [showSavingBadge, setShowSavingBadge] = useState(false)

  useEffect(() => {
    if (item.$synced !== false) {
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
  }, [item.id, item.$synced])

  return (
    <View style={styles.itemRow}>
      <TouchableOpacity
        style={[
          styles.checkbox,
          item.checked && styles.checkboxChecked,
        ]}
        onPress={onToggle}
      >
        {item.checked && <Text style={styles.checkmark}>✓</Text>}
      </TouchableOpacity>
      <Text
        style={[
          styles.itemText,
          item.checked && styles.itemTextChecked,
        ]}
      >
        {item.text}
      </Text>
      {showSavingBadge ? (
        <View style={styles.savingBadge}>
          <Text style={styles.savingBadgeText}>Saving</Text>
        </View>
      ) : null}
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={onDelete}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.deleteButtonText}>Delete</Text>
      </TouchableOpacity>
    </View>
  )
}

export function ListDetail({ listId }: ListDetailProps) {
  const [newItemText, setNewItemText] = useState(``)
  const { itemActions } = useShopping()

  // Get items for this list
  const itemsResult = useLiveQuery((q) =>
    q
      .from({ item: itemsCollection })
      .where(({ item }) => eq(item.listId, listId))
      .orderBy(({ item }) => item.createdAt, `asc`),
  )
  const items = itemsResult.data as Array<ListItemRow>

  const handleAddItem = async () => {
    if (!newItemText.trim() || !itemActions.addItem) return
    await itemActions.addItem({ listId, text: newItemText })
    setNewItemText(``)
  }

  const handleToggleItem = (id: string) => {
    itemActions.toggleItem?.(id)
  }

  const handleDeleteItem = (id: string) => {
    itemActions.deleteItem?.(id)
  }

  const checkedCount = items.filter((i) => i.checked).length

  return (
    <View style={styles.container}>
      {/* Summary */}
      <Text style={styles.summary}>
        {checkedCount}/{items.length} items checked
      </Text>

      {/* Add item input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={newItemText}
          onChangeText={setNewItemText}
          placeholder="Add item..."
          onSubmitEditing={handleAddItem}
        />
        <TouchableOpacity
          style={[
            styles.addButton,
            !newItemText.trim() && styles.addButtonDisabled,
          ]}
          onPress={handleAddItem}
          disabled={!newItemText.trim()}
        >
          <Text style={styles.addButtonText}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* Items */}
      {items.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No items yet. Add one above!</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          style={styles.list}
          renderItem={({ item }) => (
            <ItemRow
              item={item}
              onToggle={() => handleToggleItem(item.id)}
              onDelete={() => handleDeleteItem(item.id)}
            />
          )}
        />
      )}
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
  },
  summary: {
    fontSize: 14,
    color: `#666`,
    marginBottom: 12,
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
  emptyText: {
    color: `#666`,
    fontSize: 16,
  },
  list: {
    flex: 1,
  },
  itemRow: {
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
  itemText: {
    flex: 1,
    fontSize: 16,
    color: `#111`,
  },
  itemTextChecked: {
    textDecorationLine: `line-through`,
    color: `#999`,
  },
  deleteButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
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
  deleteButtonText: {
    color: `#dc2626`,
    fontSize: 14,
  },
})
