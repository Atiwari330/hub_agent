'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { formatCurrency } from '@/lib/utils/currency';
import { getHubSpotCompanyUrl } from '@/lib/hubspot/urls';
import type { CSHygieneCompany, CSHygieneQueueResponse } from '@/app/api/queues/cs-hygiene/route';

type SortColumn = 'name' | 'arr' | 'contractStatus' | 'contractEnd' | 'ownerName';
type SortDirection = 'asc' | 'desc';

// Color scheme for missing fields
const MISSING_FIELD_COLORS: Record<string, string> = {
  'Sentiment': 'bg-red-100 text-red-700',
  'Renewal': 'bg-orange-100 text-orange-700',
  'Contract End Date': 'bg-pink-100 text-pink-700',
  'MRR': 'bg-purple-100 text-purple-700',
  'Contract Status': 'bg-blue-100 text-blue-700',
  'QBR Notes': 'bg-cyan-100 text-cyan-700',
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

export function CSHygieneQueueView() {
  const [data, setData] = useState<CSHygieneQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [missingFieldFilter, setMissingFieldFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [statusFilterInitialized, setStatusFilterInitialized] = useState(false);

  // Sorting - default to ARR descending
  const [sortColumn, setSortColumn] = useState<SortColumn>('arr');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Selection
  const [selectedCompanies, setSelectedCompanies] = useState<Set<string>>(new Set());

  // Task creation state
  const [creatingTasks, setCreatingTasks] = useState<Set<string>>(new Set());

  // Success notification state
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (missingFieldFilter !== 'all') {
        params.set('missingField', missingFieldFilter);
      }
      const url = `/api/queues/cs-hygiene${params.toString() ? `?${params}` : ''}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch CS hygiene queue');
      }
      const json: CSHygieneQueueResponse = await response.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [missingFieldFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Extract unique owners from data
  const uniqueOwners = useMemo(() => {
    if (!data) return [];
    const owners = new Map<string, string>();
    for (const company of data.companies) {
      if (company.hubspotOwnerId && company.ownerName) {
        owners.set(company.hubspotOwnerId, company.ownerName);
      }
    }
    return Array.from(owners.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  // Extract unique missing fields for filter dropdown
  const uniqueMissingFields = useMemo(() => {
    if (!data) return [];
    const fields = new Set<string>();
    for (const company of data.companies) {
      for (const mf of company.missingFields) {
        fields.add(mf.label);
      }
    }
    return Array.from(fields).sort();
  }, [data]);

  // Extract unique statuses from data
  const uniqueStatuses = useMemo(() => {
    if (!data) return [];
    const statuses = new Set<string>();
    for (const company of data.companies) {
      if (company.contractStatus) {
        statuses.add(company.contractStatus);
      }
    }
    return Array.from(statuses).sort();
  }, [data]);

  // Initialize status filter with all statuses except "Inactive"
  useEffect(() => {
    if (data && uniqueStatuses.length > 0 && !statusFilterInitialized) {
      const defaultStatuses = uniqueStatuses.filter(s => s !== 'Inactive');
      setStatusFilter(defaultStatuses);
      setStatusFilterInitialized(true);
    }
  }, [data, uniqueStatuses, statusFilterInitialized]);

  // Filtered and sorted companies
  const processedCompanies = useMemo(() => {
    if (!data) return [];

    let result = [...data.companies];

    // Apply owner filter
    if (ownerFilter !== 'all') {
      result = result.filter((c) => c.hubspotOwnerId === ownerFilter);
    }

    // Apply status filter (only if initialized and has selections)
    if (statusFilterInitialized && statusFilter.length > 0) {
      result = result.filter((c) =>
        c.contractStatus && statusFilter.includes(c.contractStatus)
      );
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'name':
          comparison = (a.name || '').localeCompare(b.name || '');
          break;
        case 'arr':
          comparison = (a.arr || 0) - (b.arr || 0);
          break;
        case 'contractStatus':
          comparison = (a.contractStatus || '').localeCompare(b.contractStatus || '');
          break;
        case 'contractEnd':
          if (!a.contractEnd && !b.contractEnd) comparison = 0;
          else if (!a.contractEnd) comparison = 1;
          else if (!b.contractEnd) comparison = -1;
          else comparison = new Date(a.contractEnd).getTime() - new Date(b.contractEnd).getTime();
          break;
        case 'ownerName':
          comparison = (a.ownerName || '').localeCompare(b.ownerName || '');
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [data, ownerFilter, statusFilter, statusFilterInitialized, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const handleSelectAll = () => {
    if (selectedCompanies.size === processedCompanies.length) {
      setSelectedCompanies(new Set());
    } else {
      setSelectedCompanies(new Set(processedCompanies.map((c) => c.id)));
    }
  };

  const handleSelectCompany = (companyId: string) => {
    const newSelected = new Set(selectedCompanies);
    if (newSelected.has(companyId)) {
      newSelected.delete(companyId);
    } else {
      newSelected.add(companyId);
    }
    setSelectedCompanies(newSelected);
  };

  const handleCreateTask = async (company: CSHygieneCompany, skipRefresh = false) => {
    if (!company.hubspotOwnerId) {
      alert('Cannot create task: Company has no owner assigned');
      return;
    }

    setCreatingTasks((prev) => new Set(prev).add(company.id));

    try {
      const response = await fetch('/api/queues/create-cs-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: company.id,
          hubspotCompanyId: company.hubspotCompanyId,
          hubspotOwnerId: company.hubspotOwnerId,
          companyName: company.name || 'Unnamed Company',
          missingFields: company.missingFields.map((f) => f.label),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create task');
      }

      // Show success message
      setSuccessMessage(`Task created for ${company.name || 'company'}`);

      if (!skipRefresh) {
        await fetchData();
      }
    } catch (err) {
      console.error('Failed to create task:', err);
      alert(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setCreatingTasks((prev) => {
        const next = new Set(prev);
        next.delete(company.id);
        return next;
      });
    }
  };

  const handleCreateTasksForSelected = async () => {
    const companiesToProcess = processedCompanies.filter(
      (c) => selectedCompanies.has(c.id) && c.hubspotOwnerId && (!c.existingTask || !c.existingTask.coversAllCurrentFields)
    );

    for (const company of companiesToProcess) {
      await handleCreateTask(company, true);
    }

    // Show success message for bulk creation
    if (companiesToProcess.length > 0) {
      setSuccessMessage(`Tasks created for ${companiesToProcess.length} ${companiesToProcess.length === 1 ? 'company' : 'companies'}`);
    }

    await fetchData();
    setSelectedCompanies(new Set());
  };

  // Auto-dismiss success message after 4 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Check if status filter differs from default (all except Inactive)
  const defaultStatuses = useMemo(() =>
    uniqueStatuses.filter(s => s !== 'Inactive'),
    [uniqueStatuses]
  );

  const statusFilterDiffersFromDefault = statusFilterInitialized && (
    statusFilter.length !== defaultStatuses.length ||
    !statusFilter.every(s => defaultStatuses.includes(s))
  );

  const hasActiveFilters = ownerFilter !== 'all' || missingFieldFilter !== 'all' || statusFilterDiffersFromDefault;

  const clearFilters = () => {
    setOwnerFilter('all');
    setMissingFieldFilter('all');
    setStatusFilter(defaultStatuses);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">CS Hygiene Queue</h1>
          <p className="text-sm text-gray-600 mt-1">
            Customer accounts missing required CS properties, sorted by ARR.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          {selectedCompanies.size > 0 && (
            <button
              onClick={handleCreateTasksForSelected}
              disabled={creatingTasks.size > 0}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                />
              </svg>
              Create Tasks ({selectedCompanies.size})
            </button>
          )}
        </div>
      </div>

      {/* Success Notification */}
      {successMessage && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 animate-in fade-in slide-in-from-top-2 duration-300">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm font-medium">{successMessage}</span>
          <button
            onClick={() => setSuccessMessage(null)}
            className="ml-auto text-emerald-500 hover:text-emerald-700"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Owner Filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Owner:</label>
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Owners</option>
            {uniqueOwners.map((owner) => (
              <option key={owner.id} value={owner.id}>{owner.name}</option>
            ))}
          </select>
        </div>

        {/* Missing Field Filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Missing:</label>
          <select
            value={missingFieldFilter}
            onChange={(e) => setMissingFieldFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Fields</option>
            {uniqueMissingFields.map((field) => (
              <option key={field} value={field}>{field}</option>
            ))}
          </select>
        </div>

        {/* Status Filter (multi-select) */}
        <div className="flex items-center gap-2 relative">
          <label className="text-sm text-gray-600">Status:</label>
          <button
            onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 flex items-center gap-2 min-w-[120px]"
          >
            <span>
              {statusFilter.length === 0
                ? 'None'
                : statusFilter.length === uniqueStatuses.length
                  ? 'All Statuses'
                  : `${statusFilter.length} Status${statusFilter.length > 1 ? 'es' : ''}`}
            </span>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${statusDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {statusDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setStatusDropdownOpen(false)}
              />
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-20 min-w-[200px] max-h-[300px] overflow-y-auto">
                {uniqueStatuses.map((status) => (
                  <label
                    key={status}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={statusFilter.includes(status)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setStatusFilter([...statusFilter, status]);
                        } else {
                          setStatusFilter(statusFilter.filter((s) => s !== status));
                        }
                      }}
                      className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                    />
                    <span className="text-gray-700">{status}</span>
                  </label>
                ))}
                <div className="border-t border-gray-200">
                  {statusFilter.length === uniqueStatuses.length ? (
                    <button
                      onClick={() => setStatusFilter([])}
                      className="w-full px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 text-left"
                    >
                      Clear selection
                    </button>
                  ) : (
                    <button
                      onClick={() => setStatusFilter([...uniqueStatuses])}
                      className="w-full px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 text-left"
                    >
                      Select all
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear filters
          </button>
        )}

        <div className="ml-auto text-sm text-gray-500">
          {processedCompanies.length} {processedCompanies.length === 1 ? 'company' : 'companies'}
          {selectedCompanies.size > 0 && ` (${selectedCompanies.size} selected)`}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={fetchData}
            className="mt-2 text-sm text-red-600 hover:text-red-800 font-medium"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && processedCompanies.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">All caught up!</h3>
          <p className="mt-1 text-sm text-gray-500">
            {hasActiveFilters
              ? 'No companies match the current filters.'
              : 'All customer accounts have complete CS hygiene data.'}
          </p>
        </div>
      )}

      {/* Companies Table */}
      {!loading && !error && processedCompanies.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-gray-200">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedCompanies.size === processedCompanies.length && processedCompanies.length > 0}
                      onChange={handleSelectAll}
                      className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                    />
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('name')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Company</span>
                      <SortIcon active={sortColumn === 'name'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('arr')}
                  >
                    <div className="flex items-center gap-1">
                      <span>ARR</span>
                      <SortIcon active={sortColumn === 'arr'} direction={sortDirection} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    MRR
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('contractStatus')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Status</span>
                      <SortIcon active={sortColumn === 'contractStatus'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('contractEnd')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Contract End</span>
                      <SortIcon active={sortColumn === 'contractEnd'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('ownerName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Owner</span>
                      <SortIcon active={sortColumn === 'ownerName'} direction={sortDirection} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Missing Fields
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {processedCompanies.map((company) => {
                  const isCreating = creatingTasks.has(company.id);
                  const hasTask = company.existingTask !== null;
                  const taskCoversAll = company.existingTask?.coversAllCurrentFields ?? false;

                  const formatTaskDate = (dateStr: string) => {
                    const date = new Date(dateStr);
                    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  };

                  return (
                    <tr
                      key={company.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        selectedCompanies.has(company.id) ? 'bg-indigo-50' : ''
                      } ${hasTask && taskCoversAll ? 'bg-emerald-50/50' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedCompanies.has(company.id)}
                          onChange={() => handleSelectCompany(company.id)}
                          className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={getHubSpotCompanyUrl(company.hubspotCompanyId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-gray-900 hover:text-indigo-600 transition-colors"
                        >
                          {company.name || 'Unnamed Company'}
                        </a>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                          {company.arr ? formatCurrency(company.arr) : '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600 whitespace-nowrap">
                          {company.mrr ? formatCurrency(company.mrr) : '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600">
                          {company.contractStatus || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600 whitespace-nowrap">
                          {formatDate(company.contractEnd)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600">
                          {company.ownerName || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {company.missingFields.map((field) => (
                            <span
                              key={field.field}
                              className={`px-2 py-0.5 text-xs font-medium rounded ${
                                MISSING_FIELD_COLORS[field.label] || 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {field.label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          {hasTask && taskCoversAll ? (
                            <div className="flex items-center gap-2">
                              <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Task Created {formatTaskDate(company.existingTask!.createdAt)}
                              </span>
                              <button
                                onClick={() => handleCreateTask(company)}
                                disabled={isCreating || !company.hubspotOwnerId}
                                className="text-xs text-gray-500 hover:text-gray-700 underline disabled:opacity-50"
                              >
                                Re-create
                              </button>
                            </div>
                          ) : hasTask && !taskCoversAll ? (
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-amber-600">
                                Task created {formatTaskDate(company.existingTask!.createdAt)} for other fields
                              </span>
                              <button
                                onClick={() => handleCreateTask(company)}
                                disabled={isCreating || !company.hubspotOwnerId}
                                className="px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 rounded hover:bg-emerald-100 transition-colors whitespace-nowrap disabled:opacity-50 w-fit"
                              >
                                {isCreating ? (
                                  <span className="flex items-center gap-1">
                                    <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Creating...
                                  </span>
                                ) : (
                                  'Create Task for New Fields'
                                )}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleCreateTask(company)}
                              disabled={isCreating || !company.hubspotOwnerId}
                              className="px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 rounded hover:bg-emerald-100 transition-colors whitespace-nowrap disabled:opacity-50"
                              title={!company.hubspotOwnerId ? 'Company has no owner assigned' : undefined}
                            >
                              {isCreating ? (
                                <span className="flex items-center gap-1">
                                  <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  Creating...
                                </span>
                              ) : (
                                'Create Task'
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
        </div>
      )}
    </div>
  );
}
