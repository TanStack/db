import { SafeAreaView } from 'react-native-safe-area-context'
import { TodoList } from '../src/components/TodoList'

export default function HomeScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={[`bottom`]}>
      <TodoList />
    </SafeAreaView>
  )
}
