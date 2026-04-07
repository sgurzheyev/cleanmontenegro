import React, { useEffect, useMemo, useRef, useState } from 'react';

type PhantomCaptureResult = {
  files: File[];
  lat: number | null;
  lng: number | null;
  capturedAt: string;
};

export default function PhantomCapture(props: {
  referencePhotoUrl: string | null;
  currentIndex: number;
  totalScenes: number;
  onClose: () => void;
  onCaptured: (result: PhantomCaptureResult) => void;
}) {
  const { referencePhotoUrl, currentIndex, totalScenes, onClose, onCaptured } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const burstLockRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCapture = useMemo(() => !loading && !capturing, [loading, capturing]);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        setLoading(true);
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
      } catch (e: any) {
        setError(e?.message || 'Failed to open camera.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    boot();
    return () => {
      cancelled = true;
      const s = streamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const snapFrame = async (idx: number): Promise<File | null> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, vw, vh);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    );
    if (!blob) return null;
    return new File([blob], `phantom_after_${Date.now()}_${idx}.jpg`, { type: 'image/jpeg' });
  };

  const handleCapture = async () => {
    // Prevent double-triggering from rapid taps before React state updates.
    if (burstLockRef.current) return;
    if (!canCapture) return;
    burstLockRef.current = true;
    setError(null);
    setCapturing(true);
    try {
      let lat: number | null = null;
      let lng: number | null = null;
      // Optimize GPS usage: fetch only for the first scene capture.
      if (currentIndex === 0 && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
          },
          () => {
            // keep nulls
          },
          { enableHighAccuracy: true, timeout: 6000 }
        );
      }

      const f = await snapFrame(currentIndex + 1);
      if (!f) {
        throw new Error('Could not capture image.');
      }

      onCaptured({
        files: [f],
        lat,
        lng,
        capturedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      setError(e?.message || 'Capture failed.');
    } finally {
      setCapturing(false);
      burstLockRef.current = false;
    }
  };

  return (
    <div className="fixed inset-0 z-[10001] bg-black">
      <style>
        {`@keyframes phantomFlicker { 0%{opacity:0} 50%{opacity:.8} 100%{opacity:0} }`}
      </style>

      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        muted
      />
      {!!referencePhotoUrl && (
        <img
          src={referencePhotoUrl}
          alt="Phantom overlay"
          className="absolute inset-0 h-full w-full object-cover pointer-events-none"
          style={{ animation: 'phantomFlicker 1.25s ease-in-out infinite' }}
        />
      )}

      <div className="absolute inset-x-0 bottom-24 px-4 pointer-events-none">
        <p className="text-center text-lg sm:text-2xl font-black tracking-[0.22em] text-orange-200 drop-shadow-[0_0_14px_rgba(251,146,60,0.9)]">
          MAKE SAME SCENE
        </p>
      </div>

      <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          className="h-10 w-10 rounded-full bg-black/60 border border-white/20 text-white text-lg"
        >
          ✕
        </button>
        <div className="rounded-full bg-black/50 border border-white/20 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200">
          Phantom Capture
        </div>
      </div>

      <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-black/60 text-white/90 px-4 py-1.5 rounded-full text-sm font-medium tracking-wide backdrop-blur-md z-50">
        {`Scene ${currentIndex + 1} of ${totalScenes}`}
      </div>

      <div className="absolute inset-x-0 bottom-4 px-4">
        {error && <p className="mb-2 text-xs text-red-300 text-center">{error}</p>}
        <button
          type="button"
          onClick={handleCapture}
          disabled={!canCapture}
          className="w-full rounded-full py-3 text-sm font-black uppercase tracking-[0.2em] bg-orange-500/20 border border-orange-400/60 text-orange-100 shadow-[0_0_20px_rgba(251,146,60,0.45)] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {capturing ? 'Capturing…' : 'Capture Photo'}
        </button>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

