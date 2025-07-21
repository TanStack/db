import { TanStackDBError } from "@tanstack/db"

// Query Collection Errors
export class QueryCollectionError extends TanStackDBError {
  constructor(message: string) {
    super(message)
    this.name = `QueryCollectionError`
  }
}

export class QueryKeyRequiredError extends QueryCollectionError {
  constructor() {
    super(`[QueryCollection] queryKey must be provided.`)
    this.name = `QueryKeyRequiredError`
  }
}

export class QueryFnRequiredError extends QueryCollectionError {
  constructor() {
    super(`[QueryCollection] queryFn must be provided.`)
    this.name = `QueryFnRequiredError`
  }
}

export class QueryClientRequiredError extends QueryCollectionError {
  constructor() {
    super(`[QueryCollection] queryClient must be provided.`)
    this.name = `QueryClientRequiredError`
  }
}

export class GetKeyRequiredError extends QueryCollectionError {
  constructor() {
    super(`[QueryCollection] getKey must be provided.`)
    this.name = `GetKeyRequiredError`
  }
}
