import { NextResponse, type NextRequest } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { runDealsAnalysis } from '@/lib/analysis/deals-analysis';

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.DEALS_ANALYSIS);
  if (authResult instanceof NextResponse) return authResult;

  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam ? parseInt(yearParam) : undefined;

  const result = await runDealsAnalysis({ year });
  return NextResponse.json(result);
}
