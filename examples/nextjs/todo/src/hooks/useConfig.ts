/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { useOptimisticMutation } from "@tanstack/react-db"
import { api } from "../lib/api"
import { collectionSync } from "../lib/collections"
import type { Collection, PendingMutation } from "@tanstack/react-db"
import type { UpdateConfig } from "../db/validation"

export const useConfig = (
  configData: Array<UpdateConfig>,
  configCollection: Collection<UpdateConfig>
) => {
  const createConfig = useOptimisticMutation({
    mutationFn: async ({ transaction }) => {
      const mutation = transaction.mutations[0] as PendingMutation<UpdateConfig>
      const { modified } = mutation
      const response = await api.config.create(modified)
      await collectionSync(mutation, response.txid)
    },
  })

  const updateConfig = useOptimisticMutation({
    mutationFn: async ({ transaction }) => {
      const mutation = transaction.mutations[0] as PendingMutation<UpdateConfig>
      const { original, changes } = mutation
      const response = await api.config.update(original.id as number, changes)
      await collectionSync(mutation, response.txid)
    },
  })

  // Helper function to get config values
  const getConfigValue = (key: string): string => {
    if (!configData) return ``
    for (const config of configData) {
      if (config.key === key) {
        return config.value!
      }
    }
    return ``
  }

  // Helper function to update config values
  const setConfigValue = (key: string, value: string): void => {
    for (const config of configData) {
      if (config.key === key) {
        updateConfig.mutate(() =>
          configCollection.update(
            Array.from(configCollection.state.values())[0],
            (draft) => {
              draft.value = value
            }
          )
        )
        return
      }
    }

    // If the config doesn't exist yet, create it
    createConfig.mutate(() =>
      configCollection.insert({
        key,
        value,
      })
    )
  }

  return {
    getConfigValue,
    setConfigValue,
  }
}
