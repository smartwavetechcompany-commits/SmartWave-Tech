import React, { useState } from 'react';
import { Clock, CheckCircle2, AlertCircle, ShieldCheck, X, Sparkles, History, User } from 'lucide-react';
import { Reservation, Hotel, UserProfile } from '../types';
import { getGracePeriodInfo } from '../utils/dateUtils';
import { db } from '../firebase';
import { doc, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { logActivity } from '../utils/activityLogger';
import { format } from 'date-fns';

interface ExtendGracePeriodModalProps {
  isOpen: boolean;
  onClose: () => void;
  reservation: Reservation;
  hotel: Hotel;
  currentUser?: UserProfile | null;
  onSuccess?: () => void;
}

export const ExtendGracePeriodModal: React.FC<ExtendGracePeriodModalProps> = ({
  isOpen,
  onClose,
  reservation,
  hotel,
  currentUser,
  onSuccess
}) => {
  const [extensionMinutes, setExtensionMinutes] = useState<number>(60);
  const [reason, setReason] = useState<string>('Guest requested late checkout');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const graceInfo = getGracePeriodInfo(reservation, hotel, new Date());
  const currentCustomMinutes = Number(reservation.customGracePeriodMinutes || 0);
  const newTotalCustomMinutes = currentCustomMinutes + extensionMinutes;

  // Calculate prospective new deadline
  const prospectiveDeadline = new Date(
    graceInfo.effectiveDeadlineDateTime.getTime() + extensionMinutes * 60 * 1000
  );

  const quickPresets = [
    { label: '+30 Mins', value: 30 },
    { label: '+1 Hour', value: 60 },
    { label: '+2 Hours', value: 120 },
    { label: '+3 Hours', value: 180 },
    { label: '+4 Hours', value: 240 }
  ];

  const quickReasons = [
    'Guest requested late checkout',
    'Flight / Travel delay',
    'VIP Courtesy extension',
    'Executive lounge access',
    'Front Desk Courtesy'
  ];

  const handleConfirm = async () => {
    if (!hotel?.id || !reservation?.id) return;
    if (extensionMinutes <= 0) {
      setError('Please specify at least 15 minutes of extension.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const staffName = currentUser?.displayName || currentUser?.email || 'Front Desk Staff';
      const staffUid = currentUser?.uid || 'system';
      const timestampIso = new Date().toISOString();
      const newEffectiveTimeStr = format(prospectiveDeadline, 'HH:mm');

      const extensionRecord = {
        minutes: extensionMinutes,
        totalCustomMinutes: newTotalCustomMinutes,
        approvedBy: staffName,
        approvedByUid: staffUid,
        timestamp: timestampIso,
        reason: reason.trim() || 'Front Desk courtesy extension',
        previousCheckoutDeadline: graceInfo.effectiveDeadlineDateTime.toISOString(),
        newEffectiveCheckoutTime: prospectiveDeadline.toISOString()
      };

      const resRef = doc(db, 'hotels', hotel.id, 'reservations', reservation.id);

      await updateDoc(resRef, {
        customGracePeriodMinutes: newTotalCustomMinutes,
        approvedLateCheckoutTime: newEffectiveTimeStr,
        effectiveCheckoutTime: prospectiveDeadline.toISOString(),
        gracePeriodApprovedBy: {
          uid: staffUid,
          name: staffName,
          timestamp: timestampIso,
          reason: reason.trim()
        },
        gracePeriodExtensionHistory: arrayUnion(extensionRecord)
      });

      // Log activity
      try {
        await logActivity(
          hotel.id,
          currentUser,
          'GRACE_PERIOD_EXTENDED',
          'reservations',
          `Extended checkout grace period by ${extensionMinutes}m. Reason: ${reason.trim() || 'Courtesy'}. New deadline: ${newEffectiveTimeStr}`,
          reservation.id
        );
      } catch (logErr) {
        console.warn('Activity log failed (non-critical):', logErr);
      }

      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error extending grace period:', err);
      setError(err?.message || 'Failed to apply grace period extension. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = async () => {
    if (!hotel?.id || !reservation?.id) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const staffName = currentUser?.displayName || currentUser?.email || 'Front Desk Staff';
      const staffUid = currentUser?.uid || 'system';
      const resRef = doc(db, 'hotels', hotel.id, 'reservations', reservation.id);

      await updateDoc(resRef, {
        customGracePeriodMinutes: 0,
        approvedLateCheckoutTime: null,
        effectiveCheckoutTime: null
      });

      try {
        await logActivity(
          hotel.id,
          currentUser,
          'GRACE_PERIOD_RESET_TO_DEFAULT',
          'reservations',
          'Reset custom grace period extension back to standard hotel policy',
          reservation.id
        );
      } catch (logErr) {
        console.warn('Activity log failed (non-critical):', logErr);
      }

      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error resetting grace period:', err);
      setError(err?.message || 'Failed to reset grace period.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-100">Extend Checkout Grace Period</h3>
              <p className="text-xs text-zinc-400">
                Grant extra departure time without triggering overstay charges
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Guest & Current Policy Overview */}
          <div className="p-3.5 bg-zinc-950/60 rounded-xl border border-zinc-800/80 space-y-2.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-400">Guest / Room:</span>
              <span className="font-bold text-zinc-200">
                {reservation.guestName} &bull; Room {reservation.roomNumber || reservation.roomId || 'N/A'}
              </span>
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-400">Standard Checkout:</span>
              <span className="text-zinc-300 font-medium">
                {reservation.checkOut} at {graceInfo.standardCheckoutTime}
              </span>
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-400">Hotel Grace Window:</span>
              <span className="text-zinc-300 font-medium">
                {graceInfo.hotelGraceMinutes >= 60 
                  ? `${(graceInfo.hotelGraceMinutes / 60).toFixed(1).replace('.0', '')} hrs` 
                  : `${graceInfo.hotelGraceMinutes} mins`} (Default)
              </span>
            </div>

            {currentCustomMinutes > 0 && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-amber-400 font-medium">Existing Ad-hoc Extension:</span>
                <span className="text-amber-300 font-bold">
                  +{currentCustomMinutes} mins
                </span>
              </div>
            )}

            <div className="pt-2 border-t border-zinc-800/60 flex justify-between items-center text-xs">
              <span className="text-zinc-400 font-semibold">Current Effective Deadline:</span>
              <span className="font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                {format(graceInfo.effectiveDeadlineDateTime, 'MMM d, yyyy @ h:mm a')}
              </span>
            </div>

            {/* Live Status Pill */}
            <div className="pt-1 flex items-center justify-between text-[11px]">
              <span className="text-zinc-500">Current Status:</span>
              {graceInfo.isWithinGracePeriod ? (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                  Within Grace Period ({graceInfo.minutesRemainingInGrace}m remaining)
                </span>
              ) : graceInfo.isOverstay ? (
                <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 font-bold">
                  Grace Period Expired (Overstay)
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                  Before Checkout
                </span>
              )}
            </div>
          </div>

          {/* Extension Selector */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Additional Grace Time to Grant
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {quickPresets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setExtensionMinutes(preset.value)}
                  className={`py-2 px-1 text-xs font-bold rounded-lg border transition-all ${
                    extensionMinutes === preset.value
                      ? 'bg-amber-500 text-zinc-950 border-amber-400 shadow-md shadow-amber-500/20'
                      : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-750 hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Custom Minutes Input */}
            <div className="pt-2 flex items-center gap-2">
              <span className="text-xs text-zinc-400 whitespace-nowrap">Or custom minutes:</span>
              <input
                type="number"
                min="5"
                max="720"
                step="5"
                value={extensionMinutes}
                onChange={(e) => setExtensionMinutes(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-24 px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-sm text-zinc-100 font-mono focus:outline-hidden focus:border-amber-500"
              />
              <span className="text-xs text-zinc-400">mins ({((extensionMinutes || 0) / 60).toFixed(1)} hrs)</span>
            </div>
          </div>

          {/* Reason / Approval Note */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Extension Reason (Audit Log)
            </label>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {quickReasons.map((qr) => (
                <button
                  key={qr}
                  type="button"
                  onClick={() => setReason(qr)}
                  className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                    reason === qr
                      ? 'bg-zinc-700 text-white border-zinc-500'
                      : 'bg-zinc-800/60 text-zinc-400 border-zinc-700/60 hover:text-zinc-200'
                  }`}
                >
                  {qr}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter reason for late checkout approval..."
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-100 focus:outline-hidden focus:border-amber-500"
            />
          </div>

          {/* Prospective Outcome Banner */}
          <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
              <Sparkles className="w-4 h-4" />
              <span>New Effective Departure Time:</span>
            </div>
            <div className="text-sm font-black text-amber-300 font-mono">
              {format(prospectiveDeadline, 'EEEE, MMM d, yyyy @ h:mm a')}
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed pt-1">
              Guest will remain free of overstay room charges and automated nightly fees until this time. Auto-billing rules will only resume if the guest remains in room after this threshold.
            </p>
          </div>

          {/* Prior Extension History if present */}
          {reservation.gracePeriodExtensionHistory && reservation.gracePeriodExtensionHistory.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
                <History className="w-3.5 h-3.5 text-zinc-500" />
                <span>Approval History ({reservation.gracePeriodExtensionHistory.length})</span>
              </div>
              <div className="max-h-24 overflow-y-auto space-y-1 p-2 bg-zinc-950/40 rounded-lg border border-zinc-800 text-[10px] text-zinc-400">
                {reservation.gracePeriodExtensionHistory.map((hist, idx) => (
                  <div key={idx} className="flex justify-between items-center py-0.5 border-b border-zinc-800/40 last:border-0">
                    <div>
                      <span className="text-zinc-200 font-semibold">+{hist.minutes}m</span> &bull; {hist.reason || 'Approved'}
                    </div>
                    <div className="text-zinc-500">
                      by {hist.approvedBy} ({format(new Date(hist.timestamp), 'h:mm a')})
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/80 flex items-center justify-between gap-2">
          {currentCustomMinutes > 0 ? (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleReset}
              className="text-xs text-zinc-400 hover:text-red-400 px-2 py-1.5 transition-colors disabled:opacity-50"
            >
              Reset to Default
            </button>
          ) : (
            <div></div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSubmitting || extensionMinutes <= 0}
              onClick={handleConfirm}
              className="px-4 py-2 text-xs font-bold text-zinc-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin"></div>
                  <span>Applying...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Grant +{extensionMinutes} Mins</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
