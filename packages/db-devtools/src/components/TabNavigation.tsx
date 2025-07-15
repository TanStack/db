import { clsx as cx } from 'clsx'
import { useStyles } from '../useStyles'
import type { Accessor } from 'solid-js'

interface TabNavigationProps {
  selectedView: Accessor<'collections' | 'transactions'>
  collectionsCount: Accessor<number>
  transactionsCount: Accessor<number>
  onSelectView: (view: 'collections' | 'transactions') => void
}

export function TabNavigation({
  selectedView,
  collectionsCount,
  transactionsCount,
  onSelectView,
}: TabNavigationProps) {
  const styles = useStyles()

  return (
    <div class={styles().tabNav}>
      <button
        onClick={() => {
          onSelectView('collections')
        }}
        class={cx(
          styles().tabBtn,
          selectedView() === 'collections' && styles().tabBtnActive
        )}
      >
        Collections ({collectionsCount()})
      </button>
      <button
        onClick={() => {
          onSelectView('transactions')
        }}
        class={cx(
          styles().tabBtn,
          selectedView() === 'transactions' && styles().tabBtnActive
        )}
      >
        Transactions ({transactionsCount()})
      </button>
    </div>
  )
} 