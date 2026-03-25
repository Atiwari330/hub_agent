'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/browser';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export type PostgresEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export interface TableSubscription {
  table: string;
  event: PostgresEvent;
  schema?: string;
  filter?: string;
  onPayload: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
}

interface UseRealtimeOptions {
  channelName: string;
  subscriptions: TableSubscription[];
  enabled?: boolean;
}

export function useRealtimeSubscription({
  channelName,
  subscriptions,
  enabled = true,
}: UseRealtimeOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabase = useMemo(() => createClient(), []);

  // Store subscriptions in a ref to avoid re-subscribing on every render
  const subscriptionsRef = useRef(subscriptions);
  subscriptionsRef.current = subscriptions;

  const subscribe = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    setStatus('connecting');

    let channel = supabase.channel(channelName);

    for (const sub of subscriptionsRef.current) {
      const params: Record<string, string> = {
        event: sub.event,
        schema: sub.schema || 'public',
        table: sub.table,
      };
      if (sub.filter) {
        params.filter = sub.filter;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      channel = channel.on('postgres_changes' as any, params as any, sub.onPayload as any);
    }

    channel.subscribe((subscribedStatus) => {
      if (subscribedStatus === 'SUBSCRIBED') {
        setStatus('connected');
      } else if (subscribedStatus === 'CLOSED' || subscribedStatus === 'CHANNEL_ERROR') {
        setStatus('disconnected');
      } else {
        setStatus('connecting');
      }
    });

    channelRef.current = channel;
  }, [supabase, channelName]);

  useEffect(() => {
    if (!enabled) {
      setStatus('disconnected');
      return;
    }

    subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [subscribe, enabled, supabase]);

  return { status };
}
