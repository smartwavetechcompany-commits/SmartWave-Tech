import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../utils';

export function CurrencyToggle() {
  const { currency, setCurrency } = useAuth();

  return (
    <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-1">
      <button
        onClick={() => setCurrency('NGN')}
        className={cn(
          "px-3 py-1 text-xs font-bold rounded-md transition-all",
          currency === 'NGN' 
            ? "bg-emerald-500 text-white shadow-lg" 
            : "text-zinc-500 hover:text-zinc-300"
        )}
      >
        NGN
      </button>
      <button
        onClick={() => setCurrency('USD')}
        className={cn(
          "px-3 py-1 text-xs font-bold rounded-md transition-all",
          currency === 'USD' 
            ? "bg-emerald-500 text-white shadow-lg" 
            : "text-zinc-500 hover:text-zinc-300"
        )}
      >
        USD
      </button>
    </div>
  );
}
