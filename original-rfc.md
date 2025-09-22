# Product Requirements Document: Offline-First Transactions

## Title
**Offline-First Transactions**

## Summary
Enable TanStack DB applications to persist failed transactions to storage and automatically retry them when connectivity is restored, ensuring no data loss during offline periods.

## Introduction

This Product Requirements Document defines the Offline-First Transactions feature for TanStack DB, which enables applications to persist failed transactions to storage and automatically retry them when connectivity is restored. The feature addresses a critical gap in TanStack DB's current capabilities, where network failures result in lost user data and require manual re-entry of operations. By implementing intelligent transaction persistence with parallel retry coordination, permanent failure discrimination, and developer control over the retry process, this feature enables TanStack DB to support offline-first applications across field service, productivity, and local-first domains. The solution delivers a complete offline transaction system in a single phase, providing developers with the tools to build resilient applications that maintain full functionality regardless of network conditions.

## Background

TanStack DB provides a reactive client store with collections, live queries, and optimistic mutations. When a transaction's mutation function fails today, the optimistic state is rolled back and the operation is lost. Users must manually retry the operation when connectivity returns.

Currently, TanStack DB has no built-in mechanism for:
- Persisting failed transactions across application restarts
- Automatically retrying operations when connectivity is restored
- Distinguishing between temporary failures (network issues) and permanent failures (validation errors)

Developers building offline-capable applications must choose between:
1. Accepting data loss when users work offline
2. Building custom persistence and retry logic outside of TanStack DB
3. Using alternative solutions designed for offline-first scenarios

The growing demand for offline-first applications spans multiple domains:
- Field service applications where workers collect data without reliable connectivity
- Personal productivity tools that must function seamlessly regardless of network state
- Collaborative applications using sync engines like Ditto that require local-first architectures

Without first-class offline support, TanStack DB cannot serve these use cases effectively.

## Problem

Developers using TanStack DB cannot build reliable offline-first applications without significant custom code. This creates three critical problems:

**1. Data Loss During Network Failures**
When a transaction's mutation function fails due to network issues, the optimistic updates are rolled back and the user's changes are lost. Users must remember and manually re-enter their data when connectivity returns, leading to frustration and potential data inconsistencies.

**2. No Persistence Across Application Restarts**
If the application closes while offline (browser tab closed, mobile app backgrounded, device restarted), any pending operations are permanently lost. There is no mechanism to queue and retry these operations when the application restarts with connectivity.

**3. Inability to Distinguish Failure Types**
All errors are treated identically - whether it's a temporary network failure that should be retried or a permanent validation error that will never succeed. This leads to either:
- Wasted resources retrying operations that will always fail
- Premature abandonment of operations that would succeed with retry

These problems make TanStack DB unsuitable for applications that require reliable offline operation, forcing developers to either accept data loss or build complex workarounds outside the framework.

## Personas

**Field Service Developer**
- Building applications for workers who collect data in areas with unreliable or no connectivity (construction sites, agricultural fields, remote locations)
- Problem: Workers lose hours of data entry when the app fails to sync, forcing them to re-enter information from paper notes or memory when they return to connectivity

**Productivity App Developer**
- Creating note-taking, task management, or personal knowledge management applications where users expect uninterrupted work
- Problem: Users lose writing, edits, or organizational changes when working on planes, subways, or areas with poor connectivity, breaking their workflow and trust in the application

**Local-First Application Developer**
- Building collaborative applications using sync engines like Ditto that operate on local-first principles
- Problem: Cannot use TanStack DB's reactive queries and collections because the lack of offline transaction support breaks the local-first architecture, forcing them to build custom state management

**Mobile App Developer**
- Developing mobile applications where network conditions are unpredictable and app lifecycle is outside their control
- Problem: When the OS suspends or terminates the app while offline, all pending user operations are lost with no way to recover them on next launch

## Requirements and Phases

### Phase 1: Complete Offline-First Transaction System

#### Requirements

**1. Transaction Persistence**
- Failed transactions must automatically persist to a storage adapter (localStorage, IndexedDB, or custom implementation)
- Persisted transactions must include all mutation data, metadata, and retry information
- Storage format must be serializable and recoverable across application restarts

**2. Automatic Retry with Intelligent Execution**
- On application initialization, developers must be able to explicitly trigger retry of persisted transactions
- Independent transactions (no overlapping collection keys) must execute in parallel for optimal performance
- Dependent transactions (overlapping collection keys) must execute sequentially to maintain consistency
- When any transaction succeeds, all pending transactions must immediately retry without waiting for the next retry interval

**3. Error Discrimination**
- Support `NonRetriableError` class to indicate permanent failures that should not be retried
- NonRetriableErrors must immediately remove the transaction from storage
- Regular errors must persist the transaction for retry with exponential backoff

**4. Developer Control**
- Provide `beforeRetry` hook allowing developers to filter or modify transactions before retry
- Enable inspection of transaction age, retry count, and error history
- Allow developers to programmatically remove transactions from the retry queue

**5. Infinite Retry with Exponential Backoff**
- Transactions must retry indefinitely until successful or explicitly marked as non-retriable
- Implement exponential backoff with jitter: 1s → 2s → 4s → 8s → 16s → 32s → 60s (max)
- Track retry count and last retry timestamp for each transaction

## Acceptance Criteria

### Transaction Persistence
- Given a transaction fails with a network error, the transaction data must be present in storage with key `offline-tx-${transactionId}`
- Given a transaction succeeds, any persisted data for that transaction must be removed from storage
- Given a transaction fails with NonRetriableError, no data must be persisted to storage
- Given an application restart, previously persisted transactions must be loadable from storage with all original mutation data intact

### Automatic Retry with Intelligent Execution
- Given 5 transactions modifying different items, when retried, all 5 must execute simultaneously
- Given 3 transactions modifying the same item, when retried, they must execute sequentially in creation order
- Given transaction A succeeds while B and C are pending, B and C must immediately begin retry without waiting for their scheduled retry time
- Given a mix of dependent and independent transactions, independent groups must execute in parallel while maintaining sequential order within each group

### Error Discrimination
- Given a mutation throws NonRetriableError, the transaction must not appear in storage after execution
- Given a mutation throws NonRetriableError with details, the error details must be accessible in the catch handler
- Given a mutation throws a regular Error, the transaction must be persisted with incremented retry count
- Given a NonRetriableError is thrown during retry, the transaction must be removed from storage and not retried again

### Developer Control
- Given a beforeRetry hook that filters transactions older than 24 hours, those transactions must not be retried
- Given a beforeRetry hook that returns an empty array, no transactions must be retried
- Given no beforeRetry hook, all persisted transactions must be retried
- Given a transaction removed by beforeRetry, it must remain in storage unless explicitly removed

### Infinite Retry with Exponential Backoff
- Given a transaction has failed once, it must wait at least 1 second before retry
- Given a transaction has failed 5 times, it must wait at least 16 seconds before retry  
- Given a transaction has failed 10 times, it must wait no more than 60 seconds before retry
- Given a transaction in storage, it must contain retryCount and lastRetryAt timestamp

## Considerations

### Storage Adapter Design
- Should the storage adapter interface be async-first to support IndexedDB and other async storage backends?
- How should storage key conflicts be handled if multiple TanStack DB instances exist in the same application?
- What happens if storage quota is exceeded while persisting transactions?
- Should there be a mechanism to migrate stored transactions if the serialization format changes in future versions?

### Collection Registry
- How should the collection registry handle dynamic collections that may not exist at retry time?
- What happens if a collection's mutation handlers change between persistence and retry?
- Should collections be automatically registered when created, or require explicit registration?

### Retry Coordination
- How should the system handle transactions that depend on external state not captured in the transaction?
- What happens if the application is closed during the middle of a parallel retry batch?
- Should there be a maximum number of concurrent retries to prevent overwhelming the server?

### Error Handling
- Should NonRetriableError be the only way to prevent retry, or should there be other mechanisms?
- How should the system handle storage corruption or deserialization failures?
- What telemetry or debugging information should be exposed for monitoring retry behavior?

### Integration with TanStack DB
- How should offline transactions interact with the existing optimistic update system?
- Should offline transactions respect the collection's `optimistic: false` option?
- How should the system handle conflicts between retried transactions and new user actions?

## User Research

### GitHub Issue #82: Offline-First Support

Multiple users have requested offline-first capabilities for TanStack DB, highlighting specific pain points and use cases:

**Common Themes from User Feedback:**

1. **Data Loss Prevention**
   - "Lost 2 hours of inventory counts when the warehouse wifi dropped"
   - "Users get frustrated when their changes disappear after network hiccups"
   - "Need reliable offline support for our field technicians"

2. **Explicit Retry Control**
   - "Want to check server state before replaying old transactions"
   - "Need ability to filter out stale operations that no longer make sense"
   - "Should be able to review what will be synced before it happens"

3. **Integration with Existing Sync Solutions**
   - "Using Ditto for sync but want TanStack DB's reactive queries"
   - "Building on Electric SQL, need offline transaction support"
   - "Have a custom sync engine but missing client-side transaction persistence"

4. **Performance Requirements**
   - "Syncing 100+ offline operations shouldn't freeze the UI"
   - "Need operations to sync as fast as possible when connection returns"
   - "Independent operations should sync in parallel, not one-by-one"

**Specific Use Cases Mentioned:**
- Field service applications for utilities and telecommunications
- Healthcare apps used in rural clinics with intermittent connectivity  
- Educational platforms used in areas with poor internet infrastructure
- Construction and inspection apps used on job sites
- Personal note-taking and productivity tools

The consistent message is that without first-class offline support, developers must either build complex workarounds or choose alternative solutions, limiting TanStack DB adoption for offline-first applications.
