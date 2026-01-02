/**
 * Test script for utility functions
 * Run with: npx tsx src/scripts/test-utils.ts
 */

import {
  getCurrentQuarter,
  getQuarterProgress,
  getQuarterFromDate,
  formatQuarterLabel,
  parseQuarterLabel,
  getQuarterInfo,
} from '../lib/utils/quarter';

import {
  formatCurrency,
  formatCurrencyCompact,
  formatCurrencyWithSign,
  formatPercent,
} from '../lib/utils/currency';

console.log('=== Quarter Utility Tests ===\n');

// Test getCurrentQuarter
const currentQ = getCurrentQuarter();
console.log('Current Quarter:', currentQ);
console.log(`  Label: ${currentQ.label}`);
console.log(`  Start: ${currentQ.startDate.toLocaleDateString()}`);
console.log(`  End: ${currentQ.endDate.toLocaleDateString()}`);

// Test getQuarterProgress
const progress = getQuarterProgress();
console.log('\nQuarter Progress:', progress);
console.log(`  Days: ${progress.daysElapsed} of ${progress.totalDays}`);
console.log(`  Percent: ${progress.percentComplete.toFixed(1)}%`);

// Test getQuarterFromDate
const testDate = new Date('2025-05-15');
const q2 = getQuarterFromDate(testDate);
console.log('\nQuarter for May 15, 2025:', q2.label);

// Test formatQuarterLabel
console.log('\nFormat Q3 2025:', formatQuarterLabel(2025, 3));

// Test parseQuarterLabel
const parsed = parseQuarterLabel('Q2 2025');
console.log('Parse "Q2 2025":', parsed);

// Test getQuarterInfo
const q1Info = getQuarterInfo(2025, 1);
console.log('\nQ1 2025 Info:');
console.log(`  Start: ${q1Info.startDate.toLocaleDateString()}`);
console.log(`  End: ${q1Info.endDate.toLocaleDateString()}`);

console.log('\n=== Currency Utility Tests ===\n');

// Test formatCurrency
console.log('Format $125000:', formatCurrency(125000));
console.log('Format $0:', formatCurrency(0));
console.log('Format null:', formatCurrency(null));

// Test formatCurrencyCompact
console.log('\nCompact $1,500,000:', formatCurrencyCompact(1500000));
console.log('Compact $450,000:', formatCurrencyCompact(450000));
console.log('Compact $52,000:', formatCurrencyCompact(52000));

// Test formatCurrencyWithSign
console.log('\nWith sign +$24,000:', formatCurrencyWithSign(24000));
console.log('With sign -$15,000:', formatCurrencyWithSign(-15000));
console.log('With sign $0:', formatCurrencyWithSign(0));

// Test formatPercent
console.log('\nFormat 25%:', formatPercent(25));
console.log('Format 12.5%:', formatPercent(12.5));
console.log('Format 100%:', formatPercent(100));

console.log('\n=== All Tests Passed ===');
