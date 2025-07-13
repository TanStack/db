var __typeError = (msg) => {
  throw TypeError(msg);
};
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);

// src/DbDevtools.tsx
import { createEffect as createEffect2, createSignal as createSignal3, onCleanup as onCleanup2 } from "solid-js";

// src/DbDevtoolsPanel.tsx
import { For as For3, Show as Show3, createMemo, createSignal as createSignal2 } from "solid-js";

// src/components/CollectionDetails.tsx
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { jsx, jsxs } from "solid-js/jsx-runtime";
function CollectionDetails(props) {
  const [collectionData, setCollectionData] = createSignal([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal(null);
  let unsubscribe;
  createEffect(() => {
    const collectionId = props.collectionId;
    if (!collectionId) return;
    setIsLoading(true);
    setError(null);
    const collection = props.registry.getCollection(collectionId);
    if (!collection) {
      setError(`Collection not found`);
      setIsLoading(false);
      return;
    }
    unsubscribe = collection.subscribeChanges(
      (_changes) => {
        setCollectionData(Array.from(collection.values()));
      },
      { includeInitialState: true }
    );
    setIsLoading(false);
    onCleanup(() => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = void 0;
      }
      props.registry.releaseCollection(collectionId);
    });
  });
  const metadata = () => props.registry.getCollectionMetadata(props.collectionId);
  return /* @__PURE__ */ jsx("div", { style: { padding: `20px`, overflow: `auto`, height: `100%` }, children: /* @__PURE__ */ jsx(
    Show,
    {
      when: error(),
      fallback: /* @__PURE__ */ jsx(
        Show,
        {
          when: !isLoading(),
          fallback: /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                display: `flex`,
                "align-items": `center`,
                "justify-content": `center`,
                height: `200px`
              },
              children: /* @__PURE__ */ jsx("div", { style: { color: `#666` }, children: "Loading collection details..." })
            }
          ),
          children: /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsxs(
              "div",
              {
                style: {
                  display: `flex`,
                  "align-items": `center`,
                  "justify-content": `space-between`,
                  "margin-bottom": `20px`,
                  "padding-bottom": `16px`,
                  "border-bottom": `1px solid #333`
                },
                children: [
                  /* @__PURE__ */ jsxs(
                    "h2",
                    {
                      style: { margin: `0`, "font-size": `20px`, color: `#e1e1e1` },
                      children: [
                        metadata()?.type === `live-query` ? `\u{1F504}` : `\u{1F4C4}`,
                        ` `,
                        props.collectionId
                      ]
                    }
                  ),
                  /* @__PURE__ */ jsxs(
                    "div",
                    {
                      style: {
                        display: `flex`,
                        "align-items": `center`,
                        gap: `12px`,
                        "font-size": `14px`,
                        color: `#888`
                      },
                      children: [
                        /* @__PURE__ */ jsxs("span", { children: [
                          "Status: ",
                          metadata()?.status
                        ] }),
                        /* @__PURE__ */ jsx("span", { children: "\u2022" }),
                        /* @__PURE__ */ jsxs("span", { children: [
                          collectionData().length,
                          " items"
                        ] })
                      ]
                    }
                  )
                ]
              }
            ),
            /* @__PURE__ */ jsx(Show, { when: metadata(), children: /* @__PURE__ */ jsxs("div", { style: { "margin-bottom": `24px` }, children: [
              /* @__PURE__ */ jsx(
                "h3",
                {
                  style: {
                    margin: `0 0 12px 0`,
                    "font-size": `16px`,
                    color: `#e1e1e1`
                  },
                  children: "Metadata"
                }
              ),
              /* @__PURE__ */ jsxs(
                "div",
                {
                  style: {
                    display: `grid`,
                    "grid-template-columns": `repeat(auto-fit, minmax(200px, 1fr))`,
                    gap: `12px`,
                    "font-size": `14px`
                  },
                  children: [
                    /* @__PURE__ */ jsxs("div", { children: [
                      /* @__PURE__ */ jsx("strong", { children: "Type:" }),
                      " ",
                      metadata().type
                    ] }),
                    /* @__PURE__ */ jsxs("div", { children: [
                      /* @__PURE__ */ jsx("strong", { children: "Created:" }),
                      ` `,
                      metadata().createdAt.toLocaleString()
                    ] }),
                    /* @__PURE__ */ jsxs("div", { children: [
                      /* @__PURE__ */ jsx("strong", { children: "Last Updated:" }),
                      ` `,
                      metadata().lastUpdated.toLocaleString()
                    ] }),
                    /* @__PURE__ */ jsxs("div", { children: [
                      /* @__PURE__ */ jsx("strong", { children: "GC Time:" }),
                      ` `,
                      metadata().gcTime || `Default`,
                      "ms"
                    ] }),
                    /* @__PURE__ */ jsx(Show, { when: metadata().hasTransactions, children: /* @__PURE__ */ jsxs("div", { children: [
                      /* @__PURE__ */ jsx("strong", { children: "Transactions:" }),
                      ` `,
                      metadata().transactionCount
                    ] }) })
                  ]
                }
              ),
              /* @__PURE__ */ jsx(
                Show,
                {
                  when: metadata().type === `live-query` && metadata().timings,
                  children: /* @__PURE__ */ jsxs("div", { style: { "margin-top": `16px` }, children: [
                    /* @__PURE__ */ jsx(
                      "h4",
                      {
                        style: {
                          margin: `0 0 8px 0`,
                          "font-size": `14px`,
                          color: `#e1e1e1`
                        },
                        children: "Performance Metrics"
                      }
                    ),
                    /* @__PURE__ */ jsxs(
                      "div",
                      {
                        style: {
                          display: `grid`,
                          "grid-template-columns": `repeat(auto-fit, minmax(200px, 1fr))`,
                          gap: `12px`,
                          "font-size": `14px`
                        },
                        children: [
                          /* @__PURE__ */ jsx(Show, { when: metadata().timings.initialRunTime, children: /* @__PURE__ */ jsxs("div", { children: [
                            /* @__PURE__ */ jsx("strong", { children: "Initial Run:" }),
                            ` `,
                            metadata().timings.initialRunTime,
                            "ms"
                          ] }) }),
                          /* @__PURE__ */ jsxs("div", { children: [
                            /* @__PURE__ */ jsx("strong", { children: "Total Runs:" }),
                            ` `,
                            metadata().timings.totalIncrementalRuns
                          ] }),
                          /* @__PURE__ */ jsx(
                            Show,
                            {
                              when: metadata().timings.averageIncrementalRunTime,
                              children: /* @__PURE__ */ jsxs("div", { children: [
                                /* @__PURE__ */ jsx("strong", { children: "Avg Incremental:" }),
                                ` `,
                                metadata().timings.averageIncrementalRunTime,
                                "ms"
                              ] })
                            }
                          ),
                          /* @__PURE__ */ jsx(
                            Show,
                            {
                              when: metadata().timings.lastIncrementalRunTime,
                              children: /* @__PURE__ */ jsxs("div", { children: [
                                /* @__PURE__ */ jsx("strong", { children: "Last Run:" }),
                                ` `,
                                metadata().timings.lastIncrementalRunTime,
                                "ms"
                              ] })
                            }
                          )
                        ]
                      }
                    )
                  ] })
                }
              )
            ] }) }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsxs(
                "h3",
                {
                  style: {
                    margin: `0 0 16px 0`,
                    "font-size": `16px`,
                    color: `#e1e1e1`
                  },
                  children: [
                    "Data (",
                    collectionData().length,
                    " items)"
                  ]
                }
              ),
              /* @__PURE__ */ jsx(
                Show,
                {
                  when: collectionData().length === 0,
                  fallback: /* @__PURE__ */ jsx(
                    "div",
                    {
                      style: {
                        "max-height": `400px`,
                        overflow: `auto`,
                        border: `1px solid #333`,
                        "border-radius": `4px`
                      },
                      children: /* @__PURE__ */ jsx(For, { each: collectionData(), children: (item, index) => /* @__PURE__ */ jsx(
                        "div",
                        {
                          style: {
                            padding: `12px`,
                            "border-bottom": index() < collectionData().length - 1 ? `1px solid #333` : `none`,
                            "background-color": index() % 2 === 0 ? `#222` : `#1a1a1a`
                          },
                          children: /* @__PURE__ */ jsxs("details", { children: [
                            /* @__PURE__ */ jsxs(
                              "summary",
                              {
                                style: {
                                  cursor: `pointer`,
                                  "font-weight": `500`,
                                  color: `#e1e1e1`,
                                  "margin-bottom": `8px`
                                },
                                children: [
                                  "Item ",
                                  index() + 1
                                ]
                              }
                            ),
                            /* @__PURE__ */ jsx(
                              "pre",
                              {
                                style: {
                                  "font-size": `12px`,
                                  "line-height": `1.4`,
                                  color: `#ccc`,
                                  margin: `0`,
                                  "white-space": `pre-wrap`,
                                  "word-break": `break-word`
                                },
                                children: JSON.stringify(item, null, 2)
                              }
                            )
                          ] })
                        }
                      ) })
                    }
                  ),
                  children: /* @__PURE__ */ jsx(
                    "div",
                    {
                      style: {
                        padding: `40px 20px`,
                        "text-align": `center`,
                        color: `#666`,
                        "font-style": `italic`,
                        border: `1px solid #333`,
                        "border-radius": `4px`,
                        "background-color": `#1a1a1a`
                      },
                      children: "No data in collection"
                    }
                  )
                }
              )
            ] })
          ] })
        }
      ),
      children: /* @__PURE__ */ jsx(
        "div",
        {
          style: {
            display: `flex`,
            "align-items": `center`,
            "justify-content": `center`,
            height: `200px`,
            color: `#ef4444`
          },
          children: error()
        }
      )
    }
  ) });
}

// src/components/TransactionList.tsx
import { For as For2, Show as Show2 } from "solid-js";
import { jsx as jsx2, jsxs as jsxs2 } from "solid-js/jsx-runtime";
function TransactionList(props) {
  const getStateColor = (state) => {
    switch (state) {
      case `completed`:
        return `#22c55e`;
      case `failed`:
        return `#ef4444`;
      case `persisting`:
        return `#eab308`;
      case `pending`:
        return `#3b82f6`;
      default:
        return `#6b7280`;
    }
  };
  const getStateIcon = (state) => {
    switch (state) {
      case `completed`:
        return `\u2713`;
      case `failed`:
        return `\u2717`;
      case `persisting`:
        return `\u27F3`;
      case `pending`:
        return `\u25CB`;
      default:
        return `?`;
    }
  };
  return /* @__PURE__ */ jsx2("div", { style: { overflow: `auto`, height: `100%` }, children: /* @__PURE__ */ jsx2(
    Show2,
    {
      when: props.transactions.length === 0,
      fallback: /* @__PURE__ */ jsx2(For2, { each: props.transactions, children: (transaction) => /* @__PURE__ */ jsxs2(
        "div",
        {
          onClick: () => props.onTransactionSelect(transaction.id),
          style: {
            padding: `12px 16px`,
            "border-bottom": `1px solid #333`,
            cursor: `pointer`,
            "background-color": props.selectedTransaction === transaction.id ? `#0088ff20` : `transparent`,
            "border-left": props.selectedTransaction === transaction.id ? `3px solid #0088ff` : `3px solid transparent`
          },
          children: [
            /* @__PURE__ */ jsxs2(
              "div",
              {
                style: {
                  display: `flex`,
                  "align-items": `center`,
                  "justify-content": `space-between`,
                  "margin-bottom": `4px`
                },
                children: [
                  /* @__PURE__ */ jsxs2(
                    "div",
                    {
                      style: {
                        "font-weight": `500`,
                        "font-size": `14px`,
                        color: `#e1e1e1`
                      },
                      children: [
                        transaction.id.slice(0, 8),
                        "..."
                      ]
                    }
                  ),
                  /* @__PURE__ */ jsxs2(
                    "div",
                    {
                      style: {
                        display: `flex`,
                        "align-items": `center`,
                        gap: `4px`,
                        color: getStateColor(transaction.state)
                      },
                      children: [
                        /* @__PURE__ */ jsx2("span", { style: { "font-size": `12px` }, children: getStateIcon(transaction.state) }),
                        /* @__PURE__ */ jsx2(
                          "span",
                          {
                            style: {
                              "font-size": `12px`,
                              "text-transform": `capitalize`
                            },
                            children: transaction.state
                          }
                        )
                      ]
                    }
                  )
                ]
              }
            ),
            /* @__PURE__ */ jsxs2(
              "div",
              {
                style: {
                  "font-size": `12px`,
                  color: `#888`,
                  display: `flex`,
                  "justify-content": `space-between`,
                  "align-items": `center`
                },
                children: [
                  /* @__PURE__ */ jsx2("span", { children: transaction.collectionId }),
                  /* @__PURE__ */ jsxs2("span", { children: [
                    transaction.mutations.length,
                    " mutations"
                  ] })
                ]
              }
            ),
            /* @__PURE__ */ jsx2(
              "div",
              {
                style: {
                  "font-size": `11px`,
                  color: `#666`,
                  "margin-top": `4px`
                },
                children: new Date(transaction.createdAt).toLocaleString()
              }
            )
          ]
        }
      ) }),
      children: /* @__PURE__ */ jsx2(
        "div",
        {
          style: {
            padding: `40px 20px`,
            "text-align": `center`,
            color: `#666`,
            "font-style": `italic`
          },
          children: "No transactions found"
        }
      )
    }
  ) });
}

// src/DbDevtoolsPanel.tsx
import { jsx as jsx3, jsxs as jsxs3 } from "solid-js/jsx-runtime";
function DbDevtoolsPanel(props) {
  const [selectedView, setSelectedView] = createSignal2(`collections`);
  const [selectedCollection, setSelectedCollection] = createSignal2(null);
  const [selectedTransaction, setSelectedTransaction] = createSignal2(null);
  const liveQueries = createMemo(
    () => props.collections.filter((c) => c.type === `live-query`)
  );
  const regularCollections = createMemo(
    () => props.collections.filter((c) => c.type === `collection`)
  );
  const allTransactions = createMemo(() => props.registry.getTransactions());
  const handleCollectionSelect = (id) => {
    setSelectedCollection(id);
    setSelectedTransaction(null);
  };
  const handleTransactionSelect = (id) => {
    setSelectedTransaction(id);
    setSelectedCollection(null);
  };
  const panelStyle = {
    position: `fixed`,
    top: `0`,
    left: `0`,
    width: `100vw`,
    height: `100vh`,
    "z-index": 9999999,
    "background-color": `rgba(0, 0, 0, 0.5)`,
    display: `flex`,
    "align-items": `center`,
    "justify-content": `center`,
    "font-family": `system-ui, -apple-system, sans-serif`
  };
  const contentStyle = {
    "background-color": `#1a1a1a`,
    color: `#e1e1e1`,
    width: `90vw`,
    height: `90vh`,
    "border-radius": `12px`,
    "box-shadow": `0 20px 40px rgba(0, 0, 0, 0.3)`,
    display: `flex`,
    "flex-direction": `column`,
    overflow: `hidden`
  };
  const headerStyle = {
    display: `flex`,
    "align-items": `center`,
    "justify-content": `space-between`,
    padding: `16px 20px`,
    "border-bottom": `1px solid #333`,
    "background-color": `#222`
  };
  const bodyStyle = {
    display: `flex`,
    flex: `1`,
    overflow: `hidden`
  };
  const sidebarStyle = {
    width: `300px`,
    "border-right": `1px solid #333`,
    "background-color": `#1e1e1e`,
    display: `flex`,
    "flex-direction": `column`
  };
  const mainStyle = {
    flex: `1`,
    display: `flex`,
    "flex-direction": `column`,
    overflow: `hidden`
  };
  return /* @__PURE__ */ jsx3(
    "div",
    {
      style: panelStyle,
      onClick: (e) => e.target === e.currentTarget && props.onClose(),
      children: /* @__PURE__ */ jsxs3("div", { style: contentStyle, onClick: (e) => e.stopPropagation(), children: [
        /* @__PURE__ */ jsxs3("div", { style: headerStyle, children: [
          /* @__PURE__ */ jsxs3(
            "div",
            {
              style: { display: `flex`, "align-items": `center`, gap: `12px` },
              children: [
                /* @__PURE__ */ jsx3("span", { style: { "font-size": `20px` }, children: "\u{1F5C4}\uFE0F" }),
                /* @__PURE__ */ jsx3(
                  "h1",
                  {
                    style: { margin: `0`, "font-size": `18px`, "font-weight": `600` },
                    children: "TanStack DB Devtools"
                  }
                )
              ]
            }
          ),
          /* @__PURE__ */ jsx3(
            "button",
            {
              onClick: props.onClose,
              style: {
                background: `none`,
                border: `none`,
                color: `#888`,
                "font-size": `20px`,
                cursor: `pointer`,
                padding: `4px 8px`,
                "border-radius": `4px`
              },
              children: "\u2715"
            }
          )
        ] }),
        /* @__PURE__ */ jsxs3("div", { style: bodyStyle, children: [
          /* @__PURE__ */ jsxs3("div", { style: sidebarStyle, children: [
            /* @__PURE__ */ jsxs3(
              "div",
              {
                style: {
                  display: `flex`,
                  "border-bottom": `1px solid #333`,
                  "background-color": `#222`
                },
                children: [
                  /* @__PURE__ */ jsx3(
                    "button",
                    {
                      onClick: () => setSelectedView(`collections`),
                      style: {
                        flex: `1`,
                        padding: `12px`,
                        background: selectedView() === `collections` ? `#0088ff` : `transparent`,
                        border: `none`,
                        color: selectedView() === `collections` ? `white` : `#888`,
                        cursor: `pointer`,
                        "font-size": `14px`
                      },
                      children: "Collections"
                    }
                  ),
                  /* @__PURE__ */ jsxs3(
                    "button",
                    {
                      onClick: () => setSelectedView(`transactions`),
                      style: {
                        flex: `1`,
                        padding: `12px`,
                        background: selectedView() === `transactions` ? `#0088ff` : `transparent`,
                        border: `none`,
                        color: selectedView() === `transactions` ? `white` : `#888`,
                        cursor: `pointer`,
                        "font-size": `14px`
                      },
                      children: [
                        "Transactions (",
                        allTransactions().length,
                        ")"
                      ]
                    }
                  )
                ]
              }
            ),
            /* @__PURE__ */ jsxs3("div", { style: { flex: `1`, overflow: `auto` }, children: [
              /* @__PURE__ */ jsxs3(Show3, { when: selectedView() === `collections`, children: [
                /* @__PURE__ */ jsxs3(Show3, { when: liveQueries().length > 0, children: [
                  /* @__PURE__ */ jsx3("div", { style: { padding: `16px 0 8px 16px` }, children: /* @__PURE__ */ jsxs3(
                    "h3",
                    {
                      style: {
                        margin: `0 0 8px 0`,
                        "font-size": `14px`,
                        "font-weight": `600`,
                        color: `#888`,
                        "text-transform": `uppercase`,
                        "letter-spacing": `0.5px`
                      },
                      children: [
                        "Live Queries (",
                        liveQueries().length,
                        ")"
                      ]
                    }
                  ) }),
                  /* @__PURE__ */ jsx3(For3, { each: liveQueries(), children: (collection) => /* @__PURE__ */ jsx3(
                    CollectionItem,
                    {
                      collection,
                      isSelected: selectedCollection() === collection.id,
                      onClick: () => handleCollectionSelect(collection.id)
                    }
                  ) })
                ] }),
                /* @__PURE__ */ jsxs3(Show3, { when: regularCollections().length > 0, children: [
                  /* @__PURE__ */ jsx3("div", { style: { padding: `16px 0 8px 16px` }, children: /* @__PURE__ */ jsxs3(
                    "h3",
                    {
                      style: {
                        margin: `0 0 8px 0`,
                        "font-size": `14px`,
                        "font-weight": `600`,
                        color: `#888`,
                        "text-transform": `uppercase`,
                        "letter-spacing": `0.5px`
                      },
                      children: [
                        "Collections (",
                        regularCollections().length,
                        ")"
                      ]
                    }
                  ) }),
                  /* @__PURE__ */ jsx3(For3, { each: regularCollections(), children: (collection) => /* @__PURE__ */ jsx3(
                    CollectionItem,
                    {
                      collection,
                      isSelected: selectedCollection() === collection.id,
                      onClick: () => handleCollectionSelect(collection.id)
                    }
                  ) })
                ] }),
                /* @__PURE__ */ jsx3(Show3, { when: props.collections.length === 0, children: /* @__PURE__ */ jsx3(
                  "div",
                  {
                    style: {
                      padding: `40px 20px`,
                      "text-align": `center`,
                      color: `#666`,
                      "font-style": `italic`
                    },
                    children: "No collections found. Create a collection to see it here."
                  }
                ) })
              ] }),
              /* @__PURE__ */ jsx3(Show3, { when: selectedView() === `transactions`, children: /* @__PURE__ */ jsx3(
                TransactionList,
                {
                  transactions: allTransactions(),
                  selectedTransaction: selectedTransaction(),
                  onTransactionSelect: handleTransactionSelect
                }
              ) })
            ] })
          ] }),
          /* @__PURE__ */ jsx3("div", { style: mainStyle, children: /* @__PURE__ */ jsx3(
            Show3,
            {
              when: selectedCollection(),
              fallback: /* @__PURE__ */ jsx3(
                Show3,
                {
                  when: selectedTransaction(),
                  fallback: /* @__PURE__ */ jsx3(
                    "div",
                    {
                      style: {
                        display: `flex`,
                        "align-items": `center`,
                        "justify-content": `center`,
                        flex: `1`,
                        color: `#666`,
                        "font-style": `italic`
                      },
                      children: selectedView() === `collections` ? `Select a collection to view details` : `Select a transaction to view details`
                    }
                  ),
                  children: /* @__PURE__ */ jsx3(
                    TransactionDetails,
                    {
                      transactionId: selectedTransaction(),
                      registry: props.registry
                    }
                  )
                }
              ),
              children: /* @__PURE__ */ jsx3(
                CollectionDetails,
                {
                  collectionId: selectedCollection(),
                  registry: props.registry
                }
              )
            }
          ) })
        ] })
      ] })
    }
  );
}
function CollectionItem(props) {
  const statusColor = () => {
    switch (props.collection.status) {
      case `ready`:
        return `#22c55e`;
      case `loading`:
        return `#eab308`;
      case `error`:
        return `#ef4444`;
      case `cleaned-up`:
        return `#6b7280`;
      default:
        return `#6b7280`;
    }
  };
  const statusIcon = () => {
    switch (props.collection.status) {
      case `ready`:
        return `\u2713`;
      case `loading`:
        return `\u27F3`;
      case `error`:
        return `\u26A0`;
      case `cleaned-up`:
        return `\u{1F5D1}`;
      default:
        return `\u25CB`;
    }
  };
  return /* @__PURE__ */ jsxs3(
    "div",
    {
      onClick: props.onClick,
      style: {
        padding: `12px 16px`,
        "border-bottom": `1px solid #333`,
        cursor: `pointer`,
        "background-color": props.isSelected ? `#0088ff20` : `transparent`,
        "border-left": props.isSelected ? `3px solid #0088ff` : `3px solid transparent`
      },
      children: [
        /* @__PURE__ */ jsxs3(
          "div",
          {
            style: {
              display: `flex`,
              "align-items": `center`,
              "justify-content": `space-between`,
              "margin-bottom": `4px`
            },
            children: [
              /* @__PURE__ */ jsxs3(
                "div",
                {
                  style: {
                    "font-weight": `500`,
                    "font-size": `14px`,
                    color: `#e1e1e1`
                  },
                  children: [
                    props.collection.type === `live-query` ? `\u{1F504}` : `\u{1F4C4}`,
                    ` `,
                    props.collection.id
                  ]
                }
              ),
              /* @__PURE__ */ jsx3(
                "div",
                {
                  style: {
                    display: `flex`,
                    "align-items": `center`,
                    gap: `4px`,
                    color: statusColor()
                  },
                  children: /* @__PURE__ */ jsx3("span", { style: { "font-size": `12px` }, children: statusIcon() })
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ jsxs3(
          "div",
          {
            style: {
              "font-size": `12px`,
              color: `#888`,
              display: `flex`,
              "justify-content": `space-between`
            },
            children: [
              /* @__PURE__ */ jsxs3("span", { children: [
                props.collection.size,
                " items"
              ] }),
              /* @__PURE__ */ jsx3(Show3, { when: props.collection.hasTransactions, children: /* @__PURE__ */ jsxs3("span", { children: [
                props.collection.transactionCount,
                " tx"
              ] }) })
            ]
          }
        ),
        /* @__PURE__ */ jsx3(
          Show3,
          {
            when: props.collection.timings && props.collection.type === `live-query`,
            children: /* @__PURE__ */ jsxs3(
              "div",
              {
                style: {
                  "font-size": `11px`,
                  color: `#666`,
                  "margin-top": `2px`
                },
                children: [
                  props.collection.timings.totalIncrementalRuns,
                  " runs",
                  /* @__PURE__ */ jsxs3(Show3, { when: props.collection.timings.averageIncrementalRunTime, children: [
                    ", avg ",
                    props.collection.timings.averageIncrementalRunTime,
                    "ms"
                  ] })
                ]
              }
            )
          }
        )
      ]
    }
  );
}
function TransactionDetails(props) {
  const transaction = () => props.registry.getTransaction(props.transactionId);
  return /* @__PURE__ */ jsx3("div", { style: { padding: `20px`, overflow: `auto` }, children: /* @__PURE__ */ jsx3(Show3, { when: transaction(), fallback: /* @__PURE__ */ jsx3("div", { children: "Transaction not found" }), children: (tx) => /* @__PURE__ */ jsxs3("div", { children: [
    /* @__PURE__ */ jsxs3("h2", { style: { margin: `0 0 16px 0`, "font-size": `18px` }, children: [
      "Transaction ",
      tx().id
    ] }),
    /* @__PURE__ */ jsxs3("div", { style: { "margin-bottom": `20px` }, children: [
      /* @__PURE__ */ jsxs3("div", { children: [
        /* @__PURE__ */ jsx3("strong", { children: "Collection:" }),
        " ",
        tx().collectionId
      ] }),
      /* @__PURE__ */ jsxs3("div", { children: [
        /* @__PURE__ */ jsx3("strong", { children: "State:" }),
        " ",
        tx().state
      ] }),
      /* @__PURE__ */ jsxs3("div", { children: [
        /* @__PURE__ */ jsx3("strong", { children: "Created:" }),
        " ",
        tx().createdAt.toLocaleString()
      ] }),
      /* @__PURE__ */ jsxs3("div", { children: [
        /* @__PURE__ */ jsx3("strong", { children: "Updated:" }),
        " ",
        tx().updatedAt.toLocaleString()
      ] }),
      /* @__PURE__ */ jsxs3("div", { children: [
        /* @__PURE__ */ jsx3("strong", { children: "Persisted:" }),
        " ",
        tx().isPersisted ? `Yes` : `No`
      ] })
    ] }),
    /* @__PURE__ */ jsxs3("h3", { children: [
      "Mutations (",
      tx().mutations.length,
      ")"
    ] }),
    /* @__PURE__ */ jsx3(For3, { each: tx().mutations, children: (mutation) => /* @__PURE__ */ jsxs3(
      "div",
      {
        style: {
          "margin-bottom": `12px`,
          padding: `12px`,
          "background-color": `#333`,
          "border-radius": `4px`
        },
        children: [
          /* @__PURE__ */ jsxs3("div", { children: [
            /* @__PURE__ */ jsx3("strong", { children: "Type:" }),
            " ",
            mutation.type
          ] }),
          /* @__PURE__ */ jsxs3("div", { children: [
            /* @__PURE__ */ jsx3("strong", { children: "Key:" }),
            " ",
            String(mutation.key)
          ] }),
          /* @__PURE__ */ jsxs3("div", { children: [
            /* @__PURE__ */ jsx3("strong", { children: "Optimistic:" }),
            ` `,
            mutation.optimistic ? `Yes` : `No`
          ] }),
          /* @__PURE__ */ jsx3(Show3, { when: mutation.changes, children: /* @__PURE__ */ jsxs3("details", { style: { "margin-top": `8px` }, children: [
            /* @__PURE__ */ jsx3("summary", { style: { cursor: `pointer` }, children: "Changes" }),
            /* @__PURE__ */ jsx3(
              "pre",
              {
                style: {
                  "margin-top": `8px`,
                  "background-color": `#222`,
                  padding: `8px`,
                  "border-radius": `4px`,
                  "font-size": `12px`,
                  overflow: `auto`
                },
                children: JSON.stringify(mutation.changes, null, 2)
              }
            )
          ] }) })
        ]
      }
    ) })
  ] }) }) });
}

// src/registry.ts
var DbDevtoolsRegistryImpl = class {
  // Poll every second for metadata updates
  constructor() {
    this.collections = /* @__PURE__ */ new Map();
    this.pollingInterval = null;
    this.POLLING_INTERVAL_MS = 1e3;
    this.registerCollection = (collection) => {
      const metadata = {
        id: collection.id,
        type: this.detectCollectionType(collection),
        status: collection.status,
        size: collection.size,
        hasTransactions: collection.transactions.size > 0,
        transactionCount: collection.transactions.size,
        createdAt: /* @__PURE__ */ new Date(),
        lastUpdated: /* @__PURE__ */ new Date(),
        gcTime: collection.config.gcTime,
        timings: this.isLiveQuery(collection) ? {
          totalIncrementalRuns: 0
        } : void 0
      };
      const entry = {
        weakRef: new WeakRef(collection),
        metadata,
        isActive: false
      };
      this.collections.set(collection.id, entry);
      if (this.isLiveQuery(collection)) {
        this.instrumentLiveQuery(collection, entry);
      }
    };
    this.unregisterCollection = (id) => {
      const entry = this.collections.get(id);
      if (entry) {
        entry.hardRef = void 0;
        entry.isActive = false;
        this.collections.delete(id);
      }
    };
    this.getCollectionMetadata = (id) => {
      const entry = this.collections.get(id);
      if (!entry) return void 0;
      const collection = entry.weakRef.deref();
      if (collection) {
        entry.metadata.status = collection.status;
        entry.metadata.size = collection.size;
        entry.metadata.hasTransactions = collection.transactions.size > 0;
        entry.metadata.transactionCount = collection.transactions.size;
        entry.metadata.lastUpdated = /* @__PURE__ */ new Date();
      }
      return { ...entry.metadata };
    };
    this.getAllCollectionMetadata = () => {
      const results = [];
      for (const [_id, entry] of this.collections) {
        const collection = entry.weakRef.deref();
        if (collection) {
          entry.metadata.status = collection.status;
          entry.metadata.size = collection.size;
          entry.metadata.hasTransactions = collection.transactions.size > 0;
          entry.metadata.transactionCount = collection.transactions.size;
          entry.metadata.lastUpdated = /* @__PURE__ */ new Date();
          results.push({ ...entry.metadata });
        } else {
          entry.metadata.status = `cleaned-up`;
          entry.metadata.lastUpdated = /* @__PURE__ */ new Date();
          results.push({ ...entry.metadata });
        }
      }
      return results;
    };
    this.getCollection = (id) => {
      const entry = this.collections.get(id);
      if (!entry) return void 0;
      const collection = entry.weakRef.deref();
      if (collection && !entry.isActive) {
        entry.hardRef = collection;
        entry.isActive = true;
      }
      return collection;
    };
    this.releaseCollection = (id) => {
      const entry = this.collections.get(id);
      if (entry && entry.isActive) {
        entry.hardRef = void 0;
        entry.isActive = false;
      }
    };
    this.getTransactions = (collectionId) => {
      const transactions = [];
      for (const [id, entry] of this.collections) {
        if (collectionId && id !== collectionId) continue;
        const collection = entry.weakRef.deref();
        if (!collection) continue;
        for (const [txId, transaction] of collection.transactions) {
          transactions.push({
            id: txId,
            collectionId: id,
            state: transaction.state,
            mutations: transaction.mutations.map((m) => ({
              id: m.mutationId,
              type: m.type,
              key: m.key,
              optimistic: m.optimistic,
              createdAt: m.createdAt,
              original: m.original,
              modified: m.modified,
              changes: m.changes
            })),
            createdAt: transaction.createdAt,
            updatedAt: transaction.updatedAt,
            isPersisted: transaction.state === `completed`
          });
        }
      }
      return transactions.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
    };
    this.getTransaction = (id) => {
      for (const [collectionId, entry] of this.collections) {
        const collection = entry.weakRef.deref();
        if (!collection) continue;
        const transaction = collection.transactions.get(id);
        if (transaction) {
          return {
            id,
            collectionId,
            state: transaction.state,
            mutations: transaction.mutations.map((m) => ({
              id: m.mutationId,
              type: m.type,
              key: m.key,
              optimistic: m.optimistic,
              createdAt: m.createdAt,
              original: m.original,
              modified: m.modified,
              changes: m.changes
            })),
            createdAt: transaction.createdAt,
            updatedAt: transaction.updatedAt,
            isPersisted: transaction.state === `completed`
          };
        }
      }
      return void 0;
    };
    this.cleanup = () => {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }
      for (const [_id, entry] of this.collections) {
        if (entry.isActive) {
          entry.hardRef = void 0;
          entry.isActive = false;
        }
      }
    };
    this.garbageCollect = () => {
      for (const [id, entry] of this.collections) {
        const collection = entry.weakRef.deref();
        if (!collection) {
          this.collections.delete(id);
        }
      }
    };
    this.startPolling = () => {
      if (this.pollingInterval) return;
      this.pollingInterval = window.setInterval(() => {
        this.garbageCollect();
        for (const [_id, entry] of this.collections) {
          if (!entry.isActive) continue;
          const collection = entry.weakRef.deref();
          if (collection) {
            entry.metadata.status = collection.status;
            entry.metadata.size = collection.size;
            entry.metadata.hasTransactions = collection.transactions.size > 0;
            entry.metadata.transactionCount = collection.transactions.size;
            entry.metadata.lastUpdated = /* @__PURE__ */ new Date();
          }
        }
      }, this.POLLING_INTERVAL_MS);
    };
    this.detectCollectionType = (collection) => {
      if (collection.config.__devtoolsType) {
        return collection.config.__devtoolsType;
      }
      if (collection.id.startsWith(`live-query-`)) {
        return `live-query`;
      }
      return `collection`;
    };
    this.isLiveQuery = (collection) => {
      return this.detectCollectionType(collection) === `live-query`;
    };
    this.instrumentLiveQuery = (collection, entry) => {
      if (!entry.metadata.timings) {
        entry.metadata.timings = {
          totalIncrementalRuns: 0
        };
      }
    };
    this.startPolling();
  }
};
function createDbDevtoolsRegistry() {
  return new DbDevtoolsRegistryImpl();
}
function initializeDevtoolsRegistry() {
  if (!window.__TANSTACK_DB_DEVTOOLS__) {
    window.__TANSTACK_DB_DEVTOOLS__ = createDbDevtoolsRegistry();
  }
  return window.__TANSTACK_DB_DEVTOOLS__;
}

// src/DbDevtools.tsx
import { Fragment, jsx as jsx4, jsxs as jsxs4 } from "solid-js/jsx-runtime";
function DbDevtools(props = {}) {
  const [isOpen, setIsOpen] = createSignal3(props.initialIsOpen ?? false);
  const [collections, setCollections] = createSignal3(
    []
  );
  const registry = props.registry || initializeDevtoolsRegistry();
  let intervalId;
  createEffect2(() => {
    const updateCollections = () => {
      const metadata = registry.getAllCollectionMetadata();
      setCollections(metadata);
    };
    updateCollections();
    intervalId = window.setInterval(updateCollections, 1e3);
    onCleanup2(() => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    });
  });
  const toggleOpen = () => {
    const newState = !isOpen();
    setIsOpen(newState);
    props.onPanelStateChange?.(newState);
  };
  createEffect2(() => {
    if (props.panelState) {
      setIsOpen(props.panelState === `open`);
    }
  });
  const position = props.position ?? `bottom-right`;
  return /* @__PURE__ */ jsxs4(Fragment, { children: [
    /* @__PURE__ */ jsx4(
      "div",
      {
        style: {
          position: position === `relative` ? `relative` : `fixed`,
          ...position.includes(`top`) ? { top: `12px` } : { bottom: `12px` },
          ...position.includes(`left`) ? { left: `12px` } : { right: `12px` },
          "z-index": 999999
        },
        children: /* @__PURE__ */ jsxs4(
          "button",
          {
            type: "button",
            onClick: toggleOpen,
            style: {
              display: `flex`,
              "align-items": `center`,
              "justify-content": `center`,
              "background-color": `#0088ff`,
              border: `none`,
              "border-radius": `8px`,
              padding: `8px 12px`,
              color: `white`,
              "font-family": `system-ui, sans-serif`,
              "font-size": `14px`,
              "font-weight": `600`,
              cursor: `pointer`,
              "box-shadow": `0 4px 12px rgba(0, 136, 255, 0.3)`,
              transition: `all 0.2s ease`,
              ...props.toggleButtonProps?.style
            },
            ...props.toggleButtonProps,
            children: [
              /* @__PURE__ */ jsx4("span", { style: { "margin-right": `8px` }, children: "\u{1F5C4}\uFE0F" }),
              "DB (",
              collections().length,
              ")"
            ]
          }
        )
      }
    ),
    isOpen() && /* @__PURE__ */ jsx4(
      DbDevtoolsPanel,
      {
        onClose: () => setIsOpen(false),
        collections: collections(),
        registry,
        ...props.panelProps
      }
    )
  ] });
}
var DbDevtools_default = DbDevtools;

export {
  __privateGet,
  __privateAdd,
  __privateSet,
  createDbDevtoolsRegistry,
  initializeDevtoolsRegistry,
  DbDevtoolsPanel,
  DbDevtools_default
};
//# sourceMappingURL=chunk-GSIQHJS4.js.map