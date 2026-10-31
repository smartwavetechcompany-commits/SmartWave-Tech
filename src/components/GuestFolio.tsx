import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, where, onSnapshot, orderBy, doc, addDoc, limit, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { hasPermission } from '../utils/permissions';
import { Reservation, LedgerEntry, OperationType, Guest, Room, CorporateAccount, Promotion } from '../types';
import { postToLedger, settleLedger, transferLedgerBalance, voidLedgerEntry, settleOverpayment, transferToCityLedger, purgeCorruptedLedgerEntries, detectAndPurgeDuplicateOverstayCharges, processAutomatedBillingForReservation, reconcileAndRepairReservationFinancials } from '../services/ledgerService';
import { validatePromotion, recordPromotionRedemption, subscribePromotions } from '../services/promotionService';
import { logActivity } from '../utils/activityLogger';
import { validateLedgerTransaction } from '../services/financialService';
import { canEditInvoice, canVoidTransaction, canApplyDiscount, canProcessRefund } from '../utils/policyUtils';
import { ReceiptGenerator, processLedgerTaxes } from './ReceiptGenerator';
import { DiscountApplication } from './DiscountApplication';
import { ConfirmModal } from './ConfirmModal';
import { LedgerDiagnosticModal } from './LedgerDiagnosticModal';
import { LedgerAuditErrorBoundary } from './LedgerAuditErrorBoundary';
import { PrincipalRoomManager } from './PrincipalRoomManager';
import { GuestActivityTimeline } from './GuestActivityTimeline';
import { GlobalErrorBoundary } from './GlobalErrorBoundary';
import { ExtendGracePeriodModal } from './ExtendGracePeriodModal';
import { 
  Receipt, 
  User, 
  Calendar, 
  CreditCard, 
  Plus, 
  History, 
  ArrowRight, 
  Banknote,
  Clock,
  Building2,
  XCircle,
  Printer,
  Download,
  Trash2,
  DollarSign,
  PlusCircle,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Tag,
  ShieldAlert,
  X,
  Sparkles,
  Loader2
} from 'lucide-react';
import { cn, formatCurrency, safeStringify } from '../utils';
import { format, addDays, startOfDay, isAfter, parseISO, differenceInDays } from 'date-fns';
import { toast } from 'sonner';
import { calculateBilling, parseLocalDateTime, BillingEngine } from '../utils/billingEngine';
import { calculateStayDuration, formatStayDuration, StayDurationDisplay, parseTimestampToDate, safeFormatDate, getGracePeriodInfo } from '../utils/dateUtils';
import { calculateGuestAccount, calculateReservationAccount } from '../utils/financialUtils';
import { useRequestManager } from '../contexts/RequestManagerContext';
import { printDocument, generatePdfExport } from '../utils/printUtils';

interface GuestFolioProps {
  reservation: Reservation;
  onClose: () => void;
  onPostCharge?: () => void;
}

export function GuestFolio({ reservation, onClose, onPostCharge }: GuestFolioProps) {
  const { hotel, currency, exchangeRate, profile } = useAuth();
  const { executeRequest, isPending } = useRequestManager();
  const [currentReservation, setCurrentReservation] = useState<Reservation>(reservation);
  const reservationRef = useRef<Reservation>(reservation);

  useEffect(() => {
    setCurrentReservation(reservation);
  }, [reservation]);

  useEffect(() => {
    reservationRef.current = currentReservation;
  }, [currentReservation]);

  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [folioTab, setFolioTab] = useState<'ledger' | 'timeline'>('ledger');
  const [guest, setGuest] = useState<Guest | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTransferBalanceModal, setShowTransferBalanceModal] = useState(false);
  const [otherReservations, setOtherReservations] = useState<Reservation[]>([]);
  const [activeReservationsForSearch, setActiveReservationsForSearch] = useState<Reservation[]>([]);
  const [corporateAccountsList, setCorporateAccountsList] = useState<CorporateAccount[]>([]);
  const [transferType, setTransferType] = useState<'guest' | 'corporate'>('guest');
  const [transferTargetId, setTransferTargetId] = useState('');
  const [showGuestHistory, setShowGuestHistory] = useState(false);
  const [guestHistory, setGuestHistory] = useState<Reservation[]>([]);
  const [showReceipt, setShowReceipt] = useState(false);
  const [showPrincipalManager, setShowPrincipalManager] = useState(false);
  const [showDiagnosticModal, setShowDiagnosticModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<LedgerEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showSettleOverpayment, setShowSettleOverpayment] = useState(false);
  const [showSettlePayment, setShowSettlePayment] = useState(false);
  const [showOverpaymentWarning, setShowOverpaymentWarning] = useState(false);
  const [showPostChargeModal, setShowPostChargeModal] = useState(false);
  const [itemsToPost, setItemsToPost] = useState<{
    id?: string;
    amount: number;
    price: number;
    quantity: number;
    type: 'debit' | 'credit';
    category: 'restaurant' | 'service' | 'other' | 'laundry' | 'discount';
    description: string;
    discount: number;
    discountType: 'fixed' | 'percentage';
  }[]>([]);
  const [chargeDetails, setChargeDetails] = useState({
    amount: 0,
    price: 0,
    quantity: 1,
    type: 'debit' as 'debit' | 'credit',
    category: 'restaurant' as 'restaurant' | 'service' | 'other' | 'laundry' | 'discount',
    description: '',
    discount: 0,
    discountType: 'fixed' as 'fixed' | 'percentage'
  });
  const [settleData, setSettleData] = useState({ 
    splits: [{ amount: 0, method: 'cash', referenceCode: '', proofUrl: '' }] as { amount: number; method: 'cash' | 'card' | 'transfer'; referenceCode?: string; proofUrl?: string }[], 
    notes: '' 
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [showFolioDiscountModal, setShowFolioDiscountModal] = useState(false);
  const [availablePromotions, setAvailablePromotions] = useState<Promotion[]>([]);
  const [modalPromoCode, setModalPromoCode] = useState('');
  const [modalAppliedPromo, setModalAppliedPromo] = useState<Promotion | null>(null);
  const [modalPromoLimit, setModalPromoLimit] = useState<number | null>(null);
  const [modalPromoFeedback, setModalPromoFeedback] = useState<{ status: 'idle' | 'valid' | 'invalid'; message?: string }>({ status: 'idle' });
  const [isValidatingModalPromo, setIsValidatingModalPromo] = useState(false);
  const [discountData, setDiscountData] = useState({
    amount: 0,
    type: 'fixed' as 'fixed' | 'percentage',
    target: 'folio' as 'room' | 'folio',
    reason: ''
  });
  const [discountingEntry, setDiscountingEntry] = useState<LedgerEntry | null>(null);
  const [showExtendGraceModal, setShowExtendGraceModal] = useState(false);

  useEffect(() => {
    if (!hotel?.id) return;
    const unsubPromo = subscribePromotions(hotel.id, (promos) => {
      setAvailablePromotions(promos.filter(p => p.status === 'active'));
    });
    return () => unsubPromo();
  }, [hotel?.id]);

  const handleClearModalPromo = () => {
    setModalPromoCode('');
    setModalAppliedPromo(null);
    setModalPromoLimit(null);
    setModalPromoFeedback({ status: 'idle' });
    setDiscountData({ amount: 0, type: 'fixed', target: 'folio', reason: '' });
  };

  const handleValidateModalPromo = async (codeToValidate?: string) => {
    const rawCode = codeToValidate !== undefined ? codeToValidate : modalPromoCode;
    if (!hotel?.id || !currentReservation) return;
    if (!rawCode.trim()) {
      setModalPromoFeedback({ status: 'invalid', message: 'Please enter or select a promotional code.' });
      return;
    }

    setIsValidatingModalPromo(true);
    setModalPromoFeedback({ status: 'idle' });

    try {
      const res = currentReservation;
      const stayDuration = calculateStayDuration(res.checkIn, res.checkOut);
      const nights = Math.max(1, res.nights || stayDuration.totalNights || stayDuration.bookedNights || 1);
      const roomCharges = room ? (room.price || 0) * nights : res.totalAmount;
      const subtotal = res.totalAmount > 0 ? res.totalAmount : roomCharges;
      const isCorporate = Boolean(res.corporateId);
      const guestType: 'individual' | 'corporate' = isCorporate ? 'corporate' : 'individual';
      const selectedCorp = isCorporate && res.corporateId
        ? corporateAccountsList.find(c => c.id === res.corporateId)
        : undefined;

      const result = await validatePromotion(hotel.id, rawCode, {
        roomTypeId: room?.roomTypeId || room?.type,
        roomId: res.roomId,
        checkIn: res.checkIn,
        checkOut: res.checkOut,
        bookingSource: res.bookingSource || (res as any).source || 'Walk-in',
        subtotal,
        roomCharges,
        currency,
        exchangeRate,
        guestType,
        corporateId: res.corporateId,
        corporateName: selectedCorp?.name,
        corporateStatus: selectedCorp?.status,
        isNegotiatedRate: isCorporate
      });

      if (result.isValid && result.promotion) {
        setModalAppliedPromo(result.promotion);
        setModalPromoLimit(result.discountAmount);
        setModalPromoCode(result.promotion.code);
        setModalPromoFeedback({
          status: 'valid',
          message: `Campaign "${result.promotion.name}" (${result.promotion.code}) verified! Maximum discount limit: ${formatCurrency(result.discountAmount, currency, exchangeRate)}.`
        });

        // Set discount type and amount strictly to the promo discount limit
        setDiscountData({
          type: result.promotion.discountType === 'percentage' ? 'percentage' : 'fixed',
          amount: result.promotion.discountType === 'percentage' ? result.promotion.value : result.discountAmount,
          target: 'folio',
          reason: `Promo Code [${result.promotion.code}]: ${result.promotion.name}`
        });

        toast.success(`Promo code "${result.promotion.code}" applied! -${formatCurrency(result.discountAmount, currency, exchangeRate)}`);
      } else {
        setModalAppliedPromo(null);
        setModalPromoLimit(null);
        setModalPromoFeedback({
          status: 'invalid',
          message: result.errorReason || 'Promotional code is not valid for this stay.'
        });
        toast.error(result.errorReason || 'Promotional code is not valid.');
      }
    } catch (err: any) {
      console.error('Modal promo validation error:', err);
      setModalAppliedPromo(null);
      setModalPromoLimit(null);
      setModalPromoFeedback({
        status: 'invalid',
        message: err.message || 'Failed to validate promotional code.'
      });
      toast.error(err.message || 'Failed to validate promotional code.');
    } finally {
      setIsValidatingModalPromo(false);
    }
  };

  const handleToggleAutoNightDeduction = async () => {
    if (!hotel?.id || !currentReservation?.id) return;
    const currentVal = currentReservation.autoNightDeduction !== false;
    const newVal = !currentVal;

    try {
      const resRef = doc(db, 'hotels', hotel.id, 'reservations', currentReservation.id);
      await updateDoc(resRef, {
        autoNightDeduction: newVal
      });
      setCurrentReservation(prev => ({ ...prev, autoNightDeduction: newVal }));
      toast.success(newVal 
        ? 'Automatic Night Deduction enabled for this reservation.' 
        : 'Automatic Night Deduction paused. Overstay and nightly charges halted.'
      );
    } catch (err: any) {
      console.error('Error toggling autoNightDeduction:', err);
      toast.error('Failed to update Auto Night Deduction setting.');
    }
  };

  const handleApplyFolioDiscount = async () => {
    if (!hotel?.id || !profile || !currentReservation || !discountData.amount) {
      toast.error('Please enter a valid discount amount');
      return;
    }

    let finalAmount = discountData.amount;
    if (discountData.type === 'percentage') {
      finalAmount = (currentReservation.totalAmount * discountData.amount) / 100;
    }

    // Enforce promotional price limit if promo code is applied
    if (modalAppliedPromo && modalPromoLimit !== null) {
      if (finalAmount > modalPromoLimit + 0.01) {
        toast.error(`Discount cannot exceed the promotional limit of ${formatCurrency(modalPromoLimit, currency, exchangeRate)}`);
        return;
      }
      finalAmount = Math.min(finalAmount, modalPromoLimit);
    }

    const policy = canApplyDiscount(hotel, profile, finalAmount, currentReservation.totalAmount);
    if (!policy.allowed) {
      toast.error(policy.message || 'Discount denied by hotel policy');
      return;
    }

    if (!hasPermission(profile, 'edit_reservation')) {
      toast.error('You do not have permission to apply discounts');
      return;
    }

    try {
      setIsSaving(true);
      const res = currentReservation;

      const discountDesc = modalAppliedPromo
        ? `Promo Discount [${modalAppliedPromo.code}] (${modalAppliedPromo.name}): ${discountData.reason || modalAppliedPromo.name}`
        : `Discount (${discountData.type === 'percentage' ? discountData.amount + '%' : formatCurrency(discountData.amount, currency, exchangeRate)}): ${discountData.reason || 'Management Discount'}`;

      await postToLedger(hotel.id, res.guestId || 'unknown', res.id, {
        amount: finalAmount,
        type: 'credit',
        category: 'discount',
        description: discountDesc,
        referenceId: res.id,
        postedBy: profile.uid
      }, profile.uid, res.corporateId, 'cash', {
        uid: profile?.uid,
        email: profile?.email,
        role: profile?.role || 'staff',
        displayName: profile?.displayName || (profile as any)?.name || 'Staff'
      });

      // Record promotion redemption & update reservation if promo code was used
      if (modalAppliedPromo) {
        const isCorporate = Boolean(res.corporateId);
        const selectedCorp = isCorporate && res.corporateId
          ? corporateAccountsList.find(c => c.id === res.corporateId)
          : undefined;

        await recordPromotionRedemption(
          hotel.id,
          modalAppliedPromo.id,
          {
            reservationId: res.id,
            guestName: res.guestName,
            roomNumber: res.roomNumber || '',
            bookingSource: res.bookingSource || (res as any).source || 'Walk-in',
            corporateId: isCorporate ? res.corporateId : undefined,
            corporateName: isCorporate ? (selectedCorp?.name || 'Corporate Account') : undefined,
            discountAmount: finalAmount,
            originalAmount: res.totalAmount,
            finalAmount: Math.max(0, res.totalAmount - finalAmount),
            timestamp: new Date().toISOString(),
            appliedBy: profile.uid,
            appliedByName: profile.displayName || (profile as any)?.name || profile.email
          },
          profile
        );

        const resRef = doc(db, 'hotels', hotel.id, 'reservations', res.id);
        await updateDoc(resRef, {
          discountCode: modalAppliedPromo.code,
          promotionId: modalAppliedPromo.id,
          discountAmount: finalAmount,
          totalDiscount: (res.totalDiscount || 0) + finalAmount,
          discountReason: discountData.reason || `Promo Code [${modalAppliedPromo.code}]`
        });
        setCurrentReservation(prev => ({
          ...prev,
          discountCode: modalAppliedPromo.code,
          promotionId: modalAppliedPromo.id,
          discountAmount: finalAmount,
          totalDiscount: (prev.totalDiscount || 0) + finalAmount,
          discountReason: discountData.reason || `Promo Code [${modalAppliedPromo.code}]`
        }));
      } else {
        const resRef = doc(db, 'hotels', hotel.id, 'reservations', res.id);
        await updateDoc(resRef, {
          totalDiscount: (res.totalDiscount || 0) + finalAmount,
          discountReason: discountData.reason || 'Management Discount'
        });
        setCurrentReservation(prev => ({
          ...prev,
          totalDiscount: (prev.totalDiscount || 0) + finalAmount,
          discountReason: discountData.reason || 'Management Discount'
        }));
      }

      await logActivity(
        hotel.id,
        profile,
        'DISCOUNT_APPLIED',
        'Front Desk',
        `Discount applied to reservation ${res.id}${modalAppliedPromo ? ` with promo code ${modalAppliedPromo.code}` : ''}`,
        res.id,
        null,
        {
          amount: finalAmount,
          reason: discountData.reason,
          promoCode: modalAppliedPromo?.code,
          promoId: modalAppliedPromo?.id
        }
      );

      toast.success(modalAppliedPromo ? `Promotional code "${modalAppliedPromo.code}" discount applied!` : 'Discount applied successfully');
      setShowFolioDiscountModal(false);
      handleClearModalPromo();
    } catch (err: any) {
      console.error("Error applying folio discount:", err);
      toast.error('Failed to apply discount');
    } finally {
      setIsSaving(false);
    }
  };

  const handleManualNightlyCharge = async () => {
    if (!hotel?.id || !profile || currentReservation.status !== 'checked_in') return;
    
    try {
      setIsAuditing(true);
      // RULE 1, 4, 9: First auto-reconcile and purge any runaway duplicates
      await reconcileAndRepairReservationFinancials(hotel.id, currentReservation.id, ledgerEntries);

      // Now charge only missing eligible nights using authoritative engine
      const res = await processAutomatedBillingForReservation(hotel, currentReservation, profile.uid, new Date());
      
      if (res.chargedCount > 0) {
        toast.success(`Posted ${res.chargedCount} nightly charge(s) totaling ${formatCurrency(res.totalAmount, currency, exchangeRate)}`);
      } else {
        toast.info('All nights are already accurately charged up to date.');
      }
    } catch (err: any) {
      console.error("Manual audit error:", err.message || safeStringify(err));
      toast.error('Failed to process nightly charge audit');
    } finally {
      setIsAuditing(false);
    }
  };

  const [isReconciling, setIsReconciling] = useState(false);
  const handleReconcileBalances = async () => {
    if (!hotel?.id || !currentReservation.id) return;
    try {
      setIsReconciling(true);
      const result = await reconcileAndRepairReservationFinancials(hotel.id, currentReservation.id, ledgerEntries);
      if (result.purgedDuplicateEntriesCount > 0) {
        toast.success(`Reconciled folio! Purged ${result.purgedDuplicateEntriesCount} duplicate/corrupted charge(s). Restored authoritative balance: ${formatCurrency(result.expectedBalance, currency, exchangeRate)}`);
      } else if (result.discrepancy !== 0) {
        toast.success(`Reconciled folio balance! Fixed discrepancy of ${formatCurrency(result.discrepancy, currency, exchangeRate)}. Current balance: ${formatCurrency(result.expectedBalance, currency, exchangeRate)}`);
      } else {
        toast.info(`Folio balance is 100% verified and reconciled: ${formatCurrency(result.expectedBalance, currency, exchangeRate)}`);
      }
    } catch (err: any) {
      console.error("Reconciliation error:", err);
      toast.error('Failed to reconcile folio balances');
    } finally {
      setIsReconciling(false);
    }
  };

  const executeSettlePayment = async () => {
    if (!hotel?.id || !profile) return;
    await executeRequest(
      `settle-payment-${currentReservation.id}`,
      async () => {
        setIsSaving(true);
        for (const split of settleData.splits) {
          if (split.amount > 0) {
            await settleLedger(
              hotel.id, 
              currentReservation.guestId || 'unknown', 
              currentReservation.id, 
              split.amount, 
              split.method, 
              profile.uid, 
              activeFolio === 'company' ? (currentReservation.corporateId || undefined) : undefined,
              (split as any).referenceCode,
              (split as any).proofUrl,
              {
                uid: profile?.uid,
                email: profile?.email,
                role: profile?.role || 'staff',
                displayName: profile?.displayName || (profile as any)?.name || 'Staff'
              }
            );
          }
        }

        toast.success('Payment recorded successfully');
        if (hotel.settings?.payments?.autoSendReceipts) {
          toast.success(`E-Receipt automatically generated & emailed to ${currentReservation.guestEmail || 'guest on file'}`);
        }
        setShowSettlePayment(false);
        setShowOverpaymentWarning(false);
        setSettleData({ splits: [{ amount: 0, method: 'cash', referenceCode: '', proofUrl: '' }], notes: '' });
      },
      { loadingMessage: 'Processing payment ledger transaction...', showOverlay: true }
    ).finally(() => {
      setIsSaving(false);
    });
  };

  const handleSettlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;

    const policy = canEditInvoice(hotel, profile, currentReservation);
    if (!policy.allowed) {
      toast.error(policy.message || 'Invoice is locked');
      return;
    }

    const totalAmount = settleData.splits.reduce((acc, s) => acc + s.amount, 0);
    if (totalAmount <= 0) {
      toast.error('Payment amount must be greater than zero');
      return;
    }

    // Enforce payment reference and proof upload settings
    const paymentSettings = hotel.settings?.payments;
    if (paymentSettings) {
      if (paymentSettings.allowSplitPayments === false && settleData.splits.length > 1) {
        toast.error("Split payments are disabled by hotel configuration.");
        return;
      }
      if (paymentSettings.allowMultipleMethods === false && settleData.splits.length > 1) {
        const firstMethod = settleData.splits[0].method;
        const hasMixed = settleData.splits.some(s => s.method !== firstMethod);
        if (hasMixed) {
          toast.error("Mixing payment methods is disabled by hotel configuration.");
          return;
        }
      }
      if (paymentSettings.allowOfflinePayments === false) {
        const hasOffline = settleData.splits.some(s => s.method === 'cash' || s.method === 'transfer');
        if (hasOffline) {
          toast.error("Manual offline payments are disabled by hotel configuration. Only card payment is allowed.");
          return;
        }
      }

      for (let i = 0; i < settleData.splits.length; i++) {
        const split = settleData.splits[i];
        if (split.method !== 'cash') {
          if (paymentSettings.requireTransactionReference && !split.referenceCode?.trim()) {
            toast.error(`For split #${i + 1} (${split.method.toUpperCase()}): A transaction reference number is required by hotel policy.`);
            return;
          }
          if (paymentSettings.requirePaymentProofUpload && split.method === 'transfer' && !split.proofUrl) {
            toast.error(`For split #${i + 1} (Bank Transfer): An uploaded proof of payment image/receipt is required by hotel policy.`);
            return;
          }
        }
      }
    }

    // Validation hook: Detect when a payment amount exceeds the calculated net total (balance)
    if (totalAmount > balance + 0.01) {
      setShowOverpaymentWarning(true);
      return;
    }

    await executeSettlePayment();
  };

  const handleSettleOverpayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;

    const totalAmount = settleData.splits.reduce((acc, s) => acc + s.amount, 0);
    const policy = canProcessRefund(hotel, profile, totalAmount);
    if (!policy.allowed) {
      toast.error(policy.message || 'Refund denied by policy');
      return;
    }

    try {
      setIsSaving(true);
      const totalAmount = settleData.splits.reduce((acc, s) => acc + s.amount, 0);
      await settleOverpayment(
        hotel.id, 
        currentReservation.guestId || 'unknown', 
        currentReservation.id, 
        totalAmount, 
        settleData.splits[0]?.method || 'cash', 
        profile.uid, 
        activeFolio === 'company' ? currentReservation.corporateId : undefined,
        {
          uid: profile?.uid,
          email: profile?.email,
          role: profile?.role || 'staff',
          displayName: profile?.displayName || (profile as any)?.name || 'Staff'
        }
      );
      toast.success('Overpayment settled successfully');
      setShowSettleOverpayment(false);
    } catch (err: any) {
      console.error("Settle overpayment error:", err.message || safeStringify(err));
      toast.error('Failed to settle overpayment');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePostCharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !currentReservation.guestId) return;

    const policy = canEditInvoice(hotel, profile, currentReservation);
    if (!policy.allowed) {
      toast.error(policy.message || 'Invoice is locked');
      return;
    }

    try {
      setIsSaving(true);
      
      // Determine what to post
      let finalItems = [...itemsToPost];
      if (finalItems.length === 0) {
        // Fallback to single item filled in current form inputs
        finalItems.push({
          price: chargeDetails.price,
          quantity: chargeDetails.quantity,
          type: chargeDetails.type,
          category: chargeDetails.category,
          description: chargeDetails.description,
          discount: chargeDetails.discount,
          discountType: chargeDetails.discountType,
          amount: chargeDetails.amount
        });
      }

      // Policy check: allowManualLedgerAdjustments
      const allowManual = hotel?.settings?.financial?.allowManualLedgerAdjustments;
      if (allowManual === false && !hasPermission(profile, 'void_transaction')) {
        toast.error("Manual ledger adjustments are disabled by hotel configuration.");
        setIsSaving(false);
        return;
      }

      // Check permissions / policies
      for (const item of finalItems) {
        const baseAmount = item.price > 0 ? item.price * item.quantity : item.amount || 0;
        const amountAfterDiscount = item.discountType === 'fixed' 
          ? baseAmount - (item.discount || 0)
          : baseAmount * (1 - (item.discount || 0) / 100);

        const discountAmount = baseAmount - amountAfterDiscount;
        if (discountAmount > 0 || item.category === 'discount') {
          const policy = canApplyDiscount(hotel, profile, discountAmount || baseAmount, baseAmount || currentReservation.totalAmount);
          if (!policy.allowed) {
            toast.error(`${item.description || item.category}: ${policy.message || 'Discount denied by policy'}`);
            setIsSaving(false);
            return;
          }
        }
      }

      // Generate a unique idempotency key for this batch posting
      const idempotencyKey = `batch_${currentReservation.id}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      try {
        // Call server-side transaction validation logic (idempotent & immutable calculations)
        const response = await fetch("/api/ledger/validate-and-post", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            hotelId: hotel.id,
            guestId: currentReservation.guestId,
            reservationId: currentReservation.id,
            items: finalItems,
            postedBy: profile.uid,
            corporateId: activeFolio === 'company' ? currentReservation.corporateId : undefined,
            idempotencyKey
          })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "Server validation rejected the transaction.");
        }

        const resData = await response.json();
        toast.success(resData.message || `${finalItems.length === 1 ? 'Entry' : 'All entries in the batch'} posted successfully`);
      } catch (apiErr: any) {
        console.warn("Server API posting failed or offline, falling back to local fallback transaction:", apiErr.message);
        
        // Post each item sequentially to avoid write conflicts
        for (const item of finalItems) {
          const baseAmount = item.price > 0 ? item.price * item.quantity : item.amount || 0;
          const amountAfterDiscount = item.discountType === 'fixed' 
            ? baseAmount - (item.discount || 0)
            : baseAmount * (1 - (item.discount || 0) / 100);

          await postToLedger(hotel.id, currentReservation.guestId, currentReservation.id, {
            amount: amountAfterDiscount,
            type: item.type,
            category: item.category,
            description: item.description || `${item.type === 'debit' ? 'Charge' : 'Adjustment'}: ${item.category}`,
            referenceId: currentReservation.id,
            postedBy: profile.uid,
            quantity: item.quantity,
            price: item.price,
            idempotencyKey
          }, profile.uid, activeFolio === 'company' ? currentReservation.corporateId : undefined, 'cash', {
            uid: profile?.uid,
            email: profile?.email,
            role: profile?.role || 'staff',
            displayName: profile?.displayName || (profile as any)?.name || 'Staff'
          });
        }
        
        toast.success(`${finalItems.length === 1 ? 'Entry' : 'All entries in the batch'} posted successfully (Local fallback)`);
      }

      setShowPostChargeModal(false);
      setItemsToPost([]);
      setChargeDetails({ amount: 0, price: 0, quantity: 1, type: 'debit', category: 'restaurant', description: '', discount: 0, discountType: 'fixed' });
    } catch (err: any) {
      console.error("Post charge error:", err.message || safeStringify(err));
      toast.error('Failed to post entry');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!hotel?.id || !reservation.id || !reservation.guestId) return;

    // Fetch other active reservations for this guest
    const qOther = query(
      collection(db, 'hotels', hotel.id, 'reservations'),
      where('guestId', '==', reservation.guestId)
    );

    const unsubOther = onSnapshot(qOther, (snap) => {
      const allOther = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation));
      
      // Client-side filtering and sorting to avoid composite indexes
      const filtered = allOther
        .filter(r => 
          r.id !== reservation.id && 
          ['confirmed', 'checked_in'].includes(r.status)
        )
        .sort((a, b) => {
          const dateA = a.checkIn || '';
          const dateB = b.checkIn || '';
          return dateB.localeCompare(dateA); // desc
        });

      setOtherReservations(filtered);
    });

    return () => unsubOther();
  }, [hotel?.id, reservation.id, reservation.guestId]);

  // Fetch ALL active reservations for transfer (any guest)
  useEffect(() => {
    if (!hotel?.id || !showTransferBalanceModal) return;

    const qActive = query(
      collection(db, 'hotels', hotel.id, 'reservations'),
      where('status', 'in', ['confirmed', 'checked_in'])
    );

    const unsub = onSnapshot(qActive, (snap) => {
      const active = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Reservation))
        .filter(r => r.id !== reservation.id);
      setActiveReservationsForSearch(active);
    });

    const unsubCorp = onSnapshot(collection(db, 'hotels', hotel.id, 'corporate_accounts'), (snap) => {
      setCorporateAccountsList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CorporateAccount)));
    });

    return () => {
      unsub();
      unsubCorp();
    };
  }, [hotel?.id, showTransferBalanceModal, reservation.id]);

  // Fetch guest history
  useEffect(() => {
    if (!hotel?.id || !reservation.guestId || !showGuestHistory) return;

    const qHistory = query(
      collection(db, 'hotels', hotel.id, 'reservations'),
      where('guestId', '==', reservation.guestId),
      orderBy('checkIn', 'desc')
    );

    const unsub = onSnapshot(qHistory, (snap) => {
      setGuestHistory(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
    });

    return () => unsub();
  }, [hotel?.id, reservation.guestId, showGuestHistory]);

  const handleTransferBalance = async () => {
    if (!hotel?.id || !profile || !transferTargetId || balance === 0) return;
    await executeRequest(
      `transfer-balance-${currentReservation.id}`,
      async () => {
        setLoading(true);
        if (transferType === 'guest') {
          await transferLedgerBalance(
            hotel.id,
            currentReservation.guestId!,
            currentReservation.id,
            transferTargetId,
            balance,
            profile.uid,
            activeFolio === 'company' ? currentReservation.corporateId : undefined,
            {
              uid: profile?.uid,
              email: profile?.email,
              role: profile?.role || 'staff',
              displayName: profile?.displayName || (profile as any)?.name || 'Staff'
            }
          );
        } else {
          // Corporate transfer (City Ledger)
          await transferToCityLedger(
            hotel.id,
            currentReservation.guestId!,
            currentReservation.id,
            balance,
            profile.uid,
            transferTargetId, // This is the corporateId in this case
            {
              uid: profile?.uid,
              email: profile?.email,
              role: profile?.role || 'staff',
              displayName: profile?.displayName || (profile as any)?.name || 'Staff'
            }
          );
        }
        toast.success('Balance transferred successfully');
        setShowTransferBalanceModal(false);
        setTransferTargetId('');
      },
      { loadingMessage: 'Transferring ledger balance...', showOverlay: true }
    ).finally(() => {
      setLoading(false);
    });
  };

  useEffect(() => {
    if (!hotel?.id || !reservation.id) return;

    // Listen to reservation document for real-time updates
    const unsubRes = onSnapshot(doc(db, 'hotels', hotel.id, 'reservations', reservation.id), (snap) => {
      if (snap.exists()) {
        setCurrentReservation({ id: snap.id, ...snap.data() } as Reservation);
      }
    });

    // Listen to ledger entries for this reservation
    const q = query(
      collection(db, 'hotels', hotel.id, 'ledger'),
      where('reservationId', '==', reservation.id),
      limit(1000)
    );

    const unsubLedger = onSnapshot(q, (snap) => {
      const entries = snap.docs.map(doc => ({ firestoreId: doc.id, ...doc.data() } as LedgerEntry & { firestoreId: string }));
      
      // Auto-heal: Detect and purge any corrupted / virtual / invalid credit entries automatically
      const invalidEntryIds = entries
        .filter(e => !validateLedgerTransaction(e).isValid)
        .map(e => e.firestoreId)
        .filter(Boolean);

      if (invalidEntryIds.length > 0 && hotel?.id) {
        purgeCorruptedLedgerEntries(hotel.id, invalidEntryIds);
      }

      // Auto-heal: Detect and purge any duplicate or runaway overstay entries automatically
      if (hotel?.id && currentReservation.status === 'checked_in') {
        detectAndPurgeDuplicateOverstayCharges(hotel.id, currentReservation, entries);
      }

      // Filter valid entries for display
      const validEntries = entries.filter(e => validateLedgerTransaction(e).isValid);

      // Client-side sorting to avoid composite index requirements
      const sortedEntries = [...validEntries].sort((a, b) => {
        const timeA = parseTimestampToDate(a.timestamp).getTime();
        const timeB = parseTimestampToDate(b.timestamp).getTime();
        return timeB - timeA; // desc
      });

      setLedgerEntries(sortedEntries as any);
      setLoading(false);
    }, (err) => {
      setLoading(false);
      console.error("Ledger loading error:", err);
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/ledger`);
    });

    // Fetch guest details
    let unsubGuest = () => {};
    if (reservation.guestId) {
      unsubGuest = onSnapshot(doc(db, 'hotels', hotel.id, 'guests', reservation.guestId), (doc) => {
        if (doc.exists()) setGuest({ id: doc.id, ...doc.data() } as Guest);
      });
    }

    return () => {
      unsubRes();
      unsubLedger();
      unsubGuest();
    };
  }, [hotel?.id, reservation.id, reservation.guestId]);

  const [activeFolio, setActiveFolio] = useState<'guest' | 'company'>(reservation.corporateId ? 'company' : 'guest');
  
  // Sync active folio if reservation data loads later
  useEffect(() => {
    if (currentReservation.corporateId && activeFolio === 'guest' && !reservation.corporateId) {
      setActiveFolio('company');
    }
  }, [currentReservation.corporateId]);

  const [hasAutoAudited, setHasAutoAudited] = useState(false);

  const autoSyncNightlyCharges = async () => {
    if (!hotel?.id || !profile || currentReservation.status !== 'checked_in') return;
    
    try {
      // RULE 1, 4, 9: First ensure full reconciliation and purge any duplicate or excess overstays
      await reconcileAndRepairReservationFinancials(hotel.id, currentReservation.id, ledgerEntries);

      // Now process automated stay billing with strict duration limits
      const res = await processAutomatedBillingForReservation(hotel, currentReservation, profile.uid, new Date());
      if (res.chargedCount > 0) {
        toast.info(`Accrued ${res.chargedCount} night stay(s) automatically.`);
      }
    } catch (err: any) {
      console.error("Auto sync nightly charges error:", err);
    }
  };

  useEffect(() => {
    if (!loading && currentReservation.status === 'checked_in' && !hasAutoAudited && hotel?.id && profile) {
      setHasAutoAudited(true);
      autoSyncNightlyCharges();
    }
  }, [loading, currentReservation.status, hasAutoAudited, hotel?.id, profile, ledgerEntries]);

  // Improved filtering:
  // If it's a corporate reservation, split the entries.
  // If it's NOT a corporate reservation, show everything on the Guest folio.
  const companyEntries = ledgerEntries.filter(e => 
    !!e.corporateId
  );
  
  const guestEntries = ledgerEntries.filter(e => 
    !e.corporateId
  );

  let displayedEntries = currentReservation.corporateId
    ? (activeFolio === 'company' ? companyEntries : guestEntries)
    : ledgerEntries; // Show all for regular guest bookings

  // Adjust guest folio display if the guest balance has been transferred to a corporate account
  // but the corporate account does not have any money (i.e. corporate payments are zero or less than transferred amount)
  if (currentReservation.corporateId && activeFolio === 'guest') {
    const cityLedgerCredits = guestEntries.filter(e => e.category === 'city_ledger' && e.type === 'credit');
    if (cityLedgerCredits.length > 0) {
      const corpPayments = companyEntries.filter(e => e.type === 'credit' && e.category === 'payment').reduce((acc, e) => acc + e.amount, 0);
      const totalTransferred = cityLedgerCredits.reduce((acc, e) => acc + e.amount, 0);
      const unpaidTransferred = Math.max(0, totalTransferred - corpPayments);
      
      if (unpaidTransferred > 0) {
        // We only apply the paid portion of the corporate account.
        // This makes sure both show the exact same outstanding balance.
        let remainingCorpPayments = corpPayments;
        displayedEntries = displayedEntries.map(entry => {
          if (entry.category === 'city_ledger' && entry.type === 'credit') {
            const applicableCredit = Math.min(entry.amount, remainingCorpPayments);
            remainingCorpPayments -= applicableCredit;
            return { ...entry, amount: applicableCredit };
          }
          return entry;
        });
      }
    }
  }

  const processedDisplayedEntries = processLedgerTaxes(displayedEntries, hotel?.taxes || [], 'showOnFolio');

  const folioBreakdown = BillingEngine.calculateFolioBreakdown(currentReservation, hotel, processedDisplayedEntries);
  const resAccount = calculateReservationAccount(currentReservation, hotel, processedDisplayedEntries);
  const expectedNightsCount = folioBreakdown.stayDuration.totalNights;
  const originalNightsCount = folioBreakdown.stayDuration.bookedNights;
  const nightlyRateCalculated = folioBreakdown.nightlyRate;
  
  const totalDebits = folioBreakdown.tier3.totalCharges;
  const totalCredits = folioBreakdown.tier3.totalPayments;
  const balance = folioBreakdown.tier3.outstandingBalance;

  // Real posted entries only in history items - NO VIRTUAL CREDITS OR PROJECTION REDUCTIONS
  const allHistoryItems = [...processedDisplayedEntries].map(item => ({ ...item, isVirtual: false }));

  // Sort chronologically (oldest first) to compute running balance correctly
  const chronologicalHistory = [...allHistoryItems].sort((a, b) => {
    const timeA = parseTimestampToDate(a.timestamp).getTime();
    const timeB = parseTimestampToDate(b.timestamp).getTime();
    return timeA - timeB; // asc
  });

  // Calculate the running balance cumulative timeline
  let runningBalAccumulator = 0;
  const runningBalancesMap = new Map<string, { balance: number; calculation: string }>();

  chronologicalHistory.forEach((entry) => {
    const previousBal = runningBalAccumulator;
    if (entry.type === 'debit') {
      runningBalAccumulator += entry.amount;
    } else {
      runningBalAccumulator -= entry.amount;
    }
    
    const sign = entry.type === 'debit' ? '+' : '−';
    const detail = `${formatCurrency(previousBal, currency, exchangeRate)} ${sign} ${formatCurrency(entry.amount, currency, exchangeRate)} = ${formatCurrency(runningBalAccumulator, currency, exchangeRate)}`;
    
    runningBalancesMap.set(entry.id || (entry as any).firestoreId || 'projected_room_stay_charge_virtual', {
      balance: runningBalAccumulator,
      calculation: detail
    });
  });

  // Display newest history entries first (descending timestamp order)
  const sortedHistoryForDisplay = [...allHistoryItems].sort((a, b) => {
    const timeA = parseTimestampToDate(a.timestamp).getTime();
    const timeB = parseTimestampToDate(b.timestamp).getTime();
    return timeB - timeA; // desc
  });

  const handleVoidEntry = async () => {
    if (!hotel?.id || !confirmDelete || !profile) return;
    
    const policy = canVoidTransaction(hotel, profile, confirmDelete);
    if (!policy.allowed) {
      toast.error(policy.message || 'Voiding denied');
      return;
    }

    try {
      setIsDeleting(true);
      await voidLedgerEntry(hotel.id, confirmDelete as any, profile.uid, {
        uid: profile?.uid,
        email: profile?.email,
        role: profile?.role || 'staff',
        displayName: profile?.displayName || (profile as any)?.name || 'Staff'
      });
      
      toast.success('Transaction voided and reversed');
      setConfirmDelete(null);
    } catch (err: any) {
      console.error("Void error:", err.message || safeStringify(err));
      toast.error('Failed to void transaction');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!currentReservation) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 text-center space-y-4 max-w-sm w-full">
          <p className="text-sm text-zinc-300">Reservation data is currently unavailable.</p>
          <button 
            type="button"
            onClick={onClose} 
            className="px-4 py-2 bg-zinc-800 text-zinc-200 rounded-xl text-xs font-semibold hover:bg-zinc-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-center justify-center p-2 sm:p-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl sm:rounded-3xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[96dvh] sm:max-h-[90vh] shadow-2xl"
      >
        {/* Header */}
        <div className="p-3.5 sm:p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50 gap-2">
          <div className="flex items-center gap-3 block">
            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-500 border border-emerald-500/10">
              <Receipt size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-zinc-50 tracking-tight">Guest Folio</h2>
                <span className="px-2.5 py-0.5 rounded-md bg-zinc-800 text-zinc-100 text-xs font-bold border border-zinc-700 flex items-center gap-1.5 shadow-sm">
                  <span className="text-zinc-400 font-medium">Room</span>
                  <span className="text-emerald-400 font-extrabold text-sm">{currentReservation.roomNumber}</span>
                </span>
                {currentReservation.corporateId ? (
                  <span className="px-2.5 py-0.5 rounded-md bg-blue-500/20 text-blue-300 text-xs font-bold border border-blue-500/30 flex items-center gap-1.5 shadow-sm">
                    <Building2 size={13} className="text-blue-400" />
                    <span>Corporate Guest{corporateAccountsList.find(c => c.id === currentReservation.corporateId)?.name ? `: ${corporateAccountsList.find(c => c.id === currentReservation.corporateId)?.name}` : ''}</span>
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-md bg-zinc-800/80 text-zinc-400 text-xs font-medium border border-zinc-700/50 flex items-center gap-1.5">
                    <User size={13} className="text-zinc-500" />
                    <span>Individual Guest</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-400">
                <span className="font-semibold text-zinc-200">{currentReservation.guestName}</span>
                <span className="text-zinc-600">•</span>
                <span className="font-mono text-zinc-500 text-[11px]">Res #{(currentReservation.id || '').slice(-6).toUpperCase()}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button 
              type="button"
              onClick={() => setShowPrincipalManager(true)}
              className={cn(
                "px-2.5 py-1.5 sm:px-3 sm:py-1.5 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 shadow-sm active:scale-95 border",
                currentReservation.isPrincipalRoom || currentReservation.principalReservationId
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30"
                  : "bg-zinc-850 text-zinc-300 border-zinc-700 hover:bg-zinc-800"
              )}
              title="Manage Principal & Linked Rooms"
            >
              <Building2 size={14} className={currentReservation.isPrincipalRoom ? "text-amber-400" : "text-zinc-400"} />
              <span>
                {currentReservation.isPrincipalRoom 
                  ? `Master (${currentReservation.linkedRoomNumbers?.length || 0})` 
                  : currentReservation.principalReservationId 
                  ? `Linked (M: ${currentReservation.principalRoomNumber})` 
                  : 'Group / Master'}
              </span>
            </button>
            <button 
              type="button"
              onClick={() => setShowSettlePayment(true)}
              className="px-2.5 py-1.5 sm:px-3 sm:py-1.5 bg-emerald-500 text-black rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-widest hover:bg-emerald-400 transition-all flex items-center gap-1.5 shadow-lg shadow-emerald-500/10 active:scale-95 border border-emerald-500/20"
            >
              <DollarSign size={14} />
              <span>Settle</span>
            </button>
            <button 
              type="button"
              onClick={() => setShowReceipt(true)}
              className="p-1.5 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 rounded-lg transition-all flex items-center gap-1.5"
              title="Print Receipt"
            >
              <Printer size={16} />
              <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider">Print</span>
            </button>
            <button 
              type="button"
              onClick={onClose}
              className="p-1.5 text-zinc-500 hover:text-zinc-50 transition-colors"
              title="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {showReceipt && hotel && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[90] flex items-start justify-center p-4 overflow-y-auto print:p-0 print:bg-transparent print:backdrop-blur-none print:static">
            <div className="relative w-full max-w-5xl my-8 print:my-0 print:w-full print:static">
              <div className="absolute -top-12 right-0 flex items-center gap-2 sm:gap-3 print:hidden">
                <button 
                  onClick={() => {
                    const target = document.getElementById('active-hotel-receipt') || document.querySelector('.receipt-container');
                    generatePdfExport(target, {
                      title: 'Official-Receipt',
                      filename: `${hotel.name || 'Hotel'}-Receipt-${currentReservation.guestName.replace(/[^a-z0-9]/gi, '_')}`
                    });
                  }}
                  className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-zinc-700 shadow-md active:scale-95 cursor-pointer"
                  title="Download PDF"
                >
                  <Download size={14} className="text-emerald-400" />
                  <span>Download PDF</span>
                </button>
                <button 
                  onClick={() => {
                    printDocument(document.getElementById('active-hotel-receipt') || document.querySelector('.receipt-container'), {
                      title: `${hotel.name || 'Hotel'} - Official Receipt - ${currentReservation.guestName}`,
                      pageSize: 'A4 portrait',
                      pageMargin: '8mm'
                    });
                  }}
                  className="px-3.5 py-1.5 bg-emerald-500 text-black rounded-xl text-xs font-bold hover:bg-emerald-400 transition-all flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
                >
                  <Printer size={14} />
                  <span>Print Receipt</span>
                </button>
                <button 
                  onClick={() => setShowReceipt(false)}
                  className="p-1.5 text-zinc-400 hover:text-zinc-50 hover:bg-white/10 rounded-full transition-all"
                  title="Close"
                >
                  <XCircle size={28} />
                </button>
              </div>
              <ReceiptGenerator 
                hotel={hotel} 
                reservation={currentReservation} 
                type="comprehensive" 
                ledgerEntries={ledgerEntries} 
                folioType={activeFolio}
              />
            </div>
          </div>
        )}

        {showPrincipalManager && (
          <PrincipalRoomManager
            currentReservation={currentReservation}
            onClose={() => setShowPrincipalManager(false)}
          />
        )}

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 sm:space-y-8 custom-scrollbar">
          {/* Folio View Switcher: Folio Ledger & Billing vs Guest Activity Timeline */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-zinc-950 p-2 rounded-2xl border border-zinc-800">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-nowrap w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setFolioTab('ledger')}
                className={cn(
                  "flex-1 sm:flex-none px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 whitespace-nowrap shrink-0",
                  folioTab === 'ledger'
                    ? "bg-zinc-100 text-black shadow-md"
                    : "bg-zinc-900/90 text-zinc-400 hover:text-zinc-200 border border-zinc-800"
                )}
              >
                <Receipt size={15} className="shrink-0" />
                <span>Folio Ledger & Billing</span>
              </button>
              <button
                type="button"
                onClick={() => setFolioTab('timeline')}
                className={cn(
                  "flex-1 sm:flex-none px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 whitespace-nowrap shrink-0",
                  folioTab === 'timeline'
                    ? "bg-emerald-500 text-black shadow-md"
                    : "bg-zinc-900/90 text-zinc-400 hover:text-zinc-200 border border-zinc-800"
                )}
              >
                <History size={15} className="shrink-0" />
                <span>Guest Activity Timeline</span>
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Live
                </span>
              </button>
            </div>

            {/* Folio Tabs for Corporate Stays */}
            {currentReservation.corporateId && (
              <div className="flex items-center bg-zinc-900 p-1 rounded-xl border border-zinc-800 self-center sm:self-auto">
                <button
                  onClick={() => setActiveFolio('guest')}
                  className={cn(
                    "px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                    activeFolio === 'guest' ? "bg-emerald-500 text-black shadow-sm" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  Folio 2 (Guest)
                </button>
                <button
                  onClick={() => setActiveFolio('company')}
                  className={cn(
                    "px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                    activeFolio === 'company' ? "bg-blue-500 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  Folio 1 (Company)
                </button>
              </div>
            )}
          </div>

          {folioTab === 'timeline' ? (
            <div className="space-y-6">
              <GlobalErrorBoundary fallback={<div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl text-center text-zinc-400 text-xs">Activity timeline is currently unavailable.</div>}>
                <GuestActivityTimeline reservation={currentReservation} />
              </GlobalErrorBoundary>
            </div>
          ) : (
            <>
          {/* Quick Actions Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 sm:gap-4">
            <button
              type="button"
              onClick={() => setShowSettlePayment(true)}
              className="flex items-center justify-center gap-2 sm:gap-3 p-3 sm:p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl sm:rounded-2xl text-emerald-500 hover:bg-emerald-500 hover:text-black transition-all group active:scale-95"
            >
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-emerald-500/20 rounded-lg sm:rounded-xl flex items-center justify-center group-hover:bg-black/20">
                <DollarSign size={16} className="sm:size-5" />
              </div>
              <div className="text-left">
                <p className="text-[10px] font-bold text-emerald-500/70 uppercase tracking-wider leading-tight">Settle</p>
                <p className="text-xs sm:text-sm font-bold">Payment</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setShowTransferBalanceModal(true)}
              className="flex items-center justify-center gap-2 sm:gap-3 p-3 sm:p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl sm:rounded-2xl text-blue-500 hover:bg-blue-500 hover:text-white transition-all group active:scale-95"
            >
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-500/20 rounded-lg sm:rounded-xl flex items-center justify-center group-hover:bg-black/20">
                <RefreshCw size={16} className="sm:size-5" />
              </div>
              <div className="text-left">
                <p className="text-[10px] font-bold text-blue-500/70 uppercase tracking-wider leading-tight">Transfer</p>
                <p className="text-xs sm:text-sm font-bold">Balance</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => { setItemsToPost([]); setShowPostChargeModal(true); }}
              className="flex items-center justify-center gap-2 sm:gap-3 p-3 sm:p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl sm:rounded-2xl text-amber-500 hover:bg-amber-500 hover:text-black transition-all group active:scale-95"
            >
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-amber-500/20 rounded-lg sm:rounded-xl flex items-center justify-center group-hover:bg-black/20">
                <Plus size={16} className="sm:size-5" />
              </div>
              <div className="text-left">
                <p className="text-[10px] font-bold text-amber-500/70 uppercase tracking-wider leading-tight">Post</p>
                <p className="text-xs sm:text-sm font-bold">Charge</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                handleClearModalPromo();
                setShowFolioDiscountModal(true);
              }}
              className="flex items-center justify-center gap-2 sm:gap-3 p-3 sm:p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl sm:rounded-2xl text-emerald-400 hover:bg-emerald-500 hover:text-black transition-all group active:scale-95"
            >
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-emerald-500/20 rounded-lg sm:rounded-xl flex items-center justify-center group-hover:bg-black/20">
                <Tag size={16} className="sm:size-5" />
              </div>
              <div className="text-left">
                <p className="text-[10px] font-bold text-emerald-500/70 uppercase tracking-wider leading-tight">Apply</p>
                <p className="text-xs sm:text-sm font-bold">Discount</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setFolioTab('timeline')}
              className="flex items-center justify-center gap-2 sm:gap-3 p-3 sm:p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl sm:rounded-2xl text-emerald-400 hover:bg-emerald-500 hover:text-black transition-all group active:scale-95"
            >
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-emerald-500/20 rounded-lg sm:rounded-xl flex items-center justify-center group-hover:bg-black/20">
                <Clock size={16} className="sm:size-5" />
              </div>
              <div className="text-left">
                <p className="text-[10px] font-bold text-emerald-500/70 uppercase tracking-wider leading-tight">Activity</p>
                <p className="text-xs sm:text-sm font-bold">Timeline</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setShowGuestHistory(true)}
              className="flex items-center justify-center gap-2 sm:gap-3 p-3 sm:p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl sm:rounded-2xl text-purple-500 hover:bg-purple-500 hover:text-white transition-all group active:scale-95"
            >
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-purple-500/20 rounded-lg sm:rounded-xl flex items-center justify-center group-hover:bg-black/20">
                <History size={16} className="sm:size-5" />
              </div>
              <div className="text-left">
                <p className="text-[10px] font-bold text-purple-500/70 uppercase tracking-wider leading-tight">Guest</p>
                <p className="text-xs sm:text-sm font-bold">History</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setShowReceipt(true)}
              className="flex items-center justify-center gap-2 sm:gap-3 p-3 sm:p-4 bg-zinc-800 border border-zinc-700 rounded-xl sm:rounded-2xl text-zinc-300 hover:bg-zinc-700 hover:text-white transition-all group active:scale-95"
            >
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-zinc-900 rounded-lg sm:rounded-xl flex items-center justify-center group-hover:bg-black/20">
                <Printer size={16} className="sm:size-5" />
              </div>
              <div className="text-left">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider leading-tight">Print</p>
                <p className="text-xs sm:text-sm font-bold">Receipt</p>
              </div>
            </button>

            {currentReservation.status === 'checked_in' && (
              <button
                type="button"
                onClick={() => setShowExtendGraceModal(true)}
                className={cn(
                  "flex items-center justify-center gap-2 sm:gap-3 p-3 sm:p-4 rounded-xl sm:rounded-2xl transition-all group active:scale-95 border",
                  currentReservation.gracePeriodRequest?.status === 'pending'
                    ? "bg-amber-500/20 border-amber-500/60 text-amber-300 animate-pulse shadow-md shadow-amber-500/10"
                    : "bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500 hover:text-black"
                )}
                title={currentReservation.gracePeriodRequest?.status === 'pending' ? "Review pending staff grace request" : "Extend checkout grace period without penalty"}
              >
                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-amber-500/20 rounded-lg sm:rounded-xl flex items-center justify-center group-hover:bg-black/20">
                  <Clock size={16} className="sm:size-5" />
                </div>
                <div className="text-left">
                  <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider leading-tight">
                    {currentReservation.gracePeriodRequest?.status === 'pending' ? 'Req Pending' : 'Grace'}
                  </p>
                  <p className="text-xs sm:text-sm font-bold">Extension</p>
                </div>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowDiagnosticModal(true)}
              className="flex items-center justify-center gap-2 sm:gap-3 p-3 sm:p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl sm:rounded-2xl text-amber-400 hover:bg-amber-500 hover:text-black transition-all group active:scale-95"
            >
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-amber-500/20 rounded-lg sm:rounded-xl flex items-center justify-center group-hover:bg-black/20">
                <ShieldAlert size={16} className="sm:size-5" />
              </div>
              <div className="text-left">
                <p className="text-[10px] font-bold text-amber-500/70 uppercase tracking-wider leading-tight">Audit</p>
                <p className="text-xs sm:text-sm font-bold">Ledger</p>
              </div>
            </button>
          </div>

          {/* Financial Summary Breakdown */}
          <div className="bg-zinc-950 p-4 sm:p-6 rounded-2xl border border-zinc-800 shadow-sm">
            <div className="flex items-center gap-3 mb-4 sm:mb-6">
              <History size={16} className="text-emerald-500" />
              <h3 className="text-[10px] sm:text-xs font-bold text-zinc-50 uppercase tracking-widest">Financial Summary</h3>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {Object.entries(
                processedDisplayedEntries.reduce((acc: any, entry) => {
                  const rawCat = entry.category;
                  const cat = typeof rawCat === 'string' 
                    ? rawCat 
                    : (rawCat && typeof rawCat === 'object' ? String((rawCat as any).name || 'Other') : 'Other');
                  if (!acc[cat]) acc[cat] = { debit: 0, credit: 0 };
                  if (entry.type === 'debit') acc[cat].debit += entry.amount;
                  else acc[cat].credit += entry.amount;
                  return acc;
                }, {
                  room: { debit: 0, credit: 0 }
                })
              ).filter(([_, totals]: [string, any]) => totals.debit > 0 || totals.credit > 0).map(([catKey, totals]: [string, any]) => (
                <div key={catKey} className="p-3 sm:p-4 bg-zinc-900/50 rounded-xl border border-zinc-800/50 group hover:border-emerald-500/30 transition-colors">
                  <p className="text-[8px] sm:text-[10px] font-bold text-zinc-500 uppercase mb-1.5 sm:mb-2">{String(catKey).replace(/_/g, ' ')}</p>
                  <div className="space-y-1">
                    {totals.debit > 0 && (
                      <div className="flex justify-between text-[10px] sm:text-xs">
                        <span className="text-zinc-500">Charges</span>
                        <span className="text-red-400 font-bold">{formatCurrency(totals.debit, currency, exchangeRate)}</span>
                      </div>
                    )}
                    {totals.credit > 0 && (
                      <div className="flex justify-between text-[10px] sm:text-xs">
                        <span className="text-zinc-500">Payments</span>
                        <span className="text-emerald-400 font-bold">{formatCurrency(totals.credit, currency, exchangeRate)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[10px] sm:text-xs pt-1 mt-1 border-t border-zinc-800/50">
                      <span className="text-zinc-400 font-medium">Net</span>
                      <span className={cn(
                        "font-black",
                        (totals.debit - totals.credit) > 0 ? "text-zinc-50" : "text-emerald-400"
                      )}>
                        {formatCurrency(Math.abs(totals.debit - totals.credit), currency, exchangeRate)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Guest & Stay Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-800">
              <div className="flex items-center gap-3 mb-4">
                <User size={18} className="text-emerald-500" />
                <h3 className="text-sm font-bold text-zinc-50 uppercase tracking-wider">Guest Details</h3>
              </div>
              <div className="space-y-2">
                <p className="text-lg font-bold text-zinc-50">{currentReservation.guestName}</p>
                <p className="text-sm text-zinc-400">{currentReservation.guestEmail}</p>
                <p className="text-sm text-zinc-400">{currentReservation.guestPhone}</p>
                {(() => {
                  const guestAccount = calculateGuestAccount(
                    guest || { id: currentReservation.guestId, email: currentReservation.guestEmail },
                    [currentReservation, ...otherReservations],
                    hotel,
                    ledgerEntries
                  );
                  return (
                    <p className={cn(
                      "text-xs font-bold mt-1",
                      guestAccount.outstandingBalance > 0.01 ? "text-red-500" : "text-emerald-500"
                    )}>
                      Guest Ledger Balance: {formatCurrency(guestAccount.outstandingBalance, currency, exchangeRate)}
                      {guestAccount.outstandingBalance > 0.01 ? " (Debt)" : " (Settled)"}
                    </p>
                  );
                })()}
                {currentReservation.corporateId && (
                  <div className="mt-4 pt-4 border-t border-zinc-800">
                    <p className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Corporate Account</p>
                    <p className="text-sm text-emerald-500 font-bold flex items-center gap-2">
                      <Building2 size={14} />
                      Corporate Booking
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-800">
              <div className="flex items-center gap-3 mb-4">
                <Calendar size={18} className="text-blue-500" />
                <h3 className="text-sm font-bold text-zinc-50 uppercase tracking-wider">Stay Info</h3>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase">Room</p>
                    <p className="text-lg font-bold text-zinc-50">{currentReservation.roomNumber}</p>
                  </div>
                  <div className="text-right flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase">Operational:</span>
                      <span className={cn(
                        "text-[10px] font-bold uppercase px-2 py-0.5 rounded",
                        (currentReservation.operationalStatus || currentReservation.status) === 'checked_in' ? "bg-emerald-500/10 text-emerald-500" :
                        (currentReservation.operationalStatus || currentReservation.status) === 'checked_out' ? "bg-zinc-800 text-zinc-300 border border-zinc-700" :
                        "bg-blue-500/10 text-blue-500"
                      )}>
                        {(currentReservation.operationalStatus || currentReservation.status).replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase">Financial:</span>
                      <span className={cn(
                        "text-[10px] font-bold uppercase px-2 py-0.5 rounded",
                        balance <= 0.01 ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                        (currentReservation.operationalStatus || currentReservation.status) === 'checked_out' ? "bg-red-500/10 text-red-400 border border-red-500/30 font-black" :
                        "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                      )}>
                        {balance <= 0.01 ? 'SETTLED' :
                         (currentReservation.operationalStatus || currentReservation.status) === 'checked_out' ? 'DEBTOR' :
                         (currentReservation.paidAmount || 0) > 0 ? 'PARTIALLY_PAID' : 'OUTSTANDING'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase">Check In</p>
                    <p className="text-sm text-zinc-50 font-medium">{safeFormatDate(currentReservation.checkIn, 'MMM d, yyyy')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase">Check Out</p>
                    <p className="text-sm text-zinc-50 font-medium">{safeFormatDate(currentReservation.checkOut, 'MMM d, yyyy')}</p>
                  </div>
                </div>
                <div className="pt-2 mt-2 border-t border-zinc-800/50">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase mb-2 flex items-center gap-1.5">
                    <Clock size={10} />
                    Stay Duration Breakdown
                  </p>
                  <StayDurationDisplay 
                    checkIn={currentReservation.checkIn} 
                    checkOut={currentReservation.checkOut} 
                    overstayNights={currentReservation.overstayNights}
                    status={currentReservation.status}
                    mode="full"
                  />
                </div>

                {/* Grace Period & Departure Policy Card */}
                <div className="pt-3 mt-2 border-t border-zinc-800/60 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Clock size={11} className="text-amber-400" />
                      Checkout & Grace Period
                    </p>
                    {currentReservation.status === 'checked_in' && (
                      <button
                        type="button"
                        onClick={() => setShowExtendGraceModal(true)}
                        className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded-md transition-colors border",
                          currentReservation.gracePeriodRequest?.status === 'pending'
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/50 animate-pulse"
                            : "text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30"
                        )}
                      >
                        {currentReservation.gracePeriodRequest?.status === 'pending' ? 'Review Grace Request' : 'Extend Grace'}
                      </button>
                    )}
                  </div>

                  {(() => {
                    const graceInfo = getGracePeriodInfo(currentReservation, hotel);
                    return (
                      <div className="space-y-2 text-xs">
                        <div className={cn(
                          "p-2.5 rounded-xl border flex items-center justify-between gap-2",
                          graceInfo.isWithinGracePeriod
                            ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                            : graceInfo.isOverstay
                            ? "bg-red-500/10 border-red-500/30 text-red-400"
                            : "bg-zinc-900/60 border-zinc-800 text-zinc-300"
                        )}>
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5 font-bold">
                              {graceInfo.isWithinGracePeriod ? (
                                <>
                                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                                  <span>Within Grace Period</span>
                                </>
                              ) : graceInfo.isOverstay ? (
                                <>
                                  <span className="w-2 h-2 rounded-full bg-red-400"></span>
                                  <span>Grace Period Expired</span>
                                </>
                              ) : (
                                <>
                                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                                  <span>Before Checkout</span>
                                </>
                              )}
                            </div>
                            <p className="text-[11px] text-zinc-400">
                              {graceInfo.isWithinGracePeriod ? (
                                `Complimentary stay until ${graceInfo.effectiveCheckoutTimeStr} (${graceInfo.minutesRemainingInGrace}m remaining)`
                              ) : graceInfo.isOverstay ? (
                                `Overstay charges apply (grace ended ${graceInfo.effectiveCheckoutTimeStr})`
                              ) : (
                                `Checkout ${graceInfo.standardCheckoutTime} + ${Math.round(graceInfo.hotelGraceMinutes / 60)}h grace (ends ${graceInfo.effectiveCheckoutTimeStr})`
                              )}
                            </p>
                          </div>
                          {Number(currentReservation.customGracePeriodMinutes || 0) > 0 && (
                            <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded text-[9px] font-bold shrink-0 border border-amber-500/30">
                              +{currentReservation.customGracePeriodMinutes}m
                            </span>
                          )}
                        </div>

                        {/* Auto Night Deduction Toggle */}
                        <div className="p-2.5 bg-zinc-900/40 rounded-xl border border-zinc-800/80 flex items-center justify-between">
                          <div className="space-y-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Auto Night Deduction</span>
                            <p className="text-[10px] text-zinc-500">
                              {currentReservation.autoNightDeduction !== false 
                                ? 'Nightly & overstay fees post automatically' 
                                : 'Nightly charges and overstay fees are paused'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleToggleAutoNightDeduction}
                            className={cn(
                              "px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border",
                              currentReservation.autoNightDeduction !== false
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                                : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700 hover:text-zinc-200"
                            )}
                          >
                            {currentReservation.autoNightDeduction !== false ? 'Active' : 'Paused'}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-800">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Banknote size={18} className="text-amber-500" />
                  <h3 className="text-sm font-bold text-zinc-55 uppercase tracking-wider">Folio Summary</h3>
                </div>
              </div>
              
              <div className="space-y-4">
                {/* TIER 1: GROSS RATE */}
                <div className="bg-zinc-900/30 p-4 rounded-xl border border-zinc-805 space-y-2">
                  <div className="flex justify-between items-center pb-1 border-b border-zinc-800/50">
                    <span className="text-[10px] font-black tracking-wider text-zinc-400 uppercase">Tier 1: Gross Rate & Services</span>
                    <span className="text-[8px] font-bold text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded tracking-widest uppercase">Pre-Tax</span>
                  </div>
                  
                  {/* Base rate calculations */}
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Base Room Stay Gross</span>
                    <span className="text-zinc-300 font-medium font-mono">
                      {formatCurrency(folioBreakdown.tier1.baseRoomGross, currency, exchangeRate)}
                    </span>
                  </div>
                  
                  {/* Ancillary services list if any */}
                  {folioBreakdown.tier1.ancillaryCharges.length > 0 && (
                    <div className="pt-2 border-t border-zinc-900 space-y-1">
                      <span className="text-[9px] font-bold text-zinc-600 uppercase">Ancillary Gross Charges</span>
                      {folioBreakdown.tier1.ancillaryCharges.map((e, idx) => (
                        <div key={idx} className="flex justify-between text-[11px] text-zinc-400 pl-2">
                          <span className="truncate max-w-[200px]">{e.description}</span>
                          <span className="font-mono">{formatCurrency(e.amount, currency, exchangeRate)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Gross Rate Sum */}
                  <div className="flex justify-between text-xs pt-2 mt-2 border-t border-zinc-800 font-bold">
                    <span className="text-zinc-400">Total Gross Rate</span>
                    <span className="text-zinc-100 font-mono">
                      {formatCurrency(folioBreakdown.tier1.totalGrossRate, currency, exchangeRate)}
                    </span>
                  </div>
                </div>

                {/* TIER 2: TAX BREAKDOWN */}
                <div className="bg-zinc-900/30 p-4 rounded-xl border border-zinc-805 space-y-2">
                  <div className="flex justify-between items-center pb-1 border-b border-zinc-800/50">
                    <span className="text-[10px] font-black tracking-wider text-zinc-400 uppercase">Tier 2: Tax Breakdown</span>
                    <span className="text-[8px] font-bold text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded tracking-widest uppercase">Breakdown</span>
                  </div>

                  {/* Render active taxes calculated once */}
                  {folioBreakdown.tier2.taxes.length > 0 ? (
                    <div className="space-y-1.5">
                      {folioBreakdown.tier2.taxes.map((tax, idx) => (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="text-zinc-500 flex items-center gap-1">
                            {tax.name} ({tax.percentage}%)
                            <span className="text-[8px] text-zinc-650 bg-zinc-950 border border-zinc-850 px-1 rounded-sm">
                              {tax.isInclusive ? 'Incl.' : 'Excl.'}
                            </span>
                          </span>
                          <span className="text-zinc-300 font-mono">{formatCurrency(tax.amount, currency, exchangeRate)}</span>
                        </div>
                      ))}
                      <div className="pt-2 border-t border-zinc-900 flex justify-between text-xs font-bold">
                        <span className="text-zinc-400">Total Taxes</span>
                        <span className="text-zinc-200 font-mono">{formatCurrency(folioBreakdown.tier2.totalTaxAmount, currency, exchangeRate)}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[10px] text-zinc-600 italic">No tax rules applied to this folio reservation</p>
                  )}
                </div>

                {/* TIER 3: NET AMOUNT DUE */}
                <div className="bg-zinc-900/50 p-4 rounded-xl border border-zinc-800 space-y-3">
                  <div className="flex justify-between items-center pb-1 border-b border-zinc-800/50">
                    <span className="text-[10px] font-black tracking-wider text-emerald-500 uppercase">Tier 3: Net Amount Due</span>
                    <span className="text-[8px] font-bold text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded tracking-widest uppercase">Net Calc</span>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-zinc-450">Total Net Invoice (Gross + Excl. Taxes)</span>
                      <span className="text-zinc-200 font-bold font-mono">
                        {formatCurrency(totalDebits, currency, exchangeRate)}
                      </span>
                    </div>

                    <div className="flex justify-between text-emerald-500">
                      <span>Less: Payments & Credits Applied (Credits)</span>
                      <span className="font-bold font-mono">
                        -{formatCurrency(totalCredits, currency, exchangeRate)}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-zinc-800 flex justify-between items-center">
                    <div className="flex flex-col">
                      <span className="text-[11px] font-black text-zinc-400 uppercase tracking-widest leading-none">Net Amount Due</span>
                      <span className="text-[8px] font-medium text-red-500/50 uppercase leading-none mt-1.5">Real-Time Outstanding</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className={cn(
                        "text-3xl font-black transition-colors duration-300 font-mono tracking-tight",
                        balance > 0.01 ? "text-red-500" : balance < -0.01 ? "text-blue-500" : "text-emerald-400"
                      )}>
                        {formatCurrency(Math.abs(balance), currency, exchangeRate)}
                      </span>
                      <span className={cn(
                        "text-[9px] font-bold uppercase tracking-wider mt-0.5",
                        balance > 0.01 ? "text-red-500" : balance < -0.01 ? "text-blue-500" : "text-emerald-400"
                      )}>
                        {balance > 0.01 ? (activeFolio === 'company' ? "Amount Due to Property" : "Guest Debt / Owing") : balance < -0.01 ? "Credit Balance (Overpaid)" : "Account Fully Settled"}
                      </span>
                    </div>
                  </div>
                </div>

                {balance > 0.01 ? (
                  <div className="space-y-3 pt-2">
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-2 text-red-400">
                        <AlertCircle size={16} />
                        <span className="text-xs font-bold uppercase">⚠ Outstanding Balance: {formatCurrency(balance, currency, exchangeRate)}</span>
                      </div>
                      <span className="text-[9px] font-black uppercase text-red-500 bg-red-500/20 px-2 py-0.5 rounded">
                        {(currentReservation.operationalStatus || currentReservation.status) === 'checked_out' ? 'DEBTOR ACCOUNT' : 'UNPAID'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setShowSettlePayment(true)}
                        className="py-2.5 px-3 bg-emerald-500 text-black rounded-xl font-black text-xs uppercase tracking-wider hover:bg-emerald-400 transition-all flex items-center justify-center gap-1.5 active:scale-95 shadow-lg shadow-emerald-500/10"
                      >
                        <DollarSign size={14} />
                        Receive Payment
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowSettlePayment(true)}
                        className="py-2.5 px-3 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-xl font-black text-xs uppercase tracking-wider hover:bg-zinc-700 transition-all flex items-center justify-center gap-1.5 active:scale-95"
                      >
                        <CheckCircle2 size={14} className="text-emerald-500" />
                        Settle Balance
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const ledgerElem = document.getElementById('folio-ledger-table');
                          if (ledgerElem) ledgerElem.scrollIntoView({ behavior: 'smooth' });
                        }}
                        className="py-2.5 px-3 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded-xl font-bold text-xs uppercase tracking-wider hover:text-zinc-200 hover:border-zinc-700 transition-all flex items-center justify-center gap-1.5"
                      >
                        <History size={14} />
                        View Ledger
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-center gap-2 text-emerald-400">
                    <CheckCircle2 size={18} />
                    <span className="text-xs font-black uppercase tracking-widest">✅ Account Settled</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {showTransferBalanceModal && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[85] flex items-center justify-center p-4">
              <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl w-full max-w-md">
                <h3 className="text-lg font-bold text-zinc-50 mb-4">Transfer Balance</h3>
                
                <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800 mb-6">
                  <button
                    onClick={() => {
                      setTransferType('guest');
                      setTransferTargetId('');
                    }}
                    className={cn(
                      "flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                      transferType === 'guest' ? "bg-emerald-500 text-black shadow-lg" : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    To Another Guest
                  </button>
                  <button
                    onClick={() => {
                      setTransferType('corporate');
                      setTransferTargetId('');
                    }}
                    className={cn(
                      "flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                      transferType === 'corporate' ? "bg-blue-500 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    To Corporate Account
                  </button>
                </div>

                <p className="text-sm text-zinc-400 mb-6">
                  Select {transferType === 'guest' ? 'another active reservation' : 'a corporate account'} to transfer the current balance of {formatCurrency(balance, currency, exchangeRate)}.
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">
                      {transferType === 'guest' ? 'Target Reservation' : 'Target Corporate Account'}
                    </label>
                    <select 
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                      value={transferTargetId}
                      onChange={(e) => setTransferTargetId(e.target.value)}
                    >
                      <option value="">Select Target</option>
                      {transferType === 'guest' ? (
                        activeReservationsForSearch.map(r => (
                          <option key={r.id} value={r.id}>
                            {r.guestName} - Room {r.roomNumber} ({safeFormatDate(r.checkIn, 'MMM d')} - {safeFormatDate(r.checkOut, 'MMM d')})
                          </option>
                        ))
                      ) : (
                        corporateAccountsList.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name} (Ref: {c.taxId || c.id.slice(-4)})
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  <div className="flex gap-3 pt-4">
                    <button 
                      onClick={() => setShowTransferBalanceModal(false)}
                      className="flex-1 py-2 bg-zinc-800 text-zinc-50 rounded-lg font-bold hover:bg-zinc-700 transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleTransferBalance}
                      disabled={!transferTargetId || loading}
                      className="flex-1 py-2 bg-emerald-500 text-black rounded-lg font-bold hover:bg-emerald-400 transition-all disabled:opacity-50"
                    >
                      Confirm Transfer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {showSettleOverpayment && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[85] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
              >
                <div className="p-6 border-b border-zinc-800">
                  <h2 className="text-xl font-bold text-zinc-50">Settle Overpayment</h2>
                  <p className="text-sm text-zinc-500 mt-1">Refund or balance adjustment for {currentReservation.guestName}</p>
                </div>
                <form onSubmit={handleSettleOverpayment}>
                  <div className="p-6 space-y-4">
                    <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center">
                        <Banknote size={20} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-zinc-500 uppercase">Available Credit</p>
                        <p className="text-lg font-bold text-emerald-500">{formatCurrency(Math.abs(balance), currency, exchangeRate)}</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase">Refund Amount ({currency})</label>
                      <input
                        required
                        type="number"
                        value={currency === 'USD' ? ((settleData.splits[0]?.amount || 0) / exchangeRate) || '' : (settleData.splits[0]?.amount || '')}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          const newAmount = currency === 'USD' ? val * exchangeRate : val;
                          const newSplits = [...settleData.splits];
                          if (newSplits.length === 0) {
                            newSplits.push({ amount: newAmount, method: 'cash' });
                          } else {
                            newSplits[0].amount = newAmount;
                          }
                          setSettleData({ ...settleData, splits: newSplits });
                        }}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                        max={currency === 'USD' ? Math.abs(balance) / exchangeRate : Math.abs(balance)}
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase">Refund Method</label>
                      <select
                        value={settleData.splits[0]?.method || 'cash'}
                        onChange={(e) => {
                          const newSplits = [...settleData.splits];
                          if (newSplits.length === 0) {
                            newSplits.push({ amount: 0, method: e.target.value as any });
                          } else {
                            newSplits[0].method = e.target.value as any;
                          }
                          setSettleData({ ...settleData, splits: newSplits });
                        }}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                      >
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="transfer">Bank Transfer</option>
                      </select>
                    </div>
                  </div>
                  <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowSettleOverpayment(false)}
                      className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={settleData.splits.reduce((acc, s) => acc + s.amount, 0) <= 0 || isSaving}
                      className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50"
                    >
                      {isSaving ? 'Processing...' : 'Confirm Refund'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {showGuestHistory && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[85] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]"
              >
                <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-purple-500/10 rounded-xl flex items-center justify-center text-purple-500">
                      <History size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-zinc-50">Reservation History</h3>
                      <p className="text-xs text-zinc-500">Previous stays for {currentReservation.guestName}</p>
                    </div>
                  </div>
                  <button onClick={() => setShowGuestHistory(false)} className="text-zinc-500 hover:text-white">
                    <XCircle size={24} />
                  </button>
                </div>
                <div className="p-6 overflow-y-auto space-y-4">
                  {guestHistory.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-zinc-500">No previous reservations found.</p>
                    </div>
                  ) : (
                    guestHistory.map(res => (
                      <div key={res.id} className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl flex items-center justify-between hover:border-zinc-700 transition-all">
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold",
                            res.status === 'checked_out' ? "bg-emerald-500/10 text-emerald-500" :
                            res.status === 'cancelled' ? "bg-red-500/10 text-red-500" :
                            "bg-blue-500/10 text-blue-500"
                          )}>
                            {res.status === 'checked_out' ? 'CO' : res.status.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-zinc-50">Room {res.roomNumber}</p>
                            <p className="text-xs text-zinc-500">
                              {safeFormatDate(res.checkIn, 'MMM d, yyyy')} - {safeFormatDate(res.checkOut, 'MMM d, yyyy')}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-zinc-50">{formatCurrency(res.totalAmount, currency, exchangeRate)}</p>
                          <p className="text-[10px] font-bold uppercase text-zinc-600">{res.status.replace('_', ' ')}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="p-6 bg-zinc-950 border-t border-zinc-800">
                  <button 
                    onClick={() => setShowGuestHistory(false)}
                    className="w-full py-2 bg-zinc-800 text-zinc-50 rounded-xl font-bold hover:bg-zinc-700 transition-all"
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {showPostChargeModal && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[85] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
              >
                <div className="p-6 border-b border-zinc-800">
                  <h2 className="text-xl font-bold text-zinc-50">Post Entry</h2>
                  <p className="text-sm text-zinc-500 mt-1">Add charge or manual adjustment for {currentReservation.guestName}</p>
                </div>
                <form onSubmit={handlePostCharge}>
                  <div className="p-6 space-y-4">
                    <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800 mb-2">
                      <button
                        type="button"
                        onClick={() => setChargeDetails({ ...chargeDetails, type: 'debit' })}
                        className={cn(
                          "flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                          chargeDetails.type === 'debit' ? "bg-red-500 text-white" : "text-zinc-500 hover:text-zinc-300"
                        )}
                      >
                        Charge (Debit)
                      </button>
                      <button
                        type="button"
                        onClick={() => setChargeDetails({ ...chargeDetails, type: 'credit' })}
                        className={cn(
                          "flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                          chargeDetails.type === 'credit' ? "bg-emerald-500 text-black" : "text-zinc-500 hover:text-zinc-300"
                        )}
                      >
                        Adjustment (Credit)
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Category</label>
                        <select
                          value={chargeDetails.category}
                          onChange={(e) => setChargeDetails({ ...chargeDetails, category: e.target.value as any })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                        >
                          <option value="restaurant">Restaurant</option>
                          <option value="service">Room Service</option>
                          <option value="laundry">Laundry</option>
                          <option value="discount">Discount</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Unit Price ({currency})</label>
                        <input
                          type="number"
                          value={currency === 'USD' ? (chargeDetails.price / exchangeRate) || '' : chargeDetails.price || ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            const finalPrice = currency === 'USD' ? val * exchangeRate : val;
                            setChargeDetails({ ...chargeDetails, price: finalPrice });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Quantity</label>
                        <input
                          type="number"
                          min="1"
                          value={chargeDetails.quantity}
                          onChange={(e) => setChargeDetails({ ...chargeDetails, quantity: parseInt(e.target.value) || 1 })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Effective Total Amount</label>
                        <div className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-400 font-bold">
                          {(() => {
                            const baseBase = chargeDetails.price * chargeDetails.quantity;
                            const discounted = chargeDetails.discountType === 'fixed'
                              ? Math.max(0, baseBase - chargeDetails.discount)
                              : Math.max(0, baseBase * (1 - chargeDetails.discount / 100));
                            return formatCurrency(discounted, currency, exchangeRate);
                          })()}
                          {chargeDetails.discount > 0 && (
                            <span className="text-[10px] text-emerald-400 block font-normal mt-0.5">
                              Discount applied: -{chargeDetails.discountType === 'fixed' ? formatCurrency(chargeDetails.discount, currency, exchangeRate) : `${chargeDetails.discount}%`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Service Level Discount Panel */}
                    <div className="border border-zinc-800/80 bg-zinc-950/40 p-3 rounded-xl space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-zinc-400 uppercase">Service Discount</span>
                        <div className="flex bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 text-[10px]">
                          <button
                            type="button"
                            onClick={() => setChargeDetails({ ...chargeDetails, discountType: 'fixed', discount: 0 })}
                            className={cn(
                              "px-2 py-1 rounded font-bold transition-all",
                              chargeDetails.discountType === 'fixed' ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-400"
                            )}
                          >
                            Fixed
                          </button>
                          <button
                            type="button"
                            onClick={() => setChargeDetails({ ...chargeDetails, discountType: 'percentage', discount: 0 })}
                            className={cn(
                              "px-2 py-1 rounded font-bold transition-all",
                              chargeDetails.discountType === 'percentage' ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-400"
                            )}
                          >
                            Percent
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">
                          {chargeDetails.discountType === 'fixed' ? `Discount Amount (${currency})` : 'Discount Percentage (%)'}
                        </label>
                        <input
                          type="number"
                          min="0"
                          max={chargeDetails.discountType === 'percentage' ? "100" : undefined}
                          value={chargeDetails.discountType === 'fixed' && currency === 'USD' ? (chargeDetails.discount / exchangeRate) || '' : chargeDetails.discount || ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setChargeDetails({
                              ...chargeDetails,
                              discount: chargeDetails.discountType === 'fixed' && currency === 'USD' ? val * exchangeRate : val
                            });
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-50 focus:outline-none focus:border-emerald-500/50 font-mono"
                          placeholder="0"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase">Description / Reason</label>
                      <input
                        type="text"
                        value={chargeDetails.description}
                        onChange={(e) => setChargeDetails({ ...chargeDetails, description: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                        placeholder="Item name or reason for adjustment"
                      />
                    </div>                     <button
                      type="button"
                      disabled={chargeDetails.price <= 0}
                      onClick={() => {
                        if (chargeDetails.price <= 0) return;
                        setItemsToPost(prev => [...prev, {
                          ...chargeDetails,
                          id: Math.random().toString(36).substring(7)
                        }]);
                        setChargeDetails(prev => ({
                          ...prev,
                          price: 0,
                          amount: 0,
                          quantity: 1,
                          description: ''
                        }));
                      }}
                      className="w-full py-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-xl font-bold hover:bg-amber-500 hover:text-black transition-all text-xs flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:hover:bg-amber-500/10 disabled:hover:text-amber-500 disabled:cursor-not-allowed"
                    >
                      <Plus size={14} />
                      Add Another Item
                    </button>

                    {itemsToPost.length > 0 && (
                      <div className="pt-3 border-t border-zinc-800 space-y-2 max-h-[160px] overflow-y-auto pr-1">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Items added ({itemsToPost.length})</span>
                          <span className="text-xs font-bold text-amber-500 font-mono">
                            Total: {formatCurrency(itemsToPost.reduce((sum, item) => sum + (item.price * item.quantity), 0), currency, exchangeRate)}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {itemsToPost.map((item, index) => (
                            <div key={item.id || index} className="flex justify-between items-center text-xs bg-zinc-950 p-2 rounded-xl border border-zinc-800/80">
                              <div className="truncate max-w-[200px] text-left">
                                <span className="font-mono text-[8px] bg-zinc-900 border border-zinc-800 px-1 py-0.5 rounded text-zinc-400 mr-1.5 uppercase">{item.category}</span>
                                <span className="text-zinc-300 font-medium">{item.description || `${item.category.replace('_', ' ')} Charge`}</span>
                                <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                                  {item.quantity} × {formatCurrency(item.price, currency, exchangeRate)}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-zinc-300 font-mono">
                                  {formatCurrency(item.price * item.quantity, currency, exchangeRate)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setItemsToPost(prev => prev.filter((_, i) => i !== index))}
                                  className="p-1 text-zinc-500 hover:text-red-400 rounded-lg hover:bg-zinc-900 transition-colors"
                                  title="Remove item"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowPostChargeModal(false)}
                      className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-450 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSaving || (itemsToPost.length === 0 && chargeDetails.price <= 0)}
                      className={cn(
                        "flex-1 px-4 py-2 rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50",
                        itemsToPost.length > 0
                          ? "bg-amber-500 text-black font-black"
                          : chargeDetails.type === 'debit' 
                            ? "bg-red-500 text-white" 
                            : "bg-emerald-500 text-black"
                      )}
                    >
                      {isSaving 
                        ? 'Confirming...' 
                        : itemsToPost.length > 0 
                          ? `Confirm Posting (${itemsToPost.length} ${itemsToPost.length === 1 ? 'Item' : 'Items'})` 
                          : `Confirm Single ${chargeDetails.type === 'debit' ? 'Charge' : 'Adjustment'}`
                      }
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {showSettlePayment && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[85] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
              >
                <div className="p-6 border-b border-zinc-800">
                  <h2 className="text-xl font-bold text-zinc-50">Settle Payment</h2>
                  <p className="text-sm text-zinc-500 mt-1">Record payment for {currentReservation.guestName}</p>
                </div>
                <form onSubmit={handleSettlePayment}>
                  <div className="p-6 space-y-6">
                    <div className="flex flex-col gap-2 bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                          <Banknote size={20} />
                        </div>
                        <div className="flex-1">
                          <p className="text-xs font-bold text-zinc-500 uppercase truncate">Remaining Stay Total</p>
                          <p className="text-lg font-bold text-red-500">{formatCurrency(balance, currency, exchangeRate)}</p>
                        </div>
                      </div>
                      
                      {/* Detailed Balance Breakdown */}
                      <div className="pt-3 border-t border-zinc-800 space-y-1">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-zinc-500 uppercase">Principal Charges</span>
                          <span className="text-zinc-300">{formatCurrency(processedDisplayedEntries.filter(e => e.type === 'debit' && e.category !== 'tax').reduce((acc, e) => acc + e.amount, 0), currency, exchangeRate)}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-zinc-500 uppercase">Taxes & Fees</span>
                          <span className="text-zinc-300">{formatCurrency(processedDisplayedEntries.filter(e => e.type === 'debit' && e.category === 'tax').reduce((acc, e) => acc + e.amount, 0), currency, exchangeRate)}</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-zinc-500 uppercase">Total Payments</span>
                          <span className="text-emerald-500">-{formatCurrency(totalCredits, currency, exchangeRate)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Payment Splits</label>
                        {(hotel?.settings?.payments?.allowSplitPayments ?? true) && (
                          <button
                            type="button"
                            onClick={() => setSettleData({
                              ...settleData,
                              splits: [...settleData.splits, { amount: 0, method: 'cash' }]
                            })}
                            className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 hover:text-emerald-400 uppercase"
                          >
                            <PlusCircle size={12} /> Add Split
                          </button>
                        )}
                      </div>

                      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                        {settleData.splits.map((split, index) => (
                          <div key={index} className="p-4 bg-zinc-950/50 border border-zinc-800 rounded-2xl space-y-3 relative group">
                            {settleData.splits.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const newSplits = [...settleData.splits];
                                  newSplits.splice(index, 1);
                                  setSettleData({ ...settleData, splits: newSplits });
                                }}
                                className="absolute top-2 right-2 p-1.5 text-zinc-600 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase">Amount ({currency})</label>
                                <input
                                  required
                                  type="number"
                                  value={currency === 'USD' ? (split.amount / exchangeRate) || '' : split.amount || ''}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    const newSplits = [...settleData.splits];
                                    newSplits[index].amount = currency === 'USD' ? val * exchangeRate : val;
                                    setSettleData({ ...settleData, splits: newSplits });
                                  }}
                                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5 text-sm text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                                  step="0.01"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase">Method</label>
                                <select
                                  value={split.method}
                                  onChange={(e) => {
                                    const newSplits = [...settleData.splits];
                                    newSplits[index].method = e.target.value as any;
                                    setSettleData({ ...settleData, splits: newSplits });
                                  }}
                                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5 text-sm text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                                >
                                  <option value="cash">Cash</option>
                                  <option value="card">Card</option>
                                  <option value="transfer">Bank Transfer</option>
                                </select>
                              </div>
                            </div>

                            {split.method !== 'cash' && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-zinc-500 uppercase flex items-center justify-between">
                                    <span>Ref Code {hotel.settings?.payments?.requireTransactionReference && <span className="text-red-500 font-bold">*</span>}</span>
                                    {split.referenceCode && <span className="text-[9px] text-emerald-500">Registered</span>}
                                  </label>
                                  <input
                                    type="text"
                                    placeholder="e.g. TXN9481"
                                    value={split.referenceCode || ''}
                                    onChange={(e) => {
                                      const newSplits = [...settleData.splits];
                                      newSplits[index].referenceCode = e.target.value;
                                      setSettleData({ ...settleData, splits: newSplits });
                                    }}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                                  />
                                </div>
                                {split.method === 'transfer' && (
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase flex items-center justify-between">
                                      <span>Proof receipt {hotel.settings?.payments?.requirePaymentProofUpload && <span className="text-red-500 font-bold">*</span>}</span>
                                      {split.proofUrl && <span className="text-[9px] text-emerald-400">Attached</span>}
                                    </label>
                                    <div className="relative">
                                      <input
                                        type="file"
                                        accept="image/*,.pdf"
                                        onChange={(e) => {
                                          if (e.target.files && e.target.files.length > 0) {
                                            const file = e.target.files[0];
                                            const newSplits = [...settleData.splits];
                                            newSplits[index].proofUrl = `uploads/receipts/${Date.now()}_${file.name}`;
                                            setSettleData({ ...settleData, splits: newSplits });
                                            toast.success('Payment proof receipt registered in memory.');
                                          }
                                        }}
                                        className="absolute inset-x-0 inset-y-0 opacity-0 w-full h-full cursor-pointer z-10"
                                      />
                                      <div className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-400 flex items-center justify-between hover:border-zinc-700 transition-colors">
                                        <span className="truncate max-w-[120px]">
                                          {split.proofUrl ? split.proofUrl.split('_').slice(1).join('_') : 'Upload Receipt'}
                                        </span>
                                        <PlusCircle size={14} className="text-zinc-650" />
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="p-3 bg-zinc-900/50 rounded-xl border border-dashed border-zinc-800 flex justify-between items-center text-xs">
                        <span className="text-zinc-500 font-bold uppercase">Total Settlement</span>
                        <span className="text-zinc-50 font-black">
                          {formatCurrency(settleData.splits.reduce((acc, s) => acc + s.amount, 0), currency, exchangeRate)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowSettlePayment(false)}
                      className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={settleData.splits.reduce((acc, s) => acc + s.amount, 0) <= 0 || isSaving}
                      className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50"
                    >
                      {isSaving ? 'Processing...' : 'Confirm Payment'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {showOverpaymentWarning && (
            <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[95] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl w-full max-w-md shadow-2xl"
              >
                <div className="flex items-center gap-3 text-amber-500 mb-4">
                  <AlertCircle size={24} />
                  <h3 className="text-lg font-bold">Overpayment Detected</h3>
                </div>
                <p className="text-sm text-zinc-300 mb-6 leading-relaxed">
                  The payment amount of <span className="font-bold text-zinc-100">{formatCurrency(settleData.splits.reduce((acc, s) => acc + s.amount, 0), currency, exchangeRate)}</span> exceeds the calculated net remaining total of <span className="font-bold text-zinc-100">{formatCurrency(balance, currency, exchangeRate)}</span> (calculated inclusive of stays, taxes & service fees).
                  <br /><br />
                  Proceeding may create unnecessary ledger overpayment credits. Are you sure you want to proceed and record this payment?
                </p>
                <div className="flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setShowOverpaymentWarning(false)}
                    className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl font-bold transition-all"
                  >
                    Adjust Amount
                  </button>
                  <button 
                    type="button"
                    onClick={async () => {
                      await executeSettlePayment();
                    }}
                    className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-black rounded-xl font-bold transition-all"
                  >
                    Confirm Payment
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {/* Ledger Entries Table */}
          <div id="folio-ledger-table" className="bg-zinc-950 rounded-2xl border border-zinc-800 overflow-hidden">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/30">
              <div className="flex items-center gap-2">
                <History size={16} className="text-zinc-500" />
                <h3 className="text-sm font-bold text-zinc-50 uppercase tracking-wider">Transaction History</h3>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={handleReconcileBalances}
                  disabled={isReconciling}
                  title="Audit and synchronize ledger transactions to match authoritative reservation balance"
                  className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 text-zinc-300 text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-50 border border-zinc-700"
                >
                  <RefreshCw size={12} className={isReconciling ? "animate-spin" : ""} />
                  {isReconciling ? 'Reconciling...' : 'Reconcile Balance'}
                </button>
                <button 
                  onClick={() => setShowSettlePayment(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500 text-black text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-emerald-400 transition-colors"
                >
                  <DollarSign size={12} />
                  Receive Payment
                </button>
                {currentReservation.status === 'checked_in' && (
                  <button 
                    onClick={handleManualNightlyCharge}
                    disabled={isAuditing}
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 text-blue-500 text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-blue-500/20 transition-colors disabled:opacity-50 border border-blue-500/20"
                  >
                    <Clock size={12} />
                    {isAuditing ? 'Posting...' : 'Post Night'}
                  </button>
                )}
                {currentReservation.status === 'checked_in' && (
                  <button 
                    onClick={() => { setItemsToPost([]); setShowPostChargeModal(true); }}
                    className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 text-amber-500 text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-amber-500/20 transition-colors border border-amber-500/20"
                  >
                    <Plus size={12} />
                    Extra Charge
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800 bg-zinc-900/30">
                    <th className="px-6 py-3">Date & Time</th>
                    <th className="px-6 py-3">Description</th>
                    <th className="px-6 py-3">Category</th>
                    <th className="px-6 py-3 text-right">Debit</th>
                    <th className="px-6 py-3 text-right">Credit</th>
                    <th className="px-6 py-3 text-right">Running Balance</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-zinc-500">
                        <Clock size={24} className="mx-auto mb-2 animate-spin opacity-20" />
                        Loading transactions...
                      </td>
                    </tr>
                  ) : sortedHistoryForDisplay.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-zinc-500">
                        No transactions recorded for this folio.
                      </td>
                    </tr>
                  ) : (
                    sortedHistoryForDisplay.map((entry) => {
                      const entryKey = entry.id || (entry as any).firestoreId || 'projected_room_stay_charge_virtual';
                      const runningInfo = runningBalancesMap.get(entryKey);
                      const isOwing = (runningInfo?.balance || 0) > 0;
                      return (
                        <tr 
                          key={entryKey} 
                          className={cn(
                            "hover:bg-zinc-900/50 transition-colors",
                            entry.category === 'refund' ? "bg-amber-500/5 border-l-2 border-l-amber-500/50" : entry.isVirtual ? "bg-amber-500/5 border-l-2 border-l-amber-500/50" : ""
                          )}
                        >
                          <td className="px-6 py-4 text-xs text-zinc-400">
                            {safeFormatDate(entry.timestamp, 'MMM d, HH:mm')}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-medium text-zinc-50">
                                {typeof entry.description === 'string' 
                                  ? entry.description 
                                  : (entry.description && typeof entry.description === 'object' ? ((entry.description as any).name || (entry.description as any).text || JSON.stringify(entry.description)) : '')}
                              </div>
                              {String(entry.category).toLowerCase() === 'refund' && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-500 border border-amber-500/30">
                                  ↩ Refund Issued
                                </span>
                              )}
                              {entry.isVirtual && (
                                <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-500 text-[8px] font-black uppercase rounded tracking-wide border border-amber-500/30">
                                  Projected
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-zinc-500 font-mono">
                                {entry.isVirtual ? 'Virtual Forecast Reference' : `Ref: ${String(entry.id || (entry as any).firestoreId || '').slice(-8).toUpperCase()}`}
                              </span>
                              {(() => {
                                const postedName = (entry as any).postedByName;
                                const rawP = entry.postedBy;
                                const pByStr = typeof rawP === 'string' 
                                  ? rawP 
                                  : (rawP && typeof rawP === 'object' ? String((rawP as any).displayName || (rawP as any).uid || 'system') : '');
                                if (!pByStr && !postedName) return null;
                                const displayStaff = postedName || (pByStr === 'system' ? 'System' : (pByStr === profile?.uid ? (profile?.displayName || 'You') : (pByStr.includes('@') ? pByStr : `Staff (${pByStr.slice(-6).toUpperCase()})`)));
                                return (
                                  <span className="text-[9px] text-zinc-400 font-medium">
                                    • Posted by: <strong className="text-zinc-300 font-semibold">{displayStaff}</strong>
                                  </span>
                                );
                              })()}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-[10px] font-semi uppercase px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded">
                              {typeof entry.category === 'string' ? entry.category : (entry.category && typeof entry.category === 'object' ? String((entry.category as any).name || 'general') : 'general')}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right text-sm font-bold text-red-500">
                            {entry.type === 'debit' ? formatCurrency(entry.amount, currency, exchangeRate) : '-'}
                          </td>
                          <td className="px-6 py-4 text-right text-sm font-bold text-emerald-500">
                            {entry.type === 'credit' ? formatCurrency(entry.amount, currency, exchangeRate) : '-'}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className={cn(
                              "text-sm font-black font-mono",
                              isOwing ? "text-red-500" : (runningInfo?.balance || 0) < 0 ? "text-emerald-500" : "text-zinc-400"
                            )}>
                              {formatCurrency(Math.abs(runningInfo?.balance || 0), currency, exchangeRate)}
                              {isOwing ? " (Owing)" : (runningInfo?.balance || 0) < 0 ? " (Credit)" : ""}
                            </div>
                            <div className="text-[9px] text-zinc-500 font-mono mt-0.5" title="Detailed cumulative running transaction calculation">
                              {runningInfo?.calculation}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {entry.type === 'debit' && entry.category !== 'tax' && !entry.isVirtual && (
                                <button
                                  onClick={() => setDiscountingEntry(entry)}
                                  className="p-2 text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-all"
                                  title="Apply Line Discount"
                                >
                                  <Tag size={13} />
                                </button>
                              )}
                              {hasPermission(profile, 'void_transaction') && !entry.isVirtual && (
                                <button
                                  onClick={() => setConfirmDelete(entry)}
                                  className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                                  title="Void Transaction"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                              {entry.isVirtual && (
                                <span className="text-[10px] text-zinc-650 italic">n/a</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                <tfoot className="bg-zinc-900/30 border-t border-zinc-800">
                  <tr>
                    <td colSpan={3} className="px-6 py-4 text-right text-[10px] font-bold text-zinc-500 uppercase">Ledger Totals</td>
                    <td className="px-6 py-4 text-right text-sm font-bold text-red-500">
                      {formatCurrency(totalDebits, currency, exchangeRate)}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-bold text-emerald-500">
                      {formatCurrency(totalCredits, currency, exchangeRate)}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-black text-zinc-500">
                      —
                    </td>
                    {hasPermission(profile, 'void_transaction') && (
                      <td className="px-6 py-4"></td>
                    )}
                  </tr>
                  <tr className="border-t border-zinc-800/50">
                    <td colSpan={3} className="px-6 py-2 text-right text-[10px] font-bold text-zinc-500 uppercase">Net Balance (Including Projection)</td>
                    <td colSpan={3} className={cn(
                      "px-6 py-2 text-right text-sm font-black",
                      balance > 0 ? "text-red-500" : "text-emerald-500"
                    )}>
                      {formatCurrency(Math.abs(balance), currency, exchangeRate)}
                      {balance > 0 ? " (Owing)" : balance < 0 ? " (Credit)" : " (Settled)"}
                    </td>
                    {hasPermission(profile, 'void_transaction') && (
                      <td className="px-6 py-2"></td>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Complete Guest Activity Timeline (In-line beneath Transaction Ledger) */}
          <GlobalErrorBoundary fallback={<div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl text-center text-zinc-400 text-xs">Activity timeline is currently unavailable.</div>}>
            <GuestActivityTimeline reservation={currentReservation} />
          </GlobalErrorBoundary>
          </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-4">
          <button
            onClick={() => {
              // Export CSV logic
              const headers = ['Date', 'Description', 'Category', 'Debit', 'Credit'];
              const csvContent = [
                headers.join(','),
                ...processedDisplayedEntries.map(e => [
                  safeFormatDate(e.timestamp, 'yyyy-MM-dd HH:mm'),
                  `"${typeof e.description === 'string' ? e.description : JSON.stringify(e.description || '')}"`,
                  typeof e.category === 'string' ? e.category : String((e.category as any)?.name || 'general'),
                  e.type === 'debit' ? e.amount : 0,
                  e.type === 'credit' ? e.amount : 0
                ].join(','))
              ].join('\n');
              const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
              const link = document.createElement('a');
              link.href = URL.createObjectURL(blob);
              link.download = `folio_${(currentReservation.id || '').slice(-6)}.csv`;
              link.click();
            }}
            className="flex items-center gap-2 px-6 py-3 bg-zinc-800 text-zinc-50 rounded-xl font-bold hover:bg-zinc-700 transition-all active:scale-95"
          >
            <Download size={18} />
            Export CSV
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-all active:scale-95"
          >
            Close Folio
          </button>
        </div>
      </div>

      {discountingEntry && (
        <DiscountApplication
          entry={discountingEntry}
          hotel={hotel}
          profile={profile}
          reservation={currentReservation}
          currency={currency}
          exchangeRate={exchangeRate}
          onClose={() => setDiscountingEntry(null)}
          onSuccess={() => {
            // Real-time snapshot takes care of local states, just dismiss
            setDiscountingEntry(null);
          }}
        />
      )}

      {showFolioDiscountModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-[90]">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 p-6 sm:p-8 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xl font-bold text-zinc-50 flex items-center gap-2">
                <Tag size={20} className="text-emerald-500" />
                Apply Discount
              </h3>
              <button 
                type="button"
                onClick={() => { setShowFolioDiscountModal(false); handleClearModalPromo(); }}
                className="text-zinc-500 hover:text-zinc-300 p-1 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-zinc-400 text-sm mb-5">
              Apply a promotional code or custom concession to <span className="text-zinc-200 font-semibold">{currentReservation.guestName}</span> (Room {currentReservation.roomNumber || 'Assigned'}). Posted as a folio credit.
            </p>

            {/* Quick Pick: Active Hotel Promotions */}
            {availablePromotions.length > 0 && !modalAppliedPromo && (
              <div className="mb-4 p-3 bg-zinc-950/80 border border-zinc-800/90 rounded-xl">
                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Sparkles size={13} className="text-amber-400" />
                  Available Promotions ({availablePromotions.length})
                </label>
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                  {availablePromotions.map((promo) => (
                    <button
                      key={promo.id}
                      type="button"
                      onClick={() => {
                        setModalPromoCode(promo.code);
                        handleValidateModalPromo(promo.code);
                      }}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-emerald-500/20 hover:border-emerald-500/50 border border-zinc-700 text-zinc-200 hover:text-emerald-300 transition-all text-left flex items-center gap-1.5 active:scale-95"
                    >
                      <Tag size={11} className="text-emerald-400" />
                      <span className="font-mono font-bold text-emerald-400">{promo.code}</span>
                      <span className="text-zinc-400 text-[10px]">
                        ({promo.discountType === 'percentage' ? `${promo.value}%` : formatCurrency(promo.value, currency, exchangeRate)})
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Promo Code Input & Validation */}
            <div className="mb-4">
              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">
                Promotional Code (Optional)
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={modalPromoCode}
                    onChange={(e) => {
                      setModalPromoCode(e.target.value.toUpperCase().replace(/\s+/g, ''));
                      if (modalPromoFeedback.status !== 'idle') {
                        setModalPromoFeedback({ status: 'idle' });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleValidateModalPromo();
                      }
                    }}
                    placeholder="e.g. GUEST"
                    disabled={isValidatingModalPromo || !!modalAppliedPromo}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 font-mono text-zinc-50 focus:border-emerald-500 outline-none uppercase placeholder:font-sans placeholder:normal-case disabled:opacity-60"
                  />
                  {modalAppliedPromo && (
                    <CheckCircle2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500" />
                  )}
                </div>
                {modalAppliedPromo ? (
                  <button
                    type="button"
                    onClick={handleClearModalPromo}
                    className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold transition-all"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleValidateModalPromo()}
                    disabled={isValidatingModalPromo || !modalPromoCode.trim()}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {isValidatingModalPromo ? <Loader2 size={14} className="animate-spin" /> : 'Apply'}
                  </button>
                )}
              </div>

              {/* Promo Applied Summary Card */}
              {modalAppliedPromo && (
                <div className="mt-2.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs">
                  <div className="flex items-center justify-between font-bold text-emerald-400 mb-1">
                    <span className="flex items-center gap-1.5">
                      <Sparkles size={14} />
                      Code "{modalAppliedPromo.code}" Applied: {modalAppliedPromo.name}
                    </span>
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                      Active
                    </span>
                  </div>
                  <p className="text-zinc-300 text-[11px]">
                    Discount Price Limit: <span className="font-bold text-emerald-300">{formatCurrency(modalPromoLimit || 0, currency, exchangeRate)}</span> {modalAppliedPromo.discountType === 'percentage' ? `(${modalAppliedPromo.value}%)` : '(Fixed Amount)'}
                  </p>
                  {modalAppliedPromo.appliesTo === 'room_only' && (
                    <p className="text-[10px] text-zinc-400 mt-0.5">Applies to room charges only.</p>
                  )}
                </div>
              )}

              {/* Validation Failure Card */}
              {modalPromoFeedback.status === 'invalid' && (
                <div className="mt-2 p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-start gap-2">
                  <AlertCircle size={15} className="shrink-0 mt-0.5" />
                  <span>{modalPromoFeedback.message}</span>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Discount Type</label>
                <div className="flex gap-2 p-1 bg-zinc-950 border border-zinc-800 rounded-xl">
                  <button
                    type="button"
                    disabled={!!modalAppliedPromo}
                    onClick={() => setDiscountData({ ...discountData, type: 'fixed' })}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-xs font-bold transition-all",
                      discountData.type === 'fixed' ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-400",
                      modalAppliedPromo && "opacity-75 cursor-not-allowed"
                    )}
                  >
                    Fixed Amount
                  </button>
                  <button
                    type="button"
                    disabled={!!modalAppliedPromo}
                    onClick={() => setDiscountData({ ...discountData, type: 'percentage' })}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-xs font-bold transition-all",
                      discountData.type === 'percentage' ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-400",
                      modalAppliedPromo && "opacity-75 cursor-not-allowed"
                    )}
                  >
                    Percentage (%)
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-zinc-500 uppercase">
                    {discountData.type === 'fixed' ? `Discount Amount (${currency})` : 'Discount Percentage (%)'}
                  </label>
                  {modalAppliedPromo && modalPromoLimit !== null && (
                    <span className="text-[10px] text-emerald-400 font-bold">
                      Price Limit: {formatCurrency(modalPromoLimit, currency, exchangeRate)}
                    </span>
                  )}
                </div>
                <input 
                  type="number"
                  value={discountData.type === 'fixed' && currency === 'USD' ? (discountData.amount / exchangeRate) || '' : discountData.amount || ''}
                  onChange={(e) => {
                    const rawVal = parseFloat(e.target.value) || 0;
                    let val = discountData.type === 'fixed' && currency === 'USD' ? rawVal * exchangeRate : rawVal;
                    
                    // Enforce price limit if promo is applied
                    if (modalAppliedPromo && modalPromoLimit !== null && discountData.type === 'fixed') {
                      if (val > modalPromoLimit) {
                        toast.error(`Discount cannot exceed the promotional limit of ${formatCurrency(modalPromoLimit, currency, exchangeRate)}`);
                        val = modalPromoLimit;
                      }
                    }
                    
                    setDiscountData({ 
                      ...discountData, 
                      amount: val 
                    });
                  }}
                  readOnly={!!modalAppliedPromo && discountData.type === 'fixed'}
                  className={cn(
                    "w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none",
                    modalAppliedPromo && discountData.type === 'fixed' && "bg-zinc-900/80 border-emerald-500/40 text-emerald-300 font-bold"
                  )}
                  placeholder="0.00"
                />
                {modalAppliedPromo && (
                  <p className="text-[10px] text-zinc-400 mt-1">
                    🔒 Price locked to promotion limit of {formatCurrency(modalPromoLimit || 0, currency, exchangeRate)}.
                  </p>
                )}
                {discountData.type === 'percentage' && discountData.amount > 0 && (
                  <p className="text-[10px] text-emerald-500 mt-1 font-bold">
                    Calculated Discount: {formatCurrency((currentReservation.totalAmount * discountData.amount) / 100, currency, exchangeRate)}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Reason / Notes</label>
                <textarea 
                  value={discountData.reason}
                  onChange={(e) => setDiscountData({ ...discountData, reason: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none h-20 resize-none text-sm"
                  placeholder="e.g. Promo Code [GUEST], Compensation for noise..."
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => { setShowFolioDiscountModal(false); handleClearModalPromo(); }}
                className="flex-1 py-3 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyFolioDiscount}
                disabled={isSaving || !discountData.amount || !discountData.reason}
                className="flex-1 py-3 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50"
              >
                {isSaving ? 'Applying...' : 'Apply Discount'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {showDiagnosticModal && (
        <LedgerAuditErrorBoundary
          folioId={currentReservation?.id}
          guestId={currentReservation?.guestId}
          onClose={() => setShowDiagnosticModal(false)}
        >
          <LedgerDiagnosticModal
            isOpen={showDiagnosticModal}
            onClose={() => setShowDiagnosticModal(false)}
            reservation={currentReservation}
            guest={guest}
            hotel={hotel}
            ledgerEntries={ledgerEntries}
            currency={currency}
            exchangeRate={exchangeRate}
            onPurgeInvalidEntries={async (entryIds) => {
              if (hotel?.id) {
                await purgeCorruptedLedgerEntries(hotel.id, entryIds);
                toast.success(`Purged ${entryIds.length} invalid ledger entry(ies).`);
              }
            }}
          />
        </LedgerAuditErrorBoundary>
      )}

      {showExtendGraceModal && hotel && (
        <ExtendGracePeriodModal
          isOpen={showExtendGraceModal}
          onClose={() => setShowExtendGraceModal(false)}
          reservation={currentReservation}
          hotel={hotel}
          currentUser={profile}
          onSuccess={() => {
            toast.success('Grace period updated successfully.');
          }}
        />
      )}

      <ConfirmModal
        isOpen={!!confirmDelete}
        title="Void Transaction"
        message={`Are you sure you want to void the transaction "${confirmDelete?.description}"? This will create a reversal entry in the ledger to maintain the audit trail.`}
        onConfirm={handleVoidEntry}
        onCancel={() => setConfirmDelete(null)}
        confirmText="Void Transaction"
        type="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
