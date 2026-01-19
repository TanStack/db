# @tanstack/react-db

## 0.2.1

### Patch Changes

- Updated dependencies [[`6745ed0`](https://github.com/TanStack/db/commit/6745ed003dc25cfd6fa0f7e60f708205a6069ff2), [`1b22e40`](https://github.com/TanStack/db/commit/1b22e40c56323cfa5e7f759272fed53320aa32f7), [`7a2cacd`](https://github.com/TanStack/db/commit/7a2cacd7a426530cb77844a8c2680f6b06e9ce2f), [`bdf9405`](https://github.com/TanStack/db/commit/bdf94059e7ab98b5181e0df7d8d25cd1dbb5ae58)]:
  - @tanstack/db@0.5.21

## 0.2.0

### Minor Changes

- Update solid-db to enable suspense support. ([#826](https://github.com/TanStack/db/pull/826))
  You can now run do

  ```tsx
  // Use Suspense boundaries
  const todosQuery = useLiveQuery((q) => q.from({ todos: todoCollection }))

  return (
    <>
      {/* Status and other getters don't trigger Suspense */}
      <div>Status {todosQuery.status}</div>
      <div>Loading {todosQuery.isLoading ? 'yes' : 'no'}</div>

      <Suspense fallback={<div>Loading...</div>}>
        <For each={todosQuery()}>
          {(todo) => <li key={todo.id}>{todo.text}</li>}
        </For>
      </Suspense>
    </>
  )
  ```

  All values returned from useLiveQuery are now getters, so no longer need to be called as functions. This is a breaking change. This is to match how createResource works, and everything still stays reactive.

  ```tsx
  const todos = useLiveQuery(() => existingCollection)

  const handleToggle = (id) => {
    // Can now access collection directly
    todos.collection.update(id, (draft) => {
      draft.completed = !draft.completed
    })
  }

  return (
    <>
      {/* Status and other getters don't trigger Suspense */}
      <div>Status {todos.status}</div>
      <div>Loading {todos.isLoading ? 'yes' : 'no'}</div>
      <div>Ready {todos.isReady ? 'yes' : 'no'}</div>
      <div>Idle {todos.isIdle ? 'yes' : 'no'}</div>
      <div>Error {todos.isError ? 'yes' : 'no'}</div>
    </>
  )
  ```

### Patch Changes

- Updated dependencies []:
  - @tanstack/db@0.5.20

## 0.1.62

### Patch Changes

- Updated dependencies [[`29033b8`](https://github.com/TanStack/db/commit/29033b8f55b0ba5721371ad761037ec813440aa7), [`888ad6a`](https://github.com/TanStack/db/commit/888ad6afe5932b0467320c04fbd4583469cb9c47)]:
  - @tanstack/db@0.5.19

## 0.1.61

### Patch Changes

- Updated dependencies [[`c1247e8`](https://github.com/TanStack/db/commit/c1247e816950314da6d201613481577834c1d97a)]:
  - @tanstack/db@0.5.18

## 0.1.60

### Patch Changes

- Updated dependencies [[`f795a67`](https://github.com/TanStack/db/commit/f795a674f21659ef46ff370d4f3b9903a596bcaf), [`d542667`](https://github.com/TanStack/db/commit/d542667a3440415d8e6cbb449b20abd3cbd6855c), [`6503c09`](https://github.com/TanStack/db/commit/6503c091a259208331f471dca29abf086e881147), [`b1cc4a7`](https://github.com/TanStack/db/commit/b1cc4a7e018ffb6804ae7f1c99e9c6eb4bb22812)]:
  - @tanstack/db@0.5.17

## 0.1.59

### Patch Changes

- Updated dependencies [[`41308b8`](https://github.com/TanStack/db/commit/41308b8ee914aa467e22842cd454f06d1a60032e)]:
  - @tanstack/db@0.5.16

## 0.1.58

### Patch Changes

- Updated dependencies [[`32ec4d8`](https://github.com/TanStack/db/commit/32ec4d8478cca96f76f3a49efc259c95b85baa40)]:
  - @tanstack/db@0.5.15

## 0.1.57

### Patch Changes

- Updated dependencies [[`26ed0aa`](https://github.com/TanStack/db/commit/26ed0aad2def60e652508a99b2e980e73f70148e)]:
  - @tanstack/db@0.5.14

## 0.1.56

### Patch Changes

- Updated dependencies [[`8ed7725`](https://github.com/TanStack/db/commit/8ed7725514a6a501482a391162f7792aa8b371e5), [`01452bf`](https://github.com/TanStack/db/commit/01452bfd0d00da8bd52941a4954af73749473651)]:
  - @tanstack/db@0.5.13

## 0.1.55

### Patch Changes

- Updated dependencies [[`b3b1940`](https://github.com/TanStack/db/commit/b3b194000d8efcc2c6cc45a663029dadc26f13f0), [`09da081`](https://github.com/TanStack/db/commit/09da081b420fc915d7f0dc566c6cdbbc78582435), [`86ad40c`](https://github.com/TanStack/db/commit/86ad40c6bc37b2f5d4ad24d06f72168ca4b96161)]:
  - @tanstack/db@0.5.12

## 0.1.54

### Patch Changes

- Fixed `isReady` to return `true` for disabled queries in `useLiveQuery`/`injectLiveQuery` across all framework packages. When a query function returns `null` or `undefined` (disabling the query), there's no async operation to wait for, so the hook should be considered "ready" immediately. ([#886](https://github.com/TanStack/db/pull/886))

  Additionally, all frameworks now have proper TypeScript overloads that explicitly support returning `undefined | null` from query functions, making the disabled query pattern type-safe.

  This fixes the common pattern where users conditionally enable queries and don't want to show loading states when the query is disabled.

- Updated dependencies [[`c4b9399`](https://github.com/TanStack/db/commit/c4b93997432743d974749683059bf68a082d3e5b), [`a1a484e`](https://github.com/TanStack/db/commit/a1a484ec4d2331d702ab9c4b7e5b02622c76b3dd)]:
  - @tanstack/db@0.5.11

## 0.1.53

### Patch Changes

- Updated dependencies [[`1d19d22`](https://github.com/TanStack/db/commit/1d19d2219cbbaef6483845df1c3b078077e4e3bd), [`b3e4e80`](https://github.com/TanStack/db/commit/b3e4e80c4b73d96c15391ac25efb518c7ae7ccbb)]:
  - @tanstack/db@0.5.10

## 0.1.52

### Patch Changes

- Updated dependencies [[`5f474f1`](https://github.com/TanStack/db/commit/5f474f1eabd57e144ba05b0f33d848f7efc8fb07)]:
  - @tanstack/db@0.5.9

## 0.1.51

### Patch Changes

- Updated dependencies [[`954c8fe`](https://github.com/TanStack/db/commit/954c8fed5ed92a348ac8b6d8333bc69c955f4f60), [`51c73aa`](https://github.com/TanStack/db/commit/51c73aaa2b27b27966edb98fb6664beb44eac1ac)]:
  - @tanstack/db@0.5.8

## 0.1.50

### Patch Changes

- Updated dependencies [[`295cb45`](https://github.com/TanStack/db/commit/295cb45797572b232650eddd3d62ffa937fa2fd7)]:
  - @tanstack/db@0.5.7

## 0.1.49

### Patch Changes

- Updated dependencies [[`c8a2c16`](https://github.com/TanStack/db/commit/c8a2c16aa528427d5ddd55cda4ee59a5cb369b5f)]:
  - @tanstack/db@0.5.6

## 0.1.48

### Patch Changes

- Updated dependencies [[`077fc1a`](https://github.com/TanStack/db/commit/077fc1a418ca090d7533115888c09f3f609e36b2)]:
  - @tanstack/db@0.5.5

## 0.1.47

### Patch Changes

- Updated dependencies [[`acb3e4f`](https://github.com/TanStack/db/commit/acb3e4f1441e6872ca577e74d92ae2d77deb5938), [`464805d`](https://github.com/TanStack/db/commit/464805d96bad6d0fd741e48fbfc98e90dc58bebe), [`2c2e4db`](https://github.com/TanStack/db/commit/2c2e4dbd781d278347d73373f66d3c51c6388116), [`15c772f`](https://github.com/TanStack/db/commit/15c772f5e42e49000a2d775fd8e4cfda3418243f)]:
  - @tanstack/db@0.5.4

## 0.1.46

### Patch Changes

- Updated dependencies [[`846a830`](https://github.com/TanStack/db/commit/846a8309a243197245f4400a5d53cef5cec6d5d9), [`8e26dcf`](https://github.com/TanStack/db/commit/8e26dcfde600e4a18cd51fbe524560d60ab98d70)]:
  - @tanstack/db@0.5.3

## 0.1.45

### Patch Changes

- Updated dependencies [[`99a3716`](https://github.com/TanStack/db/commit/99a371630b9f4632db86c43357c64701ecb53b0e)]:
  - @tanstack/db@0.5.2

## 0.1.44

### Patch Changes

- Updated dependencies [[`a83a818`](https://github.com/TanStack/db/commit/a83a8189514d22ca2fcdf34b9cb97206d3c03c38)]:
  - @tanstack/db@0.5.1

## 0.1.43

### Patch Changes

- Updated dependencies [[`243a35a`](https://github.com/TanStack/db/commit/243a35a632ee0aca20c3ee12ee2ac2929d8be11d), [`f9d11fc`](https://github.com/TanStack/db/commit/f9d11fc3d7297c61feb3c6876cb2f436edbb5b34), [`7aedf12`](https://github.com/TanStack/db/commit/7aedf12996a67ef64010bca0d78d51c919dd384f), [`28f81b5`](https://github.com/TanStack/db/commit/28f81b5165d0a9566f99c2b6cf0ad09533e1a2cb), [`28f81b5`](https://github.com/TanStack/db/commit/28f81b5165d0a9566f99c2b6cf0ad09533e1a2cb), [`f6ac7ea`](https://github.com/TanStack/db/commit/f6ac7eac50ae1334ddb173786a68c9fc732848f9), [`01093a7`](https://github.com/TanStack/db/commit/01093a762cf2f5f308edec7f466d1c3dabb5ea9f)]:
  - @tanstack/db@0.5.0

## 0.1.42

### Patch Changes

- Updated dependencies [[`6c55e16`](https://github.com/TanStack/db/commit/6c55e16a2545b479b1d47f548b6846d362573d45), [`7805afb`](https://github.com/TanStack/db/commit/7805afb7286b680168b336e77dd4de7dd1b6f06a), [`1367756`](https://github.com/TanStack/db/commit/1367756d0a68447405c5f5c1a3cca30ab0558d74)]:
  - @tanstack/db@0.4.20

## 0.1.41

### Patch Changes

- Updated dependencies [[`75470a8`](https://github.com/TanStack/db/commit/75470a8297f316b4817601b2ea92cb9b21cc7829)]:
  - @tanstack/db@0.4.19

## 0.1.40

### Patch Changes

- Updated dependencies [[`f416231`](https://github.com/TanStack/db/commit/f41623180c862b58b4fa6415383dfdb034f84ee9), [`b1b8299`](https://github.com/TanStack/db/commit/b1b82994cb9765225129b5a19be06e9369e3158d)]:
  - @tanstack/db@0.4.18

## 0.1.39

### Patch Changes

- Updated dependencies [[`49bcaa5`](https://github.com/TanStack/db/commit/49bcaa5557ba8d647c947811ed6e0c2450159d84)]:
  - @tanstack/db@0.4.17

## 0.1.38

### Patch Changes

- Updated dependencies [[`979a66f`](https://github.com/TanStack/db/commit/979a66f2f6eff0ffe44dfde7c67feea933ee6110), [`f8a979b`](https://github.com/TanStack/db/commit/f8a979ba3aa90ac7e85f7a065fc050bda6589b4b), [`cb25623`](https://github.com/TanStack/db/commit/cb256234c9cd8df7771808b147e5afc2be56f51f)]:
  - @tanstack/db@0.4.16

## 0.1.37

### Patch Changes

- Updated dependencies [[`6738247`](https://github.com/TanStack/db/commit/673824791bcfae04acf42fc35e5d6d8755adceb2)]:
  - @tanstack/db@0.4.15

## 0.1.36

### Patch Changes

- Updated dependencies [[`970616b`](https://github.com/TanStack/db/commit/970616b6db723d1716eecd5076417de5d6e9a884)]:
  - @tanstack/db@0.4.14

## 0.1.35

### Patch Changes

- Updated dependencies [[`3c9526c`](https://github.com/TanStack/db/commit/3c9526cd1fd80032ddddff32cf4a23dfa8376888)]:
  - @tanstack/db@0.4.13

## 0.1.34

### Patch Changes

- Updated dependencies [[`8b29841`](https://github.com/TanStack/db/commit/8b298417964340bbac5ad08a831766f8f1497477), [`8187c6d`](https://github.com/TanStack/db/commit/8187c6d69c4b498e306ac2eb5fc7115e4f8193a5)]:
  - @tanstack/db@0.4.12

## 0.1.33

### Patch Changes

- Updated dependencies [[`5566b26`](https://github.com/TanStack/db/commit/5566b26100abdae9b4a041f048aeda1dd726e904)]:
  - @tanstack/db@0.4.11

## 0.1.32

### Patch Changes

- Updated dependencies [[`63aa8ef`](https://github.com/TanStack/db/commit/63aa8ef8b09960ce0f93e068d41b37fb0503a21a), [`b0687ab`](https://github.com/TanStack/db/commit/b0687ab4c1476362d7a25e3c1704ab0fb0385455)]:
  - @tanstack/db@0.4.10

## 0.1.31

### Patch Changes

- Updated dependencies [[`e52be92`](https://github.com/TanStack/db/commit/e52be92ce16b09a095b4b9baf7ac2cf708146f47), [`4a7c44a`](https://github.com/TanStack/db/commit/4a7c44a723223ade4e226745eadffead671fff13), [`ee61bb6`](https://github.com/TanStack/db/commit/ee61bb61f76ca510f113e96baa090940719aac40)]:
  - @tanstack/db@0.4.9

## 0.1.30

### Patch Changes

- Updated dependencies [[`d9ae7b7`](https://github.com/TanStack/db/commit/d9ae7b76b8ab30fd55fe835531974eee333dd450), [`44555b7`](https://github.com/TanStack/db/commit/44555b733a1a4d38d8126bf8da51d4b44f898298)]:
  - @tanstack/db@0.4.8

## 0.1.29

### Patch Changes

- Updated dependencies [[`6692aad`](https://github.com/TanStack/db/commit/6692aad4267e127b71ce595529080d6fc0aa2066)]:
  - @tanstack/db@0.4.7

## 0.1.28

### Patch Changes

- Updated dependencies [[`dd6cdf7`](https://github.com/TanStack/db/commit/dd6cdf7ea62d91bfb12ea8d25bdd25549259c113), [`c30a20b`](https://github.com/TanStack/db/commit/c30a20b1df39b34f18d0aa7c7b901a27fb963f36)]:
  - @tanstack/db@0.4.6

## 0.1.27

### Patch Changes

- Updated dependencies [[`7556fb6`](https://github.com/TanStack/db/commit/7556fb6f888b5bdc830fe6448eb3368efeb61988)]:
  - @tanstack/db@0.4.5

## 0.1.26

### Patch Changes

- Updated dependencies [[`56b870b`](https://github.com/TanStack/db/commit/56b870b3e63f8010b6eeebea87893b10c75a5888), [`f623990`](https://github.com/TanStack/db/commit/f62399062e4db61426ddfbbbe324c48cab2513dd), [`5f43d5f`](https://github.com/TanStack/db/commit/5f43d5f7f47614be8e71856ceb0f91733d9be627), [`05776f5`](https://github.com/TanStack/db/commit/05776f52a8ce4fe41b34fc8cace2046afc42835c), [`d27d32a`](https://github.com/TanStack/db/commit/d27d32aceb7f8fcabc07dcf1b55a84a605d2f23f)]:
  - @tanstack/db@0.4.4

## 0.1.25

### Patch Changes

- Updated dependencies [[`32f2212`](https://github.com/TanStack/db/commit/32f221278e2a684f3f4e1e2ace1ca98f5ecc858a)]:
  - @tanstack/db@0.4.3

## 0.1.24

### Patch Changes

- Updated dependencies [[`51c6bc5`](https://github.com/TanStack/db/commit/51c6bc58244ed6a3ac853e7e6af7775b33d6b65a), [`248e2c6`](https://github.com/TanStack/db/commit/248e2c6db8e9df8cf2cb225100e4ba9cb67cd534), [`ce7e2b2`](https://github.com/TanStack/db/commit/ce7e2b209ed882baa29ec86f89f1b527d6580e0b), [`1b832ff`](https://github.com/TanStack/db/commit/1b832ff9ec236e7dbe9256803e2ba12b4c9b9a30)]:
  - @tanstack/db@0.4.2

## 0.1.23

### Patch Changes

- Updated dependencies [[`8cd0876`](https://github.com/TanStack/db/commit/8cd0876b50bc7c1a614365318d5e74c2f32a0f80)]:
  - @tanstack/db@0.4.1

## 0.1.22

### Patch Changes

- Let collection.subscribeChanges return a subscription object. Move all data loading code related to optimizations into that subscription object. ([#564](https://github.com/TanStack/db/pull/564))

- Updated dependencies [[`2f87216`](https://github.com/TanStack/db/commit/2f8721630e06331ca8bb2f962fbb283341103a58), [`ac6250a`](https://github.com/TanStack/db/commit/ac6250a879e95718e8d911732c10fb3388569f0f), [`2f87216`](https://github.com/TanStack/db/commit/2f8721630e06331ca8bb2f962fbb283341103a58)]:
  - @tanstack/db@0.4.0

## 0.1.21

### Patch Changes

- Updated dependencies [[`cacfca2`](https://github.com/TanStack/db/commit/cacfca2d1b430c34a05202128fd3affa4bff54d6)]:
  - @tanstack/db@0.3.2

## 0.1.20

### Patch Changes

- Updated dependencies [[`5f51f35`](https://github.com/TanStack/db/commit/5f51f35d2c9543766a00cc5eea1374c62798b34e)]:
  - @tanstack/db@0.3.1

## 0.1.19

### Patch Changes

- Updated dependencies [[`c557a14`](https://github.com/TanStack/db/commit/c557a1488650ea9081b671a4ac278d55c59ac9cc), [`b5c87f7`](https://github.com/TanStack/db/commit/b5c87f71dbb534e4f1c660cf010e2cb6c0446ec5)]:
  - @tanstack/db@0.3.0

## 0.1.18

### Patch Changes

- Updated dependencies [[`b03894d`](https://github.com/TanStack/db/commit/b03894db05e063629a3660e03b31a80a48558dd5), [`3968087`](https://github.com/TanStack/db/commit/39680877fdc1993733933d2def13217bd18fa254)]:
  - @tanstack/db@0.2.5

## 0.1.17

### Patch Changes

- Updated dependencies [[`92febbf`](https://github.com/TanStack/db/commit/92febbf1feaa1d46f8cc4d7a4ea0d44cd5f85256), [`b487430`](https://github.com/TanStack/db/commit/b4874308813f95232f3361de539cec104ed55170)]:
  - @tanstack/db@0.2.4

## 0.1.16

### Patch Changes

- Updated dependencies [[`b162556`](https://github.com/TanStack/db/commit/b1625565df44b0824501297f7ef14ae1cd450b49)]:
  - @tanstack/db@0.2.3

## 0.1.15

### Patch Changes

- Updated dependencies [[`33515c6`](https://github.com/TanStack/db/commit/33515c69befc557add2cf828354ee378100f3977)]:
  - @tanstack/db@0.2.2

## 0.1.14

### Patch Changes

- Updated dependencies [[`620ebea`](https://github.com/TanStack/db/commit/620ebea96eb3fbeec66701b949de9920c4084c17)]:
  - @tanstack/db@0.2.1

## 0.1.13

### Patch Changes

- Updated dependencies [[`08303e6`](https://github.com/TanStack/db/commit/08303e645974db97e10b2aca0031abcbce027dd6), [`bafeaa1`](https://github.com/TanStack/db/commit/bafeaa1e9f161ac2200ce86537e442b2aa8e2a5b), [`1814f8c`](https://github.com/TanStack/db/commit/1814f8cc3c0e831c82f8053b86fbbbd737e4f34b), [`31acdf2`](https://github.com/TanStack/db/commit/31acdf2a96411da327f93f0d30fa78d884422969), [`e41ed7e`](https://github.com/TanStack/db/commit/e41ed7e1ff1d94dd3ce0c48b6321f66b8ea044fd), [`51954d8`](https://github.com/TanStack/db/commit/51954d8c5d64291d136159bce293e0ad00a19f88)]:
  - @tanstack/db@0.2.0

## 0.1.12

### Patch Changes

- Updated dependencies [[`cc4c34a`](https://github.com/TanStack/db/commit/cc4c34a6b40c81c83aa10c8d00dfc0a3d33c56db)]:
  - @tanstack/db@0.1.12

## 0.1.11

### Patch Changes

- Updated dependencies [[`b869f68`](https://github.com/TanStack/db/commit/b869f68f0109b3126509f202a38855cee38b4276)]:
  - @tanstack/db@0.1.11

## 0.1.10

### Patch Changes

- Updated dependencies [[`eb8fd18`](https://github.com/TanStack/db/commit/eb8fd18c50ee03b72cb06e4d7ef25f214367950b), [`e59a355`](https://github.com/TanStack/db/commit/e59a3551e75bac9dd166e14c911d9491e3a67b9a), [`074aab0`](https://github.com/TanStack/db/commit/074aab0477a7c55e9e0f19a705b96ed2619e2afb), [`d469c39`](https://github.com/TanStack/db/commit/d469c39a7bdc034fa4fbc533010573b3515f239f)]:
  - @tanstack/db@0.1.10

## 0.1.9

### Patch Changes

- Updated dependencies [[`d64b4a8`](https://github.com/TanStack/db/commit/d64b4a8b692a213c7ad58faaf66f5f5fd50bef66)]:
  - @tanstack/db@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies [[`1c5e206`](https://github.com/TanStack/db/commit/1c5e206d00d0a99f8419f0d00429b5a3c6cdc76e), [`4d20004`](https://github.com/TanStack/db/commit/4d2000488b9b5abf85c05801633297528af0eff6), [`968602e`](https://github.com/TanStack/db/commit/968602e4ffc597eaa559219daf22d6ef6321162a)]:
  - @tanstack/db@0.1.8

## 0.1.7

### Patch Changes

- Updated dependencies [[`48d0889`](https://github.com/TanStack/db/commit/48d088996a3f18df026aa7d2d1e7f27d1151345b), [`aecbcc3`](https://github.com/TanStack/db/commit/aecbcc32012561f1645df0bdf89a6c259058d888), [`a937f4c`](https://github.com/TanStack/db/commit/a937f4c7a5f4fc20c255e86692c5e2e80d5ebbec), [`3d60fad`](https://github.com/TanStack/db/commit/3d60fadbb9e8a1b62a9bcde947e282d653a2a270), [`79c95a3`](https://github.com/TanStack/db/commit/79c95a36f60087ffc3f9a02b76975c8bdf40acc7)]:
  - @tanstack/db@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [[`ad33e9e`](https://github.com/TanStack/db/commit/ad33e9e535ca6197c2e00e2dbb59bf8e8f9bb51e)]:
  - @tanstack/db@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [[`9a5a20c`](https://github.com/TanStack/db/commit/9a5a20c21fbf8286ab90e1db6d6f3315f8344a4e)]:
  - @tanstack/db@0.1.5

## 0.1.4

### Patch Changes

- Ensure that the ready status is correctly returned from a live query ([#390](https://github.com/TanStack/db/pull/390))

- Updated dependencies [[`c90b4d8`](https://github.com/TanStack/db/commit/c90b4d85822f94f7fe72286d5c7ee07b087d0e20), [`6c1c19c`](https://github.com/TanStack/db/commit/6c1c19cedbc1d9d98396948e8e43fa0515bb8919), [`69a6d2d`](https://github.com/TanStack/db/commit/69a6d2d94c7a5510568c8b652356c62bd2b3cc76), [`6250a92`](https://github.com/TanStack/db/commit/6250a92c8045ef2fd69c107a94e05179471681d7), [`68538b4`](https://github.com/TanStack/db/commit/68538b4c446abeb992e24964f811c8900749f141)]:
  - @tanstack/db@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [[`0cb7699`](https://github.com/TanStack/db/commit/0cb76999e5d6df5916694a5afeb31b928eab68e4)]:
  - @tanstack/db@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [[`bb5d50e`](https://github.com/TanStack/db/commit/bb5d50e255d9114ef32b8f52eef6b15399255327), [`97b595e`](https://github.com/TanStack/db/commit/97b595e9617b1abb05c14489e3d608b314da08e8)]:
  - @tanstack/db@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [[`bc2f204`](https://github.com/TanStack/db/commit/bc2f204b8cb8a4870ade00757d10f846524e2090), [`bda3f24`](https://github.com/TanStack/db/commit/bda3f24cc41504f60be0c5e071698b7735f75e28)]:
  - @tanstack/db@0.1.1

## 0.1.0

### Minor Changes

- 0.1 release - first beta 🎉 ([#332](https://github.com/TanStack/db/pull/332))

### Patch Changes

- We have moved development of the differential dataflow implementation from @electric-sql/d2mini to a new @tanstack/db-ivm package inside the tanstack db monorepo to make development simpler. ([#330](https://github.com/TanStack/db/pull/330))

- Updated dependencies [[`7d2f4be`](https://github.com/TanStack/db/commit/7d2f4be95c43aad29fb61e80e5a04c58c859322b), [`f0eda36`](https://github.com/TanStack/db/commit/f0eda36cb36350399bc8835686a6c4b6ad297e45)]:
  - @tanstack/db@0.1.0

## 0.0.29

### Patch Changes

- Updated dependencies [[`6e8d7f6`](https://github.com/TanStack/db/commit/6e8d7f660050118e050d575913733e469e3daa8c)]:
  - @tanstack/db@0.0.33

## 0.0.28

### Patch Changes

- Add initial version of solid-db integration TanStack DB with SolidJS ([#92](https://github.com/TanStack/db/pull/92))

## 0.0.27

- Add support for solid-js
