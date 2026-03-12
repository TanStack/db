// Must be first import to polyfill crypto before anything else loads
import '../src/polyfills'

import { Stack } from 'expo-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { queryClient } from '../src/utils/queryClient'
import { ShoppingProvider } from '../src/db/ShoppingContext'

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ShoppingProvider>
          <StatusBar style="auto" />
          <Stack>
            <Stack.Screen name="index" options={{ title: `Shopping Lists` }} />
            <Stack.Screen name="list/[id]" options={{ title: `List` }} />
          </Stack>
        </ShoppingProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
