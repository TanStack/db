# @tanstack/powersync-db-collection

## 0.1.30

### Patch Changes

- Updated dependencies [[`85c373e`](https://github.com/TanStack/db/commit/85c373ef892e4080fe86b26e2fcb762181545e3c), [`9184dcc`](https://github.com/TanStack/db/commit/9184dcce62019ea870f968f4a4a5c2428291214d), [`83d5ac8`](https://github.com/TanStack/db/commit/83d5ac82983fb6c244c53d349c83845969473a9b)]:
  - @tanstack/db@0.5.26

## 0.1.29

### Patch Changes

- Updated dependencies [[`43c7c9d`](https://github.com/TanStack/db/commit/43c7c9d5f2b47366a58f87470ac5dca95020ac57), [`284ebcc`](https://github.com/TanStack/db/commit/284ebcc8346bd237c3381de766995b8bda35009a)]:
  - @tanstack/db@0.5.25

## 0.1.28

### Patch Changes

- Updated dependencies [[`7099459`](https://github.com/TanStack/db/commit/7099459291810b237a9fb24bbfe6e543852a2ab2)]:
  - @tanstack/db@0.5.24

## 0.1.27

### Patch Changes

- Updated dependencies [[`05130f2`](https://github.com/TanStack/db/commit/05130f2420eb682f11f099310a0af87afa3f35fe)]:
  - @tanstack/db@0.5.23

## 0.1.26

### Patch Changes

- Updated dependencies [[`f9b741e`](https://github.com/TanStack/db/commit/f9b741e9fb636be1c9f1502b7e28fe691bae2480)]:
  - @tanstack/db@0.5.22

## 0.1.25

### Patch Changes

- Updated dependencies [[`6745ed0`](https://github.com/TanStack/db/commit/6745ed003dc25cfd6fa0f7e60f708205a6069ff2), [`1b22e40`](https://github.com/TanStack/db/commit/1b22e40c56323cfa5e7f759272fed53320aa32f7), [`7a2cacd`](https://github.com/TanStack/db/commit/7a2cacd7a426530cb77844a8c2680f6b06e9ce2f), [`bdf9405`](https://github.com/TanStack/db/commit/bdf94059e7ab98b5181e0df7d8d25cd1dbb5ae58)]:
  - @tanstack/db@0.5.21

## 0.1.24

### Patch Changes

- Updated dependencies []:
  - @tanstack/db@0.5.20

## 0.1.23

### Patch Changes

- Updated dependencies [[`29033b8`](https://github.com/TanStack/db/commit/29033b8f55b0ba5721371ad761037ec813440aa7), [`888ad6a`](https://github.com/TanStack/db/commit/888ad6afe5932b0467320c04fbd4583469cb9c47)]:
  - @tanstack/db@0.5.19

## 0.1.22

### Patch Changes

- Updated dependencies [[`c1247e8`](https://github.com/TanStack/db/commit/c1247e816950314da6d201613481577834c1d97a)]:
  - @tanstack/db@0.5.18

## 0.1.21

### Patch Changes

- Added support for tracking collection operation metadata in PowerSync CrudEntry operations. ([#999](https://github.com/TanStack/db/pull/999))

  ```typescript
  // Schema config
  const APP_SCHEMA = new Schema({
    documents: new Table(
      {
        name: column.text,

        created_at: column.text,
      },
      {
        // Metadata tracking must be enabled on the PowerSync table
        trackMetadata: true,
      },
    ),
  })

  // ... Other config

  // Collection operations which specify metadata
  await collection.insert(
    {
      id,
      name: `document`,
    },
    // The string version of this will be present in PowerSync `CrudEntry`s during uploads
    {
      metadata: {
        extraInfo: 'Info',
      },
    },
  )
  ```

- Updated dependencies [[`f795a67`](https://github.com/TanStack/db/commit/f795a674f21659ef46ff370d4f3b9903a596bcaf), [`d542667`](https://github.com/TanStack/db/commit/d542667a3440415d8e6cbb449b20abd3cbd6855c), [`6503c09`](https://github.com/TanStack/db/commit/6503c091a259208331f471dca29abf086e881147), [`b1cc4a7`](https://github.com/TanStack/db/commit/b1cc4a7e018ffb6804ae7f1c99e9c6eb4bb22812)]:
  - @tanstack/db@0.5.17

## 0.1.20

### Patch Changes

- Updated dependencies [[`41308b8`](https://github.com/TanStack/db/commit/41308b8ee914aa467e22842cd454f06d1a60032e)]:
  - @tanstack/db@0.5.16

## 0.1.19

### Patch Changes

- Updated dependencies [[`32ec4d8`](https://github.com/TanStack/db/commit/32ec4d8478cca96f76f3a49efc259c95b85baa40)]:
  - @tanstack/db@0.5.15

## 0.1.18

### Patch Changes

- Updated dependencies [[`26ed0aa`](https://github.com/TanStack/db/commit/26ed0aad2def60e652508a99b2e980e73f70148e)]:
  - @tanstack/db@0.5.14

## 0.1.17

### Patch Changes

- Updated dependencies [[`8ed7725`](https://github.com/TanStack/db/commit/8ed7725514a6a501482a391162f7792aa8b371e5), [`01452bf`](https://github.com/TanStack/db/commit/01452bfd0d00da8bd52941a4954af73749473651)]:
  - @tanstack/db@0.5.13

## 0.1.16

### Patch Changes

- Updated dependencies [[`b3b1940`](https://github.com/TanStack/db/commit/b3b194000d8efcc2c6cc45a663029dadc26f13f0), [`09da081`](https://github.com/TanStack/db/commit/09da081b420fc915d7f0dc566c6cdbbc78582435), [`86ad40c`](https://github.com/TanStack/db/commit/86ad40c6bc37b2f5d4ad24d06f72168ca4b96161)]:
  - @tanstack/db@0.5.12

## 0.1.15

### Patch Changes

- Updated dependencies [[`c4b9399`](https://github.com/TanStack/db/commit/c4b93997432743d974749683059bf68a082d3e5b), [`a1a484e`](https://github.com/TanStack/db/commit/a1a484ec4d2331d702ab9c4b7e5b02622c76b3dd)]:
  - @tanstack/db@0.5.11

## 0.1.14

### Patch Changes

- Updated dependencies [[`1d19d22`](https://github.com/TanStack/db/commit/1d19d2219cbbaef6483845df1c3b078077e4e3bd), [`b3e4e80`](https://github.com/TanStack/db/commit/b3e4e80c4b73d96c15391ac25efb518c7ae7ccbb)]:
  - @tanstack/db@0.5.10

## 0.1.13

### Patch Changes

- Updated dependencies [[`5f474f1`](https://github.com/TanStack/db/commit/5f474f1eabd57e144ba05b0f33d848f7efc8fb07)]:
  - @tanstack/db@0.5.9

## 0.1.12

### Patch Changes

- Updated dependencies [[`954c8fe`](https://github.com/TanStack/db/commit/954c8fed5ed92a348ac8b6d8333bc69c955f4f60), [`51c73aa`](https://github.com/TanStack/db/commit/51c73aaa2b27b27966edb98fb6664beb44eac1ac)]:
  - @tanstack/db@0.5.8

## 0.1.11

### Patch Changes

- Updated dependencies [[`295cb45`](https://github.com/TanStack/db/commit/295cb45797572b232650eddd3d62ffa937fa2fd7)]:
  - @tanstack/db@0.5.7

## 0.1.10

### Patch Changes

- Updated dependencies [[`c8a2c16`](https://github.com/TanStack/db/commit/c8a2c16aa528427d5ddd55cda4ee59a5cb369b5f)]:
  - @tanstack/db@0.5.6

## 0.1.9

### Patch Changes

- Updated dependencies [[`077fc1a`](https://github.com/TanStack/db/commit/077fc1a418ca090d7533115888c09f3f609e36b2)]:
  - @tanstack/db@0.5.5

## 0.1.8

### Patch Changes

- Updated dependencies [[`acb3e4f`](https://github.com/TanStack/db/commit/acb3e4f1441e6872ca577e74d92ae2d77deb5938), [`464805d`](https://github.com/TanStack/db/commit/464805d96bad6d0fd741e48fbfc98e90dc58bebe), [`2c2e4db`](https://github.com/TanStack/db/commit/2c2e4dbd781d278347d73373f66d3c51c6388116), [`15c772f`](https://github.com/TanStack/db/commit/15c772f5e42e49000a2d775fd8e4cfda3418243f)]:
  - @tanstack/db@0.5.4

## 0.1.7

### Patch Changes

- Updated dependencies [[`846a830`](https://github.com/TanStack/db/commit/846a8309a243197245f4400a5d53cef5cec6d5d9), [`8e26dcf`](https://github.com/TanStack/db/commit/8e26dcfde600e4a18cd51fbe524560d60ab98d70)]:
  - @tanstack/db@0.5.3

## 0.1.6

### Patch Changes

- Updated dependencies [[`99a3716`](https://github.com/TanStack/db/commit/99a371630b9f4632db86c43357c64701ecb53b0e)]:
  - @tanstack/db@0.5.2

## 0.1.5

### Patch Changes

- Updated dependencies [[`a83a818`](https://github.com/TanStack/db/commit/a83a8189514d22ca2fcdf34b9cb97206d3c03c38)]:
  - @tanstack/db@0.5.1

## 0.1.4

### Patch Changes

- Updated dependencies [[`243a35a`](https://github.com/TanStack/db/commit/243a35a632ee0aca20c3ee12ee2ac2929d8be11d), [`f9d11fc`](https://github.com/TanStack/db/commit/f9d11fc3d7297c61feb3c6876cb2f436edbb5b34), [`7aedf12`](https://github.com/TanStack/db/commit/7aedf12996a67ef64010bca0d78d51c919dd384f), [`28f81b5`](https://github.com/TanStack/db/commit/28f81b5165d0a9566f99c2b6cf0ad09533e1a2cb), [`28f81b5`](https://github.com/TanStack/db/commit/28f81b5165d0a9566f99c2b6cf0ad09533e1a2cb), [`f6ac7ea`](https://github.com/TanStack/db/commit/f6ac7eac50ae1334ddb173786a68c9fc732848f9), [`01093a7`](https://github.com/TanStack/db/commit/01093a762cf2f5f308edec7f466d1c3dabb5ea9f)]:
  - @tanstack/db@0.5.0

## 0.1.3

### Patch Changes

- Updated dependencies [[`6c55e16`](https://github.com/TanStack/db/commit/6c55e16a2545b479b1d47f548b6846d362573d45), [`7805afb`](https://github.com/TanStack/db/commit/7805afb7286b680168b336e77dd4de7dd1b6f06a), [`1367756`](https://github.com/TanStack/db/commit/1367756d0a68447405c5f5c1a3cca30ab0558d74)]:
  - @tanstack/db@0.4.20

## 0.1.2

### Patch Changes

- Updated dependencies [[`75470a8`](https://github.com/TanStack/db/commit/75470a8297f316b4817601b2ea92cb9b21cc7829)]:
  - @tanstack/db@0.4.19

## 0.1.1

### Patch Changes

- Updated dependencies [[`f416231`](https://github.com/TanStack/db/commit/f41623180c862b58b4fa6415383dfdb034f84ee9), [`b1b8299`](https://github.com/TanStack/db/commit/b1b82994cb9765225129b5a19be06e9369e3158d)]:
  - @tanstack/db@0.4.18

## 0.1.0

### Minor Changes

- Initial Release ([#747](https://github.com/TanStack/db/pull/747))

### Patch Changes

- Updated dependencies [[`49bcaa5`](https://github.com/TanStack/db/commit/49bcaa5557ba8d647c947811ed6e0c2450159d84)]:
  - @tanstack/db@0.4.17
