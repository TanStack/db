"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);

// src/registry.ts
function createDbDevtoolsRegistry() {
  return new DbDevtoolsRegistryImpl();
}
function initializeDevtoolsRegistry() {
  if (!window.__TANSTACK_DB_DEVTOOLS__) {
    window.__TANSTACK_DB_DEVTOOLS__ = createDbDevtoolsRegistry();
  }
  return window.__TANSTACK_DB_DEVTOOLS__;
}
var DbDevtoolsRegistryImpl;
var init_registry = __esm({
  "src/registry.ts"() {
    "use strict";
    DbDevtoolsRegistryImpl = class {
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
  }
});

// src/components/CollectionDetails.tsx
function CollectionDetails(props) {
  const [collectionData, setCollectionData] = (0, import_solid_js.createSignal)([]);
  const [isLoading, setIsLoading] = (0, import_solid_js.createSignal)(false);
  const [error, setError] = (0, import_solid_js.createSignal)(null);
  let unsubscribe;
  (0, import_solid_js.createEffect)(() => {
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
    (0, import_solid_js.onCleanup)(() => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = void 0;
      }
      props.registry.releaseCollection(collectionId);
    });
  });
  const metadata = () => props.registry.getCollectionMetadata(props.collectionId);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { padding: `20px`, overflow: `auto`, height: `100%` }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_solid_js.Show,
    {
      when: error(),
      fallback: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_solid_js.Show,
        {
          when: !isLoading(),
          fallback: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "div",
            {
              style: {
                display: `flex`,
                "align-items": `center`,
                "justify-content": `center`,
                height: `200px`
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: `#666` }, children: "Loading collection details..." })
            }
          ),
          children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
                        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
                          "Status: ",
                          metadata()?.status
                        ] }),
                        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u2022" }),
                        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
                          collectionData().length,
                          " items"
                        ] })
                      ]
                    }
                  )
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_solid_js.Show, { when: metadata(), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { "margin-bottom": `24px` }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                "div",
                {
                  style: {
                    display: `grid`,
                    "grid-template-columns": `repeat(auto-fit, minmax(200px, 1fr))`,
                    gap: `12px`,
                    "font-size": `14px`
                  },
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Type:" }),
                      " ",
                      metadata().type
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Created:" }),
                      ` `,
                      metadata().createdAt.toLocaleString()
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Last Updated:" }),
                      ` `,
                      metadata().lastUpdated.toLocaleString()
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "GC Time:" }),
                      ` `,
                      metadata().gcTime || `Default`,
                      "ms"
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_solid_js.Show, { when: metadata().hasTransactions, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Transactions:" }),
                      ` `,
                      metadata().transactionCount
                    ] }) })
                  ]
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                import_solid_js.Show,
                {
                  when: metadata().type === `live-query` && metadata().timings,
                  children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { "margin-top": `16px` }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
                    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                      "div",
                      {
                        style: {
                          display: `grid`,
                          "grid-template-columns": `repeat(auto-fit, minmax(200px, 1fr))`,
                          gap: `12px`,
                          "font-size": `14px`
                        },
                        children: [
                          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_solid_js.Show, { when: metadata().timings.initialRunTime, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Initial Run:" }),
                            ` `,
                            metadata().timings.initialRunTime,
                            "ms"
                          ] }) }),
                          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Total Runs:" }),
                            ` `,
                            metadata().timings.totalIncrementalRuns
                          ] }),
                          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                            import_solid_js.Show,
                            {
                              when: metadata().timings.averageIncrementalRunTime,
                              children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Avg Incremental:" }),
                                ` `,
                                metadata().timings.averageIncrementalRunTime,
                                "ms"
                              ] })
                            }
                          ),
                          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                            import_solid_js.Show,
                            {
                              when: metadata().timings.lastIncrementalRunTime,
                              children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "Last Run:" }),
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
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                import_solid_js.Show,
                {
                  when: collectionData().length === 0,
                  fallback: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "div",
                    {
                      style: {
                        "max-height": `400px`,
                        overflow: `auto`,
                        border: `1px solid #333`,
                        "border-radius": `4px`
                      },
                      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_solid_js.For, { each: collectionData(), children: (item, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        "div",
                        {
                          style: {
                            padding: `12px`,
                            "border-bottom": index() < collectionData().length - 1 ? `1px solid #333` : `none`,
                            "background-color": index() % 2 === 0 ? `#222` : `#1a1a1a`
                          },
                          children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [
                            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
                            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
                  children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
var import_solid_js, import_jsx_runtime;
var init_CollectionDetails = __esm({
  "src/components/CollectionDetails.tsx"() {
    "use strict";
    import_solid_js = require("solid-js");
    import_jsx_runtime = require("solid-js/jsx-runtime");
  }
});

// src/components/TransactionList.tsx
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
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { overflow: `auto`, height: `100%` }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
    import_solid_js2.Show,
    {
      when: props.transactions.length === 0,
      fallback: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_solid_js2.For, { each: props.transactions, children: (transaction) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
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
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
              "div",
              {
                style: {
                  display: `flex`,
                  "align-items": `center`,
                  "justify-content": `space-between`,
                  "margin-bottom": `4px`
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
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
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                    "div",
                    {
                      style: {
                        display: `flex`,
                        "align-items": `center`,
                        gap: `4px`,
                        color: getStateColor(transaction.state)
                      },
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { "font-size": `12px` }, children: getStateIcon(transaction.state) }),
                        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
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
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: transaction.collectionId }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
                    transaction.mutations.length,
                    " mutations"
                  ] })
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
      children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
var import_solid_js2, import_jsx_runtime2;
var init_TransactionList = __esm({
  "src/components/TransactionList.tsx"() {
    "use strict";
    import_solid_js2 = require("solid-js");
    import_jsx_runtime2 = require("solid-js/jsx-runtime");
  }
});

// src/DbDevtoolsPanel.tsx
function DbDevtoolsPanel(props) {
  const [selectedView, setSelectedView] = (0, import_solid_js3.createSignal)(`collections`);
  const [selectedCollection, setSelectedCollection] = (0, import_solid_js3.createSignal)(null);
  const [selectedTransaction, setSelectedTransaction] = (0, import_solid_js3.createSignal)(null);
  const liveQueries = (0, import_solid_js3.createMemo)(
    () => props.collections.filter((c) => c.type === `live-query`)
  );
  const regularCollections = (0, import_solid_js3.createMemo)(
    () => props.collections.filter((c) => c.type === `collection`)
  );
  const allTransactions = (0, import_solid_js3.createMemo)(() => props.registry.getTransactions());
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
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    "div",
    {
      style: panelStyle,
      onClick: (e) => e.target === e.currentTarget && props.onClose(),
      children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: contentStyle, onClick: (e) => e.stopPropagation(), children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: headerStyle, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "div",
            {
              style: { display: `flex`, "align-items": `center`, gap: `12px` },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { "font-size": `20px` }, children: "\u{1F5C4}\uFE0F" }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                  "h1",
                  {
                    style: { margin: `0`, "font-size": `18px`, "font-weight": `600` },
                    children: "TanStack DB Devtools"
                  }
                )
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: bodyStyle, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: sidebarStyle, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
              "div",
              {
                style: {
                  display: `flex`,
                  "border-bottom": `1px solid #333`,
                  "background-color": `#222`
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
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
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { flex: `1`, overflow: `auto` }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_solid_js3.Show, { when: selectedView() === `collections`, children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_solid_js3.Show, { when: liveQueries().length > 0, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { padding: `16px 0 8px 16px` }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
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
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_solid_js3.For, { each: liveQueries(), children: (collection) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                    CollectionItem,
                    {
                      collection,
                      isSelected: selectedCollection() === collection.id,
                      onClick: () => handleCollectionSelect(collection.id)
                    }
                  ) })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_solid_js3.Show, { when: regularCollections().length > 0, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { padding: `16px 0 8px 16px` }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
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
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_solid_js3.For, { each: regularCollections(), children: (collection) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                    CollectionItem,
                    {
                      collection,
                      isSelected: selectedCollection() === collection.id,
                      onClick: () => handleCollectionSelect(collection.id)
                    }
                  ) })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_solid_js3.Show, { when: props.collections.length === 0, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_solid_js3.Show, { when: selectedView() === `transactions`, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                TransactionList,
                {
                  transactions: allTransactions(),
                  selectedTransaction: selectedTransaction(),
                  onTransactionSelect: handleTransactionSelect
                }
              ) })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: mainStyle, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            import_solid_js3.Show,
            {
              when: selectedCollection(),
              fallback: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                import_solid_js3.Show,
                {
                  when: selectedTransaction(),
                  fallback: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
                  children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                    TransactionDetails,
                    {
                      transactionId: selectedTransaction(),
                      registry: props.registry
                    }
                  )
                }
              ),
              children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
          "div",
          {
            style: {
              display: `flex`,
              "align-items": `center`,
              "justify-content": `space-between`,
              "margin-bottom": `4px`
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
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
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "div",
                {
                  style: {
                    display: `flex`,
                    "align-items": `center`,
                    gap: `4px`,
                    color: statusColor()
                  },
                  children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { "font-size": `12px` }, children: statusIcon() })
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
          "div",
          {
            style: {
              "font-size": `12px`,
              color: `#888`,
              display: `flex`,
              "justify-content": `space-between`
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
                props.collection.size,
                " items"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_solid_js3.Show, { when: props.collection.hasTransactions, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
                props.collection.transactionCount,
                " tx"
              ] }) })
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          import_solid_js3.Show,
          {
            when: props.collection.timings && props.collection.type === `live-query`,
            children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
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
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_solid_js3.Show, { when: props.collection.timings.averageIncrementalRunTime, children: [
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
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { padding: `20px`, overflow: `auto` }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_solid_js3.Show, { when: transaction(), fallback: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { children: "Transaction not found" }), children: (tx) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("h2", { style: { margin: `0 0 16px 0`, "font-size": `18px` }, children: [
      "Transaction ",
      tx().id
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { "margin-bottom": `20px` }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "Collection:" }),
        " ",
        tx().collectionId
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "State:" }),
        " ",
        tx().state
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "Created:" }),
        " ",
        tx().createdAt.toLocaleString()
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "Updated:" }),
        " ",
        tx().updatedAt.toLocaleString()
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "Persisted:" }),
        " ",
        tx().isPersisted ? `Yes` : `No`
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("h3", { children: [
      "Mutations (",
      tx().mutations.length,
      ")"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_solid_js3.For, { each: tx().mutations, children: (mutation) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "div",
      {
        style: {
          "margin-bottom": `12px`,
          padding: `12px`,
          "background-color": `#333`,
          "border-radius": `4px`
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "Type:" }),
            " ",
            mutation.type
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "Key:" }),
            " ",
            String(mutation.key)
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "Optimistic:" }),
            ` `,
            mutation.optimistic ? `Yes` : `No`
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_solid_js3.Show, { when: mutation.changes, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { style: { "margin-top": `8px` }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { style: { cursor: `pointer` }, children: "Changes" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
var import_solid_js3, import_jsx_runtime3;
var init_DbDevtoolsPanel = __esm({
  "src/DbDevtoolsPanel.tsx"() {
    "use strict";
    import_solid_js3 = require("solid-js");
    init_CollectionDetails();
    init_TransactionList();
    import_jsx_runtime3 = require("solid-js/jsx-runtime");
  }
});

// src/DbDevtools.tsx
var DbDevtools_exports = {};
__export(DbDevtools_exports, {
  default: () => DbDevtools_default
});
function DbDevtools(props = {}) {
  const [isOpen, setIsOpen] = (0, import_solid_js4.createSignal)(props.initialIsOpen ?? false);
  const [collections, setCollections] = (0, import_solid_js4.createSignal)(
    []
  );
  const registry = props.registry || initializeDevtoolsRegistry();
  let intervalId;
  (0, import_solid_js4.createEffect)(() => {
    const updateCollections = () => {
      const metadata = registry.getAllCollectionMetadata();
      setCollections(metadata);
    };
    updateCollections();
    intervalId = window.setInterval(updateCollections, 1e3);
    (0, import_solid_js4.onCleanup)(() => {
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
  (0, import_solid_js4.createEffect)(() => {
    if (props.panelState) {
      setIsOpen(props.panelState === `open`);
    }
  });
  const position = props.position ?? `bottom-right`;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "div",
      {
        style: {
          position: position === `relative` ? `relative` : `fixed`,
          ...position.includes(`top`) ? { top: `12px` } : { bottom: `12px` },
          ...position.includes(`left`) ? { left: `12px` } : { right: `12px` },
          "z-index": 999999
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
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
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { "margin-right": `8px` }, children: "\u{1F5C4}\uFE0F" }),
              "DB (",
              collections().length,
              ")"
            ]
          }
        )
      }
    ),
    isOpen() && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
var import_solid_js4, import_jsx_runtime4, DbDevtools_default;
var init_DbDevtools = __esm({
  "src/DbDevtools.tsx"() {
    "use strict";
    import_solid_js4 = require("solid-js");
    init_DbDevtoolsPanel();
    init_registry();
    import_jsx_runtime4 = require("solid-js/jsx-runtime");
    DbDevtools_default = DbDevtools;
  }
});

// src/index.ts
var index_exports = {};
__export(index_exports, {
  BUTTON_POSITION: () => BUTTON_POSITION,
  DEFAULT_HEIGHT: () => DEFAULT_HEIGHT,
  DEFAULT_MUTATION_SORT_FN_NAME: () => DEFAULT_MUTATION_SORT_FN_NAME,
  DEFAULT_SORT_FN_NAME: () => DEFAULT_SORT_FN_NAME,
  DEFAULT_SORT_ORDER: () => DEFAULT_SORT_ORDER,
  DEFAULT_WIDTH: () => DEFAULT_WIDTH,
  DbDevtools: () => DbDevtools_default,
  DbDevtoolsPanel: () => DbDevtoolsPanel,
  INITIAL_IS_OPEN: () => INITIAL_IS_OPEN,
  POSITION: () => POSITION,
  TanstackDbDevtools: () => TanstackDbDevtools,
  createDbDevtoolsRegistry: () => createDbDevtoolsRegistry,
  firstBreakpoint: () => firstBreakpoint,
  initializeDevtoolsRegistry: () => initializeDevtoolsRegistry,
  isServer: () => isServer,
  secondBreakpoint: () => secondBreakpoint,
  thirdBreakpoint: () => thirdBreakpoint,
  tokens: () => tokens
});
module.exports = __toCommonJS(index_exports);

// src/theme.ts
var tokens = {
  colors: {
    inherit: "inherit",
    current: "currentColor",
    transparent: "transparent",
    black: "#000000",
    white: "#ffffff",
    neutral: {
      50: "#f9fafb",
      100: "#f2f4f7",
      200: "#eaecf0",
      300: "#d0d5dd",
      400: "#98a2b3",
      500: "#667085",
      600: "#475467",
      700: "#344054",
      800: "#1d2939",
      900: "#101828"
    },
    darkGray: {
      50: "#525c7a",
      100: "#49536e",
      200: "#414962",
      300: "#394056",
      400: "#313749",
      500: "#292e3d",
      600: "#212530",
      700: "#191c24",
      800: "#111318",
      900: "#0b0d10"
    },
    gray: {
      50: "#f9fafb",
      100: "#f2f4f7",
      200: "#eaecf0",
      300: "#d0d5dd",
      400: "#98a2b3",
      500: "#667085",
      600: "#475467",
      700: "#344054",
      800: "#1d2939",
      900: "#101828"
    },
    blue: {
      25: "#F5FAFF",
      50: "#EFF8FF",
      100: "#D1E9FF",
      200: "#B2DDFF",
      300: "#84CAFF",
      400: "#53B1FD",
      500: "#2E90FA",
      600: "#1570EF",
      700: "#175CD3",
      800: "#1849A9",
      900: "#194185"
    },
    green: {
      25: "#F6FEF9",
      50: "#ECFDF3",
      100: "#D1FADF",
      200: "#A6F4C5",
      300: "#6CE9A6",
      400: "#32D583",
      500: "#12B76A",
      600: "#039855",
      700: "#027A48",
      800: "#05603A",
      900: "#054F31"
    },
    red: {
      50: "#fef2f2",
      100: "#fee2e2",
      200: "#fecaca",
      300: "#fca5a5",
      400: "#f87171",
      500: "#ef4444",
      600: "#dc2626",
      700: "#b91c1c",
      800: "#991b1b",
      900: "#7f1d1d",
      950: "#450a0a"
    },
    yellow: {
      25: "#FFFCF5",
      50: "#FFFAEB",
      100: "#FEF0C7",
      200: "#FEDF89",
      300: "#FEC84B",
      400: "#FDB022",
      500: "#F79009",
      600: "#DC6803",
      700: "#B54708",
      800: "#93370D",
      900: "#7A2E0E"
    },
    purple: {
      25: "#FAFAFF",
      50: "#F4F3FF",
      100: "#EBE9FE",
      200: "#D9D6FE",
      300: "#BDB4FE",
      400: "#9B8AFB",
      500: "#7A5AF8",
      600: "#6938EF",
      700: "#5925DC",
      800: "#4A1FB8",
      900: "#3E1C96"
    },
    teal: {
      25: "#F6FEFC",
      50: "#F0FDF9",
      100: "#CCFBEF",
      200: "#99F6E0",
      300: "#5FE9D0",
      400: "#2ED3B7",
      500: "#15B79E",
      600: "#0E9384",
      700: "#107569",
      800: "#125D56",
      900: "#134E48"
    },
    pink: {
      25: "#fdf2f8",
      50: "#fce7f3",
      100: "#fbcfe8",
      200: "#f9a8d4",
      300: "#f472b6",
      400: "#ec4899",
      500: "#db2777",
      600: "#be185d",
      700: "#9d174d",
      800: "#831843",
      900: "#500724"
    },
    cyan: {
      25: "#ecfeff",
      50: "#cffafe",
      100: "#a5f3fc",
      200: "#67e8f9",
      300: "#22d3ee",
      400: "#06b6d4",
      500: "#0891b2",
      600: "#0e7490",
      700: "#155e75",
      800: "#164e63",
      900: "#083344"
    }
  },
  alpha: {
    100: "ff",
    90: "e5",
    80: "cc",
    70: "b3",
    60: "99",
    50: "80",
    40: "66",
    30: "4d",
    20: "33",
    10: "1a",
    0: "00"
  },
  font: {
    size: {
      "2xs": "calc(var(--tsdb-font-size) * 0.625)",
      xs: "calc(var(--tsdb-font-size) * 0.75)",
      sm: "calc(var(--tsdb-font-size) * 0.875)",
      md: "var(--tsdb-font-size)",
      lg: "calc(var(--tsdb-font-size) * 1.125)",
      xl: "calc(var(--tsdb-font-size) * 1.25)",
      "2xl": "calc(var(--tsdb-font-size) * 1.5)",
      "3xl": "calc(var(--tsdb-font-size) * 1.875)",
      "4xl": "calc(var(--tsdb-font-size) * 2.25)",
      "5xl": "calc(var(--tsdb-font-size) * 3)",
      "6xl": "calc(var(--tsdb-font-size) * 3.75)",
      "7xl": "calc(var(--tsdb-font-size) * 4.5)",
      "8xl": "calc(var(--tsdb-font-size) * 6)",
      "9xl": "calc(var(--tsdb-font-size) * 8)"
    },
    lineHeight: {
      xs: "calc(var(--tsdb-font-size) * 1)",
      sm: "calc(var(--tsdb-font-size) * 1.25)",
      md: "calc(var(--tsdb-font-size) * 1.5)",
      lg: "calc(var(--tsdb-font-size) * 1.75)",
      xl: "calc(var(--tsdb-font-size) * 2)",
      "2xl": "calc(var(--tsdb-font-size) * 2.25)",
      "3xl": "calc(var(--tsdb-font-size) * 2.5)",
      "4xl": "calc(var(--tsdb-font-size) * 2.75)",
      "5xl": "calc(var(--tsdb-font-size) * 3)",
      "6xl": "calc(var(--tsdb-font-size) * 3.25)",
      "7xl": "calc(var(--tsdb-font-size) * 3.5)",
      "8xl": "calc(var(--tsdb-font-size) * 3.75)",
      "9xl": "calc(var(--tsdb-font-size) * 4)"
    },
    weight: {
      thin: "100",
      extralight: "200",
      light: "300",
      normal: "400",
      medium: "500",
      semibold: "600",
      bold: "700",
      extrabold: "800",
      black: "900"
    }
  },
  breakpoints: {
    xs: "320px",
    sm: "640px",
    md: "768px",
    lg: "1024px",
    xl: "1280px",
    "2xl": "1536px"
  },
  border: {
    radius: {
      none: "0px",
      xs: "calc(var(--tsdb-font-size) * 0.125)",
      sm: "calc(var(--tsdb-font-size) * 0.25)",
      md: "calc(var(--tsdb-font-size) * 0.375)",
      lg: "calc(var(--tsdb-font-size) * 0.5)",
      xl: "calc(var(--tsdb-font-size) * 0.75)",
      "2xl": "calc(var(--tsdb-font-size) * 1)",
      "3xl": "calc(var(--tsdb-font-size) * 1.5)",
      full: "9999px"
    }
  },
  size: {
    0: "0px",
    0.25: "calc(var(--tsdb-font-size) * 0.0625)",
    0.5: "calc(var(--tsdb-font-size) * 0.125)",
    1: "calc(var(--tsdb-font-size) * 0.25)",
    1.5: "calc(var(--tsdb-font-size) * 0.375)",
    2: "calc(var(--tsdb-font-size) * 0.5)",
    2.5: "calc(var(--tsdb-font-size) * 0.625)",
    3: "calc(var(--tsdb-font-size) * 0.75)",
    3.5: "calc(var(--tsdb-font-size) * 0.875)",
    4: "calc(var(--tsdb-font-size) * 1)",
    4.5: "calc(var(--tsdb-font-size) * 1.125)",
    5: "calc(var(--tsdb-font-size) * 1.25)",
    5.5: "calc(var(--tsdb-font-size) * 1.375)",
    6: "calc(var(--tsdb-font-size) * 1.5)",
    6.5: "calc(var(--tsdb-font-size) * 1.625)",
    7: "calc(var(--tsdb-font-size) * 1.75)",
    8: "calc(var(--tsdb-font-size) * 2)",
    9: "calc(var(--tsdb-font-size) * 2.25)",
    10: "calc(var(--tsdb-font-size) * 2.5)",
    11: "calc(var(--tsdb-font-size) * 2.75)",
    12: "calc(var(--tsdb-font-size) * 3)",
    14: "calc(var(--tsdb-font-size) * 3.5)",
    16: "calc(var(--tsdb-font-size) * 4)",
    20: "calc(var(--tsdb-font-size) * 5)",
    24: "calc(var(--tsdb-font-size) * 6)",
    28: "calc(var(--tsdb-font-size) * 7)",
    32: "calc(var(--tsdb-font-size) * 8)",
    36: "calc(var(--tsdb-font-size) * 9)",
    40: "calc(var(--tsdb-font-size) * 10)",
    44: "calc(var(--tsdb-font-size) * 11)",
    48: "calc(var(--tsdb-font-size) * 12)",
    52: "calc(var(--tsdb-font-size) * 13)",
    56: "calc(var(--tsdb-font-size) * 14)",
    60: "calc(var(--tsdb-font-size) * 15)",
    64: "calc(var(--tsdb-font-size) * 16)",
    72: "calc(var(--tsdb-font-size) * 18)",
    80: "calc(var(--tsdb-font-size) * 20)",
    96: "calc(var(--tsdb-font-size) * 24)"
  },
  shadow: {
    xs: (_ = "rgb(0 0 0 / 0.1)") => `0 1px 2px 0 rgb(0 0 0 / 0.05)`,
    sm: (color = "rgb(0 0 0 / 0.1)") => `0 1px 3px 0 ${color}, 0 1px 2px -1px ${color}`,
    md: (color = "rgb(0 0 0 / 0.1)") => `0 4px 6px -1px ${color}, 0 2px 4px -2px ${color}`,
    lg: (color = "rgb(0 0 0 / 0.1)") => `0 10px 15px -3px ${color}, 0 4px 6px -4px ${color}`,
    xl: (color = "rgb(0 0 0 / 0.1)") => `0 20px 25px -5px ${color}, 0 8px 10px -6px ${color}`,
    "2xl": (color = "rgb(0 0 0 / 0.25)") => `0 25px 50px -12px ${color}`,
    inner: (color = "rgb(0 0 0 / 0.05)") => `inset 0 2px 4px 0 ${color}`,
    none: () => `none`
  },
  zIndices: {
    hide: -1,
    auto: "auto",
    base: 0,
    docked: 10,
    dropdown: 1e3,
    sticky: 1100,
    banner: 1200,
    overlay: 1300,
    modal: 1400,
    popover: 1500,
    skipLink: 1600,
    toast: 1700,
    tooltip: 1800
  }
};

// src/constants.ts
var DEFAULT_HEIGHT = 500;
var DEFAULT_WIDTH = 500;
var POSITION = "bottom-right";
var BUTTON_POSITION = "bottom-right";
var INITIAL_IS_OPEN = false;
var DEFAULT_SORT_ORDER = 1;
var DEFAULT_SORT_FN_NAME = "Status > Last Updated";
var DEFAULT_MUTATION_SORT_FN_NAME = "Status > Last Updated";
var firstBreakpoint = 1024;
var secondBreakpoint = 796;
var thirdBreakpoint = 700;
var isServer = typeof window === "undefined";

// src/index.ts
init_registry();

// src/TanstackDbDevtools.tsx
var import_web = require("solid-js/web");
var import_solid_js5 = require("solid-js");
init_registry();
var import_jsx_runtime5 = require("solid-js/jsx-runtime");
var _registry, _isMounted, _styleNonce, _shadowDOMTarget, _initialIsOpen, _position, _panelProps, _toggleButtonProps, _closeButtonProps, _storageKey, _panelState, _onPanelStateChange, _Component, _dispose;
var TanstackDbDevtools = class {
  constructor(config) {
    __privateAdd(this, _registry);
    __privateAdd(this, _isMounted, false);
    __privateAdd(this, _styleNonce);
    __privateAdd(this, _shadowDOMTarget);
    __privateAdd(this, _initialIsOpen);
    __privateAdd(this, _position);
    __privateAdd(this, _panelProps);
    __privateAdd(this, _toggleButtonProps);
    __privateAdd(this, _closeButtonProps);
    __privateAdd(this, _storageKey);
    __privateAdd(this, _panelState);
    __privateAdd(this, _onPanelStateChange);
    __privateAdd(this, _Component);
    __privateAdd(this, _dispose);
    const {
      initialIsOpen,
      position,
      panelProps,
      toggleButtonProps,
      closeButtonProps,
      storageKey,
      panelState,
      onPanelStateChange,
      styleNonce,
      shadowDOMTarget
    } = config;
    __privateSet(this, _registry, initializeDevtoolsRegistry());
    __privateSet(this, _styleNonce, styleNonce);
    __privateSet(this, _shadowDOMTarget, shadowDOMTarget);
    __privateSet(this, _initialIsOpen, (0, import_solid_js5.createSignal)(initialIsOpen));
    __privateSet(this, _position, (0, import_solid_js5.createSignal)(position));
    __privateSet(this, _panelProps, (0, import_solid_js5.createSignal)(panelProps));
    __privateSet(this, _toggleButtonProps, (0, import_solid_js5.createSignal)(toggleButtonProps));
    __privateSet(this, _closeButtonProps, (0, import_solid_js5.createSignal)(closeButtonProps));
    __privateSet(this, _storageKey, (0, import_solid_js5.createSignal)(storageKey));
    __privateSet(this, _panelState, (0, import_solid_js5.createSignal)(panelState));
    __privateSet(this, _onPanelStateChange, (0, import_solid_js5.createSignal)(onPanelStateChange));
  }
  setInitialIsOpen(isOpen) {
    __privateGet(this, _initialIsOpen)[1](isOpen);
  }
  setPosition(position) {
    __privateGet(this, _position)[1](position);
  }
  setPanelProps(props) {
    __privateGet(this, _panelProps)[1](props);
  }
  setToggleButtonProps(props) {
    __privateGet(this, _toggleButtonProps)[1](props);
  }
  setCloseButtonProps(props) {
    __privateGet(this, _closeButtonProps)[1](props);
  }
  setStorageKey(key) {
    __privateGet(this, _storageKey)[1](key);
  }
  setPanelState(state) {
    __privateGet(this, _panelState)[1](state);
  }
  setOnPanelStateChange(callback) {
    __privateGet(this, _onPanelStateChange)[1](() => callback);
  }
  mount(el) {
    if (__privateGet(this, _isMounted)) {
      throw new Error("DB Devtools is already mounted");
    }
    const dispose = (0, import_web.render)(() => {
      const [initialIsOpen] = __privateGet(this, _initialIsOpen);
      const [position] = __privateGet(this, _position);
      const [panelProps] = __privateGet(this, _panelProps);
      const [toggleButtonProps] = __privateGet(this, _toggleButtonProps);
      const [closeButtonProps] = __privateGet(this, _closeButtonProps);
      const [storageKey] = __privateGet(this, _storageKey);
      const [panelState] = __privateGet(this, _panelState);
      const [onPanelStateChange] = __privateGet(this, _onPanelStateChange);
      let DbDevtools2;
      if (__privateGet(this, _Component)) {
        DbDevtools2 = __privateGet(this, _Component);
      } else {
        DbDevtools2 = (0, import_solid_js5.lazy)(() => Promise.resolve().then(() => (init_DbDevtools(), DbDevtools_exports)));
        __privateSet(this, _Component, DbDevtools2);
      }
      return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        DbDevtools2,
        {
          registry: __privateGet(this, _registry),
          shadowDOMTarget: __privateGet(this, _shadowDOMTarget),
          ...{
            get initialIsOpen() {
              return initialIsOpen();
            },
            get position() {
              return position();
            },
            get panelProps() {
              return panelProps();
            },
            get toggleButtonProps() {
              return toggleButtonProps();
            },
            get closeButtonProps() {
              return closeButtonProps();
            },
            get storageKey() {
              return storageKey();
            },
            get panelState() {
              return panelState();
            },
            get onPanelStateChange() {
              return onPanelStateChange();
            }
          }
        }
      );
    }, el);
    __privateSet(this, _isMounted, true);
    __privateSet(this, _dispose, dispose);
  }
  unmount() {
    var _a;
    if (!__privateGet(this, _isMounted)) {
      throw new Error("DB Devtools is not mounted");
    }
    (_a = __privateGet(this, _dispose)) == null ? void 0 : _a.call(this);
    __privateSet(this, _isMounted, false);
  }
};
_registry = new WeakMap();
_isMounted = new WeakMap();
_styleNonce = new WeakMap();
_shadowDOMTarget = new WeakMap();
_initialIsOpen = new WeakMap();
_position = new WeakMap();
_panelProps = new WeakMap();
_toggleButtonProps = new WeakMap();
_closeButtonProps = new WeakMap();
_storageKey = new WeakMap();
_panelState = new WeakMap();
_onPanelStateChange = new WeakMap();
_Component = new WeakMap();
_dispose = new WeakMap();

// src/index.ts
init_DbDevtools();
init_DbDevtoolsPanel();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BUTTON_POSITION,
  DEFAULT_HEIGHT,
  DEFAULT_MUTATION_SORT_FN_NAME,
  DEFAULT_SORT_FN_NAME,
  DEFAULT_SORT_ORDER,
  DEFAULT_WIDTH,
  DbDevtools,
  DbDevtoolsPanel,
  INITIAL_IS_OPEN,
  POSITION,
  TanstackDbDevtools,
  createDbDevtoolsRegistry,
  firstBreakpoint,
  initializeDevtoolsRegistry,
  isServer,
  secondBreakpoint,
  thirdBreakpoint,
  tokens
});
//# sourceMappingURL=index.cjs.map