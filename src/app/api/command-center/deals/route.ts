import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { fetchQ2Deals } from '@/lib/command-center/fetch-q2-deals';

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.Q2_COMMAND_CENTER);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  try {
    const deals = await fetchQ2Deals(supabase);

    const counts = {
      total: deals.length,
      byGrade: {
        A: deals.filter((d) => d.overallGrade === 'A').length,
        B: deals.filter((d) => d.overallGrade === 'B').length,
        C: deals.filter((d) => d.overallGrade === 'C').length,
        D: deals.filter((d) => d.overallGrade === 'D').length,
        F: deals.filter((d) => d.overallGrade === 'F').length,
      },
      byLikelihood: {
        highly_likely: deals.filter((d) => d.likelihoodTier === 'highly_likely').length,
        likely: deals.filter((d) => d.likelihoodTier === 'likely').length,
        possible: deals.filter((d) => d.likelihoodTier === 'possible').length,
        unlikely: deals.filter((d) => d.likelihoodTier === 'unlikely').length,
        insufficient_data: deals.filter((d) => d.likelihoodTier === 'insufficient_data').length,
      },
      withOverrides: deals.filter((d) => d.override).length,
    };

    return NextResponse.json({ deals, counts });
  } catch (error) {
    console.error('Command Center deals error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch deals' },
      { status: 500 },
    );
  }
}
