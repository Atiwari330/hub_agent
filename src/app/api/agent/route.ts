import { NextRequest } from 'next/server';
import { streamAgentWithMessages } from '@/lib/ai/agent';

export async function POST(request: NextRequest) {
  try {
    const { messages, prompt } = await request.json();

    // Support both message-based and single prompt
    const agentMessages = prompt
      ? [{ role: 'user' as const, content: prompt }]
      : messages;

    if (!agentMessages || agentMessages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No messages or prompt provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = streamAgentWithMessages(agentMessages);

    return result.toTextStreamResponse();
  } catch (error) {
    console.error('Agent error:', error);
    return new Response(
      JSON.stringify({ error: 'Agent execution failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
