import { gt, upper } from "./functions"
import type { NamespacedRow } from "../../types"
import type { RefProxyForNamespaceRow, SelectObject } from "./types"

export function defineForRow<TNamespaceRow extends NamespacedRow>() {
  const callback = <TResult>(
    fn: (refs: RefProxyForNamespaceRow<TNamespaceRow>) => TResult
  ) => fn

  const select = <TSelectObject extends SelectObject>(
    fn: (refs: RefProxyForNamespaceRow<TNamespaceRow>) => TSelectObject
  ) => fn

  return {
    callback,
    select,
  }
}

/* ------ Examples ------ */

type User = {
  name: string
  age: number
}

// Can be used in where/having/groupBy, anything that has a callback returning an expression
export const userIsAdult = defineForRow<{ user: User }>().callback(({ user }) =>
  gt(user.age, 18)
)

// Can be used in select
export const userNameUpper = defineForRow<{ user: User }>().select(
  ({ user }) => ({
    name: upper(user.name),
  })
)
