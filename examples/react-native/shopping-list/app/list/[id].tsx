import { useLocalSearchParams, Stack } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/react-db'
import { listsCollection } from '../../src/db/collections'
import { ListDetail } from '../../src/components/ListDetail'

export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>() as { id: string }

  // Get the list name for the header
  const listResult = useLiveQuery((q) =>
    q
      .from({ list: listsCollection })
      .where(({ list }) => eq(list.id, id))
      .select(({ list }) => ({ id: list.id, name: list.name })),
  )
  const list = (listResult.data ?? [])[0] as
    | { id: string; name: string }
    | undefined

  return (
    <>
      <Stack.Screen options={{ title: list?.name ?? `List` }} />
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ListDetail listId={id} />
      </SafeAreaView>
    </>
  )
}
