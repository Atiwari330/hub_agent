import { NextResponse } from 'next/server';
import { getHubSpotClient } from '@/lib/hubspot/client';
import { createServiceClient } from '@/lib/supabase/client';
import { getQuarterInfo } from '@/lib/utils/quarter';
import { isConnectedOutcome } from '@/lib/utils/call-outcomes';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/objects/calls';

// AE emails to analyze
const ALL_AE_EMAILS = [
  'cgarraffa@opusbehavioral.com',
  'jrice@opusbehavioral.com',
  'atiwari@opusbehavioral.com',
  'zclaussen@opusbehavioral.com',
  'aboyd@opusbehavioral.com',
];

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const HOURS_START = 7;
const HOURS_END = 18;

interface Bucket {
  total: number;
  connected: number;
}

function newBucket(): Bucket {
  return { total: 0, connected: 0 };
}

function connectRate(b: Bucket): number {
  return b.total > 0 ? (b.connected / b.total) * 100 : 0;
}

function toESTComponents(utcDate: Date): { hour: number; dayName: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'long',
  }).formatToParts(utcDate);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return {
    hour: parseInt(get('hour'), 10),
    dayName: get('weekday'),
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

async function fetchCalls(
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
        properties: ['hs_timestamp', 'hs_call_disposition', 'hs_call_direction'],
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

export async function GET() {
  try {
    const owners = await getOwnersByEmail(ALL_AE_EMAILS);
    if (owners.length === 0) {
      return NextResponse.json({ error: 'No owners found' }, { status: 500 });
    }

    const quarterRanges = getQuarterRanges();
    const seenIds = new Set<string>();

    interface AnalyzedCall {
      estHour: number;
      dayName: string;
      isConnected: boolean;
      ownerName: string;
    }

    const dataset: AnalyzedCall[] = [];
    let earliest: Date | null = null;
    let latest: Date | null = null;

    for (const owner of owners) {
      for (const qr of quarterRanges) {
        const raw = await fetchCalls(owner.hubspotOwnerId, qr.startDate, qr.endDate);

        for (const call of raw) {
          if (seenIds.has(call.id)) continue;
          seenIds.add(call.id);

          // Only outbound calls
          if (call.direction !== 'OUTBOUND') continue;

          const est = toESTComponents(call.timestamp);

          if (!earliest || call.timestamp < earliest) earliest = call.timestamp;
          if (!latest || call.timestamp > latest) latest = call.timestamp;

          dataset.push({
            estHour: est.hour,
            dayName: est.dayName,
            isConnected: isConnectedOutcome(call.outcomeId),
            ownerName: owner.name,
          });
        }

        // Rate limiting
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    if (dataset.length === 0) {
      return NextResponse.json({
        totalCalls: 0,
        overallConnectRate: 0,
        dateRange: null,
        heatmap: [],
        hourly: [],
        daily: [],
        sweetSpots: [],
        worstSpots: [],
        perAE: [],
      });
    }

    // Overall stats
    const totalConnected = dataset.filter((c) => c.isConnected).length;
    const overallRate = (totalConnected / dataset.length) * 100;

    // Hourly buckets
    const hourBuckets = new Map<number, Bucket>();
    for (let h = 0; h < 24; h++) hourBuckets.set(h, newBucket());

    // Day buckets
    const dayBuckets = new Map<string, Bucket>();
    for (const d of WEEKDAYS) dayBuckets.set(d, newBucket());

    // Heatmap: day × hour
    const heatmap = new Map<string, Bucket>();
    for (const d of WEEKDAYS) {
      for (let h = 0; h < 24; h++) {
        heatmap.set(`${d}-${h}`, newBucket());
      }
    }

    // Per-AE buckets
    const aeBuckets = new Map<string, Bucket>();
    const aeHourBuckets = new Map<string, Map<number, Bucket>>();

    for (const call of dataset) {
      // Hour
      const hb = hourBuckets.get(call.estHour)!;
      hb.total++;
      if (call.isConnected) hb.connected++;

      // Day (weekdays only)
      if (WEEKDAYS.includes(call.dayName)) {
        const db = dayBuckets.get(call.dayName)!;
        db.total++;
        if (call.isConnected) db.connected++;

        const hmKey = `${call.dayName}-${call.estHour}`;
        const hmb = heatmap.get(hmKey);
        if (hmb) {
          hmb.total++;
          if (call.isConnected) hmb.connected++;
        }
      }

      // Per-AE
      if (!aeBuckets.has(call.ownerName)) {
        aeBuckets.set(call.ownerName, newBucket());
        const hm = new Map<number, Bucket>();
        for (let h = 0; h < 24; h++) hm.set(h, newBucket());
        aeHourBuckets.set(call.ownerName, hm);
      }
      const ab = aeBuckets.get(call.ownerName)!;
      ab.total++;
      if (call.isConnected) ab.connected++;
      const ahb = aeHourBuckets.get(call.ownerName)!.get(call.estHour)!;
      ahb.total++;
      if (call.isConnected) ahb.connected++;
    }

    // Build heatmap grid
    const heatmapGrid = WEEKDAYS.map((day) => ({
      day,
      hours: Array.from({ length: HOURS_END - HOURS_START + 1 }, (_, i) => {
        const hour = HOURS_START + i;
        const b = heatmap.get(`${day}-${hour}`)!;
        return {
          hour,
          hourLabel: formatHour(hour),
          total: b.total,
          connected: b.connected,
          rate: connectRate(b),
        };
      }),
    }));

    // Hourly summary (7AM-6PM)
    const hourly = Array.from({ length: HOURS_END - HOURS_START + 1 }, (_, i) => {
      const hour = HOURS_START + i;
      const b = hourBuckets.get(hour)!;
      return { hour, hourLabel: formatHour(hour), total: b.total, connected: b.connected, rate: connectRate(b) };
    });

    // Daily summary
    const daily = WEEKDAYS.map((day) => {
      const b = dayBuckets.get(day)!;
      return { day, total: b.total, connected: b.connected, rate: connectRate(b) };
    });

    // Sweet spots (top 5)
    const allSpots = Array.from(heatmap.entries())
      .filter(([, b]) => b.total >= 10)
      .map(([key, b]) => {
        const [day, hourStr] = key.split('-');
        const hour = parseInt(hourStr, 10);
        return { day, hour, hourLabel: formatHour(hour), total: b.total, connected: b.connected, rate: connectRate(b) };
      });

    const sweetSpots = [...allSpots].sort((a, b) => b.rate - a.rate).slice(0, 5);
    const worstSpots = [...allSpots].sort((a, b) => a.rate - b.rate).slice(0, 5);

    // Best hour/day for insights
    const bestHourEntry = hourly.filter((h) => h.total >= 20).sort((a, b) => b.rate - a.rate)[0] || null;
    const bestDayEntry = daily.filter((d) => d.total >= 20).sort((a, b) => b.rate - a.rate)[0] || null;

    // Per-AE
    const perAE = Array.from(aeBuckets.entries())
      .map(([name, b]) => {
        const hourMap = aeHourBuckets.get(name)!;
        let bestHour = 0;
        let bestHourRate = 0;
        for (const [h, hb] of hourMap) {
          if (hb.total >= 10) {
            const r = connectRate(hb);
            if (r > bestHourRate) {
              bestHourRate = r;
              bestHour = h;
            }
          }
        }
        return {
          name,
          total: b.total,
          connected: b.connected,
          rate: connectRate(b),
          bestHour: bestHourRate > 0 ? formatHour(bestHour) : '-',
          bestHourRate,
        };
      })
      .sort((a, b) => b.total - a.total);

    return NextResponse.json({
      totalCalls: dataset.length,
      totalConnected,
      overallConnectRate: overallRate,
      dateRange: earliest && latest
        ? { from: earliest.toISOString().split('T')[0], to: latest.toISOString().split('T')[0] }
        : null,
      heatmap: heatmapGrid,
      hourly,
      daily,
      sweetSpots,
      worstSpots,
      bestHour: bestHourEntry,
      bestDay: bestDayEntry,
      perAE,
    });
  } catch (error) {
    console.error('Call patterns error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze call patterns' },
      { status: 500 }
    );
  }
}
