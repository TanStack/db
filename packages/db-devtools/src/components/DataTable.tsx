import { For, createEffect, createMemo } from "solid-js"
import { createSolidTable, getCoreRowModel } from "@tanstack/solid-table"
// import { createVirtualizer } from "@tanstack/solid-virtual"
import { useStyles } from "../useStyles"
import {
  extractKeysFromData,
  formatValueForTable,
  getFullValue,
} from "../utils/dataFormatting"
import type { ColumnDef } from "@tanstack/solid-table"

interface DataTableProps {
  data: Array<any>
  class?: string
}

export function DataTable(props: DataTableProps) {
  const styles = useStyles()
  let tableContainerRef: HTMLDivElement | undefined
  let headerRef: HTMLDivElement | undefined

  // Extract columns from data
  const columns = createMemo(() => {
    const keys = extractKeysFromData(props.data)
    return keys.map((key) => ({
      id: key,
      header: key,
      accessorKey: key,
      cell: ({ getValue }: any) => {
        const value = getValue()
        return (
          <div class={styles().tableCell} title={getFullValue(value)}>
            {formatValueForTable(value)}
          </div>
        )
      },
    })) as Array<ColumnDef<any>>
  })

  // Create table instance
  const table = createMemo(() => {
    return createSolidTable({
      data: props.data,
      columns: columns(),
      getCoreRowModel: getCoreRowModel(),
    })
  })

  // Temporarily render without row virtualization for correctness.
  // We'll re-enable once stable across proxies and Solid integration.
  // let rowVirtualizer: any = null
  // createEffect(() => { ... })

  // Column model (no virtualization yet for columns to simplify)
  const leafColumns = createMemo(() => table().getAllColumns())

  // Update virtualizers when data changes
  createEffect(() => {
    props.data
  })

  // Keep header horizontal scroll in sync with body
  createEffect(() => {
    if (!tableContainerRef || !headerRef) return
    const onScroll = () => {
      headerRef.scrollLeft = tableContainerRef.scrollLeft
    }
    tableContainerRef.addEventListener(`scroll`, onScroll)
    return () => tableContainerRef.removeEventListener(`scroll`, onScroll)
  })

  return (
    <div class={`${styles().dataTableContainer} ${props.class || ``}`}>
      {/* Table Header */}
      <div ref={headerRef} class={styles().tableHeaderContainer}>
        <div
          style={{ display: `flex`, width: `fit-content`, "min-width": `100%` }}
        >
          <For each={leafColumns()}>
            {(column) => (
              <div class={styles().tableHeaderCell} style={{ width: `160px` }}>
                {typeof column.columnDef.header === `string`
                  ? column.columnDef.header
                  : column.id}
              </div>
            )}
          </For>
        </div>
      </div>

      {/* Table Body */}
      <div ref={tableContainerRef} class={styles().tableBodyContainer}>
        <div
          style={{
            position: `relative`,
            width: `fit-content`,
            "min-width": `100%`,
          }}
        >
          <For each={table().getRowModel().rows}>
            {(row) => (
              <div class={styles().tableRow} style={{ display: `flex` }}>
                <For each={leafColumns()}>
                  {(column) => {
                    const value = row.getValue(column.id)
                    return (
                      <div
                        class={styles().tableCell}
                        style={{ width: `160px` }}
                        title={getFullValue(value)}
                      >
                        {formatValueForTable(value)}
                      </div>
                    )
                  }}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
