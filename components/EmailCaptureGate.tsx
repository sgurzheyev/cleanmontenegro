import React, { useState } from 'react';
import { createPortal } from 'react-dom';

const LS_KEY = 'hasProvidedEmail';
const LS_EMAIL_KEY = 'capturedEmail';

export function hasPassedEmailGate(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem(LS_KEY);
}

export function setEmailGatePassed(email: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_KEY, 'true');
  if (email) localStorage.setItem(LS_EMAIL_KEY, email);
}

export interface EmailCaptureGateProps {
  onUnlock: () => void;
}

const EmailCaptureGate: React.FC<EmailCaptureGateProps> = ({ onUnlock }) => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError('Введите email');
      return;
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(trimmed)) {
      setError('Введите корректный email');
      return;
    }
    setIsSubmitting(true);
    setEmailGatePassed(trimmed);
    onUnlock();
  };

  const content = (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/90 backdrop-blur-xl p-4">
      <div className="absolute inset-0 bg-gradient-to-b from-amber-900/20 via-transparent to-cyan-900/20 pointer-events-none" />
      <div className="relative w-full max-w-md pointer-events-auto">
        <div className="bg-slate-900/95 border border-amber-500/30 rounded-3xl shadow-2xl shadow-amber-500/10 p-8 md:p-10 text-white overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-cyan-500/5 rounded-full translate-y-1/2 -translate-x-1/2" />
          <div className="relative z-10 text-center mb-8">
            <p className="text-amber-400/90 text-[10px] uppercase tracking-[0.35em] font-bold mb-3">
              Карта скрытых сокровищ
            </p>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white leading-tight">
              Оставьте свой Email, чтобы увидеть карту скрытых сокровищ Египта
            </h1>
            <p className="text-slate-500 text-sm mt-4">
              Бесплатный доступ к карте миссий. Без спама.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="relative z-10 space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              placeholder="your@email.com"
              autoComplete="email"
              disabled={isSubmitting}
              className="w-full px-5 py-4 rounded-2xl bg-slate-800/80 border border-white/10 text-white placeholder-slate-500 focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all disabled:opacity-60"
            />
            {error && (
              <p className="text-amber-400 text-sm text-center">{error}</p>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-400 text-slate-900 font-black text-sm uppercase tracking-widest shadow-lg shadow-amber-500/25 hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Открываем карту...' : 'Смотреть карту'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
};

export default EmailCaptureGate;
