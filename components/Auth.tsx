import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom'; // Для мгновенного перехода
import { supabase } from '../services/supabase';
const Auth: React.FC = () => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleQuickAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsLoading(true);
    
    // Используем Magic Link или просто создаем профиль, если его нет
    // Твой SQL триггер 'Auto-create profile on user signup' сам создаст запись
    const { error } = await supabase.auth.signInWithOtp({ email });

    if (!error) {
      console.log("Access granted. Syncing Hero Level...");
      // ФИКС: Мгновенный переход на страницу профиля
      navigate('/profile');
    } else {
      console.error("Auth Error:", error.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black z-50 p-4">
      <div className="w-full max-w-sm bg-zinc-900 p-8 rounded-[2.5rem] border border-white/5 shadow-2xl relative overflow-hidden">
        
        {/* Декор: Неоновая пирамида на фоне */}
        <div className="absolute -right-10 -top-10 opacity-10 rotate-12">
          <svg width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="#38bd3d" strokeWidth="1">
            <path d="M12 2L2 22H22L12 2Z" />
          </svg>
        </div>

        <div className="text-center mb-8 relative z-10">
          <h2 className="text-white text-3xl font-black italic tracking-tighter uppercase">
            Join <span className="text-[#38bd3d]">Mission</span>
          </h2>
          <p className="text-zinc-500 text-[10px] uppercase tracking-[0.3em] mt-2">Enter your e-mail to start</p>
        </div>

        <form onSubmit={handleQuickAccess} className="space-y-4 relative z-10">
          <input
            type="email"
            placeholder="sergio@cleanmontenegro.co"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-4 bg-zinc-950 border border-zinc-800 rounded-2xl text-white focus:border-[#38bd3d] outline-none transition-all text-center font-bold"
            required
          />

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-4 bg-gradient-to-r from-[#38bd3d] to-[#a855f7] rounded-2xl font-black text-lg shadow-[0_0_20px_rgba(56,189,61,0.3)] hover:scale-[1.02] active:scale-95 transition-all uppercase italic"
          >
            {isLoading ? "Loading..." : "Get Started 🚀"}
          </button>
        </form>

        <p className="text-center mt-6 text-[10px] text-zinc-600 uppercase tracking-widest">
          No password required. Instant access.
        </p>
      </div>
    </div>
  );
};

export default Auth;
