import { NextRequest, NextResponse } from 'next/server';
import { getHubSpotClient } from '@/lib/hubspot/client';
import { createServiceClient } from '@/lib/supabase/client';
import { getQuarterInfo } from '@/lib/utils/quarter';
import { isConnectedOutcome, getOutcomeLabel, formatCallDuration } from '@/lib/utils/call-outcomes';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/objects/calls';

const ALL_AE_EMAILS = [
  'cgarraffa@opusbehavioral.com',
  'jrice@opusbehavioral.com',
  'atiwari@opusbehavioral.com',
  'zclaussen@opusbehavioral.com',
  'aboyd@opusbehavioral.com',
];

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function toESTComponents(utcDate: Date): { hour: number; dayName: string; formatted: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    weekday: 'long',
  }).formatToParts(utcDate);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const hour = parseInt(get('hour'), 10);

  return {
    hour,
    dayName: get('weekday'),
    formatted: `${get('month')}/${get('day')}/${get('year')} ${get('hour')}:${get('minute')}`,
  };
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

async function getOwnersByEmail(emails: string[]) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('owners')
    .select('email, hubspot_owner_id, first_name, last_name')
    .in('email', emails);

  if (error || !data) return [];

  return data.map((o) => ({
    email: o.email,
    hubspotOwnerId: o.hubspot_owner_id,
    name: [o.first_name, o.last_name].filter(Boolean).join(' ') || o.email,
  }));
}

async function fetchCallsWithDuration(
  hubspotOwnerId: string,
  startDate: Date,
  endDate: Date
) {
  const client = getHubSpotClient();
  const calls: Array<{
    id: string;
    timestamp: Date;
    outcomeId: string | null;
    direction: string | null;
    durationMs: number | null;
  }> = [];
  let after: string | undefined;

  do {
    try {
      const response = await client.crm.objects.calls.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'hubspot_owner_id',
                operator: FilterOperatorEnum.Eq,
                value: hubspotOwnerId,
              },
              {
                propertyName: 'hs_timestamp',
                operator: FilterOperatorEnum.Gte,
                value: startDate.getTime().toString(),
              },
              {
                propertyName: 'hs_timestamp',
                operator: FilterOperatorEnum.Lte,
                value: endDate.getTime().toString(),
              },
            ],
          },
        ],
        properties: ['hs_timestamp', 'hs_call_disposition', 'hs_call_direction', 'hs_call_duration'],
        limit: 100,
        after: after ? after : undefined,
      });

      for (const call of response.results) {
        calls.push({
          id: call.id,
          timestamp: call.properties.hs_timestamp
            ? new Date(call.properties.hs_timestamp)
            : new Date(),
          outcomeId: call.properties.hs_call_disposition || null,
          direction: call.properties.hs_call_direction || null,
          durationMs: call.properties.hs_call_duration
            ? parseInt(call.properties.hs_call_duration, 10)
            : null,
        });
      }

      after = response.paging?.next?.after;
    } catch {
      break;
    }
  } while (after);

  return calls;
}

function getQuarterRanges() {
  const now = new Date();
  const ranges: Array<{ startDate: Date; endDate: Date }> = [];

  for (let year = 2024; year <= now.getFullYear(); year++) {
    for (let q = 1; q <= 4; q++) {
      const qi = getQuarterInfo(year, q);
      if (qi.startDate > now) break;
      ranges.push({ startDate: qi.startDate, endDate: qi.endDate > now ? now : qi.endDate });
    }
  }

  return ranges;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const targetDay = searchParams.get('day');
  const targetHourStr = searchParams.get('hour');

  if (!targetDay || !targetHourStr || !WEEKDAYS.includes(targetDay)) {
    return NextResponse.json({ error: 'Missing or invalid day/hour params' }, { status: 400 });
  }

  const targetHour = parseInt(targetHourStr, 10);
  if (isNaN(targetHour) || targetHour < 0 || targetHour > 23) {
    return NextResponse.json({ error: 'Invalid hour' }, { status: 400 });
  }

  try {
    const owners = await getOwnersByEmail(ALL_AE_EMAILS);
    if (owners.length === 0) {
      return NextResponse.json({ error: 'No owners found' }, { status: 500 });
    }

    const quarterRanges = getQuarterRanges();
    const seenIds = new Set<string>();

    interface CallRecord {
      id: string;
      timestampEST: string;
      timestamp: Date;
      ownerName: string;
      outcome: string;
      isConnected: boolean;
      durationFormatted: string;
    }

    const calls: CallRecord[] = [];

    for (const owner of owners) {
      for (const qr of quarterRanges) {
        const raw = await fetchCallsWithDuration(owner.hubspotOwnerId, qr.startDate, qr.endDate);

        for (const call of raw) {
          if (seenIds.has(call.id)) continue;
          seenIds.add(call.id);

          if (call.direction !== 'OUTBOUND') continue;

          const est = toESTComponents(call.timestamp);

          if (est.dayName === targetDay && est.hour === targetHour) {
            calls.push({
              id: call.id,
              timestampEST: est.formatted,
              timestamp: call.timestamp,
              ownerName: owner.name,
              outcome: getOutcomeLabel(call.outcomeId),
              isConnected: isConnectedOutcome(call.outcomeId),
              durationFormatted: call.durationMs ? formatCallDuration(call.durationMs) : '-',
            });
          }
        }

        await new Promise((r) => setTimeout(r, 150));
      }
    }

    // Sort most recent first
    calls.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const connectedCount = calls.filter((c) => c.isConnected).length;

    return NextResponse.json({
      calls: calls.map(({ id, timestampEST, ownerName, outcome, isConnected, durationFormatted }) => ({
        id,
        timestampEST,
        ownerName,
        outcome,
        isConnected,
        durationFormatted,
      })),
      day: targetDay,
      hourLabel: formatHour(targetHour),
      totalCalls: calls.length,
      connectedCalls: connectedCount,
      connectRate: calls.length > 0 ? (connectedCount / calls.length) * 100 : 0,
    });
  } catch (error) {
    console.error('Call patterns drill-down error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch call details' },
      { status: 500 }
    );
  }
}
