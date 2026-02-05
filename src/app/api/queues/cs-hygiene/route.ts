import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import {
  checkCompanyHygiene,
  generateCSHygieneReason,
  type CSHygieneMissingField,
} from '@/lib/utils/queue-detection';

interface ExistingTaskInfo {
  hubspotTaskId: string;
  createdAt: string;
  fieldsTaskedFor: string[];
  coversAllCurrentFields: boolean;
}

export interface CSHygieneCompany {
  id: string;
  hubspotCompanyId: string;
  name: string | null;
  arr: number | null;
  mrr: number | null;
  contractStatus: string | null;
  contractEnd: string | null;
  sentiment: string | null;
  autoRenew: string | null;
  qbrNotes: string | null;
  ownerName: string | null;
  hubspotOwnerId: string | null;
  missingFields: CSHygieneMissingField[];
  reason: string;
  existingTask: ExistingTaskInfo | null;
}

export interface CSHygieneQueueResponse {
  companies: CSHygieneCompany[];
  counts: {
    total: number;
  };
}

export async function GET(request: NextRequest) {
  // Check authorization
  const authResult = await checkApiAuth(RESOURCES.QUEUE_CS_HYGIENE);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  const { searchParams } = new URL(request.url);
  const ownerIdFilter = searchParams.get('ownerId');
  const missingFieldFilter = searchParams.get('missingField');

  try {
    // Build query for companies
    let query = supabase
      .from('companies')
      .select(`
        id,
        hubspot_company_id,
        name,
        arr,
        mrr,
        contract_status,
        contract_end,
        sentiment,
        auto_renew,
        qbr_notes,
        hubspot_owner_id
      `)
      // Exclude churned companies
      .neq('contract_status', 'Churned')
      // Sort by ARR descending (highest value accounts first)
      .order('arr', { ascending: false, nullsFirst: false });

    // Apply owner filter if specified
    if (ownerIdFilter) {
      query = query.eq('hubspot_owner_id', ownerIdFilter);
    }

    const { data: companies, error: companiesError } = await query;

    if (companiesError) {
      console.error('Error fetching companies:', companiesError);
      return NextResponse.json(
        { error: 'Failed to fetch companies', details: companiesError.message },
        { status: 500 }
      );
    }

    // Get owner information for the companies
    const ownerIds = [...new Set(
      (companies || [])
        .map((c) => c.hubspot_owner_id)
        .filter((id): id is string => id !== null)
    )];

    const { data: owners } = await supabase
      .from('owners')
      .select('hubspot_owner_id, first_name, last_name, email')
      .in('hubspot_owner_id', ownerIds);

    // Build owner lookup map
    const ownerMap = new Map<string, string>();
    for (const owner of owners || []) {
      const name = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email;
      ownerMap.set(owner.hubspot_owner_id, name);
    }

    // Get existing CS hygiene tasks
    const companyIds = (companies || []).map((c) => c.id);
    const { data: existingTasks } = await supabase
      .from('cs_hygiene_tasks')
      .select('company_id, hubspot_task_id, missing_fields, created_at')
      .in('company_id', companyIds)
      .order('created_at', { ascending: false });

    // Build task lookup map (most recent task per company)
    const taskMap = new Map<string, { hubspotTaskId: string; createdAt: string; missingFields: string[] }>();
    for (const task of existingTasks || []) {
      if (!taskMap.has(task.company_id)) {
        taskMap.set(task.company_id, {
          hubspotTaskId: task.hubspot_task_id,
          createdAt: task.created_at,
          missingFields: task.missing_fields,
        });
      }
    }

    // Process companies and check hygiene
    const transformedCompanies: CSHygieneCompany[] = [];

    for (const company of companies || []) {
      const hygieneCheck = checkCompanyHygiene({
        id: company.id,
        sentiment: company.sentiment,
        auto_renew: company.auto_renew,
        contract_end: company.contract_end,
        mrr: company.mrr,
        contract_status: company.contract_status,
        qbr_notes: company.qbr_notes,
      });

      // Skip compliant companies
      if (hygieneCheck.isCompliant) {
        continue;
      }

      // Apply missing field filter if specified
      if (missingFieldFilter) {
        const hasMissingField = hygieneCheck.missingFields.some(
          (f) => f.label === missingFieldFilter
        );
        if (!hasMissingField) {
          continue;
        }
      }

      const ownerName = company.hubspot_owner_id ? ownerMap.get(company.hubspot_owner_id) || null : null;
      const existingTaskData = taskMap.get(company.id);

      let existingTask: ExistingTaskInfo | null = null;
      if (existingTaskData) {
        const currentMissingLabels = hygieneCheck.missingFields.map((f) => f.label);
        const coversAllCurrentFields = currentMissingLabels.every(
          (label) => existingTaskData.missingFields.includes(label)
        );
        existingTask = {
          hubspotTaskId: existingTaskData.hubspotTaskId,
          createdAt: existingTaskData.createdAt,
          fieldsTaskedFor: existingTaskData.missingFields,
          coversAllCurrentFields,
        };
      }

      transformedCompanies.push({
        id: company.id,
        hubspotCompanyId: company.hubspot_company_id,
        name: company.name,
        arr: company.arr,
        mrr: company.mrr,
        contractStatus: company.contract_status,
        contractEnd: company.contract_end,
        sentiment: company.sentiment,
        autoRenew: company.auto_renew,
        qbrNotes: company.qbr_notes,
        ownerName,
        hubspotOwnerId: company.hubspot_owner_id,
        missingFields: hygieneCheck.missingFields,
        reason: generateCSHygieneReason(hygieneCheck.missingFields),
        existingTask,
      });
    }

    const response: CSHygieneQueueResponse = {
      companies: transformedCompanies,
      counts: {
        total: transformedCompanies.length,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('CS hygiene queue error:', error);
    return NextResponse.json(
      { error: 'Failed to get CS hygiene queue', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
