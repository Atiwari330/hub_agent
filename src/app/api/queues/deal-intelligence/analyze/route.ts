import { NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { analyzeDealIntelligence } from '@/lib/intelligence/deal-llm';

interface RequestBody {
  dealId: string;
}

export async function POST(request: Request) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_DEAL_HEALTH);
  if (authResult instanceof NextResponse) return authResult;

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { dealId } = body;
  if (!dealId) {
    return NextResponse.json({ error: 'dealId is required' }, { status: 400 });
  }

  const result = await analyzeDealIntelligence(dealId);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || 'Analysis failed' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, dealId });
}
