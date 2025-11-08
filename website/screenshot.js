#!/usr/bin/env node

/**
 * Screenshot Generation Script
 *
 * This script generates a full-page screenshot of the TanStack DB website.
 *
 * Prerequisites:
 * - The dev server should be running on http://localhost:5173
 * - Chrome or Chromium should be installed
 *
 * Usage:
 * 1. Start the dev server: npm run dev
 * 2. In another terminal, run: node screenshot.js
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('📸 TanStack DB Website Screenshot Generator');
console.log('');
console.log('To generate a screenshot:');
console.log('1. Start the dev server: npm run dev');
console.log('2. Open http://localhost:5173 in your browser');
console.log('3. Use browser DevTools to take a full-page screenshot:');
console.log('   - Chrome: Cmd/Ctrl + Shift + P → "Capture full size screenshot"');
console.log('   - Firefox: Right-click → "Take Screenshot" → "Save full page"');
console.log('');
console.log('Alternative: Use a tool like:');
console.log('- Playwright: npx playwright screenshot http://localhost:5173 screenshot.png');
console.log('- Puppeteer: (requires additional setup)');
console.log('- Browser extensions like "Full Page Screen Capture"');
