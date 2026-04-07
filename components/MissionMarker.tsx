import React, { useEffect, useMemo, useState } from 'react';
import { formatEurDigits } from '../src/lib/formatMoney';

export interface MissionMarkerProps {
  currentFundingEgp: number;
  targetEgp: number;
  orderType: 'home' | 'city';
  label?: string;
  onClick?: (e: React.MouseEvent) => void;
  isDraft?: boolean;
  isActive?: boolean;
  bidCount?: number;
  variant?: 'default' | 'in_progress' | 'completed';
}

/** Faceted crystal clip — slender obelisk (top point → mid facets → base). */
const CLIP_CRYSTAL =
  'polygon(50% 0%, 82% 22%, 92% 52%, 78% 82%, 50% 96%, 22% 82%, 8% 52%, 18% 22%)';

/** Sharp pyramid anchor at map ground. */
const CLIP_PYRAMID = 'polygon(50% 0%, 100% 100%, 0% 100%)';

type Theme = {
  neon: string;
  rgb: string;
  animClass: string;
};

const MissionMarker: React.FC<MissionMarkerProps> = ({
  currentFundingEgp,
  targetEgp: _targetEgp,
  orderType,
  label,
  onClick,
  isDraft = false,
  isActive = false,
  bidCount = 0,
  variant = 'default',
}) => {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const scale = isDraft ? 1 : 0.78 + (Math.min(currentFundingEgp, 5000) / 5000) * 0.28;

  const theme: Theme = useMemo(() => {
    if (isDraft) {
      return { neon: '#00FFFF', rgb: '0,255,255', animClass: 'mission-marker-crystal--draft' };
    }
    // Constitution v6.0 neon mapping:
    // city (public)  -> intense neon green
    // home (private) -> intense neon gold/orange
    const isPublic = orderType === 'city';
    return {
      neon: isPublic ? '#00FF00' : '#F97316',
      rgb: isPublic ? '34,197,94' : '249,115,22',
      animClass: 'mission-marker-crystal--accent',
    };
  }, [isDraft, orderType]);

  const fundingWhole = Math.round(Number(currentFundingEgp) || 0);

  const textGlow = `0 0 10px rgba(${theme.rgb},0.85), 0 0 2px rgba(255,255,255,0.95), 0 2px 4px rgba(0,0,0,0.9)`;

  const mainContent = isDraft ? (
    <span
      className="font-mono font-black uppercase tracking-[0.28em] text-[8px] leading-tight text-center px-0.5"
      style={{ textShadow: textGlow, color: '#e8ffff' }}
    >
      CREATE
    </span>
  ) : variant === 'completed' ? (
    <span
      className="font-mono font-black uppercase tracking-wider text-[9px] text-center px-1"
      style={{ textShadow: textGlow, color: '#fff7fb' }}
    >
      {label || 'DONE'}
    </span>
  ) : isActive ? (
    <span
      className="font-mono font-black uppercase tracking-wider text-[8px] text-center px-0.5"
      style={{ textShadow: textGlow, color: '#fffbeb' }}
    >
      {label || 'MY MISSION'}
    </span>
  ) : (
    <span className="inline-flex items-baseline justify-center gap-0.5">
      <span
        className="font-mono font-bold tabular-nums tracking-tight text-[11px]"
        style={{ textShadow: textGlow, color: '#fff8e8' }}
      >
        {formatEurDigits(fundingWhole)}
      </span>
      <span
        className="text-[7px] font-bold uppercase tracking-[0.15em] font-mono opacity-95"
        style={{ textShadow: `0 0 8px rgba(${theme.rgb},0.7)`, color: 'rgba(255,248,232,0.92)' }}
      >
        EUR
      </span>
    </span>
  );

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!isDraft) onClick?.(e);
      }}
      className="mission-marker-crystal-root relative z-[9999] isolate flex flex-col items-center group select-none outline-none border-0 p-0 bg-transparent origin-bottom"
      style={{
        transform: `scale(${scale})`,
        transformOrigin: 'bottom center',
        ['--crystal-neon' as string]: theme.neon,
        ['--crystal-rgb' as string]: theme.rgb,
      }}
      aria-label={isDraft ? 'Create mission' : `Mission funding ${formatEurDigits(currentFundingEgp)} EUR`}
    >
      {/* Ultra-neon ambient beacon pool (far-distance visibility) */}
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 rounded-full blur-[40px] opacity-60 pointer-events-none -z-10 ${orderType === 'home' ? 'bg-orange-500' : 'bg-green-500'}`}
        aria-hidden
      />

      {/* Radar pulse (ground point) */}
      <div
        className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 z-[0]"
        aria-hidden
      >
        <div
          className="h-3 w-3 rounded-full animate-ping"
          style={{
            backgroundColor: `rgba(${theme.rgb},0.15)`,
            boxShadow: `0 0 15px rgba(${theme.rgb},0.8)`,
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[6px] w-[6px] rounded-full"
          style={{
            backgroundColor: `rgba(${theme.rgb},0.65)`,
            boxShadow: `0 0 10px rgba(${theme.rgb},0.75)`,
          }}
        />
      </div>

      {/* Elevation: badge + inline SVG pin (Constitution v6.0) */}
      <div className="-translate-y-full pb-2 flex flex-col items-center gap-2 z-[50] pointer-events-none">
        {/* Amount Badge */}
        <div className="bg-black/90 text-white font-bold px-2 py-0.5 rounded-full border border-gray-700 tabular-nums">
          <span>{formatEurDigits(fundingWhole)}</span>
          {!isDraft && !isActive && bidCount > 0 && (
            <span className="ml-1 text-[10px] font-black opacity-95">{`+${bidCount}`}</span>
          )}
        </div>

        {/* Pin (SVG) */}
        <svg
          width="24"
          height="32"
          viewBox="0 0 24 32"
          xmlns="http://www.w3.org/2000/svg"
          style={{ filter: `drop-shadow(0 0 15px rgba(${theme.rgb},0.8))` }}
          aria-hidden
        >
          <polygon
            points="12,32 2,6 22,6"
            fill={orderType === 'home' ? '#F97316' : '#00FF00'}
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="1"
          />
          <polygon points="12,30 7,14 17,14" fill="rgba(255,255,255,0.10)" />
        </svg>
      </div>

      {/* Chrono-Glass crystal body */}
      <div
        className={[
          'hidden',
          'mission-marker-crystal-body relative flex flex-col items-center justify-center',
          theme.animClass,
          entered ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
          'transition-all duration-300 ease-out',
          'group-hover:brightness-110',
          // Elevation: float above GPS coordinate to avoid clipping into buildings.
          '-translate-y-6',
        ].join(' ')}
        style={{
          clipPath: CLIP_CRYSTAL,
          WebkitClipPath: CLIP_CRYSTAL,
          width: '52px',
          minHeight: '58px',
          padding: '10px 8px 14px',
        }}
      >
        {/* Facet lines + inner sheen */}
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background: [
              'linear-gradient(118deg, transparent 44%, rgba(255,255,255,0.14) 50%, transparent 56%)',
              'linear-gradient(242deg, transparent 44%, rgba(255,255,255,0.08) 50%, transparent 56%)',
              'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 42%, rgba(0,0,0,0.15) 100%)',
            ].join(', '),
          }}
          aria-hidden
        />
        {/* Thin neon edge (inset ring simulates 1.5px facet border) */}
        <div
          className="pointer-events-none absolute inset-[1px] opacity-95"
          style={{
            clipPath: CLIP_CRYSTAL,
            WebkitClipPath: CLIP_CRYSTAL,
            boxShadow: `
              inset 0 0 0 1.5px ${theme.neon},
              inset 0 0 12px rgba(${theme.rgb},0.25),
              inset 0 -20px 28px rgba(0,0,0,0.35)
            `,
          }}
          aria-hidden
        />

        <div className="relative z-[1] flex flex-col items-center justify-center text-center w-full min-h-[2rem] antialiased [text-rendering:geometricPrecision] -translate-y-1">
          {mainContent}
          {!isDraft && !isActive && bidCount > 0 && (
            <span
              className="mt-0.5 text-[8px] font-black font-mono"
              style={{ color: '#a5f3fc', textShadow: '0 0 8px rgba(34,211,238,0.9)' }}
            >
              +{bidCount}
            </span>
          )}
        </div>
      </div>

      {/* Ground anchor — sharp pyramid */}
      <div
        className="hidden mission-marker-pyramid -mt-px relative z-[1] w-[22px] h-[11px]"
        style={{
          clipPath: CLIP_PYRAMID,
          WebkitClipPath: CLIP_PYRAMID,
          background: `linear-gradient(180deg, ${theme.neon}cc 0%, rgba(${theme.rgb},0.35) 55%, rgba(0,0,0,0.65) 100%)`,
          boxShadow: `0 0 10px rgba(${theme.rgb},0.55), 0 2px 4px rgba(0,0,0,0.8)`,
          filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.9))',
        }}
        aria-hidden
      />

      {label && !isDraft && (
        <div className="mt-1.5 bg-black/85 backdrop-blur-md border border-white/10 px-3 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-[10] max-w-[200px]">
          <p className="text-[10px] text-white font-bold uppercase tracking-widest">{label}</p>
        </div>
      )}
    </button>
  );
};

export default MissionMarker;
