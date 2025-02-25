import {
  ShapeStream,
  ShapeStreamOptions,
  Message,
  Row,
  ControlMessage,
  isChangeMessage,
  isControlMessage,
} from "@electric-sql/client"
import { SyncConfig } from "../types"

interface ElectricSyncConfig<T extends Row<unknown> = Row>
  extends ShapeStreamOptions<T> {
  id: string
}

function isUpToDateMessage<T extends Row<unknown> = Row>(
  message: Message<T>
): message is ControlMessage & { up_to_date: true } {
  return isControlMessage(message) && message.headers.control === `up-to-date`
}

export function createElectricSync<T extends Row<unknown> = Row>(
  config: Omit<ElectricSyncConfig<T>, `id`>
): SyncConfig {
  const { ...streamOptions } = config

  return {
    id: `electric`,
    sync: ({ begin, write, commit }) => {
      const stream = new ShapeStream(streamOptions)
      let transactionStarted = false

      stream.subscribe((messages: Message<T>[]) => {
        let hasUpToDate = false

        for (const message of messages) {
          if (isChangeMessage(message)) {
            if (!transactionStarted) {
              begin()
              transactionStarted = true
            }
            write({
              key: message.key,
              type: message.headers.operation,
              value: message.value,
            })
          } else if (isUpToDateMessage(message)) {
            hasUpToDate = true
          }
        }

        if (hasUpToDate && transactionStarted) {
          commit()
          transactionStarted = false
        }
      })
    },
  }
}
