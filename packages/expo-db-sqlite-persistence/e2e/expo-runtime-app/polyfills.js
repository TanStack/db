function createPseudoRandomUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const randomNibble = Math.floor(Math.random() * 16)
    const value = char === 'x' ? randomNibble : (randomNibble & 0x3) | 0x8
    return value.toString(16)
  })
}

if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      randomUUID: createPseudoRandomUuid,
    },
  })
} else if (typeof globalThis.crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: createPseudoRandomUuid,
  })
}
