import { describe, it, expect } from 'vitest'
import {
  parseOffset,
  formatOffset,
  compareOffsets,
  headOffset,
  isValidOffset
} from '../../src/core/offsets'

describe('offsets', () => {
  describe('parseOffset', () => {
    it('should parse -1 correctly', () => {
      expect(parseOffset('-1')).toBe(-1)
    })

    it('should parse valid version offsets', () => {
      expect(parseOffset('0_0')).toBe(0)
      expect(parseOffset('123_0')).toBe(123)
      expect(parseOffset('999999_0')).toBe(999999)
    })

    it('should reject invalid formats', () => {
      expect(parseOffset('')).toBeNull()
      expect(parseOffset('abc')).toBeNull()
      expect(parseOffset('123')).toBeNull()
      expect(parseOffset('123_1')).toBeNull() // seq must be 0
      expect(parseOffset('123_abc')).toBeNull()
      expect(parseOffset('abc_0')).toBeNull()
    })
  })

  describe('formatOffset', () => {
    it('should format -1 correctly', () => {
      expect(formatOffset(-1)).toBe('-1')
    })

    it('should format version numbers correctly', () => {
      expect(formatOffset(0)).toBe('0_0')
      expect(formatOffset(123)).toBe('123_0')
      expect(formatOffset(999999)).toBe('999999_0')
    })
  })

  describe('compareOffsets', () => {
    it('should compare offsets correctly', () => {
      expect(compareOffsets('-1', '0_0')).toBe(-1)
      expect(compareOffsets('0_0', '1_0')).toBe(-1)
      expect(compareOffsets('1_0', '0_0')).toBe(1)
      expect(compareOffsets('5_0', '5_0')).toBe(0)
    })

    it('should throw on invalid offsets', () => {
      expect(() => compareOffsets('invalid', '0_0')).toThrow()
      expect(() => compareOffsets('0_0', 'invalid')).toThrow()
    })
  })

  describe('headOffset', () => {
    it('should format head offset correctly', () => {
      expect(headOffset(0)).toBe('0_0')
      expect(headOffset(123)).toBe('123_0')
    })
  })

  describe('isValidOffset', () => {
    it('should validate correct offsets', () => {
      expect(isValidOffset('-1')).toBe(true)
      expect(isValidOffset('0_0')).toBe(true)
      expect(isValidOffset('123_0')).toBe(true)
    })

    it('should reject invalid offsets', () => {
      expect(isValidOffset('')).toBe(false)
      expect(isValidOffset('abc')).toBe(false)
      expect(isValidOffset('123')).toBe(false)
      expect(isValidOffset('123_1')).toBe(false)
    })
  })
})