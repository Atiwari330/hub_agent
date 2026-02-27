import { NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { fetchSupportPulseData } from './shared';

// Re-export types for consumers
export type {
  SupportPulseTicket,
  SupportPulseAccount,
  SupportPulseResponse,
} from './shared';

// --- Route Handler ---

export async function GET() {
  // Check authorization
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_PULSE);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const response = await fetchSupportPulseData();
    return NextResponse.json(response);
  } catch (error) {
    console.error('Support pulse error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get support pulse',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
