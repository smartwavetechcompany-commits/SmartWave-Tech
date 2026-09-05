import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ShieldX, LogOut, PhoneCall } from 'lucide-react';

export function AccountSuspendedModal() {
  const { profile, hotel, signOut } = useAuth();

  return (
    <div className="fixed inset-0 z-[9999] bg-zinc-950/95 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-red-500/30 rounded-2xl shadow-2xl overflow-hidden p-6 text-center space-y-5 animate-in zoom-in-95 duration-200">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 text-red-400 mx-auto flex items-center justify-center border border-red-500/20">
          <ShieldX size={32} />
        </div>

        <div>
          <h2 className="text-xl font-bold text-zinc-100">Account Suspended</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Your staff account has been locked or suspended by a Hotel Administrator.
          </p>
        </div>

        <div className="bg-zinc-950/60 p-4 rounded-xl border border-zinc-800 text-left text-xs space-y-2 text-zinc-300">
          <div className="flex justify-between">
            <span className="text-zinc-500">Account Email:</span>
            <span className="font-mono text-zinc-200">{profile?.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Property:</span>
            <span className="text-zinc-200">{hotel?.name || 'Assigned Hotel'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Department:</span>
            <span className="text-zinc-200">{profile?.department || 'General'}</span>
          </div>
          {profile?.lockedReason && (
            <div className="pt-2 border-t border-zinc-800/80">
              <span className="text-zinc-500 block mb-0.5">Suspension Reason:</span>
              <span className="text-red-400 font-medium">{profile.lockedReason}</span>
            </div>
          )}
        </div>

        <div className="text-xs text-zinc-500 flex items-center justify-center gap-1.5">
          <PhoneCall size={14} className="text-zinc-400" />
          <span>Please contact your general manager or system administrator.</span>
        </div>

        <div className="pt-2">
          <button
            onClick={signOut}
            className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
