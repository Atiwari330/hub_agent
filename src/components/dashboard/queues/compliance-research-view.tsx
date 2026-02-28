'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getHubSpotDealUrl } from '@/lib/hubspot/urls';
import type { ComplianceResearchQueueResponse, ComplianceResearchDeal } from '@/app/api/queues/compliance-research/route';
import type { ComplianceResearchDetails } from '@/app/api/queues/compliance-research/details/route';

// --- Types ---

type StatusFilter = 'all' | 'researched' | 'unresearched' | 'failed';
type SortColumn = 'status' | 'dealName' | 'amount' | 'stage' | 'location' | 'researchedAt';
type SortDirection = 'asc' | 'desc';

// --- Helper Components ---

function ResearchStatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
        Pending
      </span>
    );
  }
  const styles: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-700',
    researching: 'bg-blue-100 text-blue-700',
    failed: 'bg-red-100 text-red-700',
    pending: 'bg-gray-100 text-gray-500',
  };
  const labels: Record<string, string> = {
    completed: 'Researched',
    researching: 'Researching...',
    failed: 'Failed',
    pending: 'Pending',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-500'}`}>
      {labels[status] || status}
    </span>
  );
}

function ConfidenceBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? 'bg-emerald-100 text-emerald-700' : pct >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {pct}%
    </span>
  );
}

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) {
    return (
      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    );
  }
  return direction === 'asc' ? (
    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatCurrency(amount: number | null): string {
  if (amount === null) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

// --- Constants ---

const STATUS_ORDER: Record<string, number> = { completed: 3, failed: 2, researching: 1, pending: 0 };

// --- Detail Modal ---

function ComplianceDetailModal({
  domain,
  onClose,
}: {
  domain: string;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<ComplianceResearchDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['executive_summary', 'talking_points'])
  );

  useEffect(() => {
    async function fetchDetails() {
      try {
        const res = await fetch(`/api/queues/compliance-research/details?domain=${encodeURIComponent(domain)}`);
        if (!res.ok) throw new Error('Failed to fetch details');
        const data: ComplianceResearchDetails = await res.json();
        setDetails(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchDetails();
  }, [domain]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const sections = details
    ? [
        {
          key: 'executive_summary',
          title: 'Executive Summary',
          count: details.executive_summary ? 1 : 0,
          content: details.executive_summary ? (
            <div className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">
              {details.executive_summary}
            </div>
          ) : null,
        },
        {
          key: 'talking_points',
          title: 'Key Talking Points',
          count: details.key_talking_points.length,
          content:
            details.key_talking_points.length > 0 ? (
              <ul className="space-y-2">
                {details.key_talking_points.map((point, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-indigo-500 mt-0.5 flex-shrink-0">&#x2022;</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            ) : null,
        },
        {
          key: 'state_requirements',
          title: 'State Requirements',
          count: details.state_requirements.length,
          content:
            details.state_requirements.length > 0 ? (
              <div className="space-y-3">
                {details.state_requirements.map((req, i) => (
                  <div key={i} className="border-l-2 border-indigo-200 pl-3">
                    <div className="font-medium text-sm text-gray-900">{req.requirement}</div>
                    <div className="text-sm text-gray-600 mt-0.5">{req.description}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{req.category}</span>
                      {req.source_url && (
                        <a href={req.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline">
                          Source
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : null,
        },
        {
          key: 'screening_tools',
          title: 'Screening Tools & Assessments',
          count: details.screening_tools.length,
          content:
            details.screening_tools.length > 0 ? (
              <div className="space-y-3">
                {details.screening_tools.map((tool, i) => (
                  <div key={i} className="border-l-2 border-purple-200 pl-3">
                    <div className="font-medium text-sm text-gray-900">{tool.name}</div>
                    <div className="text-sm text-gray-600 mt-0.5">{tool.description}</div>
                    <div className="text-xs text-gray-500 mt-1">When required: {tool.when_required}</div>
                    {tool.source_url && (
                      <a href={tool.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline">
                        Source
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : null,
        },
        {
          key: 'reporting_platforms',
          title: 'Reporting Platforms',
          count: details.reporting_platforms.length,
          content:
            details.reporting_platforms.length > 0 ? (
              <div className="space-y-3">
                {details.reporting_platforms.map((platform, i) => (
                  <div key={i} className="border-l-2 border-blue-200 pl-3">
                    <div className="font-medium text-sm text-gray-900">{platform.name}</div>
                    <div className="text-sm text-gray-600 mt-0.5">{platform.description}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-400">{platform.state}</span>
                      {platform.url && (
                        <a href={platform.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">
                          Platform
                        </a>
                      )}
                      {platform.source_url && (
                        <a href={platform.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline">
                          Source
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : null,
        },
        {
          key: 'licensing_requirements',
          title: 'Licensing & Certification',
          count: details.licensing_requirements.length,
          content:
            details.licensing_requirements.length > 0 ? (
              <div className="space-y-3">
                {details.licensing_requirements.map((lic, i) => (
                  <div key={i} className="border-l-2 border-amber-200 pl-3">
                    <div className="font-medium text-sm text-gray-900">{lic.requirement}</div>
                    <div className="text-xs text-gray-500">Issued by: {lic.issuing_body}</div>
                    <div className="text-sm text-gray-600 mt-0.5">{lic.description}</div>
                    {lic.source_url && (
                      <a href={lic.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline mt-1 block">
                        Source
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : null,
        },
        {
          key: 'payor_requirements',
          title: 'Payor Requirements',
          count: details.payor_requirements.length,
          content:
            details.payor_requirements.length > 0 ? (
              <div className="space-y-3">
                {details.payor_requirements.map((payor, i) => (
                  <div key={i} className="border-l-2 border-green-200 pl-3">
                    <div className="font-medium text-sm text-gray-900">{payor.payor}</div>
                    <ul className="mt-1 space-y-0.5">
                      {payor.requirements.map((req, j) => (
                        <li key={j} className="text-sm text-gray-600 flex items-start gap-1.5">
                          <span className="text-gray-400 mt-0.5 flex-shrink-0">-</span>
                          <span>{req}</span>
                        </li>
                      ))}
                    </ul>
                    {payor.source_url && (
                      <a href={payor.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline mt-1 block">
                        Source
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : null,
        },
        {
          key: 'documentation_standards',
          title: 'Documentation Standards',
          count: details.documentation_standards.length,
          content:
            details.documentation_standards.length > 0 ? (
              <div className="space-y-3">
                {details.documentation_standards.map((doc, i) => (
                  <div key={i} className="border-l-2 border-teal-200 pl-3">
                    <div className="font-medium text-sm text-gray-900">{doc.standard}</div>
                    <div className="text-sm text-gray-600 mt-0.5">{doc.description}</div>
                    <div className="text-xs text-gray-500 mt-1">Applies to: {doc.applies_to}</div>
                    {doc.source_url && (
                      <a href={doc.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline mt-1 block">
                        Source
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : null,
        },
        {
          key: 'accreditation_info',
          title: 'Accreditation',
          count: details.accreditation_info.length,
          content:
            details.accreditation_info.length > 0 ? (
              <div className="space-y-3">
                {details.accreditation_info.map((acc, i) => (
                  <div key={i} className="border-l-2 border-rose-200 pl-3">
                    <div className="font-medium text-sm text-gray-900">{acc.body}: {acc.requirement}</div>
                    <div className="text-sm text-gray-600 mt-0.5">{acc.description}</div>
                    {acc.source_url && (
                      <a href={acc.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline mt-1 block">
                        Source
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : null,
        },
        {
          key: 'sources',
          title: 'Sources',
          count: details.source_urls.length,
          content:
            details.source_urls.length > 0 ? (
              <ul className="space-y-1">
                {details.source_urls.map((url, i) => (
                  <li key={i}>
                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 hover:underline break-all">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null,
        },
      ]
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl max-w-3xl w-full mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Compliance Research</h2>
            <p className="text-sm text-gray-500">{domain}</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
            </div>
          )}
          {error && (
            <div className="text-red-600 text-sm py-4">{error}</div>
          )}
          {details && (
            <div className="space-y-3">
              {/* Confidence badge */}
              <div className="flex items-center gap-2">
                <ConfidenceBadge score={details.confidence_score} />
                {details.researched_at && (
                  <span className="text-xs text-gray-400">Researched {formatRelativeTime(details.researched_at)}</span>
                )}
                {details.research_context.state && (
                  <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">
                    {details.research_context.state}
                  </span>
                )}
              </div>

              {/* Sections */}
              {sections.map((section) => (
                <div key={section.key} className="border border-gray-200 rounded-lg">
                  <button
                    onClick={() => toggleSection(section.key)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{section.title}</span>
                      {section.count > 0 && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                          {section.count}
                        </span>
                      )}
                    </div>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${expandedSections.has(section.key) ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {expandedSections.has(section.key) && section.content && (
                    <div className="px-4 pb-4">
                      {section.content}
                    </div>
                  )}
                  {expandedSections.has(section.key) && !section.content && (
                    <div className="px-4 pb-4 text-sm text-gray-400 italic">No data available</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main Component ---

export function ComplianceResearchView() {
  const [data, setData] = useState<ComplianceResearchQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [researchingDeals, setResearchingDeals] = useState<Set<string>>(new Set());
  const [detailDomain, setDetailDomain] = useState<string | null>(null);

  // Batch state
  const [isBatchResearching, setIsBatchResearching] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    currentDeal: string;
    successful: number;
    failed: number;
  } | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    dealIds: string[];
    count: number;
  } | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [aeFilter, setAeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Sorting
  const [sortColumn, setSortColumn] = useState<SortColumn>('amount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Checkbox selection
  const [selectedDeals, setSelectedDeals] = useState<Set<string>>(new Set());

  // --- Data Fetching ---

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/queues/compliance-research');
      if (!response.ok) throw new Error('Failed to fetch compliance research data');
      const json: ComplianceResearchQueueResponse = await response.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Derived data ---

  const aeOptions = useMemo(() => {
    if (!data) return [];
    const names = new Set<string>();
    for (const d of data.deals) {
      if (d.ownerName) names.add(d.ownerName);
    }
    return Array.from(names).sort();
  }, [data]);

  // --- Sorting & Filtering ---

  const processedDeals = useMemo(() => {
    if (!data) return [];
    let result = [...data.deals];

    // Status filter
    if (statusFilter === 'researched') {
      result = result.filter((d) => d.research?.status === 'completed');
    } else if (statusFilter === 'unresearched') {
      result = result.filter((d) => !d.research || d.research.status === 'pending');
    } else if (statusFilter === 'failed') {
      result = result.filter((d) => d.research?.status === 'failed');
    }

    // AE filter
    if (aeFilter !== 'all') {
      result = result.filter((d) => d.ownerName === aeFilter);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (d) =>
          d.dealName?.toLowerCase().includes(q) ||
          d.companyName?.toLowerCase().includes(q) ||
          d.domain?.toLowerCase().includes(q) ||
          d.locations.some((l) => l.toLowerCase().includes(q)) ||
          d.services.some((s) => s.toLowerCase().includes(q))
      );
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'status':
          comparison = (STATUS_ORDER[a.research?.status || 'pending'] || 0) - (STATUS_ORDER[b.research?.status || 'pending'] || 0);
          break;
        case 'dealName':
          comparison = (a.dealName || '').localeCompare(b.dealName || '');
          break;
        case 'amount':
          comparison = (a.amount || 0) - (b.amount || 0);
          break;
        case 'stage':
          comparison = a.stageName.localeCompare(b.stageName);
          break;
        case 'location':
          comparison = (a.locations[0] || '').localeCompare(b.locations[0] || '');
          break;
        case 'researchedAt': {
          const aTime = a.research?.researchedAt ? new Date(a.research.researchedAt).getTime() : 0;
          const bTime = b.research?.researchedAt ? new Date(b.research.researchedAt).getTime() : 0;
          comparison = aTime - bTime;
          break;
        }
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [data, statusFilter, aeFilter, searchQuery, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const hasActiveFilters = statusFilter !== 'all' || aeFilter !== 'all' || searchQuery.trim() !== '';

  const clearFilters = () => {
    setStatusFilter('all');
    setAeFilter('all');
    setSearchQuery('');
  };

  // --- Selection ---

  const toggleSelect = (dealId: string) => {
    setSelectedDeals((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) next.delete(dealId);
      else next.add(dealId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedDeals.size === processedDeals.length) {
      setSelectedDeals(new Set());
    } else {
      setSelectedDeals(new Set(processedDeals.map((d) => d.dealId)));
    }
  };

  // --- Actions ---

  const researchDeal = async (deal: ComplianceResearchDeal, force?: boolean) => {
    setResearchingDeals((prev) => new Set(prev).add(deal.dealId));

    try {
      const response = await fetch('/api/queues/compliance-research/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId: deal.dealId, force }),
      });

      if (!response.ok) throw new Error('Research failed');
      await fetchData();
    } catch (err) {
      console.error('Research failed:', err);
    } finally {
      setResearchingDeals((prev) => {
        const next = new Set(prev);
        next.delete(deal.dealId);
        return next;
      });
    }
  };

  const batchResearch = async (dealIds: string[], force?: boolean) => {
    if (!data || dealIds.length === 0) return;

    const totalDeals = dealIds.length;
    const CHUNK_SIZE = 100;

    setIsBatchResearching(true);
    setBatchProgress({ current: 0, total: totalDeals, currentDeal: '', successful: 0, failed: 0 });

    const abortController = new AbortController();
    batchAbortRef.current = abortController;

    let cumulativeSuccessful = 0;
    let cumulativeFailed = 0;

    try {
      for (let chunkStart = 0; chunkStart < totalDeals; chunkStart += CHUNK_SIZE) {
        if (abortController.signal.aborted) break;

        const chunkIds = dealIds.slice(chunkStart, chunkStart + CHUNK_SIZE);
        const chunkOffset = chunkStart;

        const response = await fetch('/api/queues/compliance-research/batch-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dealIds: chunkIds, force }),
          signal: abortController.signal,
        });

        if (!response.ok) throw new Error('Batch research failed to start');

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const dataLine = line.trim();
            if (!dataLine.startsWith('data: ')) continue;

            try {
              const event = JSON.parse(dataLine.slice(6));

              if (event.type === 'progress') {
                if (event.status === 'success') cumulativeSuccessful++;
                if (event.status === 'error') cumulativeFailed++;

                setBatchProgress({
                  current: chunkOffset + event.index,
                  total: totalDeals,
                  currentDeal: event.dealName || '',
                  successful: cumulativeSuccessful,
                  failed: cumulativeFailed,
                });
              }
            } catch {
              // Skip malformed events
            }
          }
        }
      }

      setBatchProgress({
        current: totalDeals,
        total: totalDeals,
        currentDeal: '',
        successful: cumulativeSuccessful,
        failed: cumulativeFailed,
      });

      await fetchData();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        await fetchData();
      } else {
        console.error('Batch research error:', err);
      }
    } finally {
      setIsBatchResearching(false);
      batchAbortRef.current = null;
      setSelectedDeals(new Set());
    }
  };

  const cancelBatch = () => {
    batchAbortRef.current?.abort();
  };

  const handleResearchUnresearched = () => {
    if (!data) return;
    const ids = data.deals
      .filter((d) => !d.research || d.research.status === 'pending')
      .map((d) => d.dealId);
    if (ids.length === 0) return;
    setConfirmDialog({ dealIds: ids, count: ids.length });
  };

  const handleResearchSelected = () => {
    const ids = Array.from(selectedDeals);
    if (ids.length === 0) return;
    setConfirmDialog({ dealIds: ids, count: ids.length });
  };

  const confirmResearch = () => {
    if (!confirmDialog) return;
    const ids = confirmDialog.dealIds;
    setConfirmDialog(null);
    batchResearch(ids);
  };

  // --- Render ---

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Compliance Research</h1>
        <p className="text-sm text-gray-600 mt-1">
          Research state-specific compliance requirements for enriched deals — documentation standards, screening tools, reporting platforms, and licensing obligations.
        </p>
      </div>

      {/* Summary Cards */}
      {!loading && data && data.counts.total > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <div className="text-3xl font-bold text-gray-900">{data.counts.total}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mt-0.5">Enriched Deals</div>
            </div>
            <div className="h-12 w-px bg-gray-200" />
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span>{data.counts.researched} researched</span>
              <span className="text-gray-300">|</span>
              <span>{data.counts.unresearched} unresearched</span>
            </div>
            <div className="h-12 w-px bg-gray-200" />
            <div className="flex items-center gap-3">
              {data.counts.researched > 0 && (
                <button
                  onClick={() => setStatusFilter(statusFilter === 'researched' ? 'all' : 'researched')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === 'researched' ? 'bg-emerald-100 text-emerald-800 ring-2 ring-emerald-300' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  {data.counts.researched} Researched
                </button>
              )}
              {data.counts.failed > 0 && (
                <button
                  onClick={() => setStatusFilter(statusFilter === 'failed' ? 'all' : 'failed')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === 'failed' ? 'bg-red-100 text-red-800 ring-2 ring-red-300' : 'bg-red-50 text-red-700 hover:bg-red-100'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  {data.counts.failed} Failed
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons & Filters */}
      {!loading && data && data.counts.total > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {/* Batch Actions */}
          {!isBatchResearching && (
            <>
              {data.counts.unresearched > 0 && (
                <button
                  onClick={handleResearchUnresearched}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Research All Unresearched ({data.counts.unresearched})
                </button>
              )}
              {selectedDeals.size > 0 && (
                <button
                  onClick={handleResearchSelected}
                  className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
                >
                  Research Selected ({selectedDeals.size})
                </button>
              )}
            </>
          )}

          {/* Batch Progress */}
          {isBatchResearching && batchProgress && (
            <div className="flex items-center gap-3 flex-1">
              <div className="flex-1">
                <div className="flex justify-between text-sm text-gray-600 mb-1">
                  <span>Researching: {batchProgress.currentDeal || 'Starting...'}</span>
                  <span>
                    {batchProgress.current}/{batchProgress.total}
                    {batchProgress.failed > 0 && ` (${batchProgress.failed} failed)`}
                  </span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full">
                  <div
                    className="h-full bg-indigo-600 rounded-full transition-all"
                    style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                  />
                </div>
              </div>
              <button
                onClick={cancelBatch}
                className="px-3 py-1.5 bg-red-100 text-red-700 text-sm font-medium rounded-lg hover:bg-red-200"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Search */}
          <input
            type="text"
            placeholder="Search deals, companies, locations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64"
          />

          {/* AE Filter */}
          <select
            value={aeFilter}
            onChange={(e) => setAeFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All AEs</option>
            {aeOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg"
            >
              Clear Filters
            </button>
          )}
        </div>
      )}

      {/* Loading / Error States */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && data && data.counts.total === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg font-medium">No enriched deals found</p>
          <p className="text-sm mt-1">Run Domain Enrichment first to populate this queue.</p>
        </div>
      )}

      {/* Table */}
      {!loading && data && data.counts.total > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-3 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedDeals.size === processedDeals.length && processedDeals.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="px-3 py-3 text-left">
                    <button onClick={() => handleSort('status')} className="flex items-center gap-1 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status <SortIcon active={sortColumn === 'status'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <button onClick={() => handleSort('dealName')} className="flex items-center gap-1 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Deal <SortIcon active={sortColumn === 'dealName'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-right">
                    <button onClick={() => handleSort('amount')} className="flex items-center gap-1 text-xs font-medium text-gray-500 uppercase tracking-wider ml-auto">
                      Amount <SortIcon active={sortColumn === 'amount'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <button onClick={() => handleSort('stage')} className="flex items-center gap-1 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Stage <SortIcon active={sortColumn === 'stage'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Company
                  </th>
                  <th className="px-3 py-3 text-left">
                    <button onClick={() => handleSort('location')} className="flex items-center gap-1 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Location <SortIcon active={sortColumn === 'location'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Services
                  </th>
                  <th className="px-3 py-3 text-left">
                    <button onClick={() => handleSort('researchedAt')} className="flex items-center gap-1 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Researched <SortIcon active={sortColumn === 'researchedAt'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {processedDeals.map((deal) => {
                  const isResearching = researchingDeals.has(deal.dealId);
                  const isSelected = selectedDeals.has(deal.dealId);

                  return (
                    <tr
                      key={deal.dealId}
                      className={`hover:bg-gray-50 transition-colors ${isSelected ? 'bg-indigo-50' : ''}`}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(deal.dealId)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <ResearchStatusBadge status={deal.research?.status || null} />
                        {deal.research?.confidenceScore !== undefined && deal.research?.confidenceScore !== null && (
                          <div className="mt-1">
                            <ConfidenceBadge score={deal.research.confidenceScore} />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <a
                          href={getHubSpotDealUrl(deal.dealId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-indigo-600 hover:underline"
                        >
                          {deal.dealName || 'Unnamed'}
                        </a>
                        {deal.ownerName && (
                          <div className="text-xs text-gray-400 mt-0.5">{deal.ownerName}</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-gray-700">
                        {formatCurrency(deal.amount)}
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-700">{deal.stageName}</td>
                      <td className="px-3 py-3">
                        <div className="text-sm text-gray-700">{deal.companyName || '-'}</div>
                        {deal.domain && (
                          <div className="text-xs text-gray-400">{deal.domain}</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-700">
                        {deal.locations.length > 0 ? deal.locations.slice(0, 2).join(', ') : '-'}
                        {deal.locations.length > 2 && (
                          <span className="text-xs text-gray-400"> +{deal.locations.length - 2}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {deal.services.slice(0, 2).map((s, i) => (
                            <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                              {s}
                            </span>
                          ))}
                          {deal.services.length > 2 && (
                            <span className="text-xs text-gray-400">+{deal.services.length - 2}</span>
                          )}
                          {deal.services.length === 0 && <span className="text-xs text-gray-400">-</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-500">
                        {deal.research?.researchedAt
                          ? formatRelativeTime(deal.research.researchedAt)
                          : '-'}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          {deal.research?.status === 'completed' ? (
                            <>
                              <button
                                onClick={() => deal.domain && setDetailDomain(deal.domain)}
                                className="text-xs text-indigo-600 hover:underline font-medium"
                              >
                                View
                              </button>
                              <button
                                onClick={() => researchDeal(deal, true)}
                                disabled={isResearching || isBatchResearching}
                                className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
                              >
                                Re-run
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => researchDeal(deal)}
                              disabled={isResearching || isBatchResearching}
                              className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                            >
                              {isResearching ? (
                                <span className="flex items-center gap-1.5">
                                  <span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
                                  Researching...
                                </span>
                              ) : (
                                'Research'
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-gray-200 text-sm text-gray-500">
            Showing {processedDeals.length} of {data.counts.total} enriched deals
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailDomain && (
        <ComplianceDetailModal
          domain={detailDomain}
          onClose={() => setDetailDomain(null)}
        />
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900">Confirm Batch Research</h3>
            <p className="text-sm text-gray-600 mt-2">
              This will run compliance research on <strong>{confirmDialog.count} deal{confirmDialog.count !== 1 ? 's' : ''}</strong>.
              Each deal requires multiple web searches and Claude analysis, so this may take several minutes.
            </p>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmResearch}
                className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
              >
                Start Research
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
