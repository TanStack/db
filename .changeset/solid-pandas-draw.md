---
"@tanstack/react-db": patch
"@tanstack/vue-db": patch
"@tanstack/db": patch
---

Add createOptimisticAction helper that replaces useOptimisticMutation

An example of converting a `useOptimisticMutation` hook to `createOptimisticAction`. Now all optimistic & server mutation logic are consolidated.

```diff
-import { useOptimisticMutation } from '@tanstack/react-db'
+import { createOptimisticAction } from '@tanstack/react-db'
+
+// Create the `addTodo` action, passing in your `mutationFn` and `onMutate`.
+const addTodo = createOptimisticAction<string>({
+  onMutate: (text) => {
+    // Instantly applies the local optimistic state.
+    todoCollection.insert({
+      id: uuid(),
+      text,
+      completed: false
+    })
+  },
+  mutationFn: async (text) => {
+    // Persist the todo to your backend
+    const response = await fetch('/api/todos', {
+      method: 'POST',
+      body: JSON.stringify({ text, completed: false }),
+    })
+    return response.json()
+  }
+})

 const Todo = () => {
-  // Create the `addTodo` mutator, passing in your `mutationFn`.
-  const addTodo = useOptimisticMutation({ mutationFn })
-
   const handleClick = () => {
-    // Triggers the mutationFn
-    addTodo.mutate(() =>
-      // Instantly applies the local optimistic state.
-      todoCollection.insert({
-        id: uuid(),
-        text: '🔥 Make app faster',
-        completed: false
-      })
-    )
+    // Triggers the onMutate and then the mutationFn
+    addTodo('🔥 Make app faster')
   }

   return <Button onClick={ handleClick } />
 }
```
