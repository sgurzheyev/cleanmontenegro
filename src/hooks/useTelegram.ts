import { useMemo } from 'react';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: {
          user?: {
            id: number;
            first_name?: string;
            last_name?: string;
            username?: string;
            language_code?: string;
            is_premium?: boolean;
            photo_url?: string;
          };
        };
        expand?: () => void;
        close?: () => void;
        ready?: () => void;
        MainButton?: unknown;
        BackButton?: unknown;
        HapticFeedback?: unknown;
        [key: string]: unknown;
      };
    };
  }
}

export function useTelegram() {
  return useMemo(() => {
    if (typeof window === 'undefined') {
      return { webApp: undefined, tgUser: undefined, isTMA: false };
    }

    const webApp = window.Telegram?.WebApp;
    const tgUser = webApp?.initDataUnsafe?.user;
    const isTMA = !!(window.Telegram?.WebApp?.initData);

    if (tgUser) {
      console.log('Telegram User detected:', tgUser);
    }

    return {
      webApp: webApp ?? undefined,
      tgUser: tgUser ?? undefined,
      isTMA,
    };
  }, []);
}
