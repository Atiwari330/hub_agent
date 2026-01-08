'use client';

import { useState, useMemo } from 'react';
import { generateAllSlackMessages } from '@/lib/utils/slack-message-generator';

interface HygieneQueueDeal {
  id: string;
  dealName: string;
  amount: number | null;
  ownerName: string;
  ownerId: string;
  missingFields: { field: string; label: string }[];
}

interface SlackMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  deals: HygieneQueueDeal[];
}

export function SlackMessageModal({ isOpen, onClose, deals }: SlackMessageModalProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messages = useMemo(() => generateAllSlackMessages(deals), [deals]);

  if (!isOpen) return null;

  const handleCopy = async (ownerId: string, message: string) => {
    try {
      await navigator.clipboard.writeText(message);
      setCopiedId(ownerId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleCopyAll = async () => {
    try {
      const allMessages = messages.map((m) => m.message).join('\n\n---\n\n');
      await navigator.clipboard.writeText(allMessages);
      setCopiedId('all');
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy all:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Slack Messages</h2>
          <p className="text-sm text-gray-600 mt-1">
            Copy these messages to send to your AEs about their deals needing hygiene updates.
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">
              No deals to generate messages for.
            </p>
          ) : (
            messages.map((item) => (
              <div key={item.ownerId} className="border border-gray-200 rounded-lg">
                {/* AE Header */}
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200 rounded-t-lg">
                  <span className="font-medium text-gray-900">{item.ownerName}</span>
                  <button
                    onClick={() => handleCopy(item.ownerId, item.message)}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                      copiedId === item.ownerId
                        ? 'bg-green-100 text-green-700'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                  >
                    {copiedId === item.ownerId ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                {/* Message */}
                <pre className="p-4 text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50/50 rounded-b-lg">
                  {item.message}
                </pre>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 flex justify-between">
          {messages.length > 1 && (
            <button
              onClick={handleCopyAll}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                copiedId === 'all'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {copiedId === 'all' ? 'Copied All!' : 'Copy All Messages'}
            </button>
          )}
          <div className={messages.length <= 1 ? 'ml-auto' : ''}>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
