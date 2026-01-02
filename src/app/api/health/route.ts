import { NextResponse } from 'next/server';

export async function GET() {
  const checks = {
    hubspot: !!process.env.HUBSPOT_ACCESS_TOKEN,
    supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    aiGateway: !!process.env.AI_GATEWAY_API_KEY,
  };

  const allHealthy = Object.values(checks).every(Boolean);

  return NextResponse.json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  }, {
    status: allHealthy ? 200 : 503,
  });
}
