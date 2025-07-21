// Query Collection Errors
export class QueryCollectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = `QueryCollectionError`
  }
}

export class QueryKeyRequiredError extends QueryCollectionError {
  constructor() {
    super(`[QueryCollection] queryKey must be provided.`)
  }
}

export class QueryFnRequiredError extends QueryCollectionError {
  constructor() {
    super(`[QueryCollection] queryFn must be provided.`)
  }
}

export class QueryClientRequiredError extends QueryCollectionError {
  constructor() {
    super(`[QueryCollection] queryClient must be provided.`)
  }
}

export class GetKeyRequiredError extends QueryCollectionError {
  constructor() {
    super(`[QueryCollection] getKey must be provided.`)
  }
}
