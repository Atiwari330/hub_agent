import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

// Create Anthropic provider via AI Gateway
function getAnthropicProvider() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;

  if (!apiKey) {
    throw new Error('AI_GATEWAY_API_KEY is not configured');
  }

  return createAnthropic({
    apiKey,
    baseURL: 'https://ai-gateway.vercel.sh/v1',
  });
}

const SYSTEM_PROMPT = `You are a RevOps AI assistant generating executive insights for a VP of Revenue Operations at a behavioral health EHR software company.

Your role is to analyze dashboard data and provide:
1. One-sentence overall trajectory statement
2. Top 3 wins or positive signals
3. Top 3 concerns requiring attention
4. One actionable recommendation

Be concise and direct. Focus on what the VP needs to know and do. Use specific numbers and names when available. Keep the total response under 200 words.`;

interface InsightRequest {
  dashboardType: 'daily' | 'weekly' | 'quarterly';
  data: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const body: InsightRequest = await request.json();
    const { dashboardType, data } = body;

    if (!dashboardType || !data) {
      return NextResponse.json(
        { error: 'Missing dashboardType or data' },
        { status: 400 }
      );
    }

    // Build context-specific prompts
    let prompt = '';

    switch (dashboardType) {
      case 'daily':
        prompt = `Analyze this daily RevOps dashboard data and provide executive insights:

Summary:
- Total active deals: ${data.totalActiveDeals || 0}
- Total exceptions: ${data.totalExceptions || 0}
- Overdue next steps: ${(data.counts as Record<string, number>)?.overdueNextSteps || 0}
- Past close dates: ${(data.counts as Record<string, number>)?.pastCloseDates || 0}
- Activity drought (10d+): ${(data.counts as Record<string, number>)?.activityDrought || 0}
- High-value at risk: ${(data.counts as Record<string, number>)?.highValueAtRisk || 0}

Critical Alert: ${data.hasCriticalAlert ? data.criticalAlertMessage : 'None'}

AE Status Overview:
${JSON.stringify(data.aeStatuses, null, 2)}

Top Exception Deals:
${JSON.stringify((data.exceptionDeals as unknown[])?.slice(0, 5), null, 2)}`;
        break;

      case 'weekly':
        prompt = `Analyze this weekly RevOps dashboard data and provide executive insights:

Pipeline Movement (This Week vs Last):
- New SQLs: ${(data.thisWeek as Record<string, Record<string, number>>)?.metrics?.sqlCount || 0} (delta: ${(data.deltas as Record<string, number>)?.sqlCount || 0})
- Demos Scheduled: ${(data.thisWeek as Record<string, Record<string, number>>)?.metrics?.demoScheduledCount || 0} (delta: ${(data.deltas as Record<string, number>)?.demoScheduledCount || 0})
- Demos Completed: ${(data.thisWeek as Record<string, Record<string, number>>)?.metrics?.demoCompletedCount || 0} (delta: ${(data.deltas as Record<string, number>)?.demoCompletedCount || 0})
- Closed Won: ${(data.thisWeek as Record<string, Record<string, number>>)?.metrics?.closedWonCount || 0} (delta: ${(data.deltas as Record<string, number>)?.closedWonCount || 0})
- Revenue Won: $${(data.thisWeek as Record<string, Record<string, number>>)?.metrics?.closedWonAmount || 0} (delta: $${(data.deltas as Record<string, number>)?.closedWonAmount || 0})

AE Comparison:
${JSON.stringify(data.aeComparisons, null, 2)}

Stage Velocity (potential bottlenecks):
${JSON.stringify(data.stageVelocity, null, 2)}

Sentiment Summary:
${JSON.stringify(data.sentimentSummary, null, 2)}`;
        break;

      case 'quarterly':
        prompt = `Analyze this quarterly RevOps dashboard data and provide executive insights:

Target Progress:
- Total Target: $${(data.target as Record<string, number>)?.total || 0}
- Closed Won: $${(data.target as Record<string, number>)?.closedWon || 0} (${(data.target as Record<string, number>)?.attainment || 0}%)
- Remaining: $${(data.target as Record<string, number>)?.remaining || 0}

Pace to Goal:
- On Track: ${(data.pace as Record<string, boolean>)?.onTrack ? 'Yes' : 'No'}
- Difference: $${(data.pace as Record<string, number>)?.difference || 0}

Forecast:
- Weighted Forecast: $${(data.forecast as Record<string, number>)?.weighted || 0}
- Forecast Attainment: ${(data.forecast as Record<string, number>)?.attainment || 0}%
- Confidence: ${(data.forecast as Record<string, string>)?.confidence || 'unknown'}

Pipeline Coverage:
- Total Pipeline: $${(data.pipeline as Record<string, number>)?.total || 0}
- Coverage: ${(data.pipeline as Record<string, number>)?.coverage || 0}x
- Status: ${(data.pipeline as Record<string, string>)?.coverageStatus || 'unknown'}

AE Contributions:
${JSON.stringify(data.aeContributions, null, 2)}

Risk Factors:
${JSON.stringify(data.riskFactors, null, 2)}`;
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid dashboard type' },
          { status: 400 }
        );
    }

    const anthropic = getAnthropicProvider();

    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: SYSTEM_PROMPT,
      prompt,
    });

    return NextResponse.json({
      insights: result.text,
      dashboardType,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error generating insights:', error);
    return NextResponse.json(
      { error: 'Failed to generate insights' },
      { status: 500 }
    );
  }
}
