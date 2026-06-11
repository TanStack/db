import { SafeAreaView } from 'react-native-safe-area-context'
import { ListsScreen } from '../src/components/ListsScreen'

export default function HomeScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <ListsScreen />
    </SafeAreaView>
  )
}
