import noDirectCollectionMutations from './no-direct-collection-mutations.js'

const tanstackArchitecturePlugin = {
  rules: {
    'no-direct-collection-mutations': noDirectCollectionMutations,
  },
}

export default tanstackArchitecturePlugin
