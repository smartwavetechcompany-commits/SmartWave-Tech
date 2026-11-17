import React, { useEffect, useState } from 'react';
import { Room } from '../types';
import {
  UtensilsCrossed,
  ShieldAlert,
  ShieldCheck,
  Clock,
  User,
  X,
  History,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '../utils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { roomService } from '../services/roomService';
import {
  canManageRoomRestaurantPosting,
  isRoomRestaurantPostingBlocked,
} from '../utils/restaurantPostingGuard';

interface RestaurantPostingControlModalProps {
  isOpen: boolean;
  onClose: () => void;
  room: Room | null;
  hotelId: string;
  profile: any;
  customRoles?: any[];
  guestName?: string;
}

function formatDateTimeSafe(iso?: string): string {
  if (!iso) return 'Unknown time';
  try {
    const parsed = new Date(iso);
    if (isNaN(parsed.getTime())) return iso;
    return format(parsed, 'MMM dd, yyyy • HH:mm');
  } catch {
    return iso;
  }
}

export function RestaurantPostingControlModal({
  isOpen,
  onClose,
  room,
  hotelId,
  profile,
  customRoles = [],
  guestName,
}: RestaurantPostingControlModalProps) {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setReason('');
    }
  }, [isOpen, room?.id]);

  if (!isOpen || !room) return null;

  const isAuthorized = canManageRoomRestaurantPosting(profile, customRoles);
  if (!isAuthorized) return null;

  const currentlyBlocked = isRoomRestaurantPostingBlocked(room);
  const restriction = room.restaurantPostingRestriction;
  const history = Array.isArray(room.restaurantPostingHistory)
    ? room.restaurantPostingHistory
    : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotelId || !room || isSubmitting) return;

    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error(
        `Please enter a reason to ${currentlyBlocked ? 'unblock' : 'block'} restaurant posting.`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await roomService.setRoomRestaurantPostingRestriction({
        hotelId,
        room,
        block: !currentlyBlocked,
        reason: trimmed,
        profile,
        customRoles,
      });

      toast.success(
        currentlyBlocked
          ? `Restaurant posting unblocked for Room ${room.roomNumber}.`
          : `Restaurant posting blocked for Room ${room.roomNumber}.`
      );
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update restaurant posting restriction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl my-auto"
      >
        {/* Header */}
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center border',
                currentlyBlocked
                  ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              )}
            >
              <UtensilsCrossed size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-50 flex items-center gap-2">
                Room {room.roomNumber} Restaurant Posting
              </h3>
              <p className="text-xs text-zinc-400">
                {room.type}
                {guestName ? ` • Guest: ${guestName}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Current Status Card */}
          <div
            className={cn(
              'p-4 rounded-xl border space-y-2',
              currentlyBlocked
                ? 'bg-red-500/10 border-red-500/30'
                : 'bg-emerald-500/10 border-emerald-500/30'
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Current Restaurant Posting Status
              </span>
              <span
                className={cn(
                  'px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider flex items-center gap-1 border',
                  currentlyBlocked
                    ? 'bg-red-500/20 text-red-300 border-red-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                )}
              >
                {currentlyBlocked ? (
                  <>
                    <ShieldAlert size={11} /> Blocked
                  </>
                ) : (
                  <>
                    <ShieldCheck size={11} /> Allowed
                  </>
                )}
              </span>
            </div>

            {currentlyBlocked ? (
              <p className="text-xs text-red-300 font-medium">
                Restaurant charges cannot be posted to Room {room.roomNumber}. Direct cash, card, or transfer payments at the restaurant counter remain unaffected.
              </p>
            ) : (
              <p className="text-xs text-emerald-300 font-medium">
                Restaurant and F&amp;B charges are currently permitted to post to Room {room.roomNumber}.
              </p>
            )}

            {restriction && (
              <div className="pt-2 mt-2 border-t border-zinc-800/70 space-y-1 text-[11px] text-zinc-300">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="flex items-center gap-1.5 text-zinc-400">
                    <User size={12} />
                    <span>
                      Last {restriction.action} by{' '}
                      <strong className="text-zinc-100">{restriction.updatedByName}</strong>
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-zinc-400 font-mono text-[10px]">
                    <Clock size={11} />
                    {formatDateTimeSafe(restriction.updatedAt)}
                  </span>
                </div>
                {restriction.reason && (
                  <div className="text-zinc-300 italic">
                    Reason: &ldquo;{restriction.reason}&rdquo;
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mandatory Reason Input */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
              Reason for {currentlyBlocked ? 'Unblocking' : 'Blocking'}{' '}
              <span className="text-red-400">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                currentlyBlocked
                  ? 'e.g. Guest cleared credit limit / deposited cash at Front Desk'
                  : 'e.g. Guest requested no room charges / deposit limit reached'
              }
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500/50 resize-none"
            />
          </div>

          {/* Warning Note when blocking */}
          {!currentlyBlocked && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300">
              <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-400" />
              <span>
                Only Room {room.roomNumber} will be restricted. Other rooms will continue accepting restaurant charges normally.
              </span>
            </div>
          )}

          {/* Recent Action History */}
          {history.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                <History size={12} />
                Recent Restriction Audit History
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                {history.slice(0, 6).map((item, idx) => (
                  <div
                    key={`${item.timestamp}-${idx}`}
                    className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80 text-[11px] space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          'font-bold uppercase text-[9px] px-1.5 py-0.5 rounded',
                          item.action === 'blocked'
                            ? 'bg-red-500/15 text-red-400'
                            : 'bg-emerald-500/15 text-emerald-400'
                        )}
                      >
                        {item.action}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {formatDateTimeSafe(item.timestamp)}
                      </span>
                    </div>
                    <div className="text-zinc-300">
                      <span className="font-semibold text-zinc-100">{item.staffName}</span>: &ldquo;{item.reason}&rdquo;
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !reason.trim()}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50',
                currentlyBlocked
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-black'
                  : 'bg-red-500 hover:bg-red-400 text-white'
              )}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving...
                </>
              ) : currentlyBlocked ? (
                <>
                  <ShieldCheck size={14} />
                  Unblock Restaurant Posting
                </>
              ) : (
                <>
                  <ShieldAlert size={14} />
                  Block Restaurant Posting
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
