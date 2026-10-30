import React, { useState } from 'react';
import { 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  ShieldCheck, 
  X, 
  Sparkles, 
  History, 
  User, 
  Send, 
  XCircle, 
  MessageSquare, 
  AlertTriangle,
  ArrowRight
} from 'lucide-react';
import { Reservation, Hotel, UserProfile, GracePeriodRequest } from '../types';
import { getGracePeriodInfo } from '../utils/dateUtils';
import { db } from '../firebase';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { logActivity } from '../utils/activityLogger';
import { format } from 'date-fns';
import { safeFormatDate } from '../utils/dateUtils';
import { toast } from 'sonner';

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
  const isAdmin = currentUser?.role === 'hotelAdmin' || currentUser?.role === 'superAdmin';
  const pendingRequest = reservation.gracePeriodRequest?.status === 'pending' ? reservation.gracePeriodRequest : null;
  const lastRequest = reservation.gracePeriodRequest;

  const [extensionMinutes, setExtensionMinutes] = useState<number>(60);
  const [reason, setReason] = useState<string>('Guest requested late checkout');
  const [adminNote, setAdminNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [adminViewMode, setAdminViewMode] = useState<'review' | 'direct'>(pendingRequest ? 'review' : 'direct');

  if (!isOpen) return null;

  const graceInfo = getGracePeriodInfo(reservation, hotel, new Date());
  const currentCustomMinutes = Number(reservation.customGracePeriodMinutes || 0);
  const newTotalCustomMinutes = currentCustomMinutes + extensionMinutes;

  // Calculate prospective new deadline for current inputs
  const prospectiveDeadline = new Date(
    graceInfo.effectiveDeadlineDateTime.getTime() + extensionMinutes * 60 * 1000
  );

  // Prospective deadline for pending request if present
  const pendingProspectiveDeadline = pendingRequest?.requestedMinutes
    ? new Date(graceInfo.effectiveDeadlineDateTime.getTime() + pendingRequest.requestedMinutes * 60 * 1000)
    : null;

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
    'Medical / emergency delay',
    'Executive lounge access',
    'Front Desk Courtesy'
  ];

  const quickAdminNotes = [
    'Approved - Low arrival volume today',
    'Approved - VIP loyalty courtesy',
    'Approved - Late flight acknowledged',
    'Rejected - High arrival volume, room needed for turnover',
    'Rejected - Please inform guest late checkout fee applies'
  ];

  /**
   * Other Staff: Submit request for Hotel Admin approval
   */
  const handlePlaceRequest = async () => {
    if (!hotel?.id || !reservation?.id || !currentUser) return;
    if (extensionMinutes <= 0) {
      setError('Please specify at least 15 minutes of extension.');
      return;
    }
    if (!reason.trim()) {
      setError('Please provide a reason or justification for the Hotel Admin.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const staffName = currentUser?.displayName || currentUser?.name || currentUser?.email || 'Front Desk Staff';
      const staffUid = currentUser?.uid || 'unknown';
      const timestampIso = new Date().toISOString();
      const requestId = `gpr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      const newRequest: GracePeriodRequest = {
        id: requestId,
        requestedMinutes: extensionMinutes,
        requestedAt: timestampIso,
        requestedBy: staffName,
        requestedByUid: staffUid,
        reason: reason.trim(),
        status: 'pending',
        prospectiveCheckoutTime: prospectiveDeadline.toISOString()
      };

      const resRef = doc(db, 'hotels', hotel.id, 'reservations', reservation.id);

      await updateDoc(resRef, {
        gracePeriodRequest: newRequest,
        gracePeriodRequestsHistory: arrayUnion(newRequest)
      });

      try {
        await logActivity(
          hotel.id,
          currentUser,
          'GRACE_PERIOD_REQUESTED',
          'reservations',
          `Staff ${staffName} requested +${extensionMinutes}m grace period extension for Room ${reservation.roomNumber}. Reason: ${reason.trim()}`,
          reservation.id
        );
      } catch (logErr) {
        console.warn('Activity log failed (non-critical):', logErr);
      }

      toast.success('Grace period request placed. Awaiting Hotel Admin review.');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error placing grace period request:', err);
      setError(err?.message || 'Failed to submit request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Other Staff: Withdraw / Cancel pending request
   */
  const handleCancelRequest = async () => {
    if (!hotel?.id || !reservation?.id || !pendingRequest) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const staffName = currentUser?.displayName || currentUser?.name || currentUser?.email || 'Staff';
      const timestampIso = new Date().toISOString();
      const cancelledRequest: GracePeriodRequest = {
        ...pendingRequest,
        status: 'cancelled',
        reviewedAt: timestampIso,
        adminNote: `Withdrawn by ${staffName}`
      };

      const resRef = doc(db, 'hotels', hotel.id, 'reservations', reservation.id);
      await updateDoc(resRef, {
        gracePeriodRequest: cancelledRequest,
        gracePeriodRequestsHistory: arrayUnion(cancelledRequest)
      });

      try {
        await logActivity(
          hotel.id,
          currentUser,
          'GRACE_PERIOD_REQUEST_CANCELLED',
          'reservations',
          `Staff ${staffName} cancelled pending grace period request for Room ${reservation.roomNumber}`,
          reservation.id
        );
      } catch (logErr) {
        console.warn('Activity log failed (non-critical):', logErr);
      }

      toast.info('Grace period request withdrawn.');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error withdrawing request:', err);
      setError(err?.message || 'Failed to withdraw request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Hotel Admin: Accept pending request
   */
  const handleAdminAccept = async () => {
    if (!hotel?.id || !reservation?.id || !pendingRequest || !currentUser) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const adminName = currentUser?.displayName || currentUser?.name || currentUser?.email || 'Hotel Admin';
      const adminUid = currentUser?.uid || 'admin';
      const timestampIso = new Date().toISOString();

      const approvedMinutes = pendingRequest.requestedMinutes;
      const newTotalMinutes = currentCustomMinutes + approvedMinutes;
      const targetDeadline = pendingProspectiveDeadline || new Date(
        graceInfo.effectiveDeadlineDateTime.getTime() + approvedMinutes * 60 * 1000
      );
      const newEffectiveTimeStr = format(targetDeadline, 'HH:mm');

      const approvedRequest: GracePeriodRequest = {
        ...pendingRequest,
        status: 'approved',
        adminNote: adminNote.trim() || 'Approved by Hotel Admin',
        reviewedBy: adminName,
        reviewedByUid: adminUid,
        reviewedAt: timestampIso
      };

      const extensionRecord = {
        minutes: approvedMinutes,
        totalCustomMinutes: newTotalMinutes,
        approvedBy: adminName,
        approvedByUid: adminUid,
        timestamp: timestampIso,
        reason: `${pendingRequest.reason}${adminNote.trim() ? ` (Admin Note: ${adminNote.trim()})` : ''}`,
        previousCheckoutDeadline: graceInfo.effectiveDeadlineDateTime.toISOString(),
        newEffectiveCheckoutTime: targetDeadline.toISOString()
      };

      const resRef = doc(db, 'hotels', hotel.id, 'reservations', reservation.id);

      await updateDoc(resRef, {
        customGracePeriodMinutes: newTotalMinutes,
        approvedLateCheckoutTime: newEffectiveTimeStr,
        effectiveCheckoutTime: targetDeadline.toISOString(),
        gracePeriodApprovedBy: {
          uid: adminUid,
          name: adminName,
          timestamp: timestampIso,
          reason: extensionRecord.reason
        },
        gracePeriodExtensionHistory: arrayUnion(extensionRecord),
        gracePeriodRequest: approvedRequest,
        gracePeriodRequestsHistory: arrayUnion(approvedRequest)
      });

      try {
        await logActivity(
          hotel.id,
          currentUser,
          'GRACE_PERIOD_REQUEST_APPROVED',
          'reservations',
          `Hotel Admin ${adminName} accepted grace extension of +${approvedMinutes}m for Room ${reservation.roomNumber}. Admin Note: ${adminNote.trim() || 'None'}. New deadline: ${newEffectiveTimeStr}`,
          reservation.id
        );
      } catch (logErr) {
        console.warn('Activity log failed (non-critical):', logErr);
      }

      toast.success(`Grace period request accepted (+${approvedMinutes}m granted).`);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error accepting grace period request:', err);
      setError(err?.message || 'Failed to accept request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Hotel Admin: Reject pending request with note
   */
  const handleAdminReject = async () => {
    if (!hotel?.id || !reservation?.id || !pendingRequest || !currentUser) return;
    if (!adminNote.trim()) {
      setError('Please provide an Admin Note explaining why the request is rejected.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const adminName = currentUser?.displayName || currentUser?.name || currentUser?.email || 'Hotel Admin';
      const adminUid = currentUser?.uid || 'admin';
      const timestampIso = new Date().toISOString();

      const rejectedRequest: GracePeriodRequest = {
        ...pendingRequest,
        status: 'rejected',
        adminNote: adminNote.trim(),
        reviewedBy: adminName,
        reviewedByUid: adminUid,
        reviewedAt: timestampIso
      };

      const resRef = doc(db, 'hotels', hotel.id, 'reservations', reservation.id);

      await updateDoc(resRef, {
        gracePeriodRequest: rejectedRequest,
        gracePeriodRequestsHistory: arrayUnion(rejectedRequest)
      });

      try {
        await logActivity(
          hotel.id,
          currentUser,
          'GRACE_PERIOD_REQUEST_REJECTED',
          'reservations',
          `Hotel Admin ${adminName} rejected grace extension request (+${pendingRequest.requestedMinutes}m) for Room ${reservation.roomNumber}. Reason Note: ${adminNote.trim()}`,
          reservation.id
        );
      } catch (logErr) {
        console.warn('Activity log failed (non-critical):', logErr);
      }

      toast.error(`Grace period request rejected: "${adminNote.trim()}"`);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error rejecting grace period request:', err);
      setError(err?.message || 'Failed to reject request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Hotel Admin: Direct grant / override
   */
  const handleAdminDirectGrant = async () => {
    if (!hotel?.id || !reservation?.id) return;
    if (extensionMinutes <= 0) {
      setError('Please specify at least 15 minutes of extension.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const adminName = currentUser?.displayName || currentUser?.name || currentUser?.email || 'Hotel Admin';
      const adminUid = currentUser?.uid || 'system';
      const timestampIso = new Date().toISOString();
      const newEffectiveTimeStr = format(prospectiveDeadline, 'HH:mm');

      const extensionRecord = {
        minutes: extensionMinutes,
        totalCustomMinutes: newTotalCustomMinutes,
        approvedBy: adminName,
        approvedByUid: adminUid,
        timestamp: timestampIso,
        reason: reason.trim() || 'Hotel Admin direct grant',
        previousCheckoutDeadline: graceInfo.effectiveDeadlineDateTime.toISOString(),
        newEffectiveCheckoutTime: prospectiveDeadline.toISOString()
      };

      const resRef = doc(db, 'hotels', hotel.id, 'reservations', reservation.id);

      await updateDoc(resRef, {
        customGracePeriodMinutes: newTotalCustomMinutes,
        approvedLateCheckoutTime: newEffectiveTimeStr,
        effectiveCheckoutTime: prospectiveDeadline.toISOString(),
        gracePeriodApprovedBy: {
          uid: adminUid,
          name: adminName,
          timestamp: timestampIso,
          reason: reason.trim()
        },
        gracePeriodExtensionHistory: arrayUnion(extensionRecord)
      });

      try {
        await logActivity(
          hotel.id,
          currentUser,
          'GRACE_PERIOD_EXTENDED',
          'reservations',
          `Hotel Admin granted grace extension of +${extensionMinutes}m for Room ${reservation.roomNumber}. Reason: ${reason.trim()}. New deadline: ${newEffectiveTimeStr}`,
          reservation.id
        );
      } catch (logErr) {
        console.warn('Activity log failed (non-critical):', logErr);
      }

      toast.success(`Grace period extended by +${extensionMinutes}m.`);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error extending grace period:', err);
      setError(err?.message || 'Failed to apply grace period extension.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Hotel Admin: Reset grace period to hotel default
   */
  const handleReset = async () => {
    if (!hotel?.id || !reservation?.id) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const staffName = currentUser?.displayName || currentUser?.name || currentUser?.email || 'Staff';
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

      toast.success('Grace period reset to default hotel policy.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
              isAdmin && pendingRequest && adminViewMode === 'review'
                ? 'bg-amber-500/20 border-amber-500/30 text-amber-400'
                : !isAdmin
                  ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            }`}>
              {isAdmin && pendingRequest && adminViewMode === 'review' ? (
                <ShieldCheck className="w-5 h-5" />
              ) : (
                <Clock className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                {isAdmin && pendingRequest && adminViewMode === 'review' ? (
                  <>
                    <span>Review Staff Grace Period Request</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
                      Pending
                    </span>
                  </>
                ) : !isAdmin && pendingRequest ? (
                  <>
                    <span>Grace Request Pending Approval</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Awaiting Admin
                    </span>
                  </>
                ) : !isAdmin ? (
                  'Request Grace Period Extension'
                ) : (
                  'Manage Grace Period Extension'
                )}
              </h3>
              <p className="text-xs text-zinc-400">
                {isAdmin && pendingRequest && adminViewMode === 'review'
                  ? `Review and accept or reject request with an administrative note`
                  : !isAdmin
                    ? `Place request for Hotel Admin approval before extending grace period`
                    : `Grant or adjust departure grace time without triggering overstay charges`}
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

        {/* Content Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Guest & Current Policy Overview */}
          <div className="p-3.5 bg-zinc-950/60 rounded-xl border border-zinc-800/80 space-y-2">
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
              <span className="text-zinc-400">Hotel Default Grace:</span>
              <span className="text-zinc-300 font-medium">
                {graceInfo.hotelGraceMinutes >= 60 
                  ? `${(graceInfo.hotelGraceMinutes / 60).toFixed(1).replace('.0', '')} hrs` 
                  : `${graceInfo.hotelGraceMinutes} mins`}
              </span>
            </div>

            {currentCustomMinutes > 0 && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-emerald-400 font-medium">Approved Custom Extension:</span>
                <span className="text-emerald-300 font-bold">
                  +{currentCustomMinutes} mins
                </span>
              </div>
            )}

            <div className="pt-2 border-t border-zinc-800/60 flex justify-between items-center text-xs">
              <span className="text-zinc-400 font-semibold">Current Effective Deadline:</span>
              <span className="font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                {safeFormatDate(graceInfo.effectiveDeadlineDateTime, 'MMM d, yyyy @ h:mm a')}
              </span>
            </div>
          </div>

          {/* Hotel Admin Mode Switch (If pending request exists, allow admin to toggle between Reviewing Request or Direct Grant) */}
          {isAdmin && pendingRequest && (
            <div className="flex gap-2 p-1 bg-zinc-950 border border-zinc-800 rounded-xl">
              <button
                type="button"
                onClick={() => setAdminViewMode('review')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  adminViewMode === 'review'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Review Pending Request ({pendingRequest.requestedMinutes}m)
              </button>
              <button
                type="button"
                onClick={() => setAdminViewMode('direct')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  adminViewMode === 'direct'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Direct Admin Override
              </button>
            </div>
          )}

          {/* VIEW 1: HOTEL ADMIN REVIEWING PENDING STAFF REQUEST */}
          {isAdmin && pendingRequest && adminViewMode === 'review' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5 uppercase tracking-wide">
                    <Sparkles className="w-3.5 h-3.5" />
                    Pending Request Details
                  </span>
                  <span className="text-[11px] font-mono text-zinc-400">
                    {safeFormatDate(pendingRequest.requestedAt, 'MMM d, h:mm a')}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                  <div className="bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800">
                    <span className="text-zinc-400 text-[10px] uppercase font-bold block mb-0.5">Requested Extension</span>
                    <span className="font-extrabold text-amber-300 text-sm">+{pendingRequest.requestedMinutes} Mins</span>
                    <span className="text-zinc-400 text-[10px] ml-1">({((pendingRequest.requestedMinutes || 0) / 60).toFixed(1)} hrs)</span>
                  </div>

                  <div className="bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800">
                    <span className="text-zinc-400 text-[10px] uppercase font-bold block mb-0.5">Requested By</span>
                    <span className="font-bold text-zinc-200 truncate block">{pendingRequest.requestedBy}</span>
                    <span className="text-zinc-400 text-[10px]">Staff</span>
                  </div>
                </div>

                <div className="bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800">
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block mb-0.5">Staff Justification / Reason:</span>
                  <p className="text-zinc-200 text-xs italic">"{pendingRequest.reason}"</p>
                </div>

                <div className="pt-1 flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Prospective New Departure:</span>
                  <span className="font-mono font-bold text-amber-300">
                    {pendingProspectiveDeadline ? safeFormatDate(pendingProspectiveDeadline, 'h:mm a (MMM d)') : 'N/A'}
                  </span>
                </div>
              </div>

              {/* Hotel Admin Decision Note */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
                  Hotel Admin Note (Required to Reject, Recommended for Audit)
                </label>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {quickAdminNotes.map((note) => (
                    <button
                      key={note}
                      type="button"
                      onClick={() => setAdminNote(note)}
                      className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                        adminNote === note
                          ? 'bg-zinc-700 text-white border-zinc-500'
                          : 'bg-zinc-800/70 text-zinc-400 border-zinc-700/60 hover:text-zinc-200'
                      }`}
                    >
                      {note}
                    </button>
                  ))}
                </div>
                <textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder="Enter reason for decision (e.g. Approved for loyalty guest / Rejected due to high incoming check-in occupancy)..."
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-xl text-xs text-zinc-100 focus:outline-hidden focus:border-amber-500 h-20 resize-none"
                />
              </div>

              {/* Admin Decision Action Buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleAdminReject}
                  className="flex-1 py-2.5 px-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 hover:text-red-300 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 active:scale-95"
                >
                  <XCircle className="w-4 h-4" />
                  <span>Reject Request</span>
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleAdminAccept}
                  className="flex-1 py-2.5 px-3 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 shadow-lg shadow-emerald-500/20 active:scale-95"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Accept & Grant +{pendingRequest.requestedMinutes}m</span>
                </button>
              </div>
            </div>
          )}

          {/* VIEW 2: OTHER STAFF WITH PENDING REQUEST */}
          {!isAdmin && pendingRequest && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wide">
                <Clock className="w-4 h-4 animate-spin" />
                <span>Request Awaiting Hotel Admin Approval</span>
              </div>

              <div className="bg-zinc-900/90 p-3 rounded-lg border border-zinc-800 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Extension Requested:</span>
                  <span className="font-bold text-amber-300">+{pendingRequest.requestedMinutes} mins</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Staff Reason:</span>
                  <span className="text-zinc-200 italic font-medium">"{pendingRequest.reason}"</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Submitted:</span>
                  <span className="text-zinc-400 font-mono text-[11px]">
                    {safeFormatDate(pendingRequest.requestedAt, 'MMM d, h:mm a')} by {pendingRequest.requestedBy}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Your request is pending Hotel Admin review. The Hotel Admin will accept or reject this request with an administrative note. The departure deadline will be updated once accepted.
              </p>

              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleCancelRequest}
                className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg text-xs font-bold transition-colors"
              >
                Withdraw Request
              </button>
            </div>
          )}

          {/* VIEW 3: STAFF PLACING NEW REQUEST OR ADMIN DIRECT GRANT */}
          {((!isAdmin && !pendingRequest) || (isAdmin && (!pendingRequest || adminViewMode === 'direct'))) && (
            <div className="space-y-4">
              {/* Previous Rejection Banner (if last request was rejected) */}
              {!isAdmin && lastRequest?.status === 'rejected' && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-red-400">
                    <XCircle className="w-4 h-4" />
                    <span>Previous Grace Request Rejected</span>
                  </div>
                  <p className="text-zinc-300 text-[11px]">
                    Admin Note by <span className="font-semibold text-zinc-200">{lastRequest.reviewedBy || 'Hotel Admin'}</span>: "{lastRequest.adminNote || 'No explanation provided'}"
                  </p>
                </div>
              )}

              {/* Policy Explanation */}
              {!isAdmin && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl text-xs text-blue-300 flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed text-[11px]">
                    <span className="font-bold text-blue-200">Hotel Admin Approval Required:</span> Front Desk staff must submit a request before applying grace periods different from the hotel's standard policy. The Hotel Admin will review and accept or reject your request with a note.
                  </p>
                </div>
              )}

              {/* Extension Selector */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  {isAdmin ? 'Additional Grace Time to Grant' : 'Additional Grace Time to Request'}
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

              {/* Reason / Request Justification */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  {isAdmin ? 'Extension Reason (Audit Log)' : 'Justification for Hotel Admin'}
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
                  placeholder={isAdmin ? "Enter reason for late checkout approval..." : "Explain why the guest needs extra grace time..."}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-100 focus:outline-hidden focus:border-amber-500"
                />
              </div>

              {/* Prospective Outcome Banner */}
              <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
                  <Sparkles className="w-4 h-4" />
                  <span>Prospective Departure Deadline:</span>
                </div>
                <div className="text-sm font-black text-amber-300 font-mono">
                  {safeFormatDate(prospectiveDeadline, 'EEEE, MMM d, yyyy @ h:mm a')}
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed pt-1">
                  {isAdmin 
                    ? 'Guest will remain free of overstay room charges and automated nightly fees until this time.'
                    : 'If approved by the Hotel Admin, overstay room charges will be waived until this time.'}
                </p>
              </div>
            </div>
          )}

          {/* Prior Extension History */}
          {reservation.gracePeriodExtensionHistory && reservation.gracePeriodExtensionHistory.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-zinc-800/60">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
                <History className="w-3.5 h-3.5 text-zinc-500" />
                <span>Approved History ({reservation.gracePeriodExtensionHistory.length})</span>
              </div>
              <div className="max-h-24 overflow-y-auto space-y-1 p-2 bg-zinc-950/40 rounded-lg border border-zinc-800 text-[10px] text-zinc-400">
                {reservation.gracePeriodExtensionHistory.map((hist, idx) => (
                  <div key={idx} className="flex justify-between items-center py-0.5 border-b border-zinc-800/40 last:border-0">
                    <div>
                      <span className="text-zinc-200 font-semibold">+{hist.minutes}m</span> &bull; {hist.reason || 'Approved'}
                    </div>
                    <div className="text-zinc-500">
                      by {hist.approvedBy} ({safeFormatDate(hist.timestamp, 'h:mm a, MMM d')})
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Past Grace Period Requests Log (if any) */}
          {reservation.gracePeriodRequestsHistory && reservation.gracePeriodRequestsHistory.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
                <MessageSquare className="w-3.5 h-3.5 text-zinc-500" />
                <span>Requests Audit Trail ({reservation.gracePeriodRequestsHistory.length})</span>
              </div>
              <div className="max-h-24 overflow-y-auto space-y-1 p-2 bg-zinc-950/40 rounded-lg border border-zinc-800 text-[10px] text-zinc-400">
                {reservation.gracePeriodRequestsHistory.map((req, idx) => (
                  <div key={idx} className="py-1 border-b border-zinc-800/40 last:border-0 flex justify-between items-start gap-2">
                    <div>
                      <span className={`px-1.5 py-0.2 rounded font-bold uppercase text-[9px] ${
                        req.status === 'approved' ? 'bg-emerald-500/20 text-emerald-300' :
                        req.status === 'rejected' ? 'bg-red-500/20 text-red-300' :
                        req.status === 'pending' ? 'bg-amber-500/20 text-amber-300' :
                        'bg-zinc-800 text-zinc-400'
                      }`}>
                        {req.status}
                      </span>
                      <span className="ml-1.5 text-zinc-200 font-semibold">+{req.requestedMinutes}m</span> &bull; {req.reason}
                      {req.adminNote && (
                        <div className="text-zinc-400 italic mt-0.5 text-[9px]">
                          Admin Note: "{req.adminNote}" ({req.reviewedBy})
                        </div>
                      )}
                    </div>
                    <span className="text-zinc-500 text-[9px] shrink-0">
                      {safeFormatDate(req.requestedAt, 'MMM d, h:mm a')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/80 flex items-center justify-between gap-2">
          {isAdmin && currentCustomMinutes > 0 && adminViewMode === 'direct' ? (
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

            {/* If Admin is reviewing pending request, buttons are rendered inside the review block */}
            {!(isAdmin && pendingRequest && adminViewMode === 'review') && (
              <>
                {!isAdmin && !pendingRequest && (
                  <button
                    type="button"
                    disabled={isSubmitting || extensionMinutes <= 0 || !reason.trim()}
                    onClick={handlePlaceRequest}
                    className="px-4 py-2 text-xs font-bold text-black bg-amber-400 hover:bg-amber-300 rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center gap-1.5 disabled:opacity-50 active:scale-95"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin"></div>
                        <span>Submitting...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Place Request for Admin (+{extensionMinutes}m)</span>
                      </>
                    )}
                  </button>
                )}

                {isAdmin && (adminViewMode === 'direct' || !pendingRequest) && (
                  <button
                    type="button"
                    disabled={isSubmitting || extensionMinutes <= 0}
                    onClick={handleAdminDirectGrant}
                    className="px-4 py-2 text-xs font-bold text-zinc-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center gap-1.5 disabled:opacity-50 active:scale-95"
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
                )}
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
