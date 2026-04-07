import React from 'react';
import { formatEgp } from '../src/lib/formatMoney';

interface SliderProps {
  amount: number;
  setAmount: (val: number) => void;
  type: 'home' | 'city';
}

const Slider: React.FC<SliderProps> = ({ amount, setAmount, type }) => {
  // Настройки диапазона согласно твоим правилам
  const min = type === 'home' ? 5 : 1;
  const max = type === 'home' ? 500 : 100;

  return (
    <div className="w-full px-4 py-6 bg-zinc-900/50 backdrop-blur-md rounded-[2rem] border border-white/5 shadow-xl">
      <div className="flex justify-between items-end mb-4 px-2">
        <div>
          <p className="text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
            {type === 'home' ? 'Private Bidding' : 'Community Donation'}
          </p>
          <h3 className="text-white text-3xl font-black italic tracking-tighter">
            <span className="text-cyan-400">{formatEgp(amount)}</span>
          </h3>
        </div>
        
        {/* Индикатор масштаба пирамиды */}
        <div className="text-right">
          <p className="text-zinc-500 text-[9px] uppercase font-bold mb-1">Pyramid Scale</p>
          <div className="flex gap-1">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className={`w-1 h-3 rounded-full transition-all duration-300 ${
                  amount > (max / 5) * i ? 'bg-cyan-500 shadow-[0_0_8px_#06b6d4]' : 'bg-zinc-800'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="relative flex items-center group">
        {/* Кастомный трек слайдера с градиентом */}
        <input
          type="range"
          min={min}
          max={max}
          step={type === 'home' ? 5 : 1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500 transition-all"
          style={{
            background: `linear-gradient(to right, #06b6d4 0%, #06b6d4 ${(amount / max) * 100}%, #27272a ${(amount / max) * 100}%, #27272a 100%)`
          }}
        />
      </div>

      <div className="flex justify-between mt-3 px-1">
        <span className="text-zinc-600 text-[10px] font-bold tracking-widest uppercase italic">{min}$</span>
        <span className="text-zinc-600 text-[10px] font-bold tracking-widest uppercase italic">{max}$</span>
      </div>

      {/* Подсказка о списании */}
      <p className="text-center text-[9px] text-zinc-500 uppercase tracking-widest mt-6 opacity-60">
        Funds will be deducted upon pin placement
      </p>
    </div>
  );
};

export default Slider;
