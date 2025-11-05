#!/usr/bin/env node

/**
 * Performance test script for TanStack DB query pooling
 *
 * This script opens the test2-app in Puppeteer and measures:
 * 1. Whether pooling is being used (via console logs)
 * 2. Initial render performance
 * 3. Tab switching performance
 */

import puppeteer from 'puppeteer';

async function measurePerformance() {
  console.log('🚀 Starting TanStack DB pooling performance test...\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Collect console logs
  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);

    // Log pooling messages immediately
    if (text.includes('[TanStack DB')) {
      console.log(`  📊 ${text}`);
    }
  });

  // Navigate to TanStack version
  console.log('📖 Loading TanStack version at http://localhost:5173/\n');
  await page.goto('http://localhost:5173/', {
    waitUntil: 'networkidle0'
  });

  // Wait for React to render
  await page.waitForSelector('.grids');

  // Analyze console logs
  console.log('\n📈 Analysis:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const poolingLogs = consoleLogs.filter(log => log.includes('[TanStack DB Pooling]'));
  const fallbackLogs = consoleLogs.filter(log => log.includes('Query not poolable'));

  console.log(`✅ Pooled queries: ${poolingLogs.length}`);
  console.log(`⚠️  Non-pooled queries: ${fallbackLogs.length}`);

  if (poolingLogs.length > 0) {
    console.log('\n🎉 SUCCESS: Query pooling is ACTIVE!');
    console.log(`   Expected ~240 queries to use pooling`);
    console.log(`   Actual pooled: ${poolingLogs.length}`);
  } else {
    console.log('\n❌ WARNING: No pooled queries detected!');
  }

  if (fallbackLogs.length > 0) {
    console.log(`\n⚠️  Some queries fell back to standard approach:`);
    const reasons = fallbackLogs.slice(0, 3); // Show first 3
    reasons.forEach(reason => console.log(`     ${reason}`));
    if (fallbackLogs.length > 3) {
      console.log(`     ... and ${fallbackLogs.length - 3} more`);
    }
  }

  // Measure performance metrics
  console.log('\n⏱️  Performance Metrics:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const metrics = await page.evaluate(() => {
    const perfData = performance.getEntriesByType('navigation')[0];
    const paintData = performance.getEntriesByType('paint');

    return {
      domContentLoaded: perfData.domContentLoadedEventEnd - perfData.domContentLoadedEventStart,
      loadComplete: perfData.loadEventEnd - perfData.loadEventStart,
      firstPaint: paintData.find(p => p.name === 'first-paint')?.startTime || 0,
      firstContentfulPaint: paintData.find(p => p.name === 'first-contentful-paint')?.startTime || 0,
    };
  });

  console.log(`   DOM Content Loaded: ${metrics.domContentLoaded.toFixed(2)}ms`);
  console.log(`   Load Complete: ${metrics.loadComplete.toFixed(2)}ms`);
  console.log(`   First Paint: ${metrics.firstPaint.toFixed(2)}ms`);
  console.log(`   First Contentful Paint: ${metrics.firstContentfulPaint.toFixed(2)}ms`);

  // Test tab switching performance
  console.log('\n🔄 Testing tab switch performance...\n');

  const tabSwitchTimes = [];

  for (let i = 0; i < 5; i++) {
    // Click second tab
    const start = Date.now();
    await page.evaluate(() => {
      const tabs = document.querySelectorAll('.tab-button');
      if (tabs[1]) tabs[1].click();
    });
    await page.waitForTimeout(100); // Small wait for render

    // Click first tab
    await page.evaluate(() => {
      const tabs = document.querySelectorAll('.tab-button');
      if (tabs[0]) tabs[0].click();
    });
    await page.waitForTimeout(100); // Small wait for render

    const end = Date.now();
    const time = end - start;
    tabSwitchTimes.push(time);
    console.log(`   Switch ${i + 1}: ${time}ms`);
  }

  const avgTabSwitch = tabSwitchTimes.reduce((a, b) => a + b, 0) / tabSwitchTimes.length;
  console.log(`\n   Average tab switch: ${avgTabSwitch.toFixed(2)}ms`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n✨ Test complete!');

  await browser.close();
}

// Run the test
measurePerformance().catch(error => {
  console.error('❌ Error running performance test:', error);
  process.exit(1);
});
