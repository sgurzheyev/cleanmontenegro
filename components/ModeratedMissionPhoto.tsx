import React from 'react';

type Props = {
  url: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  /** Show green verification checkmark on uploaded photos */
  showSafeBadge?: boolean;
};

/**
 * Renders a mission photo with optional green checkmark badge.
 * All successfully uploaded photos get the verification checkmark.
 */
const ModeratedMissionPhoto: React.FC<Props> = ({
  url,
  alt,
  className = '',
  imgClassName = 'w-full h-48 object-cover rounded-xl shadow-md bg-slate-800',
  showSafeBadge = true,
}) => {
  const isInvalidUrl =
    typeof url !== 'string' || !url || url.startsWith('censored://');

  if (isInvalidUrl) {
    return (
      <div
        className={`relative flex min-h-[12rem] w-full items-center justify-center rounded-xl bg-slate-800 ${className}`}
      >
        <p className="text-center text-xs text-slate-500">Image unavailable</p>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <img
        src={url}
        alt={alt}
        className={imgClassName}
        onError={(e) => {
          const el = e.currentTarget;
          el.onerror = null;
          el.src =
            'data:image/svg+xml,' +
            encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect fill="%23334155" width="400" height="200"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%2394a3b8" font-size="14" font-family="system-ui">Image unavailable</text></svg>'
            );
          el.classList.add('object-contain');
        }}
      />
      {showSafeBadge && (
        <span
          className="pointer-events-none absolute left-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/90 text-base shadow-[0_0_12px_rgba(16,185,129,0.85)] ring-2 ring-emerald-300/60 animate-moderation-safe-pulse"
          aria-hidden
          title="Verified"
        >
          ✔️
        </span>
      )}
    </div>
  );
};

export default ModeratedMissionPhoto;
