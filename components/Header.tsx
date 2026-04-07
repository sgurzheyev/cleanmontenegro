import React from 'react';
import { useLocalization } from '../hooks/useLocalization';
import { Language } from '../types';

interface HeaderProps {
  language: Language;
  toggleLanguage: () => void;
  xp?: number;
  level?: number;
  onOpenMenu: () => void; // <-- Функция открытия меню
}

const Header: React.FC<HeaderProps> = ({
  language,
  toggleLanguage,
  xp = 74,
  level = 12,
  onOpenMenu
}) => {
  const { t } = useLocalization(language);

  return (
    <header className="fixed top-0 left-0 w-full z-50">
      {/* Основная панель Header */}
      <div className="bg-black/60 backdrop-blur-xl border-b border-white/10 px-6 py-4 flex justify-between items-center">
        
        {/* Левая часть: Иконка профиля/логотип */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl border border-[#39FF14]/30 flex items-center justify-center bg-[#39FF14]/5">
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-[#39FF14] drop-shadow-[0_0_5px_#39FF14]">
              <path d="M12 2L2 22H22L12 2Z" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          <div className="hidden xs:block text-left">
            <h1 className="text-lg font-black italic tracking-tighter text-white uppercase leading-none">
              Clean<span className="text-[#39FF14]">Egypt</span>
            </h1>
          </div>
        </div>

        {/* Центральная часть: Статус Eco-Hero */}
        <div className="flex flex-col items-center">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em]">
            Eco-Hero
          </span>
          <span className="text-sm font-black italic text-white tracking-widest">
            Lv. {level}
          </span>
        </div>

        {/* Правая часть: Меню и Язык */}
        <div className="flex items-center gap-4">
          <button
            onClick={toggleLanguage}
            className="px-3 py-1 border border-white/20 text-white text-[10px] font-black rounded-lg hover:bg-white/10 transition-all uppercase italic"
          >
            {language === 'en' ? 'AR' : 'EN'}
          </button>
          
          {/* КНОПКА МЕНЮ (Гамбургер) */}
          <button
            onClick={onOpenMenu}
            className="text-white hover:text-[#39FF14] transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Полоска XP (Progress Bar) прямо под хедером */}
      <div className="w-full h-[3px] bg-gray-900/50 relative overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[#39FF14] to-cyan-400 shadow-[0_0_15px_#39FF14] transition-all duration-1000 ease-out"
          style={{ width: `${xp}%` }}
        />
        {/* Световой блик на полоске */}
        <div
          className="absolute top-0 left-0 h-full w-20 bg-white/20 skew-x-12 animate-[shimmer_2s_infinite]"
          style={{ left: `${xp - 10}%` }}
        />
      </div>
    </header>
  );
};

export default Header;
