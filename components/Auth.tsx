import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../services/supabase';

/** Standalone auth screen — dark cyberpunk styling (parity with AuthOverlay when routed). */
const Auth: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const validateEmailPassword = () => {
    if (!email?.trim() || !password) {
      setError(t('authEmailPasswordRequired'));
      return false;
    }
    return true;
  };

  const handlePasswordSignIn = async () => {
    setError(null);
    setInfo(null);
    if (!validateEmailPassword()) return;
    setIsLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (err) throw err;
      navigate('/');
    } catch (err: any) {
      setError(err?.message || t('authSignFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordSignUp = async () => {
    setError(null);
    setInfo(null);
    if (!validateEmailPassword()) return;
    setIsLoading(true);
    try {
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (err) throw err;
      if (data.session?.user) {
        navigate('/');
      } else {
        setInfo(t('authConfirmEmailCheck'));
      }
    } catch (err: any) {
      setError(err?.message || t('authSignUpFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setInfo(null);
    setIsLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}${window.location.pathname}${window.location.search}`,
        },
      });
      if (err) throw err;
    } catch (err: any) {
      setError(err?.message || t('authGoogleSignInFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)] overflow-y-auto">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(6,182,212,0.08),_transparent_55%)]" />

      <div className="relative z-10 w-full max-w-md max-h-[85vh] overflow-y-auto rounded-3xl border border-cyan-500/20 bg-slate-950/90 backdrop-blur-md shadow-[0_0_48px_rgba(6,182,212,0.14)]">
        <div className="sticky top-0 z-50 border-b border-cyan-500/15 bg-slate-950/95 px-6 py-4 backdrop-blur-md">
          <h2 className="text-center text-lg font-black uppercase tracking-[0.2em] text-white">{t('signIn')}</h2>
          <p className="mt-2 text-center text-[10px] uppercase tracking-[0.22em] text-cyan-400/85">{t('authCyberpunkSubtitle')}</p>
        </div>

        <div className="space-y-5 px-6 pb-8 pt-5">
          <div>
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{t('email')}</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-2xl border border-cyan-500/20 bg-black/35 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-orange-500/45 focus:ring-1 focus:ring-orange-500/25"
            />
          </div>
          <div>
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{t('password')}</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-2xl border border-cyan-500/20 bg-black/35 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-orange-500/45 focus:ring-1 focus:ring-orange-500/25"
            />
          </div>

          {error && (
            <p className="rounded-xl border border-red-500/35 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</p>
          )}
          {info && (
            <p className="rounded-xl border border-emerald-500/35 bg-emerald-950/35 px-3 py-2 text-xs text-emerald-200">{info}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={isLoading}
              onClick={handlePasswordSignIn}
              className="rounded-full border border-orange-500/50 bg-orange-500/10 px-4 py-3 text-[11px] font-black uppercase tracking-[0.15em] text-orange-400 shadow-[0_0_20px_rgba(249,115,22,0.14)] hover:bg-orange-500/15 disabled:cursor-wait disabled:opacity-45"
            >
              {isLoading ? t('signingIn') : t('signIn')}
            </button>
            <button
              type="button"
              disabled={isLoading}
              onClick={handlePasswordSignUp}
              className="rounded-full border border-cyan-500/40 bg-cyan-950/40 px-4 py-3 text-[11px] font-black uppercase tracking-[0.15em] text-cyan-300 hover:border-cyan-400/55 hover:bg-cyan-950/55 disabled:cursor-wait disabled:opacity-45"
            >
              {isLoading ? t('signingUp') : t('signUp')}
            </button>
          </div>

          <button
            type="button"
            disabled={isLoading}
            onClick={handleGoogleLogin}
            className="w-full rounded-full border border-white/15 bg-white/5 px-6 py-3 text-xs font-bold uppercase tracking-[0.18em] text-white hover:border-cyan-400/35 hover:bg-white/10 disabled:cursor-wait disabled:opacity-45"
          >
            {t('continueWithGoogle')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Auth;
