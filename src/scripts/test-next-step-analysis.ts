/**
 * Test script for Next Step Analysis functionality
 * Run with: npx tsx src/scripts/test-next-step-analysis.ts
 *
 * Tests the LLM extraction of expected action dates from next step text.
 */

import { analyzeNextStep } from '../lib/ai/analyze-next-step';
import type { NextStepAnalysis } from '../types/next-step-analysis';

// Test cases
const TEST_CASES = [
  // Explicit dates
  { text: 'Demo scheduled for Jan 15th 2026 at 2pm', expected: 'date_found' },
  { text: 'Follow up on January 20, 2026', expected: 'date_found' },
  { text: 'Send proposal by 1/25/26', expected: 'date_found' },

  // Relative dates (will be inferred)
  { text: 'Follow up next Tuesday', expected: 'date_inferred' },
  { text: 'Call back in 2 weeks', expected: 'date_inferred' },
  { text: 'Send proposal by end of week', expected: 'date_inferred' },
  { text: 'Schedule demo for next month', expected: 'date_inferred' },

  // Vague/unclear
  { text: 'Call back soon', expected: 'date_unclear' },
  { text: 'Follow up when ready', expected: 'date_unclear' },
  { text: 'ASAP', expected: 'date_unclear' },

  // Awaiting external party
  { text: 'Waiting on their legal team to review BAA', expected: 'awaiting_external' },
  { text: 'Pending customer response on pricing', expected: 'awaiting_external' },
  { text: 'Ball in their court - waiting for budget approval', expected: 'awaiting_external' },

  // No date mentioned
  { text: 'Need to connect with CFO', expected: 'no_date' },
  { text: 'Discuss pricing options', expected: 'no_date' },
  { text: 'Get stakeholder list', expected: 'no_date' },

  // Empty
  { text: '', expected: 'empty' },
  { text: '   ', expected: 'empty' },

  // Unparseable
  { text: 'asdfasdf', expected: 'unparseable' },
  { text: 'TBD', expected: 'no_date' }, // Could be no_date or date_unclear
];

async function runTests() {
  console.log('=== Next Step Analysis Tests ===\n');
  console.log('Testing LLM extraction of action dates from next step text.\n');

  let passed = 0;
  let failed = 0;

  for (const testCase of TEST_CASES) {
    try {
      console.log(`Testing: "${testCase.text || '(empty)'}"`);
      console.log(`  Expected status: ${testCase.expected}`);

      const result: NextStepAnalysis = await analyzeNextStep({
        nextStepText: testCase.text,
        referenceDate: new Date(),
      });

      console.log(`  Actual status: ${result.status}`);
      console.log(`  Due date: ${result.dueDate || 'null'}`);
      console.log(`  Message: ${result.displayMessage}`);
      console.log(`  Confidence: ${(result.confidence * 100).toFixed(0)}%`);
      console.log(`  Action type: ${result.actionType || 'null'}`);

      // Check if status matches expected (allowing some flexibility)
      const isMatch = result.status === testCase.expected;

      if (isMatch) {
        console.log(`  Result: PASS\n`);
        passed++;
      } else {
        console.log(`  Result: FAIL (expected ${testCase.expected}, got ${result.status})\n`);
        failed++;
      }
    } catch (error) {
      console.log(`  Result: ERROR - ${error}\n`);
      failed++;
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log('=== Summary ===');
  console.log(`Passed: ${passed}/${TEST_CASES.length}`);
  console.log(`Failed: ${failed}/${TEST_CASES.length}`);
  console.log(`Success rate: ${((passed / TEST_CASES.length) * 100).toFixed(0)}%`);
}

// Run single test
async function runSingleTest(text: string) {
  console.log(`\nAnalyzing: "${text}"\n`);

  const result = await analyzeNextStep({
    nextStepText: text,
    referenceDate: new Date(),
  });

  console.log('Result:', JSON.stringify(result, null, 2));
}

// Main
const args = process.argv.slice(2);

if (args.length > 0) {
  // Run single test with provided text
  runSingleTest(args.join(' ')).catch(console.error);
} else {
  // Run all tests
  runTests().catch(console.error);
}
