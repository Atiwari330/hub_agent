'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';

interface VoiceMemoRecorderProps {
  ticketId: string;
  hasExisting: boolean;
  onRecorded: () => void;
}

export function VoiceMemoRecorder({ ticketId, hasExisting, onRecorded }: VoiceMemoRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const MAX_DURATION = 120; // 2 minutes

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });

      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);

        const blob = new Blob(chunksRef.current, { type: mimeType });
        const duration = Math.round((Date.now() - startTimeRef.current) / 1000);

        setUploading(true);
        try {
          const formData = new FormData();
          formData.append('ticketId', ticketId);
          formData.append('audio', blob, `memo.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
          formData.append('durationSeconds', String(duration));

          const res = await fetch('/api/queues/support-manager/voice-memo', {
            method: 'POST',
            body: formData,
          });

          if (!res.ok) throw new Error('Upload failed');
          onRecorded();
        } catch (err) {
          console.error('Voice memo upload failed:', err);
        } finally {
          setUploading(false);
          setRecording(false);
          setElapsed(0);
        }
      };

      mediaRecorderRef.current = recorder;
      startTimeRef.current = Date.now();
      recorder.start(1000);
      setRecording(true);
      setElapsed(0);

      timerRef.current = setInterval(() => {
        const secs = Math.round((Date.now() - startTimeRef.current) / 1000);
        setElapsed(secs);
        if (secs >= MAX_DURATION) {
          recorder.stop();
        }
      }, 500);
    } catch (err) {
      console.error('Microphone access denied:', err);
    }
  }, [ticketId, onRecorded]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (uploading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Uploading...
      </span>
    );
  }

  if (recording) {
    return (
      <div className="inline-flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs text-red-600 font-medium">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          {formatTime(elapsed)} / {formatTime(MAX_DURATION)}
        </span>
        <button
          onClick={stopRecording}
          className="px-2.5 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 transition-colors"
        >
          Stop
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={startRecording}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded text-xs font-medium hover:bg-indigo-100 transition-colors"
      title={hasExisting ? 'Re-record voice memo' : 'Record voice memo'}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-14 0m14 0a7 7 0 00-14 0m14 0v1a7 7 0 01-14 0v-1m14 0H5m7 7v4m-4 0h8" />
      </svg>
      {hasExisting ? 'Re-record' : 'Record Memo'}
    </button>
  );
}
