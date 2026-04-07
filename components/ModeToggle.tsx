
import React from 'react';
import { OrderMode, Language } from '../types';
import { useLocalization } from '../hooks/useLocalization';
import HomeIcon from './icons/HomeIcon';
import CityIcon from './icons/CityIcon';

interface ModeToggleProps {
  mode: OrderMode;
  setMode: (mode: OrderMode) => void;
  language: Language;
}

const ModeToggle: React.FC<ModeToggleProps> = ({ mode, setMode, language }) => {
  const { t } = useLocalization(language);
  const isHome = mode === OrderMode.HOME;

  return (
    <div className="relative w-full max-w-sm h-16 bg-teal-100 rounded-full p-2 flex items-center transition-all duration-300 ease-in-out shadow-inner">
      <div
        className={`absolute top-1 h-14 w-1/2 bg-white rounded-full shadow-md transform transition-transform duration-500 ease-in-out ${
          isHome ? 'translate-x-1' : 'translate-x-[calc(100%-0.5rem)]'
        }`}
        style={{ direction: language === 'ar' ? 'rtl' : 'ltr' }}
      ></div>
      <button
        onClick={() => setMode(OrderMode.HOME)}
        className={`w-1/2 z-10 flex items-center justify-center gap-2 h-full rounded-full text-lg font-bold transition-colors duration-300 ${
          isHome ? 'text-teal-600' : 'text-gray-500'
        }`}
      >
        <HomeIcon className={`w-6 h-6 ${isHome ? 'text-teal-500' : 'text-gray-400'}`} />
        {t('clean_my_home')}
      </button>
      <button
        onClick={() => setMode(OrderMode.CITY)}
        className={`w-1/2 z-10 flex items-center justify-center gap-2 h-full rounded-full text-lg font-bold transition-colors duration-300 ${
          !isHome ? 'text-blue-600' : 'text-gray-500'
        }`}
      >
        <CityIcon className={`w-6 h-6 ${!isHome ? 'text-blue-500' : 'text-gray-400'}`} />
        {t('clean_my_city')}
      </button>
    </div>
  );
};

export default ModeToggle;
