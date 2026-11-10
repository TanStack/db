export function unfinishedBytes(u, len, enc) {
  switch (enc) {
    case 'utf-8': {
      // 0-3
      let p = 0
      while (p < 2 && p < len && (u[len - p - 1] & 0xc0) === 0x80) p++ // go back 0-2 trailing bytes
      if (p === len) return 0 // no space for lead
      const l = u[len - p - 1]
      if (l < 0xc2 || l > 0xf4) return 0 // not a lead
      if (p === 0) return 1 // nothing to recheck, we have only lead, return it. 2-byte must return here
      if (l < 0xe0 || (l < 0xf0 && p >= 2)) return 0 // 2-byte, or 3-byte or less and we already have 2 trailing
      const lower = l === 0xf0 ? 0x90 : l === 0xe0 ? 0xa0 : 0x80
      const upper = l === 0xf4 ? 0x8f : l === 0xed ? 0x9f : 0xbf
      const n = u[len - p]
      return n >= lower && n <= upper ? p + 1 : 0
    }

    case 'utf-16le':
    case 'utf-16be': {
      // 0-3
      let p = 0
      if (len % 2 !== 0) p++ // uneven bytes
      const l = len - p - 1
      if (len - p >= 2) {
        const last = enc === 'utf-16le' ? (u[l] << 8) ^ u[l - 1] : (u[l - 1] << 8) ^ u[l]
        if (last >= 0xd8_00 && last < 0xdc_00) p += 2 // lone lead
      }

      return p
    }
  }

  throw new Error('Unsupported encoding')
}
