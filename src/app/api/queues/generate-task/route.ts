import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateTaskContent } from '@/lib/ai/generate-task';

// Request schema
const RequestSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  dealName: z.string().optional(),
  companyName: z.string().optional(),
  ownerName: z.string().optional(),
  stageName: z.string().optional(),
  queueType: z.enum(['hygiene', 'next-step', 'cs-hygiene', 'other']).optional(),
  missingFields: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validate request body
    const parseResult = RequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const input = parseResult.data;

    // Generate task content using LLM
    const generatedTask = await generateTaskContent({
      prompt: input.prompt,
      dealName: input.dealName,
      companyName: input.companyName,
      ownerName: input.ownerName,
      stageName: input.stageName,
      queueType: input.queueType || 'other',
      missingFields: input.missingFields,
    });

    return NextResponse.json(generatedTask);
  } catch (error) {
    console.error('Error generating task:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate task' },
      { status: 500 }
    );
  }
}
