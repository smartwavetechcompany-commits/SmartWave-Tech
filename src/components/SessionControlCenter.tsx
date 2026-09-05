import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { database } from '../utils/database';
import { useAuth } from '../contexts/AuthContext';
import { ActiveSession } from '../types';
import { 
  Laptop, 
  Smartphone, 
  ShieldAlert, 
  Clock, 
  LogOut, 
  CheckCircle2, 
  AlertTriangle,
  RefreshCw,
  Search,
  UserCheck
} from 'lucide-react';
import { toast } from 'sonner';

export function SessionControlCenter() {
  const { profile, hotel, currentSessionId } = useAuth();
  const hotelId = profile?.hotelId || hotel?.id;

  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isRevoking, setIsRevoking] = useState<string | null>(null);

  useEffect(() => {
    if (!hotelId || hotelId === 'system') return;

    const sessionsRef = collection(db, 'hotels', hotelId, 'sessions');
    const unsub = onSnapshot(sessionsRef, (snap) => {
      const list: ActiveSession[] = snap.docs.map(d => ({
        id: d.id,
        ...(d.data() as any)
      }));
      // Sort: active first, then most recently active
      list.sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (a.status !== 'active' && b.status === 'active') return 1;
        return new Date(b.lastActivityAt || 0).getTime() - new Date(a.lastActivityAt || 0).getTime();
      });
      setSessions(list);
    }, (err) => {
      console.warn('Session sync warning:', err);
    });

    return () => unsub();
  }, [hotelId]);

  const handleRevokeSession = async (session: ActiveSession) => {
    if (!hotelId) return;
    setIsRevoking(session.id);
    try {
      const sessionRef = doc(db, 'hotels', hotelId, 'sessions', session.id);
      await database.safeUpdate(sessionRef, {
        status: 'revoked',
        lastActivityAt: new Date().toISOString(),
        revokedBy: profile?.email || 'admin',
        revokedAt: new Date().toISOString()
      }, {
        hotelId,
        module: 'Session Security',
        action: 'REVOKE_SESSION',
        details: `Revoked active session for ${session.userEmail} on ${session.device} (${session.browser})`
      });

      toast.success(`Session terminated for ${session.userEmail}`);
    } catch (err: any) {
      console.error('Revoke session error:', err);
      toast.error('Failed to revoke session: ' + err.message);
    } finally {
      setIsRevoking(null);
    }
  };

  const handleRevokeAllOtherSessions = async () => {
    if (!hotelId) return;
    const targets = sessions.filter(s => s.status === 'active' && s.id !== currentSessionId);
    if (targets.length === 0) {
      toast.info('No other active sessions found.');
      return;
    }

    try {
      for (const target of targets) {
        const sessionRef = doc(db, 'hotels', hotelId, 'sessions', target.id);
        await database.safeUpdate(sessionRef, {
          status: 'revoked',
          lastActivityAt: new Date().toISOString(),
          revokedBy: profile?.email || 'admin',
          revokedAt: new Date().toISOString()
        }, {
          hotelId,
          module: 'Session Security',
          action: 'REVOKE_ALL_OTHER_SESSIONS',
          details: `Terminated session for ${target.userEmail} during mass session purge`
        });
      }
      toast.success(`Terminated ${targets.length} other active session(s)`);
    } catch (err: any) {
      toast.error('Failed to terminate sessions: ' + err.message);
    }
  };

  const filteredSessions = sessions.filter(s => {
    const term = searchTerm.toLowerCase();
    return (
      (s.userName?.toLowerCase() || '').includes(term) ||
      (s.userEmail?.toLowerCase() || '').includes(term) ||
      (s.browser?.toLowerCase() || '').includes(term) ||
      (s.os?.toLowerCase() || '').includes(term) ||
      (s.userRole?.toLowerCase() || '').includes(term)
    );
  });

  const activeCount = sessions.filter(s => s.status === 'active').length;

  return (
    <div className="space-y-6">
      {/* Overview bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <UserCheck size={20} />
          </div>
          <div>
            <span className="text-2xl font-black text-zinc-100">{activeCount}</span>
            <span className="text-xs text-zinc-400 block">Active Device Sessions</span>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
            <Laptop size={20} />
          </div>
          <div>
            <span className="text-2xl font-black text-zinc-100">{sessions.length}</span>
            <span className="text-xs text-zinc-400 block">Total Logged Sessions</span>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-zinc-300 block">Emergency Control</span>
            <span className="text-[11px] text-zinc-500">Revoke all sessions except current</span>
          </div>
          <button
            onClick={handleRevokeAllOtherSessions}
            className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <LogOut size={14} />
            Revoke Others
          </button>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by user, email, browser, or role..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Session Cards / Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950/70 border-b border-zinc-800 text-zinc-400 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3.5 px-4">Staff Member</th>
                <th className="py-3.5 px-4">Device & Browser</th>
                <th className="py-3.5 px-4">Login Time</th>
                <th className="py-3.5 px-4">Last Activity</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {filteredSessions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-500">
                    No active sessions found.
                  </td>
                </tr>
              ) : (
                filteredSessions.map((session) => {
                  const isCurrent = session.id === currentSessionId;
                  const isActive = session.status === 'active';

                  return (
                    <tr key={session.id} className="hover:bg-zinc-800/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${
                            isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
                          }`}>
                            {session.userName?.charAt(0).toUpperCase() || 'U'}
                          </div>
                          <div>
                            <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                              {session.userName || 'Unnamed'}
                              {isCurrent && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                  Current Device
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-zinc-500 font-mono block">
                              {session.userEmail}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2 text-zinc-300">
                          {session.device === 'Mobile' ? (
                            <Smartphone size={15} className="text-zinc-500 shrink-0" />
                          ) : (
                            <Laptop size={15} className="text-zinc-500 shrink-0" />
                          )}
                          <span>
                            {session.browser || 'Browser'} on {session.os || 'OS'}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-zinc-400">
                        {session.loginAt ? new Date(session.loginAt).toLocaleString() : 'N/A'}
                      </td>

                      <td className="py-3 px-4 text-zinc-400">
                        {session.lastActivityAt ? new Date(session.lastActivityAt).toLocaleTimeString() : 'N/A'}
                      </td>

                      <td className="py-3 px-4">
                        {isActive ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-zinc-800 text-zinc-400">
                            Revoked
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        {isActive && !isCurrent ? (
                          <button
                            onClick={() => handleRevokeSession(session)}
                            disabled={isRevoking === session.id}
                            className="px-2.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold transition-colors flex items-center gap-1 ml-auto"
                          >
                            <LogOut size={12} />
                            {isRevoking === session.id ? 'Revoking...' : 'Terminate'}
                          </button>
                        ) : isCurrent ? (
                          <span className="text-[11px] text-zinc-500 italic">Protected</span>
                        ) : (
                          <span className="text-[11px] text-zinc-600">Terminated</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
