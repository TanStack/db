import type { ElectricMessage } from '../types'

/**
 * Streaming JSON encoder for Electric-style records
 * Encodes messages as newline-delimited JSON
 */
export class ElectricStreamEncoder {
  private encoder = new TextEncoder()

  /**
   * Encode a single Electric message to JSON
   * @param message The message to encode
   * @returns JSON string with newline
   */
  encodeMessage(message: ElectricMessage): string {
    return JSON.stringify(message) + '\n'
  }

  /**
   * Encode an up-to-date control message
   * @returns JSON string with newline
   */
  encodeUpToDate(): string {
    return this.encodeMessage({
      headers: { control: 'up-to-date' }
    })
  }

  /**
   * Encode an insert operation
   * @param pk Primary key
   * @param value Row data
   * @param lsn Logical sequence number
   * @param opPosition Operation position
   * @returns JSON string with newline
   */
  encodeInsert(pk: string, value: Record<string, any>, lsn?: string, opPosition?: string): string {
    const headers: any = { operation: 'insert' }
    if (lsn) headers.lsn = lsn
    if (opPosition) headers.op_position = opPosition

    return this.encodeMessage({
      headers,
      key: pk,
      value
    })
  }

  /**
   * Encode an update operation
   * @param pk Primary key
   * @param value Changed values
   * @param oldValue Previous values (optional)
   * @param lsn Logical sequence number
   * @param opPosition Operation position
   * @returns JSON string with newline
   */
  encodeUpdate(
    pk: string, 
    value: Record<string, any>, 
    oldValue?: Record<string, any>,
    lsn?: string, 
    opPosition?: string
  ): string {
    const headers: any = { operation: 'update' }
    if (lsn) headers.lsn = lsn
    if (opPosition) headers.op_position = opPosition

    const message: ElectricMessage = {
      headers,
      key: pk,
      value
    }

    if (oldValue) {
      message.old_value = oldValue
    }

    return this.encodeMessage(message)
  }

  /**
   * Encode a delete operation
   * @param pk Primary key
   * @param value Full row data (for full replica mode)
   * @param lsn Logical sequence number
   * @param opPosition Operation position
   * @returns JSON string with newline
   */
  encodeDelete(pk: string, value?: Record<string, any>, lsn?: string, opPosition?: string): string {
    const headers: any = { operation: 'delete' }
    if (lsn) headers.lsn = lsn
    if (opPosition) headers.op_position = opPosition

    const message: ElectricMessage = {
      headers,
      key: pk
    }

    if (value) {
      message.value = value
    }

    return this.encodeMessage(message)
  }

  /**
   * Encode a must-refetch control message
   * @returns JSON string with newline
   */
  encodeMustRefetch(): string {
    return this.encodeMessage({
      headers: { control: 'must-refetch' }
    })
  }

  /**
   * Convert a JSON string to Uint8Array for streaming
   * @param jsonString The JSON string to convert
   * @returns Uint8Array
   */
  toUint8Array(jsonString: string): Uint8Array {
    return this.encoder.encode(jsonString)
  }

  /**
   * Encode a message and convert to Uint8Array
   * @param message The message to encode
   * @returns Uint8Array
   */
  encodeMessageToBytes(message: ElectricMessage): Uint8Array {
    return this.toUint8Array(this.encodeMessage(message))
  }
}