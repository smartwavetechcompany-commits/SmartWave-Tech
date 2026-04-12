import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { CurrencyToggle } from './CurrencyToggle';
import { Notifications } from './Notifications';
import { User, Building2, WifiOff, XCircle } from 'lucide-react';

export function TopBar() {
  const { hotel, profile, isOffline, setSelectedHotelId } = useAuth();

  const isManaging = profile?.role === 'superAdmin' && hotel?.id;

  return (
    <div className="h-16 border-b border-zinc-800 bg-zinc-950/50 backdrop-blur-md flex items-center justify-between px-4 sm:px-8 sticky top-0 z-40">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-zinc-400">
          <Building2 size={16} />
          <span className="text-xs sm:text-sm font-medium truncate max-w-[100px] sm:max-w-none">{hotel?.name || 'PMS'}</span>
        </div>
        {isManaging && (
          <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-emerald-500">
            <span className="text-[10px] font-bold uppercase tracking-wider">Management Mode</span>
            <button 
              onClick={() => setSelectedHotelId(null)}
              className="hover:text-emerald-400 transition-colors"
              title="Exit Management Mode"
            >
              <XCircle size={14} />
            </button>
          </div>
        )}
        {isOffline && (
          <div className="flex items-center gap-2 px-3 py-1 bg-red-500/10 border border-red-500/20 rounded-full text-red-500 animate-pulse">
            <WifiOff size={14} />
            <span className="text-[10px] font-bold uppercase tracking-wider">Offline Mode</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-6">
        <div className="flex items-center gap-2 sm:gap-4 border-r border-zinc-800 pr-2 sm:pr-6">
          <CurrencyToggle />
          <Notifications />
        </div>
        
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-bold text-zinc-50 leading-none mb-1">
              {profile?.displayName || profile?.email?.split('@')[0]}
            </div>
            <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider leading-none">
              {profile?.role === 'superAdmin' ? 'Super Admin' : profile?.staffRole || profile?.role}
            </div>
          </div>
          <div className="w-10 h-10 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-center text-zinc-400">
            <User size={20} />
          </div>
        </div>
      </div>
    </div>
  );
}
