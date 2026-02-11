---
id: isChangeMessage
title: isChangeMessage
---

# Function: isChangeMessage()

```ts
function isChangeMessage<T>(message): message is ChangeMessage<T>;
```

Defined in: node\_modules/.pnpm/@electric-sql+client@1.5.3/node\_modules/@electric-sql/client/dist/index.d.ts:884

Type guard for checking Message is ChangeMessage.

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

`message is ChangeMessage<T>`

true if the message is a ChangeMessage

## Example

```ts
if (isChangeMessage(message)) {
  const msgChng: ChangeMessage = message // Ok
  const msgCtrl: ControlMessage = message // Err, type mismatch
}
```
