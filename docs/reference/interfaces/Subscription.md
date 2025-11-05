---
id: Subscription
title: Subscription
---

# Interface: Subscription

Defined in: [packages/db/src/types.ts:201](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L201)

Public interface for a collection subscription
Used by sync implementations to track subscription lifecycle

## Extends

- `EventEmitter`\<[`SubscriptionEvents`](../../type-aliases/SubscriptionEvents.md)\>

## Properties

### status

```ts
readonly status: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:203](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L203)

Current status of the subscription

## Methods

### clearListeners()

```ts
protected clearListeners(): void;
```

Defined in: [packages/db/src/event-emitter.ts:115](https://github.com/TanStack/db/blob/main/packages/db/src/event-emitter.ts#L115)

Clear all listeners

#### Returns

`void`

#### Inherited from

```ts
EventEmitter.clearListeners
```

***

### emitInner()

```ts
protected emitInner<T>(event, eventPayload): void;
```

Defined in: [packages/db/src/event-emitter.ts:96](https://github.com/TanStack/db/blob/main/packages/db/src/event-emitter.ts#L96)

**`Internal`**

Emit an event to all listeners

#### Type Parameters

##### T

`T` *extends* keyof [`SubscriptionEvents`](../../type-aliases/SubscriptionEvents.md)

#### Parameters

##### event

`T`

Event name to emit

##### eventPayload

[`SubscriptionEvents`](../../type-aliases/SubscriptionEvents.md)\[`T`\]

Event payload
 For use by subclasses - subclasses should wrap this with a public emit if needed

#### Returns

`void`

#### Inherited from

```ts
EventEmitter.emitInner
```

***

### off()

```ts
off<T>(event, callback): void;
```

Defined in: [packages/db/src/event-emitter.ts:53](https://github.com/TanStack/db/blob/main/packages/db/src/event-emitter.ts#L53)

Unsubscribe from an event

#### Type Parameters

##### T

`T` *extends* keyof [`SubscriptionEvents`](../../type-aliases/SubscriptionEvents.md)

#### Parameters

##### event

`T`

Event name to stop listening for

##### callback

(`event`) => `void`

Function to remove

#### Returns

`void`

#### Inherited from

```ts
EventEmitter.off
```

***

### on()

```ts
on<T>(event, callback): () => void;
```

Defined in: [packages/db/src/event-emitter.ts:17](https://github.com/TanStack/db/blob/main/packages/db/src/event-emitter.ts#L17)

Subscribe to an event

#### Type Parameters

##### T

`T` *extends* keyof [`SubscriptionEvents`](../../type-aliases/SubscriptionEvents.md)

#### Parameters

##### event

`T`

Event name to listen for

##### callback

(`event`) => `void`

Function to call when event is emitted

#### Returns

Unsubscribe function

```ts
(): void;
```

##### Returns

`void`

#### Inherited from

```ts
EventEmitter.on
```

***

### once()

```ts
once<T>(event, callback): () => void;
```

Defined in: [packages/db/src/event-emitter.ts:37](https://github.com/TanStack/db/blob/main/packages/db/src/event-emitter.ts#L37)

Subscribe to an event once (automatically unsubscribes after first emission)

#### Type Parameters

##### T

`T` *extends* keyof [`SubscriptionEvents`](../../type-aliases/SubscriptionEvents.md)

#### Parameters

##### event

`T`

Event name to listen for

##### callback

(`event`) => `void`

Function to call when event is emitted

#### Returns

Unsubscribe function

```ts
(): void;
```

##### Returns

`void`

#### Inherited from

```ts
EventEmitter.once
```

***

### waitFor()

```ts
waitFor<T>(event, timeout?): Promise<SubscriptionEvents[T]>;
```

Defined in: [packages/db/src/event-emitter.ts:66](https://github.com/TanStack/db/blob/main/packages/db/src/event-emitter.ts#L66)

Wait for an event to be emitted

#### Type Parameters

##### T

`T` *extends* keyof [`SubscriptionEvents`](../../type-aliases/SubscriptionEvents.md)

#### Parameters

##### event

`T`

Event name to wait for

##### timeout?

`number`

Optional timeout in milliseconds

#### Returns

`Promise`\<[`SubscriptionEvents`](../../type-aliases/SubscriptionEvents.md)\[`T`\]\>

Promise that resolves with the event payload

#### Inherited from

```ts
EventEmitter.waitFor
```
