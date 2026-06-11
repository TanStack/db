export type BrowserOPFSWorkerErrorCode =
  | `INVALID_CONFIG`
  | `PERSISTENCE_UNAVAILABLE`
  | `INTERNAL`

export type BrowserOPFSWorkerInitRequest = {
  type: `init`
  requestId: string
  databaseName: string
  vfsName: string
}

export type BrowserOPFSWorkerExecuteRequest = {
  type: `execute`
  requestId: string
  sql: string
  params: ReadonlyArray<unknown>
}

export type BrowserOPFSWorkerCloseRequest = {
  type: `close`
  requestId: string
}

export type BrowserOPFSWorkerRequest =
  | BrowserOPFSWorkerInitRequest
  | BrowserOPFSWorkerExecuteRequest
  | BrowserOPFSWorkerCloseRequest

export type BrowserOPFSWorkerSuccessResponse = {
  type: `response`
  requestId: string
  ok: true
  rows?: ReadonlyArray<Record<string, unknown>>
}

export type BrowserOPFSWorkerErrorResponse = {
  type: `response`
  requestId: string
  ok: false
  code: BrowserOPFSWorkerErrorCode
  error: string
}

export type BrowserOPFSWorkerResponse =
  | BrowserOPFSWorkerSuccessResponse
  | BrowserOPFSWorkerErrorResponse
