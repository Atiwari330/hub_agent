'use client';

import React, { useState, useCallback, useRef } from 'react';

interface VoiceMemoPlayerProps {
  ticketId: string;
  durationSeconds: number | null;
  acknowledgedAt: string | null;
  onAcknowledged: () => void;
}

export function VoiceMemoPlayer({ ticketId, durationSeconds, acknowledgedAt, onAcknowledged }: VoiceMemoPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadAndPlay = useCallback(async () => {
    if (audioUrl) {
      // Already loaded, just toggle play
      if (audioRef.current) {
        if (playing) {
          audioRef.current.pause();
          setPlaying(false);
        } else {
          audioRef.current.play();
          setPlaying(true);
        }
      }
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/queues/support-manager/voice-memo?ticketId=${ticketId}`);
      if (!res.ok) throw new Error('Failed to load audio');
      const { url } = await res.json();
      setAudioUrl(url);

      // Play after loading
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlaying(false);
      audio.play();
      setPlaying(true);
    } catch (err) {
      console.error('Failed to load voice memo:', err);
    } finally {
      setLoading(false);
    }
  }, [ticketId, audioUrl, playing]);

  const handleAcknowledge = useCallback(async () => {
    setAcknowledging(true);
    try {
      const res = await fetch('/api/queues/support-manager/voice-memo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId }),
      });
      if (!res.ok) throw new Error('Failed to acknowledge');
      onAcknowledged();
    } catch (err) {
      console.error('Acknowledge failed:', err);
    } finally {
      setAcknowledging(false);
    }
  }, [ticketId, onAcknowledged]);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={loadAndPlay}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded text-xs font-medium hover:bg-indigo-100 transition-colors disabled:opacity-50"
      >
        {loading ? (
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : playing ? (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        {playing ? 'Pause' : 'Play Memo'}
        {durationSeconds && <span className="text-indigo-400">({formatDuration(durationSeconds)})</span>}
      </button>

      {!acknowledgedAt && (
        <button
          onClick={handleAcknowledge}
          disabled={acknowledging}
          className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded text-xs font-medium hover:bg-emerald-100 transition-colors disabled:opacity-50"
        >
          {acknowledging ? 'Saving...' : 'Acknowledge'}
        </button>
      )}

      {acknowledgedAt && (
        <span className="text-xs text-emerald-600 font-medium">Acknowledged</span>
      )}
    </div>
  );
}
