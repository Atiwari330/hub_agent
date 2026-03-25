import type { ConnectionStatus } from '@/hooks/use-realtime-subscription';

// --- Utility Functions ---

export function computeLiveHours(lastCustomerMessageAt: string | null, lastAgentMessageAt: string | null): number | null {
  if (!lastCustomerMessageAt) return null;
  const customerTime = new Date(lastCustomerMessageAt).getTime();
  const agentTime = lastAgentMessageAt ? new Date(lastAgentMessageAt).getTime() : 0;
  // Only show wait time if customer message is more recent than agent response
  if (agentTime >= customerTime) return null;
  const hours = (Date.now() - customerTime) / (1000 * 60 * 60);
  return hours > 0 ? hours : null;
}

export function formatHours(hours: number): string {
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${Math.round(hours % 24)}h`;
  if (hours >= 1) return `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`;
  return `${Math.round(hours * 60)}m`;
}

// --- Badge Components ---

export function ResponseClock({ hours }: { hours: number | null }) {
  if (hours === null || hours === 0) {
    return <span className="text-xs text-gray-400 font-mono">--</span>;
  }

  let color = 'text-gray-500';
  let bg = 'bg-gray-50';
  if (hours >= 4) {
    color = 'text-red-700';
    bg = 'bg-red-50 border border-red-200';
  } else if (hours >= 2) {
    color = 'text-orange-700';
    bg = 'bg-orange-50 border border-orange-200';
  } else if (hours >= 1) {
    color = 'text-yellow-700';
    bg = 'bg-yellow-50 border border-yellow-200';
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold ${color} ${bg}`}>
      {formatHours(hours)}
    </span>
  );
}

export function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const config: Record<ConnectionStatus, { color: string; label: string }> = {
    connected: { color: 'bg-emerald-500', label: 'Live' },
    connecting: { color: 'bg-yellow-500 animate-pulse', label: 'Connecting...' },
    disconnected: { color: 'bg-red-500', label: 'Offline' },
  };
  const { color, label } = config[status];
  return (
    <div className="flex items-center gap-1.5" title={`Realtime: ${label}`}>
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-[10px] text-gray-400">{label}</span>
    </div>
  );
}

export function StatusTag({ tag }: { tag: string }) {
  const config: Record<string, { label: string; color: string }> = {
    reply_needed: { label: 'Reply Needed', color: 'bg-red-100 text-red-700' },
    update_due: { label: 'Update Due', color: 'bg-yellow-100 text-yellow-700' },
    engineering_ping: { label: 'Eng Ping', color: 'bg-purple-100 text-purple-700' },
    internal_action: { label: 'Internal Action', color: 'bg-blue-100 text-blue-700' },
    waiting_on_customer: { label: 'Waiting', color: 'bg-gray-100 text-gray-500' },
  };
  const { label, color } = config[tag] || { label: tag, color: 'bg-gray-100 text-gray-500' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${color}`}>
      {label}
    </span>
  );
}

export function TemperatureBadge({ temp }: { temp: string }) {
  const config: Record<string, { label: string; color: string }> = {
    angry: { label: 'Angry', color: 'bg-red-100 text-red-700' },
    escalating: { label: 'Escalating', color: 'bg-orange-100 text-orange-700' },
    frustrated: { label: 'Frustrated', color: 'bg-yellow-100 text-yellow-700' },
    calm: { label: 'Calm', color: 'bg-green-100 text-green-700' },
  };
  const { label, color } = config[temp] || { label: temp, color: 'bg-gray-100 text-gray-500' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${color}`}>
      {label}
    </span>
  );
}

export function EscalationRiskBadge({ score }: { score: number | null }) {
  if (score === null || score < 0.6) return null;
  const label = score >= 0.9 ? 'Critical' : score >= 0.75 ? 'High' : 'Elevated';
  const color = score >= 0.9 ? 'bg-red-600 text-white' : score >= 0.75 ? 'bg-orange-500 text-white' : 'bg-yellow-500 text-black';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold ${color}`} title={`Escalation risk: ${Math.round(score * 100)}%`}>
      {label}
    </span>
  );
}

export function AlertSeverityBadge({ severity, label }: { severity: string; label: string }) {
  const colors: Record<string, string> = {
    critical: 'bg-red-900/50 text-red-300 border border-red-800',
    warning: 'bg-orange-900/50 text-orange-300 border border-orange-800',
    info: 'bg-blue-900/50 text-blue-300 border border-blue-800',
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium ${colors[severity] || colors.info}`}>
      {label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const config: Record<string, { label: string; color: string }> = {
    now: { label: 'NOW', color: 'bg-red-600 text-white' },
    today: { label: 'TODAY', color: 'bg-orange-500 text-white' },
    this_week: { label: 'THIS WEEK', color: 'bg-blue-500 text-white' },
  };
  const { label, color } = config[priority] || { label: priority, color: 'bg-gray-500 text-white' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold ${color}`}>
      {label}
    </span>
  );
}

export function WhoBadge({ who }: { who: string }) {
  const config: Record<string, { label: string; color: string }> = {
    any_support_agent: { label: 'Support', color: 'bg-blue-50 text-blue-600' },
    engineering: { label: 'Engineering', color: 'bg-purple-50 text-purple-600' },
    cs_manager: { label: 'CS Manager', color: 'bg-orange-50 text-orange-600' },
  };
  const { label, color } = config[who] || { label: who, color: 'bg-gray-50 text-gray-600' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${color}`}>
      {label}
    </span>
  );
}

export function AnalyzedTimestamp({ dateStr }: { dateStr: string }) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let label: string;
  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMin = Math.floor(diffMs / (1000 * 60));
      label = `${diffMin}m ago`;
    } else {
      label = `${diffHours}h ago`;
    }
  } else if (diffDays === 1) {
    label = 'Yesterday';
  } else {
    label = `${diffDays}d ago`;
  }

  return <span className="text-xs text-gray-400">{label}</span>;
}

export function LinearBadge({ state }: { state: string }) {
  const stateColors: Record<string, string> = {
    'In Progress': 'bg-blue-100 text-blue-700',
    'Done': 'bg-emerald-100 text-emerald-700',
    'Todo': 'bg-yellow-100 text-yellow-700',
    'Backlog': 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${stateColors[state] || 'bg-gray-100 text-gray-600'}`}>
      {state}
    </span>
  );
}
