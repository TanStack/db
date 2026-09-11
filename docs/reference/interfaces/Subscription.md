---
id: Subscription
title: Subscription
---

# Interface: Subscription

Defined in: [packages/db/src/types.ts:269](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L269)

Public interface for a collection subscription
Used by sync implementations to track subscription lifecycle

## Extends

- `EventEmitter`\<[`SubscriptionEvents`](../type-aliases/SubscriptionEvents.md)\>

## Properties

### lastError

```ts
readonly lastError: unknown;
```

Defined in: [packages/db/src/types.ts:273](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L273)

Most recent subset-load failure observed by this subscription.

***

### status

```ts
readonly status: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:271](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L271)

Current status of the subscription

## Methods

### clearListeners()

```ts
protected clearListeners(): void;
```

Defined in: [packages/db/src/event-emitter.ts:156](https://github.com/TanStack/db/blob/main/packages/db/src/event-emitter.ts#L156)

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

Defined in: [packages/db/src/event-emitter.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/event-emitter.ts#L124)

**`Internal`**

Emit an event to all listeners

#### Type Parameters

##### T

`T` *extends* keyof [`SubscriptionEvents`](../type-aliases/SubscriptionEvents.md)

#### Parameters

##### event

`T`

Event name to emit

##### eventPayload

[`SubscriptionEvents`](../type-aliases/SubscriptionEvents.md)\[`T`\]

Event payload
 For use by subclasses - subclasses should wrap this with a public emit if needed

#### Returns

`void`

#### Inherited from

```ts
EventEmitter.emitInner
```

***

### emitInnerWhile()

```ts
protected emitInnerWhile<T>(
   event, 
   eventPayload, 
   isCurrent): void;
```

Defined in: [packages/db/src/event-emitter.ts:132](https://github.com/TanStack/db/blob/main/packages/db/src/event-emitter.ts#L132)

Emit until a reentrant callback invalidates the event being delivered.

#### Type Parameters

##### T

`T` *extends* keyof [`SubscriptionEvents`](../type-aliases/SubscriptionEvents.md)

#### Parameters

##### event

`T`

##### eventPayload

[`SubscriptionEvents`](../type-aliases/SubscriptionEvents.md)\[`T`\]

##### isCurrent

() => `boolean`

#### Returns

`void`

#### Inherited from

```ts
EventEmitter.emitInnerWhile
```

***

### off()

```ts
off<T>(event, callback): void;
```

Defined in: [packages/db/src/event-emitter.ts:72](https://github.com/TanStack/db/blob/main/packages/db/src/event-emitter.ts#L72)

Unsubscribe from an event

#### Type Parameters

##### T

`T` *extends* keyof [`SubscriptionEvents`](../type-aliases/SubscriptionEvents.md)

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

Defined in: [packages/db/src/event-emitter.ts:21](https://github.com/TanStack/db/blob/main/packages/db/src/event-emitter.ts#L21)

Subscribe to an event

#### Type Parameters

##### T

`T` *extends* keyof [`SubscriptionEvents`](../type-aliases/SubscriptionEvents.md)

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

Defined in: [packages/db/src/event-emitter.ts:50](https://github.com/TanStack/db/blob/main/packages/db/src/event-emitter.ts#L50)

Subscribe to an event once (automatically unsubscribes after first emission)

#### Type Parameters

##### T

`T` *extends* keyof [`SubscriptionEvents`](../type-aliases/SubscriptionEvents.md)

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

Defined in: [packages/db/src/event-emitter.ts:94](https://github.com/TanStack/db/blob/main/packages/db/src/event-emitter.ts#L94)

Wait for an event to be emitted

#### Type Parameters

##### T

`T` *extends* keyof [`SubscriptionEvents`](../type-aliases/SubscriptionEvents.md)

#### Parameters

##### event

`T`

Event name to wait for

##### timeout?

`number`

Optional timeout in milliseconds

#### Returns

`Promise`\<[`SubscriptionEvents`](../type-aliases/SubscriptionEvents.md)\[`T`\]\>

Promise that resolves with the event payload

#### Inherited from

```ts
EventEmitter.waitFor
```
