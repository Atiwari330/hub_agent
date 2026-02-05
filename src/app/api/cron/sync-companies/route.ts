import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { getAllCompanies } from '@/lib/hubspot/companies';

// Convert empty strings to null for timestamp fields
const toTimestamp = (value: string | undefined | null): string | null => {
  if (!value || value === '') return null;
  // HubSpot sometimes returns epoch milliseconds as a string
  if (/^\d{13}$/.test(value)) {
    return new Date(parseInt(value, 10)).toISOString();
  }
  return value;
};

// Convert empty strings to null for date fields (DATE type, not TIMESTAMPTZ)
const toDate = (value: string | undefined | null): string | null => {
  if (!value || value === '') return null;
  // If it's a timestamp, extract just the date part
  if (value.includes('T')) {
    return value.split('T')[0];
  }
  return value;
};

// Convert empty strings to null for numeric fields
const toNumber = (value: string | undefined | null): number | null => {
  if (!value || value === '') return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
};

// Verify cron secret for security
function verifyCronSecret(request: Request): boolean {
  // Skip auth in development mode
  if (process.env.NODE_ENV === 'development') return true;

  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) return true; // Skip if not configured
  return authHeader === `Bearer ${cronSecret}`;
}

const DB_BATCH_SIZE = 100;

export async function GET(request: Request) {
  // Verify the request is from Vercel Cron
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const workflowId = crypto.randomUUID();

  try {
    const startTime = Date.now();

    // Log workflow start
    await supabase.from('workflow_runs').insert({
      id: workflowId,
      workflow_name: 'sync-companies',
      status: 'running',
    });

    // Fetch all companies from HubSpot
    console.log('Fetching companies from HubSpot...');
    const companies = await getAllCompanies();
    console.log(`Found ${companies.length} companies with contract status or ARR`);

    // Transform to database format
    const companyData = companies.map((company) => ({
      hubspot_company_id: company.id,
      name: company.properties.name,
      domain: company.properties.domain,
      hubspot_owner_id: company.properties.hubspot_owner_id,
      // CS Health Properties
      health_score: toNumber(company.properties.health_score),
      health_score_status: company.properties.health_score_status,
      sentiment: company.properties.sentiment,
      // Contract Properties
      contract_end: toDate(company.properties.contract_end),
      contract_status: company.properties.contract_status,
      auto_renew: company.properties.auto_renew,
      // Revenue Properties
      arr: toNumber(company.properties.arr),
      mrr: toNumber(company.properties.mrr),
      total_revenue: toNumber(company.properties.total_revenue),
      // Activity Properties
      last_activity_date: toTimestamp(company.properties.last_activity_date),
      next_activity_date: toTimestamp(company.properties.next_activity_date),
      latest_meeting_date: toTimestamp(company.properties.latest_meeting_date),
      // Metadata
      synced_at: new Date().toISOString(),
    }));

    // Batch upsert companies
    let companySuccess = 0;
    let companyErrors = 0;

    for (let i = 0; i < companyData.length; i += DB_BATCH_SIZE) {
      const chunk = companyData.slice(i, i + DB_BATCH_SIZE);
      const { error: companyError } = await supabase
        .from('companies')
        .upsert(chunk, { onConflict: 'hubspot_company_id' });

      if (companyError) {
        console.error(`Company batch upsert error (chunk ${i / DB_BATCH_SIZE + 1}):`, companyError);
        companyErrors += chunk.length;
      } else {
        companySuccess += chunk.length;
      }
    }

    const duration = Date.now() - startTime;

    // Log success
    await supabase.from('workflow_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      result: {
        companiesSync: companySuccess,
        companyErrors,
        totalFetched: companies.length,
        durationMs: duration,
      },
    }).eq('id', workflowId);

    console.log(`Sync complete in ${duration}ms: ${companySuccess} companies synced (${companyErrors} errors)`);

    return NextResponse.json({
      success: true,
      companiesSynced: companySuccess,
      companyErrors,
      totalFetched: companies.length,
      durationMs: duration,
    });
  } catch (error) {
    console.error('Company sync failed:', error);

    // Log failure
    await supabase.from('workflow_runs').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    }).eq('id', workflowId);

    return NextResponse.json(
      { error: 'Company sync failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
