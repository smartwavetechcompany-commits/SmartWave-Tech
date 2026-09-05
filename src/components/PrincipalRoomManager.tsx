import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Reservation, Room, LedgerEntry } from '../types';
import { 
  Building2, 
  Bed, 
  Users, 
  DollarSign, 
  Plus, 
  Trash2, 
  ArrowRightLeft, 
  LogOut, 
  FileText, 
  CreditCard, 
  CheckCircle2, 
  AlertCircle, 
  Receipt, 
  X, 
  Split,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';
import { cn, formatCurrency } from '../utils';
import { format, parseISO } from 'date-fns';
import { principalRoomService, GroupFinancialSummary } from '../services/principalRoomService';
import { ReceiptGenerator } from './ReceiptGenerator';
import { toast } from 'sonner';

interface PrincipalRoomManagerProps {
  currentReservation: Reservation;
  onClose: () => void;
  onRefresh?: () => void;
}

export function PrincipalRoomManager({
  currentReservation,
  onClose,
  onRefresh
}: PrincipalRoomManagerProps) {
  const { hotel, profile, currency, exchangeRate } = useAuth();
  const [allReservations, setAllReservations] = useState<Reservation[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals & tabs
  const [activeTab, setActiveTab] = useState<'overview' | 'charges' | 'payments' | 'checkout' | 'grouping'>('overview');
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState<{ isOpen: boolean; childReservation?: Reservation }>({ isOpen: false });
  const [showConsolidatedReceipt, setShowConsolidatedReceipt] = useState(false);
  const [selectedInvoiceRoom, setSelectedInvoiceRoom] = useState<Reservation | null>(null);

  // Group Payment state
  const [paymentSplits, setPaymentSplits] = useState<Array<{ amount: number; method: 'cash' | 'card' | 'transfer'; referenceCode?: string }>>([
    { amount: 0, method: 'cash', referenceCode: '' }
  ]);
  const [paymentNotes, setPaymentNotes] = useState('');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  // Room linking selection
  const [selectedChildResId, setSelectedChildResId] = useState('');
  const [isLinking, setIsLinking] = useState(false);

  // Listen to active in-house reservations
  useEffect(() => {
    if (!hotel?.id) return;
    const resRef = collection(db, 'hotels', hotel.id, 'reservations');
    const q = query(resRef, where('status', 'in', ['checked_in', 'confirmed']));

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Reservation));
      setAllReservations(data);
      setLoading(false);
    });

    return () => unsub();
  }, [hotel?.id]);

  // Listen to ledger entries
  useEffect(() => {
    if (!hotel?.id) return;
    const ledgerRef = collection(db, 'hotels', hotel.id, 'ledger');

    const unsub = onSnapshot(ledgerRef, (snap) => {
      const entries = snap.docs.map(d => ({ id: d.id, ...d.data() } as LedgerEntry));
      setLedgerEntries(entries);
    });

    return () => unsub();
  }, [hotel?.id]);

  // Determine Master and Linked reservations
  const { masterReservation, linkedReservations, isChildLinked } = useMemo(() => {
    const isChild = !!currentReservation.principalReservationId;
    let master: Reservation = currentReservation;

    if (isChild) {
      const foundMaster = allReservations.find(r => r.id === currentReservation.principalReservationId);
      if (foundMaster) {
        master = foundMaster;
      }
    }

    const linkedIds = new Set(master.linkedReservationIds || []);
    const linked = allReservations.filter(r => linkedIds.has(r.id) && r.id !== master.id);

    return {
      masterReservation: master,
      linkedReservations: linked,
      isChildLinked: isChild
    };
  }, [currentReservation, allReservations]);

  // Calculate Group Financials
  const groupFinancials: GroupFinancialSummary = useMemo(() => {
    return principalRoomService.calculateGroupFinancials(
      masterReservation,
      linkedReservations,
      ledgerEntries
    );
  }, [masterReservation, linkedReservations, ledgerEntries]);

  // Available rooms to link (checked-in or confirmed, not already master with links, not already linked)
  const availableToLink = useMemo(() => {
    const existingGroupIds = new Set([
      masterReservation.id,
      ...linkedReservations.map(r => r.id)
    ]);

    return allReservations.filter(r => {
      if (existingGroupIds.has(r.id)) return false;
      if (r.principalReservationId) return false;
      if (r.isPrincipalRoom && r.linkedReservationIds && r.linkedReservationIds.length > 0) return false;
      return true;
    });
  }, [allReservations, masterReservation, linkedReservations]);

  // Link a Room to Master
  const handleLinkRoom = async () => {
    if (!hotel?.id || !selectedChildResId) return;
    const childRes = allReservations.find(r => r.id === selectedChildResId);
    if (!childRes) return;

    setIsLinking(true);
    try {
      await principalRoomService.linkRoomsToPrincipal(
        hotel.id,
        masterReservation,
        [childRes],
        profile ? { uid: profile.uid, email: profile.email, displayName: profile.displayName || profile.email } : undefined
      );

      toast.success(`Linked Room ${childRes.roomNumber} to Master Room ${masterReservation.roomNumber}`);
      setShowLinkModal(false);
      setSelectedChildResId('');
      onRefresh?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to link room');
    } finally {
      setIsLinking(false);
    }
  };

  // Unlink a Room from Master (Split Group)
  const handleUnlinkRoom = async (childRes: Reservation) => {
    if (!hotel?.id) return;
    try {
      await principalRoomService.unlinkRoomFromPrincipal(
        hotel.id,
        masterReservation,
        childRes,
        profile ? { uid: profile.uid, email: profile.email, displayName: profile.displayName || profile.email } : undefined
      );

      toast.success(`Unlinked Room ${childRes.roomNumber} from Master Room ${masterReservation.roomNumber}`);
      onRefresh?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to unlink room');
    }
  };

  // Move Room to Another Master Group
  const handleMoveRoom = async (childRes: Reservation, newMasterId: string) => {
    if (!hotel?.id) return;
    const newMaster = allReservations.find(r => r.id === newMasterId);
    if (!newMaster) return;

    try {
      await principalRoomService.moveRoomToAnotherMaster(
        hotel.id,
        masterReservation,
        newMaster,
        childRes,
        profile ? { uid: profile.uid, email: profile.email, displayName: profile.displayName || profile.email } : undefined
      );

      toast.success(`Moved Room ${childRes.roomNumber} to Master Room ${newMaster.roomNumber}`);
      setShowMoveModal({ isOpen: false });
      onRefresh?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to move room');
    }
  };

  // Process Group Payment
  const handleGroupPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id) return;

    const totalToPay = paymentSplits.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    if (totalToPay <= 0) {
      toast.error('Payment amount must be greater than zero');
      return;
    }

    setIsProcessingPayment(true);
    try {
      await principalRoomService.postGroupPayment(
        hotel.id,
        masterReservation,
        paymentSplits,
        { uid: profile?.uid || 'staff', name: profile?.displayName || profile?.email || 'Staff' },
        { notes: paymentNotes, isConsolidated: true }
      );

      toast.success(`Group payment of ${formatCurrency(totalToPay, currency, exchangeRate)} recorded to Master Folio`);
      setPaymentSplits([{ amount: 0, method: 'cash', referenceCode: '' }]);
      setPaymentNotes('');
      setActiveTab('overview');
    } catch (err: any) {
      toast.error('Failed to post group payment');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  // Checkout modes: 'entire_group' | 'master_only' | 'linked_only'
  const handleGroupCheckout = async (mode: 'entire_group' | 'master_only' | 'linked_only', targetChildId?: string) => {
    if (!hotel?.id) return;

    if (groupFinancials.groupNetBalance > 0.05 && mode === 'entire_group') {
      if (!window.confirm(`Warning: The group has an outstanding balance of ${formatCurrency(groupFinancials.groupNetBalance, currency, exchangeRate)}. Proceed with checkout?`)) {
        return;
      }
    }

    try {
      const allInGroup = [masterReservation, ...linkedReservations];
      const result = await principalRoomService.checkoutGroup(
        hotel.id,
        masterReservation,
        allInGroup,
        mode,
        targetChildId,
        profile ? { uid: profile.uid, email: profile.email, displayName: profile.displayName || profile.email } : undefined
      );

      toast.success(result.message);
      onClose();
      onRefresh?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to process group checkout');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
              <Building2 size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold text-zinc-50">
                  Principal / Master Room Management
                </h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold">
                  Master Room {masterReservation.roomNumber}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Principal Guest: <strong className="text-zinc-200">{masterReservation.guestName}</strong> • Linked Rooms: {linkedReservations.length}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-zinc-800 bg-zinc-950/20 px-6 gap-2 text-xs font-semibold overflow-x-auto">
          <button
            onClick={() => setActiveTab('overview')}
            className={cn(
              "py-3 px-3 border-b-2 transition-all whitespace-nowrap",
              activeTab === 'overview' ? "border-amber-500 text-amber-400" : "border-transparent text-zinc-400 hover:text-zinc-200"
            )}
          >
            Overview & Group Rooms
          </button>
          <button
            onClick={() => setActiveTab('charges')}
            className={cn(
              "py-3 px-3 border-b-2 transition-all whitespace-nowrap",
              activeTab === 'charges' ? "border-amber-500 text-amber-400" : "border-transparent text-zinc-400 hover:text-zinc-200"
            )}
          >
            Charge Breakdown by Room ({groupFinancials.allGroupEntries.length})
          </button>
          <button
            onClick={() => setActiveTab('payments')}
            className={cn(
              "py-3 px-3 border-b-2 transition-all whitespace-nowrap",
              activeTab === 'payments' ? "border-amber-500 text-amber-400" : "border-transparent text-zinc-400 hover:text-zinc-200"
            )}
          >
            Group & Split Payments
          </button>
          <button
            onClick={() => setActiveTab('checkout')}
            className={cn(
              "py-3 px-3 border-b-2 transition-all whitespace-nowrap",
              activeTab === 'checkout' ? "border-amber-500 text-amber-400" : "border-transparent text-zinc-400 hover:text-zinc-200"
            )}
          >
            Checkout Controls
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Financial Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-4">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Group Total Charges</span>
                  <div className="text-2xl font-black text-zinc-50 mt-1">
                    {formatCurrency(groupFinancials.groupTotalCharges, currency, exchangeRate)}
                  </div>
                  <span className="text-[11px] text-zinc-400">Master + {linkedReservations.length} Linked Rooms</span>
                </div>

                <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-4">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Total Payments Settled</span>
                  <div className="text-2xl font-black text-emerald-400 mt-1">
                    {formatCurrency(groupFinancials.groupTotalPayments, currency, exchangeRate)}
                  </div>
                  <span className="text-[11px] text-zinc-400">Posted to Master Folio</span>
                </div>

                <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-4">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Consolidated Net Balance</span>
                  <div className={cn(
                    "text-2xl font-black mt-1",
                    groupFinancials.groupNetBalance > 0 ? "text-amber-400" : "text-emerald-400"
                  )}>
                    {formatCurrency(groupFinancials.groupNetBalance, currency, exchangeRate)}
                  </div>
                  <span className="text-[11px] text-zinc-400">
                    {groupFinancials.groupNetBalance > 0 ? 'Due for Settlement' : 'Fully Settled'}
                  </span>
                </div>
              </div>

              {/* Master & Linked Rooms Breakdown List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
                    <Bed size={16} className="text-amber-400" />
                    Rooms in This Group ({linkedReservations.length + 1})
                  </h4>
                  <button
                    onClick={() => setShowLinkModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-black rounded-lg text-xs font-bold transition-all"
                  >
                    <Plus size={14} />
                    <span>Link Another Room</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {/* Master Room Card */}
                  <div className="bg-amber-950/20 border border-amber-500/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-300 font-bold flex items-center justify-center text-sm">
                        {masterReservation.roomNumber}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <strong className="text-zinc-100 text-sm">{masterReservation.guestName}</strong>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500 text-black font-extrabold uppercase">
                            Principal / Master Room
                          </span>
                        </div>
                        <div className="text-xs text-zinc-400 mt-0.5">
                          Status: <span className="text-emerald-400 uppercase font-semibold">{masterReservation.status}</span> • Dates: {masterReservation.checkIn} - {masterReservation.checkOut}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-xs text-zinc-400">Room Balance</div>
                        <div className="text-sm font-bold text-zinc-100">
                          {formatCurrency(groupFinancials.chargesByRoom[masterReservation.roomNumber]?.balance || 0, currency, exchangeRate)}
                        </div>
                      </div>

                      <button
                        onClick={() => setSelectedInvoiceRoom(masterReservation)}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-semibold flex items-center gap-1"
                      >
                        <Receipt size={13} />
                        <span>Room Invoice</span>
                      </button>
                    </div>
                  </div>

                  {/* Linked Room Cards */}
                  {linkedReservations.length === 0 ? (
                    <div className="p-6 bg-zinc-950/40 border border-dashed border-zinc-800 rounded-xl text-center text-xs text-zinc-500">
                      No other rooms are currently linked to this Principal Room. Click "Link Another Room" to group rooms.
                    </div>
                  ) : (
                    linkedReservations.map((child) => {
                      const childSummary = groupFinancials.chargesByRoom[child.roomNumber];

                      return (
                        <div key={child.id} className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-300 font-bold flex items-center justify-center text-sm border border-blue-500/20">
                              {child.roomNumber}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <strong className="text-zinc-100 text-sm">{child.guestName}</strong>
                                <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-semibold">
                                  Linked Room
                                </span>
                              </div>
                              <div className="text-xs text-zinc-400 mt-0.5">
                                Status: <span className="text-emerald-400 uppercase font-semibold">{child.status}</span> • Dates: {child.checkIn} - {child.checkOut}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="text-xs text-zinc-400">Total Charges</div>
                              <div className="text-sm font-bold text-zinc-100">
                                {formatCurrency(childSummary?.totalCharges || 0, currency, exchangeRate)}
                              </div>
                            </div>

                            <button
                              onClick={() => setSelectedInvoiceRoom(child)}
                              className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-semibold flex items-center gap-1"
                              title="Separate Room Invoice"
                            >
                              <Receipt size={13} />
                              <span>Separate Inv</span>
                            </button>

                            <button
                              onClick={() => setShowMoveModal({ isOpen: true, childReservation: child })}
                              className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-semibold flex items-center gap-1"
                              title="Move Room to Another Group"
                            >
                              <ArrowRightLeft size={13} />
                              <span>Move</span>
                            </button>

                            <button
                              onClick={() => handleUnlinkRoom(child)}
                              className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                              title="Unlink Room (Split Group)"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Invoice Generation Buttons */}
              <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800">
                <div className="text-xs text-zinc-400">
                  Generate combined group documentation or separate itemized folios for individual guests.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowConsolidatedReceipt(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black rounded-xl text-xs font-bold transition-all shadow-sm"
                  >
                    <FileText size={15} />
                    <span>Generate Consolidated Invoice</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CHARGE BREAKDOWN BY ROOM */}
          {activeTab === 'charges' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>
                  All accommodation, restaurant, laundry, and service charges from linked rooms automatically flow into the Master Folio.
                </span>
              </div>

              <div className="border border-zinc-800 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950 text-zinc-400 uppercase tracking-wider text-[10px] border-b border-zinc-800">
                    <tr>
                      <th className="py-3 px-4 font-bold">Source Room</th>
                      <th className="py-3 px-4 font-bold">Charge Description</th>
                      <th className="py-3 px-4 font-bold">Category</th>
                      <th className="py-3 px-4 font-bold">Date & Time</th>
                      <th className="py-3 px-4 font-bold">Posted By</th>
                      <th className="py-3 px-4 font-bold text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                    {groupFinancials.allGroupEntries.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-zinc-500">
                          No charges recorded for this room group yet.
                        </td>
                      </tr>
                    ) : (
                      groupFinancials.allGroupEntries.map((entry) => (
                        <tr key={entry.id} className="hover:bg-zinc-800/30">
                          <td className="py-2.5 px-4 font-bold text-zinc-100">
                            <span className={cn(
                              "px-2 py-0.5 rounded font-mono text-[11px]",
                              entry.sourceRoomNumber === masterReservation.roomNumber
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                            )}>
                              Room {entry.sourceRoomNumber}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 font-medium text-zinc-100">
                            {entry.description}
                          </td>
                          <td className="py-2.5 px-4 uppercase text-[10px] font-bold text-zinc-400">
                            {entry.category}
                          </td>
                          <td className="py-2.5 px-4 text-zinc-400 text-[11px]">
                            {entry.date ? format(new Date(entry.date), 'MMM dd, HH:mm') : '-'}
                          </td>
                          <td className="py-2.5 px-4 text-zinc-400">
                            {entry.postedByName || entry.postedBy || 'Staff'}
                          </td>
                          <td className={cn(
                            "py-2.5 px-4 font-mono font-bold text-right",
                            entry.type === 'credit' ? "text-emerald-400" : "text-zinc-100"
                          )}>
                            {entry.type === 'credit' ? '-' : ''}{formatCurrency(entry.amount, currency, exchangeRate)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: GROUP & SPLIT PAYMENTS */}
          {activeTab === 'payments' && (
            <form onSubmit={handleGroupPayment} className="space-y-4">
              <div className="bg-zinc-950/60 border border-zinc-800 p-4 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Consolidated Group Balance:</span>
                  <span className="font-bold text-zinc-100 text-sm">
                    {formatCurrency(groupFinancials.groupNetBalance, currency, exchangeRate)}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Payments are posted directly to the Master Folio and automatically settle the unified balance across Room {masterReservation.roomNumber} and all linked rooms.
                </p>
              </div>

              {/* Payment Splits */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-zinc-300 uppercase">Payment Splits</label>
                  <button
                    type="button"
                    onClick={() => setPaymentSplits(prev => [...prev, { amount: 0, method: 'cash', referenceCode: '' }])}
                    className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1"
                  >
                    <Plus size={13} /> Add Payment Method
                  </button>
                </div>

                {paymentSplits.map((split, index) => (
                  <div key={index} className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                    <div>
                      <label className="block text-[10px] text-zinc-500 font-bold mb-1">Method</label>
                      <select
                        value={split.method}
                        onChange={(e) => {
                          const val = e.target.value as any;
                          setPaymentSplits(prev => prev.map((s, i) => i === index ? { ...s, method: val } : s));
                        }}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 outline-none"
                      >
                        <option value="cash">Cash</option>
                        <option value="card">Card / POS</option>
                        <option value="transfer">Bank Transfer</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-zinc-500 font-bold mb-1">Amount</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={split.amount || ''}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setPaymentSplits(prev => prev.map((s, i) => i === index ? { ...s, amount: val } : s));
                        }}
                        placeholder="0.00"
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 outline-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-zinc-500 font-bold mb-1">Ref / Auth Code</label>
                      <input
                        type="text"
                        value={split.referenceCode || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPaymentSplits(prev => prev.map((s, i) => i === index ? { ...s, referenceCode: val } : s));
                        }}
                        placeholder="Optional code"
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="Optional settlement notes..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 outline-none resize-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="submit"
                  disabled={isProcessingPayment}
                  className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-black font-bold rounded-xl text-xs transition-all shadow-md"
                >
                  {isProcessingPayment ? 'Processing...' : 'Post Group Payment'}
                </button>
              </div>
            </form>
          )}

          {/* TAB 4: CHECKOUT CONTROLS */}
          {activeTab === 'checkout' && (
            <div className="space-y-6">
              <div className="bg-zinc-950/60 border border-zinc-800 p-4 rounded-xl space-y-1">
                <h4 className="text-xs font-bold text-zinc-200">Group Checkout Actions</h4>
                <p className="text-[11px] text-zinc-400">
                  Select whether to checkout the entire group simultaneously or release rooms individually.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Checkout Entire Group */}
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 space-y-3 flex flex-col justify-between">
                  <div>
                    <h5 className="font-bold text-zinc-100 text-sm flex items-center gap-2">
                      <Users size={16} className="text-emerald-400" />
                      Checkout Entire Group
                    </h5>
                    <p className="text-xs text-zinc-400 mt-1">
                      Simultaneously checks out Master Room {masterReservation.roomNumber} and all {linkedReservations.length} linked rooms. Marks all rooms as dirty for housekeeping.
                    </p>
                  </div>
                  <button
                    onClick={() => handleGroupCheckout('entire_group')}
                    className="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl text-xs transition-all"
                  >
                    Checkout Entire Group ({linkedReservations.length + 1} Rooms)
                  </button>
                </div>

                {/* Checkout Master Room Only */}
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 space-y-3 flex flex-col justify-between">
                  <div>
                    <h5 className="font-bold text-zinc-100 text-sm flex items-center gap-2">
                      <Bed size={16} className="text-amber-400" />
                      Checkout Master Room Only
                    </h5>
                    <p className="text-xs text-zinc-400 mt-1">
                      Checks out only Room {masterReservation.roomNumber}. Linked rooms remain in-house and active.
                    </p>
                  </div>
                  <button
                    onClick={() => handleGroupCheckout('master_only')}
                    className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold rounded-xl text-xs transition-all"
                  >
                    Checkout Master Room {masterReservation.roomNumber} Only
                  </button>
                </div>
              </div>

              {/* Individual Linked Rooms Checkout List */}
              {linkedReservations.length > 0 && (
                <div className="space-y-2 pt-2">
                  <h5 className="text-xs font-bold text-zinc-300 uppercase">Checkout Individual Linked Room</h5>
                  <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950/40">
                    {linkedReservations.map((child) => (
                      <div key={child.id} className="p-3.5 flex items-center justify-between text-xs">
                        <div>
                          <strong className="text-zinc-100">Room {child.roomNumber}</strong> - {child.guestName}
                        </div>
                        <button
                          onClick={() => handleGroupCheckout('linked_only', child.id)}
                          className="px-3 py-1.5 bg-zinc-800 hover:bg-red-500 hover:text-white text-zinc-300 rounded-lg text-xs font-semibold transition-all"
                        >
                          Checkout Room {child.roomNumber}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* MODAL: LINK ANOTHER ROOM */}
      {showLinkModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 z-60">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h4 className="font-bold text-zinc-50">Link Room to Master Room {masterReservation.roomNumber}</h4>
              <button onClick={() => setShowLinkModal(false)} className="text-zinc-400 hover:text-zinc-100">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-zinc-400">
                Select an active checked-in or confirmed room to link under Master Room {masterReservation.roomNumber}.
              </p>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Available Rooms</label>
                {availableToLink.length === 0 ? (
                  <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-500">
                    No available rooms to link.
                  </div>
                ) : (
                  <select
                    value={selectedChildResId}
                    onChange={(e) => setSelectedChildResId(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-amber-500"
                  >
                    <option value="">Select a room to link...</option>
                    {availableToLink.map(r => (
                      <option key={r.id} value={r.id}>
                        Room {r.roomNumber} - {r.guestName} ({r.status.toUpperCase()})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
              <button
                onClick={() => setShowLinkModal(false)}
                className="px-4 py-2 text-zinc-400 hover:text-zinc-100 font-semibold text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleLinkRoom}
                disabled={!selectedChildResId || isLinking}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-black font-bold rounded-xl text-xs transition-all"
              >
                {isLinking ? 'Linking...' : 'Confirm Link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: MOVE ROOM TO ANOTHER MASTER GROUP */}
      {showMoveModal.isOpen && showMoveModal.childReservation && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 z-60">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h4 className="font-bold text-zinc-50">
                Move Room {showMoveModal.childReservation.roomNumber} to Another Group
              </h4>
              <button onClick={() => setShowMoveModal({ isOpen: false })} className="text-zinc-400 hover:text-zinc-100">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-zinc-400">
                Select the target Principal / Master Room to transfer Room {showMoveModal.childReservation.roomNumber} into.
              </p>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Target Master Room</label>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {allReservations
                    .filter(r => r.id !== masterReservation.id && r.id !== showMoveModal.childReservation?.id)
                    .map(targetMaster => (
                      <button
                        key={targetMaster.id}
                        onClick={() => handleMoveRoom(showMoveModal.childReservation!, targetMaster.id)}
                        className="w-full text-left p-3 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 transition-all flex items-center justify-between"
                      >
                        <div>
                          <strong className="text-zinc-100">Room {targetMaster.roomNumber}</strong> - {targetMaster.guestName}
                        </div>
                        <span className="text-[10px] text-amber-400 font-semibold">Select</span>
                      </button>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONSOLIDATED INVOICE MODAL */}
      {showConsolidatedReceipt && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 z-70">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-zinc-900 rounded-2xl border border-zinc-800 p-6 relative">
            <button
              onClick={() => setShowConsolidatedReceipt(false)}
              className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-full"
            >
              <X size={20} />
            </button>
            <div className="mb-4">
              <h3 className="text-xl font-bold text-zinc-100">Consolidated Master Invoice</h3>
              <p className="text-xs text-zinc-400">
                Covers Master Room {masterReservation.roomNumber} + Linked Rooms: {linkedReservations.map(r => r.roomNumber).join(', ')}
              </p>
            </div>
            <ReceiptGenerator
              hotel={hotel!}
              reservation={masterReservation}
              type="comprehensive"
              ledgerEntries={ledgerEntries.filter(e => {
                const groupIds = new Set([masterReservation.id, ...linkedReservations.map(r => r.id)]);
                return (
                  (e.reservationId && groupIds.has(e.reservationId)) ||
                  e.masterReservationId === masterReservation.id ||
                  (e.sourceReservationId && groupIds.has(e.sourceReservationId))
                );
              })}
            />
          </div>
        </div>
      )}

      {/* SEPARATE ROOM INVOICE MODAL */}
      {selectedInvoiceRoom && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 z-70">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-zinc-900 rounded-2xl border border-zinc-800 p-6 relative">
            <button
              onClick={() => setSelectedInvoiceRoom(null)}
              className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-full"
            >
              <X size={20} />
            </button>
            <div className="mb-4">
              <h3 className="text-xl font-bold text-zinc-100">
                Individual Room Invoice - Room {selectedInvoiceRoom.roomNumber}
              </h3>
              <p className="text-xs text-zinc-400">
                Guest: {selectedInvoiceRoom.guestName}
              </p>
            </div>
            <ReceiptGenerator
              hotel={hotel!}
              reservation={selectedInvoiceRoom}
              type="comprehensive"
              ledgerEntries={ledgerEntries.filter(e => 
                e.reservationId === selectedInvoiceRoom.id ||
                e.sourceReservationId === selectedInvoiceRoom.id ||
                e.sourceRoomNumber === selectedInvoiceRoom.roomNumber
              )}
            />
          </div>
        </div>
      )}
    </div>
  );
}
