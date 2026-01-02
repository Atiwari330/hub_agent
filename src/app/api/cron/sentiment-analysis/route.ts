import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { runAgent } from '@/lib/ai/agent';

function verifyCronSecret(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) return true;
  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const workflowId = crypto.randomUUID();

  try {
    await supabase.from('workflow_runs').insert({
      id: workflowId,
      workflow_name: 'sentiment-analysis',
      status: 'running',
    });

    // Get deals that need sentiment analysis
    // (deals not analyzed in last 24 hours or never analyzed)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: deals } = await supabase
      .from('deals')
      .select(`
        id,
        hubspot_deal_id,
        deal_name,
        sentiment_analyses(analyzed_at)
      `)
      .order('updated_at', { ascending: false })
      .limit(20); // Process 20 deals per run to stay within limits

    const dealsToAnalyze = deals?.filter((deal) => {
      const analyses = deal.sentiment_analyses as Array<{ analyzed_at: string }> | null;
      const lastAnalysis = analyses?.[0]?.analyzed_at;
      return !lastAnalysis || lastAnalysis < oneDayAgo;
    }) || [];

    let analyzed = 0;
    const results: Array<{ dealId: string; sentiment: string }> = [];

    for (const deal of dealsToAnalyze) {
      try {
        console.log(`Analyzing sentiment for deal: ${deal.deal_name}`);

        const result = await runAgent(
          `Analyze the sentiment of deal ID ${deal.hubspot_deal_id} named "${deal.deal_name}".
           Get the deal details including notes, then provide a sentiment analysis.
           Return your analysis in this format:
           SENTIMENT: [positive/neutral/negative]
           CONFIDENCE: [0.0-1.0]
           SUMMARY: [1-2 sentence summary]
           KEY_FACTORS: [comma-separated list]
           RECOMMENDATIONS: [comma-separated list if negative, otherwise "none"]`
        );

        // Parse the response to extract sentiment data
        const text = result.text;
        const sentimentMatch = text.match(/SENTIMENT:\s*(positive|neutral|negative)/i);
        const confidenceMatch = text.match(/CONFIDENCE:\s*([\d.]+)/i);
        const summaryMatch = text.match(/SUMMARY:\s*(.+?)(?=KEY_FACTORS:|$)/is);
        const keyFactorsMatch = text.match(/KEY_FACTORS:\s*(.+?)(?=RECOMMENDATIONS:|$)/is);
        const recommendationsMatch = text.match(/RECOMMENDATIONS:\s*(.+?)$/is);

        if (sentimentMatch) {
          const sentiment = sentimentMatch[1].toLowerCase() as 'positive' | 'neutral' | 'negative';
          const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;
          const summary = summaryMatch ? summaryMatch[1].trim() : 'Analysis complete';
          const keyFactors = keyFactorsMatch
            ? keyFactorsMatch[1].split(',').map((f) => f.trim()).filter(Boolean)
            : [];
          const recommendations = recommendationsMatch && recommendationsMatch[1].toLowerCase() !== 'none'
            ? recommendationsMatch[1].split(',').map((r) => r.trim()).filter(Boolean)
            : [];

          await supabase.from('sentiment_analyses').insert({
            deal_id: deal.id,
            sentiment_score: sentiment,
            confidence: Math.min(1, Math.max(0, confidence)),
            summary,
            key_factors: keyFactors,
            recommendations: recommendations.length > 0 ? recommendations : null,
          });

          analyzed++;
          results.push({ dealId: deal.id, sentiment });
        }
      } catch (error) {
        console.error(`Failed to analyze deal ${deal.id}:`, error);
      }
    }

    await supabase.from('workflow_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      result: {
        dealsChecked: dealsToAnalyze.length,
        dealsAnalyzed: analyzed,
        results,
      },
    }).eq('id', workflowId);

    console.log(`Sentiment analysis complete: ${analyzed}/${dealsToAnalyze.length} deals`);

    return NextResponse.json({
      success: true,
      dealsChecked: dealsToAnalyze.length,
      dealsAnalyzed: analyzed,
    });
  } catch (error) {
    console.error('Sentiment analysis failed:', error);

    await supabase.from('workflow_runs').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    }).eq('id', workflowId);

    return NextResponse.json(
      { error: 'Sentiment analysis failed' },
      { status: 500 }
    );
  }
}
