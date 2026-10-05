// Must be first import to polyfill crypto before anything else loads
import '../src/polyfills'

import React, { useCallback, useState } from 'react'
import { Stack } from 'expo-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { queryClient } from '../src/utils/queryClient'
import { ShoppingProvider, useShopping } from '../src/db/ShoppingContext'

function HeaderControls({ onAppRefresh }: { onAppRefresh: () => void }) {
  const {
    isOnline,
    isSimulatedOffline,
    setSimulateOffline,
    clearLocalState,
    pendingCount,
  } = useShopping()
  const [menuVisible, setMenuVisible] = useState(false)
  const [isClearingState, setIsClearingState] = useState(false)

  const closeMenu = useCallback(() => {
    setMenuVisible(false)
  }, [])

  const toggleSimulatedOffline = useCallback(() => {
    setMenuVisible(false)
    void setSimulateOffline(!isSimulatedOffline)
  }, [isSimulatedOffline, setSimulateOffline])

  const clearAndRefresh = useCallback(() => {
    setMenuVisible(false)
    // Delay the alert one tick so iOS can fully dismiss the modal first.
    setTimeout(() => {
      Alert.alert(
        `Clear local state`,
        `This clears local SQLite data and queued offline transactions, then refreshes the app.`,
        [
          { text: `Cancel`, style: `cancel` },
          {
            text: `Clear`,
            style: `destructive`,
            onPress: () => {
              if (isClearingState) return
              setIsClearingState(true)
              void (async () => {
                try {
                  await clearLocalState()
                  onAppRefresh()
                } catch (error) {
                  console.error(`[Shopping] Failed to clear local state`, error)
                  Alert.alert(
                    `Clear failed`,
                    error instanceof Error ? error.message : `Unknown error`,
                  )
                } finally {
                  setIsClearingState(false)
                }
              })()
            },
          },
        ],
      )
    }, 0)
  }, [clearLocalState, isClearingState, onAppRefresh])

  const statusLabel = isOnline
    ? `Online`
    : isSimulatedOffline
      ? `Offline (sim)`
      : `Offline`

  return (
    <View style={{ flexDirection: `row`, alignItems: `center`, gap: 8 }}>
      <View
        style={{
          backgroundColor: isOnline ? `#dcfce7` : `#fee2e2`,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 999,
        }}
      >
        <Text
          style={{
            color: isOnline ? `#166534` : `#991b1b`,
            fontSize: 11,
            fontWeight: `600`,
          }}
        >
          {statusLabel}
          {pendingCount > 0 ? ` · ${pendingCount} pending` : ``}
        </Text>
      </View>
      <Pressable
        onPress={() => setMenuVisible(true)}
        style={{
          backgroundColor: `#e5e7eb`,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 8,
        }}
        accessibilityLabel="Open demo menu"
      >
        <Text style={{ fontSize: 16, fontWeight: `700`, color: `#111827` }}>
          ☰
        </Text>
      </Pressable>
      <Modal
        transparent
        visible={menuVisible}
        animationType="fade"
        onRequestClose={closeMenu}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={closeMenu} />
          <View style={styles.menuAnchor}>
            <View style={styles.menuCard}>
              <Pressable
                style={styles.menuItem}
                onPress={toggleSimulatedOffline}
              >
                <Text style={styles.menuText}>
                  {isSimulatedOffline
                    ? `Disable simulated offline mode`
                    : `Enable simulated offline mode`}
                </Text>
              </Pressable>
              <View style={styles.menuDivider} />
              <Pressable style={styles.menuItem} onPress={clearAndRefresh}>
                <Text style={[styles.menuText, styles.menuTextDanger]}>
                  Clear local state
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

export default function RootLayout() {
  const [refreshKey, setRefreshKey] = useState(0)
  const refreshApp = useCallback(() => {
    queryClient.clear()
    setRefreshKey((current) => current + 1)
  }, [])

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient} key={refreshKey}>
        <ShoppingProvider key={refreshKey}>
          <StatusBar style="dark" translucent={false} />
          <Stack
            screenOptions={{
              ...(Platform.OS === `android`
                ? {
                    statusBarTranslucent: false,
                    statusBarStyle: `dark` as const,
                  }
                : {}),
              headerRight: () => <HeaderControls onAppRefresh={refreshApp} />,
            }}
          >
            <Stack.Screen name="index" options={{ title: `Shopping Lists` }} />
            <Stack.Screen name="list/[id]" options={{ title: `List` }} />
          </Stack>
        </ShoppingProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: `rgba(0, 0, 0, 0.12)`,
  },
  menuAnchor: {
    flex: 1,
    alignItems: `flex-end`,
    paddingTop: 70,
    paddingRight: 12,
  },
  menuCard: {
    width: 260,
    backgroundColor: `#fff`,
    borderRadius: 12,
    overflow: `hidden`,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `#d1d5db`,
  },
  menuItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  menuText: {
    fontSize: 14,
    color: `#111827`,
    fontWeight: `500`,
  },
  menuTextDanger: {
    color: `#b91c1c`,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: `#e5e7eb`,
  },
})
