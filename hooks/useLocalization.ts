
import { useCallback } from 'react';
import { Language } from '../types';
import { translations } from '../constants';

export const useLocalization = (language: Language) => {
  const t = useCallback(
    (key: string): string => {
      return translations[language][key] || key;
    },
    [language]
  );

  return { t };
};
