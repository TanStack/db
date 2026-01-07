---
id: isControlMessage
title: isControlMessage
---

# Function: isControlMessage()

```ts
function isControlMessage<T>(message): message is ControlMessage;
```

Defined in: node\_modules/.pnpm/@electric-sql+client@1.3.0/node\_modules/@electric-sql/client/dist/index.d.ts:834

Type guard for checking Message is ControlMessage.

See [TS docs](https://www.typescriptlang.org/docs/handbook/advanced-types.html#user-defined-type-guards)
for information on how to use type guards.

## Type Parameters

### T

`T` *extends* `Row`\<`unknown`\> = `Row`\<`never`\>

## Parameters

### message

`Message`\<`T`\>

the message to check

## Returns

`message is ControlMessage`

true if the message is a ControlMessage

 *

## Example

```ts
if (isControlMessage(message)) {
  const msgChng: ChangeMessage = message // Err, type mismatch
  const msgCtrl: ControlMessage = message // Ok
}
```
