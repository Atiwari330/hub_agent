import { config } from 'dotenv';
config({ path: '.env.local' });
import { runAgent } from '../lib/ai/agent';

async function main() {
  // Get query from command line arguments
  const query = process.argv.slice(2).join(' ');

  if (!query) {
    console.log('Usage: npm run ask "your question here"');
    console.log('\nExamples:');
    console.log('  npm run ask "List all account executives"');
    console.log('  npm run ask "Show deals for atiwari@opusbehavioral.com"');
    console.log('  npm run ask "Summarize pipeline for Adi Tiwari"');
    process.exit(1);
  }

  console.log(`\n🤖 RevOps Agent`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`Q: ${query}\n`);

  try {
    const startTime = Date.now();
    const result = await runAgent(query);
    const duration = Date.now() - startTime;

    console.log(`A: ${result.text}`);

    console.log(`\n${'─'.repeat(50)}`);
    if (result.toolCalls && result.toolCalls.length > 0) {
      console.log(`Tools: ${result.toolCalls.map(c => c.toolName).join(', ')}`);
    }
    console.log(`Time: ${(duration / 1000).toFixed(1)}s | Tokens: ${result.usage?.totalTokens || 'N/A'}`);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
