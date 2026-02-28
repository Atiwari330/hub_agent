import { NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { analyzeDealEnrichment } from './analyze-core';

interface RequestBody {
  dealId: string;
  force?: boolean;
}

export async function POST(request: Request) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_DOMAIN_ENRICHMENT);
  if (authResult instanceof NextResponse) return authResult;

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { dealId, force } = body;
  if (!dealId) {
    return NextResponse.json({ error: 'dealId is required' }, { status: 400 });
  }

  const result = await analyzeDealEnrichment(dealId, { force });

  if (!result.success) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.statusCode || 500 }
    );
  }

  return NextResponse.json({
    success: true,
    enrichment: result.enrichment,
  });
}
