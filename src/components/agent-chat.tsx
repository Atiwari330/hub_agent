'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';
import { useChat } from '@ai-sdk/react';
import { TextStreamChatTransport } from 'ai';

export function AgentChat() {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, error } = useChat({
    transport: new TextStreamChatTransport({
      api: '/api/agent',
    }),
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const message = input;
    setInput('');
    await sendMessage({ text: message });
  };

  // Extract text content from message parts
  const getMessageContent = (message: typeof messages[0]) => {
    // Handle parts array (the new UIMessage format)
    if (Array.isArray(message.parts)) {
      return message.parts
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('');
    }
    return '';
  };

  return (
    <div className="border border-gray-200 rounded-lg bg-white shadow-sm">
      {/* Messages */}
      <div className="h-96 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            <p className="text-lg mb-2">RevOps Agent Ready</p>
            <p className="text-sm">Try asking:</p>
            <ul className="text-sm mt-2 space-y-1">
              <li>&quot;List all account executives&quot;</li>
              <li>&quot;How many deals does [email] have?&quot;</li>
              <li>&quot;Summarize the pipeline for [email]&quot;</li>
            </ul>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`p-3 rounded-lg ${
              message.role === 'user'
                ? 'bg-blue-50 ml-8 border border-blue-100'
                : 'bg-gray-50 mr-8 border border-gray-100'
            }`}
          >
            <p className="text-xs font-semibold mb-1 text-gray-600">
              {message.role === 'user' ? 'You' : 'RevOps Agent'}
            </p>
            <div className="whitespace-pre-wrap text-sm">{getMessageContent(message)}</div>
          </div>
        ))}

        {isLoading && (
          <div className="p-3 bg-gray-50 mr-8 rounded-lg border border-gray-100">
            <p className="text-xs font-semibold mb-1 text-gray-600">RevOps Agent</p>
            <div className="flex items-center space-x-2">
              <div className="animate-pulse flex space-x-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
              </div>
              <span className="text-sm text-gray-500">Thinking...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 rounded-lg border border-red-200">
            <p className="text-sm text-red-600">Error: {error.message}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-gray-200 p-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about deals, AEs, or pipeline..."
            className="flex-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
