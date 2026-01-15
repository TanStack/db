// Polyfill for crypto.randomUUID() which is not available in React Native Hermes
if (typeof global.crypto === 'undefined') {
  global.crypto = {} as Crypto
}

if (typeof global.crypto.randomUUID !== 'function') {
  global.crypto.randomUUID = function randomUUID(): `${string}-${string}-${string}-${string}-${string}` {
    // Simple UUID v4 implementation
    const hex = '0123456789abcdef'
    let uuid = ''
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) {
        uuid += '-'
      } else if (i === 14) {
        uuid += '4' // Version 4
      } else if (i === 19) {
        uuid += hex[(Math.random() * 4) | 8] // Variant bits
      } else {
        uuid += hex[(Math.random() * 16) | 0]
      }
    }
    return uuid as `${string}-${string}-${string}-${string}-${string}`
  }
}
