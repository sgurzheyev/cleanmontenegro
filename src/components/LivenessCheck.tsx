import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type LivenessResult = {
  blob: Blob;
  mimeType: string;
  lat: number | null;
  lng: number | null;
};

export default function LivenessCheck(props: {
  disabled?: boolean;
  onRecorded: (res: LivenessResult) => void;
}) {
  const { disabled, onRecorded } = props;
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const stopTimerRef = useRef<number | null>(null);

  const [ready, setReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supportedMimeType = useMemo(() => {
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    for (const t of candidates) {
      try {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
      } catch {
        // ignore
      }
    }
    return '';
  }, []);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        setStarting(true);
        setError(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch (e: any) {
        setError(e?.message || 'Camera permission denied.');
      } finally {
        setStarting(false);
      }
    };

    if (!disabled && navigator.mediaDevices?.getUserMedia) start();

    return () => {
      cancelled = true;
      if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
      try {
        recorderRef.current?.stop();
      } catch {
        // ignore
      }
      const s = streamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      chunksRef.current = [];
    };
  }, [disabled]);

  const startRecording = async () => {
    if (disabled || recording || !streamRef.current) return;
    setError(null);

    if (!supportedMimeType) {
      setError('Recording not supported on this device/browser.');
      return;
    }

    const stream = streamRef.current;
    chunksRef.current = [];

    let lat: number | null = null;
    let lng: number | null = null;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        },
        () => {
          // ignore (still allow recording)
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }

    try {
      const recorder = new MediaRecorder(stream, { mimeType: supportedMimeType });
      recorderRef.current = recorder;
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: supportedMimeType });
        chunksRef.current = [];
        onRecorded({ blob, mimeType: supportedMimeType, lat, lng });
      };

      setRecording(true);
      recorder.start();

      // Force exactly ~2 seconds.
      stopTimerRef.current = window.setTimeout(() => {
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      }, 2000);
    } catch (e: any) {
      setRecording(false);
      setError(e?.message || 'Failed to start recording.');
    }
  };

  const cancelIfReleasedEarly = () => {
    if (!recording) return;
    if (!stopTimerRef.current) return;
    // If user releases early, stop immediately but treat as failure (no callback).
    window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    try {
      recorderRef.current?.stop();
    } catch {
      // ignore
    }
  };

  return (
    <div className="rounded-2xl border border-orange-500/40 bg-orange-500/5 p-4 space-y-3">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-200">
        Liveness Check (Required)
      </p>

      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/40">
        <video
          ref={videoRef}
          className="w-full h-48 object-cover"
          playsInline
          muted
        />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-300 bg-black/40">
            {starting ? 'Starting camera…' : 'Camera preview unavailable.'}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}

      <button
        type="button"
        disabled={!ready || !!disabled}
        onPointerDown={startRecording}
        onPointerUp={cancelIfReleasedEarly}
        onPointerCancel={cancelIfReleasedEarly}
        className="w-full rounded-full px-5 py-3 text-[11px] font-black uppercase tracking-[0.2em] border border-orange-500/60 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
      >
        {recording ? 'Recording…' : 'Hold to Record (2s)'}
      </button>

      <p className="text-[11px] text-slate-300 leading-relaxed">
        {t('livenessFinalStep', {
          defaultValue:
            'Final Step: Record a 2-second video of any of the cleaned scenes to prove liveness.',
        })}
      </p>
    </div>
  );
}

