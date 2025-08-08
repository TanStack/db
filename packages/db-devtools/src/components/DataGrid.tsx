/** @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useStyles } from "../useStyles"
import { onDevtoolsEvent } from "../index"

export interface DataGridProps {
  instance: any
}

export function DataGrid(props: DataGridProps) {
  const styles = useStyles()
  const [rows, setRows] = createSignal<Array<[any, any]>>([])
  const [limit, setLimit] = createSignal(100)
  const [editingKey, setEditingKey] = createSignal<any>(null)
  const [draftRow, setDraftRow] = createSignal<Record<string, any> | null>(null)

  const fetchRows = () => {
    try {
      const entries = Array.from(props.instance.entries?.() ?? []) as Array<[
        any,
        any,
      ]>
      setRows(entries)
    } catch {
      setRows([])
    }
  }

  onMount(() => {
    fetchRows()
    const off = onDevtoolsEvent("collectionUpdated", ({ id }) => {
      if (id === props.instance.id) fetchRows()
    })
    onCleanup(off)
  })

  createEffect(() => {
    // When instance changes
    fetchRows()
  })

  const columns = createMemo(() => {
    const first = rows()[0]?.[1]
    if (!first || typeof first !== "object") return [] as Array<string>
    return Object.keys(first)
  })

  const canEdit = createMemo(() => {
    const cfg = props.instance?.config
    return Boolean(cfg?.onInsert || cfg?.onUpdate || cfg?.onDelete)
  })

  const visibleRows = createMemo(() => rows().slice(0, limit()))

  let containerRef: HTMLDivElement | undefined
  const onScroll = () => {
    if (!containerRef) return
    const { scrollTop, clientHeight, scrollHeight } = containerRef
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      setLimit((v) => v + 100)
    }
  }

  const startEdit = (key: any, value: any) => {
    if (!canEdit()) return
    setEditingKey(key)
    setDraftRow({ ...value })
  }

  const cancelEdit = () => {
    setEditingKey(null)
    setDraftRow(null)
  }

  const saveEdit = async () => {
    const key = editingKey()
    const draft = draftRow()
    if (key == null || !draft) return
    try {
      props.instance.update(key, (d: any) => {
        Object.assign(d, draft)
      })
      cancelEdit()
    } catch {
      // ignore
    }
  }

  const removeRow = async (key: any) => {
    try {
      props.instance.delete(key)
    } catch {
      // ignore
    }
  }

  const updateDraftField = (field: string, value: any) => {
    setDraftRow((prev) => ({ ...(prev ?? {}), [field]: value }))
  }

  return (
    <div class={styles().detailsContent} style={{ padding: "0" }}>
      <div
        ref={(el) => (containerRef = el)}
        onScroll={onScroll}
        style={{ "max-height": "400px", overflow: "auto" }}
      >
        <table style={{ width: "100%", "border-collapse": "collapse" }}>
          <thead>
            <tr>
              <th style={{ padding: "6px", "text-align": "left" }}>key</th>
              {columns().map((col) => (
                <th style={{ padding: "6px", "text-align": "left" }}>{col}</th>
              ))}
              {canEdit() ? <th style={{ padding: "6px" }}></th> : null}
            </tr>
          </thead>
          <tbody>
            {visibleRows().map(([key, value]) => {
              const isEditing = editingKey() === key
              return (
                <tr style={{ "border-top": "1px solid #333" }}>
                  <td style={{ padding: "6px", color: "#888" }}>{String(key)}</td>
                  {columns().map((col) => (
                    <td style={{ padding: "6px" }}>
                      {isEditing ? (
                        <input
                          value={draftRow()?.[col] ?? ""}
                          onInput={(e) => updateDraftField(col, (e.target as HTMLInputElement).value)}
                          style={{ width: "100%" }}
                        />
                      ) : (
                        <span>{String(value?.[col])}</span>
                      )}
                    </td>
                  ))}
                  {canEdit() ? (
                    <td style={{ padding: "6px", "white-space": "nowrap" }}>
                      {!isEditing ? (
                        <button onClick={() => startEdit(key, value)}>Edit</button>
                      ) : (
                        <>
                          <button onClick={saveEdit}>Save</button>
                          <button onClick={cancelEdit} style={{ margin: "0 6px" }}>
                            Cancel
                          </button>
                        </>
                      )}
                      <button onClick={() => removeRow(key)} style={{ margin: "0 6px" }}>
                        Delete
                      </button>
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}