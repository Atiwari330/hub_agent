'use client';

import { useState, useRef, useEffect } from 'react';

// Queue-specific preset templates
const PRESET_TEMPLATES: Record<string, Array<{ label: string; prompt: string }>> = {
  hygiene: [
    { label: 'Follow up on status', prompt: 'Follow up on the current deal status and get an update' },
    { label: 'Request field updates', prompt: 'Request the AE to update the missing deal fields' },
    { label: 'Verify deal details', prompt: 'Verify that the deal details are accurate and up to date' },
  ],
  'next-step': [
    { label: 'Check on progress', prompt: 'Check on the progress of the next step action' },
    { label: 'Schedule follow-up', prompt: 'Schedule a follow-up meeting or call with the prospect' },
    { label: 'Get meeting update', prompt: 'Get an update on the outcome of the recent meeting' },
  ],
  'cs-hygiene': [
    { label: 'Update customer info', prompt: 'Update the customer account information and details' },
    { label: 'Verify company details', prompt: 'Verify that the company details are accurate' },
  ],
  other: [
    { label: 'General follow-up', prompt: 'Follow up on this deal' },
  ],
};

interface DealContext {
  hubspotDealId: string;
  hubspotOwnerId: string;
  dealName: string;
  ownerName: string;
  stageName?: string;
  missingFields?: string[];
}

interface CompanyContext {
  hubspotCompanyId: string;
  hubspotOwnerId: string;
  companyName: string;
  ownerName: string;
  missingFields?: string[];
}

type EntityContext = (DealContext & { type: 'deal' }) | (CompanyContext & { type: 'company' });

interface SmartTaskPopoverProps {
  context: EntityContext;
  queueType: 'hygiene' | 'next-step' | 'cs-hygiene' | 'other';
  onTaskCreated: (taskTitle: string) => void;
  trigger: React.ReactNode;
  dealId?: string;  // Supabase deal UUID for tracking
  companyId?: string;  // Supabase company UUID for tracking
}

interface GeneratedTask {
  title: string;
  description: string;
  suggestedPriority: 'LOW' | 'MEDIUM' | 'HIGH';
}

export function SmartTaskPopover({
  context,
  queueType,
  onTaskCreated,
  trigger,
  dealId,
  companyId,
}: SmartTaskPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [generatedTask, setGeneratedTask] = useState<GeneratedTask | null>(null);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedPriority, setEditedPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [error, setError] = useState<string | null>(null);

  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const presets = PRESET_TEMPLATES[queueType] || PRESET_TEMPLATES.other;

  // Handle click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Reset state when popover opens
  useEffect(() => {
    if (isOpen) {
      setPrompt('');
      setGeneratedTask(null);
      setEditedTitle('');
      setEditedDescription('');
      setEditedPriority('MEDIUM');
      setError(null);
    }
  }, [isOpen]);

  const handlePresetClick = (presetPrompt: string) => {
    setPrompt(presetPrompt);
  };

  const handleGeneratePreview = async () => {
    if (!prompt.trim()) {
      setError('Please enter a request or select a preset');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/queues/generate-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          dealName: context.type === 'deal' ? context.dealName : undefined,
          companyName: context.type === 'company' ? context.companyName : undefined,
          ownerName: context.ownerName,
          stageName: context.type === 'deal' ? context.stageName : undefined,
          queueType,
          missingFields: context.missingFields,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate task');
      }

      const task: GeneratedTask = await response.json();
      setGeneratedTask(task);
      setEditedTitle(task.title);
      setEditedDescription(task.description);
      setEditedPriority(task.suggestedPriority);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate task');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateTask = async () => {
    if (!editedTitle.trim() || !editedDescription.trim()) {
      setError('Title and description are required');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch('/api/queues/create-smart-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hubspotDealId: context.type === 'deal' ? context.hubspotDealId : undefined,
          hubspotCompanyId: context.type === 'company' ? context.hubspotCompanyId : undefined,
          hubspotOwnerId: context.hubspotOwnerId,
          title: editedTitle.trim(),
          description: editedDescription.trim(),
          priority: editedPriority,
          dealId: dealId,
          companyId: companyId,
          queueType: queueType,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create task');
      }

      // Success - close and notify parent with task title
      const taskTitle = editedTitle.trim();
      setIsOpen(false);
      onTaskCreated(taskTitle);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancel = () => {
    if (generatedTask) {
      // Go back to prompt input
      setGeneratedTask(null);
    } else {
      // Close popover
      setIsOpen(false);
    }
  };

  return (
    <div className="relative inline-block">
      {/* Trigger */}
      <div ref={triggerRef} onClick={() => setIsOpen(!isOpen)}>
        {trigger}
      </div>

      {/* Popover */}
      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-2 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">
              {generatedTask ? 'Preview Task' : 'Create Smart Task'}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {context.type === 'deal' ? context.dealName : context.companyName}
            </p>
          </div>

          {/* Content */}
          <div className="p-4">
            {!generatedTask ? (
              // Input mode
              <>
                {/* Preset chips */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {presets.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => handlePresetClick(preset.prompt)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
                        prompt === preset.prompt
                          ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-500'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Text input */}
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe the task you want to create..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  rows={3}
                />

                {/* Error message */}
                {error && (
                  <p className="mt-2 text-xs text-red-600">{error}</p>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-2 mt-3">
                  <button
                    onClick={() => setIsOpen(false)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGeneratePreview}
                    disabled={isGenerating || !prompt.trim()}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {isGenerating ? (
                      <>
                        <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Generating...
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Generate Preview
                      </>
                    )}
                  </button>
                </div>
              </>
            ) : (
              // Preview/edit mode
              <>
                {/* Title */}
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
                  <input
                    type="text"
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                {/* Description */}
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={editedDescription}
                    onChange={(e) => setEditedDescription(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                    rows={3}
                  />
                </div>

                {/* Priority */}
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
                  <div className="flex gap-2">
                    {(['LOW', 'MEDIUM', 'HIGH'] as const).map((priority) => (
                      <button
                        key={priority}
                        onClick={() => setEditedPriority(priority)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          editedPriority === priority
                            ? priority === 'HIGH'
                              ? 'bg-red-100 text-red-700 ring-1 ring-red-500'
                              : priority === 'MEDIUM'
                              ? 'bg-yellow-100 text-yellow-700 ring-1 ring-yellow-500'
                              : 'bg-green-100 text-green-700 ring-1 ring-green-500'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {priority}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Due date info */}
                <p className="text-xs text-gray-500 mb-3">
                  Task will be due in 24 hours and assigned to {context.ownerName}
                </p>

                {/* Error message */}
                {error && (
                  <p className="mb-3 text-xs text-red-600">{error}</p>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={handleCancel}
                    disabled={isCreating}
                    className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleCreateTask}
                    disabled={isCreating || !editedTitle.trim() || !editedDescription.trim()}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {isCreating ? (
                      <>
                        <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Creating...
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Create Task
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
