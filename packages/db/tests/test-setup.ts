import "@testing-library/jest-dom/vitest"

// Register BTreeIndex as default for test backwards compatibility
import { registerDefaultIndexType } from "../src/indexes/index-registry"
import { BTreeIndex } from "../src/indexes/btree-index"

registerDefaultIndexType(BTreeIndex)
