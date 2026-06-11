// Must be first import to polyfill crypto before anything else loads
import '../src/polyfills'

import { Stack } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen
          name="index"
          options={{
            title: `Offline Transactions + SQLite`,
          }}
        />
      </Stack>
    </SafeAreaProvider>
  )
}
