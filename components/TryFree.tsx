import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';

const TryFree: React.FC = () => {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleFreeCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setIsSubmitting(true);

    try {
      // Сохраняем "лапу" в базу
      await supabase.from('leads').insert([{ email, source: 'try_free_button' }]);

      setTimeout(() => {
        setIsSubmitting(false);
        // Редирект на карту с активированным демо-режимом (туча пирамид)
        navigate('/?view=demo_active');
      }, 1500);
    } catch (err) {
      setIsSubmitting(false);
      navigate('/');
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-[#0a0b0e] p-6 font-sans">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h2 className="text-4xl font-black italic tracking-tighter uppercase bg-clip-text text-transparent bg-gradient-to-r from-[#00f2ff] to-[#7000ff] mb-2">
            Clean<span className="text-white">Egypt</span>
          </h2>
          <p className="text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-bold">БЕСПЛАТНАЯ ПРОВЕРКА ЗАДАЧ</p>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 p-8 rounded-[2.5rem] backdrop-blur-xl relative overflow-hidden">
          {isSubmitting && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
              <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}

          <form onSubmit={handleFreeCheck} className="space-y-6">
            <input
              type="email"
              required
              placeholder="ВВЕДИ СВОЙ EMAIL..."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-black/50 border border-zinc-800 p-5 rounded-2xl outline-none focus:border-cyan-500 text-white font-bold"
            />
            <button
              type="submit"
              className="w-full py-5 bg-gradient-to-r from-[#00f2ff] to-[#7000ff] text-white font-black uppercase rounded-2xl shadow-[0_0_30px_rgba(0,242,255,0.2)]"
            >
              ПРОВЕРИТЬ БЕСПЛАТНО 🚀
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default TryFree;
