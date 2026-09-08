import React, { useState, useEffect, useMemo } from 'react';
import { 
  DollarSign, 
  Search, 
  Filter, 
  ArrowUpRight, 
  Download, 
  Printer, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  AlertTriangle, 
  User, 
  Building, 
  FileText, 
  ShieldAlert, 
  ChevronRight, 
  RefreshCw, 
  CreditCard, 
  X, 
  History, 
  BadgePercent,
  Layers,
  Wrench
} from 'lucide-react';
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { OutstandingDebt, OutstandingDebtAuditEntry, CorporateAccount, Guest } from '../types';
import { formatCurrency } from '../utils';
import { 
  getOutstandingDebts, 
  receiveDebtPayment, 
  transferDebt, 
  writeOffDebt, 
  adjustDebt,
  repairErroneousFolioCredit 
} from '../services/debtService';
import { hasPermission } from '../utils/permissions';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';

interface OutstandingGuestLedgerProps {
  hotel: any;
  profile: any;
  currency?: 'NGN' | 'USD';
  exchangeRate?: number;
}

export const OutstandingGuestLedger: React.FC<OutstandingGuestLedgerProps> = ({
  hotel,
  profile,
  currency = 'NGN',
  exchangeRate = 1
}) => {
  const [debts, setDebts] = useState<OutstandingDebt[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<'all_active' | '0-30' | '31-60' | '61-90' | '90+' | 'paid' | 'transferred' | 'written_off' | 'all'>('all_active');
  const [corporateAccounts, setCorporateAccounts] = useState<CorporateAccount[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  
  // Modals
  const [activePaymentDebt, setActivePaymentDebt] = useState<OutstandingDebt | null>(null);
  const [activeTransferDebt, setActiveTransferDebt] = useState<OutstandingDebt | null>(null);
  const [activeWriteOffDebt, setActiveWriteOffDebt] = useState<OutstandingDebt | null>(null);
  const [activeAuditDebt, setActiveAuditDebt] = useState<OutstandingDebt | null>(null);

  // Form states
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [paymentNotes, setPaymentNotes] = useState('');

  const [transferType, setTransferType] = useState<'corporate' | 'city_ledger' | 'house_account' | 'travel_agent' | 'master_folio'>('corporate');
  const [transferTargetId, setTransferTargetId] = useState('');
  const [transferTargetName, setTransferTargetName] = useState('');
  const [transferAmount, setTransferAmount] = useState<number>(0);
  const [transferNotes, setTransferNotes] = useState('');

  const [writeOffType, setWriteOffType] = useState<'write_off' | 'reduction' | 'increase'>('write_off');
  const [writeOffAmount, setWriteOffAmount] = useState<number>(0);
  const [writeOffReason, setWriteOffReason] = useState('Uncollectible / Bad Debt');
  const [writeOffCustomReason, setWriteOffCustomReason] = useState('');
  const [writeOffApprovedBy, setWriteOffApprovedBy] = useState(profile?.displayName || profile?.name || 'General Manager');
  const [writeOffNotes, setWriteOffNotes] = useState('');

  const [actionLoading, setActionLoading] = useState(false);
  const [repairingId, setRepairingId] = useState<string | null>(null);

  // Permissions
  const canWriteOff = profile?.role === 'superAdmin' || profile?.role === 'hotelAdmin' || hasPermission(profile, 'write_off_debt');
  const canAdjust = profile?.role === 'superAdmin' || profile?.role === 'hotelAdmin' || hasPermission(profile, 'adjust_debt');
  const canTransfer = profile?.role === 'superAdmin' || profile?.role === 'hotelAdmin' || hasPermission(profile, 'transfer_debt');

  const hotelDisplayName = hotel?.branding?.name || hotel?.name || 'Grand Hotel PMS';
  const primaryColor = hotel?.branding?.primaryColor || '#10b981';

  const loadDebts = async () => {
    if (!hotel?.id) return;
    try {
      setLoading(true);
      const data = await getOutstandingDebts(hotel.id);
      setDebts(data);

      // Load corporate accounts for identification & transfer dropdown
      const corpRef = collection(db, 'hotels', hotel.id, 'corporate_accounts');
      const corpSnap = await getDocs(corpRef);
      const corps = corpSnap.docs.map(d => ({ id: d.id, ...d.data() } as CorporateAccount));
      setCorporateAccounts(corps);

      // Load guests to determine corporate guest profile linkage
      const guestsRef = collection(db, 'hotels', hotel.id, 'guests');
      const guestsSnap = await getDocs(guestsRef);
      const guestList = guestsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Guest));
      setGuests(guestList);
    } catch (err: any) {
      console.error("Failed to load outstanding debts:", err);
      toast.error("Failed to load debts: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Helper to detect if debtor is associated with a corporate account
  const getCorporateInfo = (debt: OutstandingDebt) => {
    const linkedGuest = guests.find(g => g.id === debt.guestId);
    const corpId = debt.corporateId || linkedGuest?.corporateId;
    const isCorp = Boolean(
      corpId || 
      debt.corporateName || 
      debt.transferredTo?.type === 'corporate' || 
      linkedGuest?.tags?.includes('Corporate') ||
      corporateAccounts.some(c => c.name.toLowerCase() === debt.guestName?.toLowerCase())
    );
    const corpName = 
      debt.corporateName || 
      corporateAccounts.find(c => c.id === corpId)?.name || 
      debt.transferredTo?.targetName || 
      (linkedGuest?.tags?.includes('Corporate') ? 'Corporate Account' : null);

    return { isCorp, corpName };
  };

  useEffect(() => {
    loadDebts();
  }, [hotel?.id]);

  // Statistics
  const stats = useMemo(() => {
    const activeDebts = debts.filter(d => d.status === 'outstanding' || d.status === 'partially_paid');
    const totalOutstanding = activeDebts.reduce((sum, d) => sum + (d.outstandingAmount || 0), 0);
    const activeDebtorsCount = new Set(activeDebts.map(d => d.guestId || d.guestName)).size;
    const overdue30Plus = activeDebts
      .filter(d => (d.agingDays || 0) > 30)
      .reduce((sum, d) => sum + (d.outstandingAmount || 0), 0);
    const resolvedCount = debts.filter(d => d.status === 'paid' || d.status === 'transferred' || d.status === 'written_off').length;
    const totalOriginalDebt = debts.reduce((sum, d) => sum + (d.originalDebt || 0), 0);
    const totalCollected = debts.reduce((sum, d) => {
      const paid = (d.originalDebt || 0) - (d.outstandingAmount || 0);
      return sum + (paid > 0 ? paid : 0);
    }, 0);

    return {
      totalOutstanding,
      activeDebtorsCount,
      overdue30Plus,
      resolvedCount,
      totalOriginalDebt,
      totalCollected
    };
  }, [debts]);

  // Filtering
  const filteredDebts = useMemo(() => {
    return debts.filter(d => {
      // Search match
      const queryStr = searchTerm.toLowerCase().trim();
      const matchesSearch = 
        !queryStr ||
        d.guestName?.toLowerCase().includes(queryStr) ||
        d.folioNumber?.toLowerCase().includes(queryStr) ||
        d.roomNumber?.toLowerCase().includes(queryStr) ||
        d.guestPhone?.includes(queryStr) ||
        d.guestEmail?.toLowerCase().includes(queryStr);

      if (!matchesSearch) return false;

      // Status/Aging filter
      if (selectedFilter === 'all_active') {
        return (d.status === 'outstanding' || d.status === 'partially_paid') && d.outstandingAmount > 0.01;
      }
      if (selectedFilter === '0-30') {
        return (d.status === 'outstanding' || d.status === 'partially_paid') && (d.agingDays || 0) <= 30;
      }
      if (selectedFilter === '31-60') {
        return (d.status === 'outstanding' || d.status === 'partially_paid') && (d.agingDays || 0) > 30 && (d.agingDays || 0) <= 60;
      }
      if (selectedFilter === '61-90') {
        return (d.status === 'outstanding' || d.status === 'partially_paid') && (d.agingDays || 0) > 60 && (d.agingDays || 0) <= 90;
      }
      if (selectedFilter === '90+') {
        return (d.status === 'outstanding' || d.status === 'partially_paid') && (d.agingDays || 0) > 90;
      }
      if (selectedFilter === 'paid') {
        return d.status === 'paid' || d.outstandingAmount <= 0.01;
      }
      if (selectedFilter === 'transferred') {
        return d.status === 'transferred';
      }
      if (selectedFilter === 'written_off') {
        return d.status === 'written_off';
      }
      return true;
    });
  }, [debts, searchTerm, selectedFilter]);

  // Export CSV / Excel
  const handleExportCSV = () => {
    if (filteredDebts.length === 0) {
      toast.error("No debt records to export.");
      return;
    }

    const headers = [
      "Folio Number",
      "Guest Name",
      "Guest Type",
      "Corporate Account",
      "Room Number",
      "Checkout Date",
      "Aging Days",
      `Original Debt (${currency})`,
      `Outstanding Amount (${currency})`,
      "Status",
      "Phone",
      "Email",
      "Transferred To",
      "Notes"
    ];

    const rows = filteredDebts.map(d => {
      const { isCorp, corpName } = getCorporateInfo(d);
      return [
        `"${d.folioNumber || ''}"`,
        `"${d.guestName || ''}"`,
        `"${isCorp ? 'Corporate' : 'Individual'}"`,
        `"${corpName || ''}"`,
        `"Room ${d.roomNumber || 'N/A'}"`,
        `"${d.checkoutDate || ''}"`,
        d.agingDays || 0,
        d.originalDebt || 0,
        d.outstandingAmount || 0,
        `"${d.status}"`,
        `"${d.guestPhone || ''}"`,
        `"${d.guestEmail || ''}"`,
        `"${d.transferredTo?.targetName || ''}"`,
        `"${(d.notes || '').replace(/"/g, '""')}"`
      ];
    });

    const csvContent = "data:text/csv;charset=utf-8," + 
      [`# ${hotelDisplayName} - Outstanding Guest Ledger (AR) - Generated ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
       headers.join(","),
       ...rows.map(e => e.join(","))
      ].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Outstanding_Guest_Ledger_${format(new Date(), 'yyyyMMdd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Accounts Receivable Ledger exported to CSV.");
  };

  // Print Statement
  const handlePrint = () => {
    window.print();
  };

  // Open Payment Modal
  const handleOpenPayment = (debt: OutstandingDebt) => {
    setActivePaymentDebt(debt);
    setPaymentAmount(debt.outstandingAmount);
    setPaymentMethod('cash');
    setPaymentNotes('');
  };

  const handleProcessPayment = async () => {
    if (!activePaymentDebt) return;
    try {
      if (paymentAmount <= 0) {
        toast.error("Enter a valid payment amount.");
        return;
      }
      setActionLoading(true);
      await receiveDebtPayment(
        hotel.id,
        activePaymentDebt.id,
        paymentAmount,
        paymentMethod,
        profile,
        paymentNotes
      );
      toast.success(`Payment of ${formatCurrency(paymentAmount, currency, exchangeRate)} recorded.`);
      setActivePaymentDebt(null);
      await loadDebts();
    } catch (err: any) {
      console.error("Payment failed:", err);
      toast.error(err.message || "Payment processing failed.");
    } finally {
      setActionLoading(false);
    }
  };

  // Open Transfer Modal
  const handleOpenTransfer = (debt: OutstandingDebt) => {
    setActiveTransferDebt(debt);
    setTransferAmount(debt.outstandingAmount);
    setTransferType('corporate');
    setTransferTargetId(corporateAccounts[0]?.id || '');
    setTransferTargetName(corporateAccounts[0]?.name || 'City Ledger Corporate');
    setTransferNotes('');
  };

  const handleProcessTransfer = async () => {
    if (!activeTransferDebt) return;
    try {
      if (transferAmount <= 0) {
        toast.error("Enter a valid transfer amount.");
        return;
      }
      if (!transferTargetName.trim()) {
        toast.error("Target account name is required.");
        return;
      }
      if (!transferNotes.trim()) {
        toast.error("A transfer justification note is mandatory.");
        return;
      }
      setActionLoading(true);
      await transferDebt(
        hotel.id,
        activeTransferDebt.id,
        {
          targetType: transferType,
          targetId: transferTargetId,
          targetName: transferTargetName,
          amount: transferAmount,
          notes: transferNotes
        },
        profile
      );
      toast.success(`Debt transferred to ${transferTargetName} successfully.`);
      setActiveTransferDebt(null);
      await loadDebts();
    } catch (err: any) {
      console.error("Transfer failed:", err);
      toast.error(err.message || "Transfer failed.");
    } finally {
      setActionLoading(false);
    }
  };

  // Open Write-Off Modal
  const handleOpenWriteOff = (debt: OutstandingDebt) => {
    setActiveWriteOffDebt(debt);
    setWriteOffType('write_off');
    setWriteOffAmount(debt.outstandingAmount);
    setWriteOffReason('Uncollectible / Bad Debt');
    setWriteOffCustomReason('');
    setWriteOffApprovedBy(profile?.displayName || profile?.name || 'General Manager');
    setWriteOffNotes('');
  };

  const handleProcessWriteOff = async () => {
    if (!activeWriteOffDebt) return;
    try {
      if (writeOffAmount <= 0) {
        toast.error("Amount must be greater than zero.");
        return;
      }
      const finalReason = writeOffReason === 'Other' ? writeOffCustomReason : writeOffReason;
      if (!finalReason || finalReason.trim().length < 3) {
        toast.error("Please enter a clear, specific reason.");
        return;
      }
      if (!writeOffApprovedBy.trim()) {
        toast.error("Approver name is required.");
        return;
      }

      setActionLoading(true);

      if (writeOffType === 'write_off') {
        await writeOffDebt(
          hotel.id,
          activeWriteOffDebt.id,
          {
            amount: writeOffAmount,
            reason: finalReason,
            approvedBy: writeOffApprovedBy,
            approvalNotes: writeOffNotes
          },
          profile
        );
        toast.success(`Write-off of ${formatCurrency(writeOffAmount, currency, exchangeRate)} authorized.`);
      } else {
        await adjustDebt(
          hotel.id,
          activeWriteOffDebt.id,
          {
            type: writeOffType,
            amount: writeOffAmount,
            reason: finalReason,
            approvedBy: writeOffApprovedBy
          },
          profile
        );
        toast.success(`Balance adjustment applied successfully.`);
      }

      setActiveWriteOffDebt(null);
      await loadDebts();
    } catch (err: any) {
      console.error("Write off failed:", err);
      toast.error(err.message || "Write-off authorization failed.");
    } finally {
      setActionLoading(false);
    }
  };

  // One-click repair for past reservations with erroneous checkout folio credit
  const handleRepairReservation = async (reservationId: string) => {
    try {
      setRepairingId(reservationId);
      const res = await repairErroneousFolioCredit(hotel.id, reservationId, profile);
      if (res.repaired) {
        toast.success(`Successfully repaired folio credit and restored ${formatCurrency(res.restoredAmount, currency, exchangeRate)} to Debt Ledger.`);
        await loadDebts();
      } else {
        toast.info("No erroneous checkout city ledger credit found on this reservation.");
      }
    } catch (err: any) {
      console.error("Repair failed:", err);
      toast.error(err.message || "Failed to repair reservation.");
    } finally {
      setRepairingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Brand Header */}
      <div className="bg-zinc-900 rounded-2xl p-6 border border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <div 
              className="p-2.5 rounded-xl border transition-colors"
              style={{
                backgroundColor: `${primaryColor}15`,
                borderColor: `${primaryColor}35`,
                color: primaryColor
              }}
            >
              <Building className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-2xl font-bold text-zinc-50 tracking-tight">
                  {hotelDisplayName}
                </h1>
                <span 
                  className="px-2.5 py-0.5 rounded-full text-xs font-bold border transition-colors"
                  style={{
                    backgroundColor: `${primaryColor}15`,
                    borderColor: `${primaryColor}35`,
                    color: primaryColor
                  }}
                >
                  Accounts Receivable
                </span>
              </div>
              <p className="text-zinc-400 text-xs mt-1">
                Outstanding Guest Ledger • Unpaid post-checkout balances & debt lifecycle management
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <button
            onClick={loadDebts}
            disabled={loading}
            className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-300 bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/60 rounded-xl transition-colors flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-300 bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/60 rounded-xl transition-colors flex items-center space-x-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-zinc-400" />
            <span>Export Excel</span>
          </button>

          <button
            onClick={handlePrint}
            style={{ backgroundColor: primaryColor }}
            className="px-3.5 py-2 text-[10px] font-black uppercase tracking-widest text-black hover:opacity-90 rounded-xl transition-all flex items-center space-x-1.5 cursor-pointer active:scale-95 shadow-sm"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Ledger</span>
          </button>
        </div>
      </div>

      {/* KPI Highlight Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Outstanding */}
        <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-bold uppercase tracking-wider">
            <span>Total Active AR Debt</span>
            <div className="p-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-red-400 mt-2">
            {formatCurrency(stats.totalOutstanding, currency, exchangeRate)}
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Across {stats.activeDebtorsCount} departing debtor{stats.activeDebtorsCount === 1 ? '' : 's'}
          </p>
        </div>

        {/* 30+ Days Overdue */}
        <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-bold uppercase tracking-wider">
            <span>High Risk (30+ Days)</span>
            <div className="p-2 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-xl">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-amber-400 mt-2">
            {formatCurrency(stats.overdue30Plus, currency, exchangeRate)}
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Requires follow-up or debt transfer
          </p>
        </div>

        {/* Total Collected Post-Checkout */}
        <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-bold uppercase tracking-wider">
            <span>Recovered Post-Stay</span>
            <div className="p-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-2">
            {formatCurrency(stats.totalCollected, currency, exchangeRate)}
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Cash/Card settlements received
          </p>
        </div>

        {/* Closed & Transferred */}
        <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-bold uppercase tracking-wider">
            <span>Resolved Folios</span>
            <div className="p-2 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-xl">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-zinc-100 mt-2">
            {stats.resolvedCount}
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Transferred, settled, or written off
          </p>
        </div>
      </div>

      {/* Filters & Search Toolbar */}
      <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800 space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search by Guest, Folio #, Room, Phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs border border-zinc-800 rounded-xl focus:outline-none focus:border-emerald-500/50 bg-zinc-950 text-zinc-100 placeholder:text-zinc-500"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center flex-wrap gap-1 w-full md:w-auto bg-zinc-950 p-1 rounded-xl border border-zinc-800">
            {[
              { id: 'all_active', label: 'All Active AR' },
              { id: '0-30', label: '0-30 Days (Current)' },
              { id: '31-60', label: '31-60 Days' },
              { id: '61-90', label: '61-90 Days' },
              { id: '90+', label: '90+ Days' },
              { id: 'paid', label: 'Settled / Paid' },
              { id: 'transferred', label: 'Transferred' },
              { id: 'written_off', label: 'Written Off' },
              { id: 'all', label: 'All History' }
            ].map((f) => {
              const isActive = selectedFilter === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setSelectedFilter(f.id as any)}
                  style={isActive ? { backgroundColor: primaryColor } : undefined}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    isActive
                      ? 'text-black font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Ledger Table */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
        {loading ? (
          <div className="py-20 text-center">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3" style={{ color: primaryColor }} />
            <p className="text-zinc-400 text-sm font-medium">Loading Outstanding Guest Ledger...</p>
          </div>
        ) : filteredDebts.length === 0 ? (
          <div className="py-20 text-center px-4">
            <div className="w-12 h-12 bg-zinc-800/80 border border-zinc-700/60 text-zinc-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <h3 className="text-base font-bold text-zinc-100">No Unpaid Balances Found</h3>
            <p className="text-xs text-zinc-400 max-w-md mx-auto mt-1">
              There are no matching debtor records in this view. All departures are balanced, or check filters above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-zinc-950/80 border-b border-zinc-800 text-zinc-400 font-bold uppercase tracking-wider text-[11px]">
                  <th className="py-3.5 px-4">Guest & Corporate Status</th>
                  <th className="py-3.5 px-4">Folio & Room Number</th>
                  <th className="py-3.5 px-4">Checkout Date</th>
                  <th className="py-3.5 px-4">Aging Days</th>
                  <th className="py-3.5 px-4 text-right">Original Debt</th>
                  <th className="py-3.5 px-4 text-right">Active Balance</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filteredDebts.map((debt) => {
                  const aging = debt.agingDays || 0;
                  const isOverdue90 = aging > 90;
                  const isOverdue60 = aging > 60 && aging <= 90;
                  const isOverdue30 = aging > 30 && aging <= 60;
                  const { isCorp, corpName } = getCorporateInfo(debt);

                  return (
                    <tr 
                      key={debt.id} 
                      className={`hover:bg-zinc-800/40 transition-colors ${
                        debt.status === 'written_off' ? 'bg-zinc-950/40 opacity-70' : ''
                      }`}
                    >
                      {/* Guest Info */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center font-bold text-zinc-300 text-xs shrink-0">
                            {debt.guestName ? debt.guestName.charAt(0).toUpperCase() : 'G'}
                          </div>
                          <div>
                            <div className="font-bold text-zinc-100 text-sm flex items-center gap-2 flex-wrap">
                              <span>{debt.guestName}</span>
                              {isCorp ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/30" title={`Corporate Guest: ${corpName || 'Corporate Account'}`}>
                                  <Building className="w-3 h-3" />
                                  <span>{corpName || 'Corporate Guest'}</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-medium bg-zinc-800/80 text-zinc-400 border border-zinc-700/50">
                                  Individual
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-zinc-400 flex items-center space-x-2 mt-1">
                              <span className="font-mono font-bold text-zinc-200 bg-zinc-800/90 px-1.5 py-0.5 rounded border border-zinc-700/80">
                                Room {debt.roomNumber || 'N/A'}
                              </span>
                              {debt.guestPhone && <span>• {debt.guestPhone}</span>}
                              {debt.guestEmail && (
                                <span className="truncate max-w-[140px] text-zinc-500">• {debt.guestEmail}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Folio & Room */}
                      <td className="py-3.5 px-4">
                        <span className="font-bold text-zinc-200 bg-zinc-800 border border-zinc-700 px-2 py-0.5 rounded text-xs font-mono">
                          {debt.folioNumber || `FOL-${debt.id.slice(-6).toUpperCase()}`}
                        </span>
                        <div className="text-xs font-bold text-zinc-300 mt-1 flex items-center gap-1.5">
                          <span className="text-zinc-500 font-normal">Assigned:</span>
                          <span className="font-mono bg-zinc-800/60 px-1.5 py-0.5 rounded border border-zinc-700/50 text-zinc-200">
                            Room {debt.roomNumber || 'N/A'}
                          </span>
                        </div>
                      </td>

                      {/* Checkout Date */}
                      <td className="py-3.5 px-4 text-zinc-300">
                        {debt.checkoutDate}
                      </td>

                      {/* Aging Badge */}
                      <td className="py-3.5 px-4">
                        {debt.status === 'paid' ? (
                          <span className="text-emerald-400 font-medium">Settled</span>
                        ) : debt.status === 'transferred' ? (
                          <span className="text-indigo-400 font-medium">Transferred</span>
                        ) : debt.status === 'written_off' ? (
                          <span className="text-zinc-500 font-medium">Closed</span>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold text-[11px] inline-flex items-center space-x-1 ${
                              isOverdue90
                                ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                : isOverdue60
                                ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                                : isOverdue30
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            }`}
                          >
                            <Clock className="w-3 h-3 inline mr-1" />
                            <span>{aging} day{aging === 1 ? '' : 's'}</span>
                          </span>
                        )}
                      </td>

                      {/* Original Debt */}
                      <td className="py-3.5 px-4 text-right font-medium text-zinc-400">
                        {formatCurrency(debt.originalDebt, currency, exchangeRate)}
                      </td>

                      {/* Outstanding Balance */}
                      <td className="py-3.5 px-4 text-right">
                        <span className={`text-sm font-black ${debt.outstandingAmount > 0.01 ? 'text-red-400' : 'text-zinc-500'}`}>
                          {formatCurrency(debt.outstandingAmount, currency, exchangeRate)}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold inline-block capitalize ${
                          debt.status === 'paid'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : debt.status === 'partially_paid'
                            ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                            : debt.status === 'transferred'
                            ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                            : debt.status === 'written_off'
                            ? 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          {debt.status.replace('_', ' ')}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center space-x-1">
                          {debt.outstandingAmount > 0.01 && (
                            <>
                              {/* Receive Payment */}
                              <button
                                onClick={() => handleOpenPayment(debt)}
                                title="Receive Payment"
                                className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg transition-colors cursor-pointer"
                              >
                                <DollarSign className="w-4 h-4" />
                              </button>

                              {/* Transfer Debt */}
                              {canTransfer && (
                                <button
                                  onClick={() => handleOpenTransfer(debt)}
                                  title="Transfer Debt"
                                  className="p-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 rounded-lg transition-colors cursor-pointer"
                                >
                                  <ArrowUpRight className="w-4 h-4" />
                                </button>
                              )}

                              {/* Write Off / Adjust */}
                              {canWriteOff && (
                                <button
                                  onClick={() => handleOpenWriteOff(debt)}
                                  title="Write Off or Adjust Balance"
                                  className="p-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-lg transition-colors cursor-pointer"
                                >
                                  <BadgePercent className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          )}

                          {/* Audit History */}
                          <button
                            onClick={() => setActiveAuditDebt(debt)}
                            title="View Audit Trail"
                            className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-lg transition-colors cursor-pointer"
                          >
                            <History className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* -------------------- PAYMENT MODAL -------------------- */}
      {activePaymentDebt && (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 rounded-2xl shadow-2xl max-w-md w-full border border-zinc-800 text-zinc-100 overflow-hidden animate-in fade-in zoom-in-95">
            <div className="bg-zinc-950 px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl">
                  <DollarSign className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-base text-zinc-100">Receive Debt Payment</h3>
              </div>
              <button 
                onClick={() => setActivePaymentDebt(null)}
                className="text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                <div className="text-xs text-zinc-400">Debtor / Folio</div>
                <div className="font-bold text-zinc-100 text-sm mt-0.5">
                  {activePaymentDebt.guestName} • {activePaymentDebt.folioNumber} (Room {activePaymentDebt.roomNumber})
                </div>
                <div className="text-xs text-red-400 font-bold mt-1">
                  Active Outstanding: {formatCurrency(activePaymentDebt.outstandingAmount, currency, exchangeRate)}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">
                  Payment Amount ({currency})
                </label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                  max={activePaymentDebt.outstandingAmount}
                  min={1}
                  className="w-full px-3 py-2 text-sm font-bold bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-xl focus:outline-none focus:border-emerald-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['cash', 'card', 'transfer'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`py-2 text-xs font-bold rounded-xl border capitalize cursor-pointer transition-colors ${
                        paymentMethod === method
                          ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-400'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                      }`}
                    >
                      {method === 'transfer' ? 'Bank Transfer' : method}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">Notes / Receipt Ref</label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="e.g. Bank Ref #99382 or Cash receipt"
                  className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 rounded-xl focus:outline-none focus:border-emerald-500/50"
                />
              </div>

              <div className="pt-3 flex items-center justify-end space-x-2 border-t border-zinc-800">
                <button
                  onClick={() => setActivePaymentDebt(null)}
                  className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleProcessPayment}
                  disabled={actionLoading || paymentAmount <= 0}
                  className="px-5 py-2 text-xs font-black uppercase tracking-widest text-black bg-emerald-500 hover:bg-emerald-400 rounded-xl shadow transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {actionLoading ? 'Recording...' : 'Confirm Payment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* -------------------- TRANSFER DEBT MODAL -------------------- */}
      {activeTransferDebt && (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 rounded-2xl shadow-2xl max-w-lg w-full border border-zinc-800 text-zinc-100 overflow-hidden animate-in fade-in zoom-in-95">
            <div className="bg-zinc-950 px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-xl">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-base text-zinc-100">Transfer Debt Balance</h3>
              </div>
              <button 
                onClick={() => setActiveTransferDebt(null)}
                className="text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                <div className="text-xs text-zinc-400">Originating Debtor</div>
                <div className="font-bold text-zinc-100 text-sm mt-0.5">
                  {activeTransferDebt.guestName} • {activeTransferDebt.folioNumber} (Room {activeTransferDebt.roomNumber})
                </div>
                <div className="text-xs text-red-400 font-bold mt-1">
                  Transferable Balance: {formatCurrency(activeTransferDebt.outstandingAmount, currency, exchangeRate)}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">Transfer Destination</label>
                <select
                  value={transferType}
                  onChange={(e) => {
                    const val = e.target.value as any;
                    setTransferType(val);
                    if (val === 'corporate' && corporateAccounts.length > 0) {
                      setTransferTargetId(corporateAccounts[0].id);
                      setTransferTargetName(corporateAccounts[0].name);
                    } else if (val === 'city_ledger') {
                      setTransferTargetId('city_ledger_general');
                      setTransferTargetName('City Ledger (Accounts Receivable)');
                    } else if (val === 'house_account') {
                      setTransferTargetId('house_account_general');
                      setTransferTargetName('Hotel House Account (Operational)');
                    } else if (val === 'travel_agent') {
                      setTransferTargetId('travel_agent_ar');
                      setTransferTargetName('Travel Agency AR');
                    } else {
                      setTransferTargetId('');
                      setTransferTargetName('');
                    }
                  }}
                  className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-xl focus:outline-none focus:border-emerald-500/50"
                >
                  <option value="corporate">Corporate Account (Direct Billing)</option>
                  <option value="city_ledger">City Ledger (General AR)</option>
                  <option value="house_account">House Account (Hotel Operational / Owner)</option>
                  <option value="travel_agent">Travel Agent Account</option>
                  <option value="master_folio">Master Group Folio</option>
                </select>
              </div>

              {transferType === 'corporate' && corporateAccounts.length > 0 ? (
                <div>
                  <label className="block text-xs font-bold text-zinc-300 mb-1">Select Corporate Company</label>
                  <select
                    value={transferTargetId}
                    onChange={(e) => {
                      const selected = corporateAccounts.find(c => c.id === e.target.value);
                      setTransferTargetId(e.target.value);
                      setTransferTargetName(selected?.name || '');
                    }}
                    className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-xl focus:outline-none focus:border-emerald-500/50"
                  >
                    {corporateAccounts.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({formatCurrency(c.currentBalance || 0, currency, exchangeRate)} balance)
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-zinc-300 mb-1">Target Account Name / Reference</label>
                  <input
                    type="text"
                    value={transferTargetName}
                    onChange={(e) => setTransferTargetName(e.target.value)}
                    placeholder="e.g. Chevron Nigeria Ltd or Room 501 Master"
                    className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 rounded-xl focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">Amount to Transfer</label>
                <input
                  type="number"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(parseFloat(e.target.value) || 0)}
                  max={activeTransferDebt.outstandingAmount}
                  min={1}
                  className="w-full px-3 py-2 text-sm font-bold bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-xl focus:outline-none focus:border-emerald-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">
                  Mandatory Transfer Justification Note *
                </label>
                <input
                  type="text"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  placeholder="e.g. Guest corporate stay approved by HR, moving to company credit"
                  className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 rounded-xl focus:outline-none focus:border-emerald-500/50"
                />
              </div>

              <div className="pt-3 flex items-center justify-end space-x-2 border-t border-zinc-800">
                <button
                  onClick={() => setActiveTransferDebt(null)}
                  className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleProcessTransfer}
                  disabled={actionLoading || transferAmount <= 0}
                  className="px-5 py-2 text-xs font-black uppercase tracking-widest text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {actionLoading ? 'Transferring...' : 'Execute Transfer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* -------------------- WRITE-OFF / ADJUSTMENT MODAL -------------------- */}
      {activeWriteOffDebt && (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 rounded-2xl shadow-2xl max-w-lg w-full border border-zinc-800 text-zinc-100 overflow-hidden animate-in fade-in zoom-in-95">
            <div className="bg-zinc-950 px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-xl">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-base text-zinc-100">Authorize Write-Off / Adjustment</h3>
              </div>
              <button 
                onClick={() => setActiveWriteOffDebt(null)}
                className="text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl text-xs text-amber-300">
                <strong>Strict Financial Audit Mandate:</strong> Debt write-offs permanently reduce accounts receivable. This action requires authorization and is recorded in the permanent audit trail.
              </div>

              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                <div className="text-xs text-zinc-400">Folio Target</div>
                <div className="font-bold text-zinc-100 text-sm mt-0.5">
                  {activeWriteOffDebt.guestName} • {activeWriteOffDebt.folioNumber} (Room {activeWriteOffDebt.roomNumber})
                </div>
                <div className="text-xs text-red-400 font-bold mt-1">
                  Outstanding Debt: {formatCurrency(activeWriteOffDebt.outstandingAmount, currency, exchangeRate)}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">Action Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'write_off', label: 'Full Write-Off' },
                    { id: 'reduction', label: 'Credit Note / Reduction' },
                    { id: 'increase', label: 'Debit Adjustment' }
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setWriteOffType(t.id as any)}
                      className={`py-2 text-xs font-bold rounded-xl border text-center transition-colors cursor-pointer ${
                        writeOffType === t.id
                          ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">Amount</label>
                <input
                  type="number"
                  value={writeOffAmount}
                  onChange={(e) => setWriteOffAmount(parseFloat(e.target.value) || 0)}
                  max={activeWriteOffDebt.outstandingAmount}
                  min={1}
                  className="w-full px-3 py-2 text-sm font-bold bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-xl focus:outline-none focus:border-emerald-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">Mandatory Reason Category *</label>
                <select
                  value={writeOffReason}
                  onChange={(e) => setWriteOffReason(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-xl focus:outline-none focus:border-emerald-500/50"
                >
                  <option value="Uncollectible / Bad Debt">Uncollectible / Bad Debt (Skipper)</option>
                  <option value="Management Courtesy">Management Courtesy</option>
                  <option value="Dispute Resolution / Service Recovery">Dispute Resolution / Service Recovery</option>
                  <option value="Deceased">Deceased Guest</option>
                  <option value="Billing Error Correction">Billing Error Correction</option>
                  <option value="Other">Other (Specify below)</option>
                </select>
              </div>

              {writeOffReason === 'Other' && (
                <div>
                  <label className="block text-xs font-bold text-zinc-300 mb-1">Specific Custom Reason *</label>
                  <input
                    type="text"
                    value={writeOffCustomReason}
                    onChange={(e) => setWriteOffCustomReason(e.target.value)}
                    placeholder="Provide exact justification..."
                    className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 rounded-xl focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">Approved By (Authority Name) *</label>
                <input
                  type="text"
                  value={writeOffApprovedBy}
                  onChange={(e) => setWriteOffApprovedBy(e.target.value)}
                  placeholder="e.g. General Manager / Director of Finance"
                  className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 rounded-xl focus:outline-none focus:border-emerald-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">Approval Reference / Notes</label>
                <input
                  type="text"
                  value={writeOffNotes}
                  onChange={(e) => setWriteOffNotes(e.target.value)}
                  placeholder="e.g. Board resolution #42 or executive memo"
                  className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 rounded-xl focus:outline-none focus:border-emerald-500/50"
                />
              </div>

              <div className="pt-3 flex items-center justify-end space-x-2 border-t border-zinc-800">
                <button
                  onClick={() => setActiveWriteOffDebt(null)}
                  className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleProcessWriteOff}
                  disabled={actionLoading || writeOffAmount <= 0}
                  className="px-5 py-2 text-xs font-black uppercase tracking-widest text-black bg-amber-500 hover:bg-amber-400 rounded-xl shadow transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {actionLoading ? 'Authorizing...' : 'Authorize Action'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* -------------------- AUDIT TRAIL MODAL -------------------- */}
      {activeAuditDebt && (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 rounded-2xl shadow-2xl max-w-2xl w-full border border-zinc-800 text-zinc-100 overflow-hidden animate-in fade-in zoom-in-95">
            <div className="bg-zinc-950 px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-300">
                  <History className="w-4 h-4 text-emerald-400" />
                </div>
                <h3 className="font-bold text-base text-zinc-100">
                  Audit History: {activeAuditDebt.folioNumber} ({activeAuditDebt.guestName})
                </h3>
              </div>
              <button 
                onClick={() => setActiveAuditDebt(null)}
                className="text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 flex justify-between items-center text-xs">
                <div>
                  <span className="text-zinc-400">Checkout Date: </span>
                  <span className="font-bold text-zinc-200">{activeAuditDebt.checkoutDate}</span>
                </div>
                <div>
                  <span className="text-zinc-400">Original Balance: </span>
                  <span className="font-bold text-zinc-200">{formatCurrency(activeAuditDebt.originalDebt, currency, exchangeRate)}</span>
                </div>
                <div>
                  <span className="text-zinc-400">Current Debt: </span>
                  <span className="font-bold text-red-400">{formatCurrency(activeAuditDebt.outstandingAmount, currency, exchangeRate)}</span>
                </div>
              </div>

              <div className="border border-zinc-800 rounded-xl divide-y divide-zinc-800/80 bg-zinc-950/60">
                {(!activeAuditDebt.auditHistory || activeAuditDebt.auditHistory.length === 0) ? (
                  <div className="p-4 text-center text-xs text-zinc-500">
                    No timeline logs found for this folio.
                  </div>
                ) : (
                  activeAuditDebt.auditHistory.map((item, idx) => (
                    <div key={item.id || idx} className="p-4 space-y-1.5 hover:bg-zinc-900/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            item.action === 'created'
                              ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                              : item.action === 'payment'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : item.action === 'transfer'
                              ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                              : item.action === 'write_off'
                              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}>
                            {item.action}
                          </span>
                          <span className="text-xs font-bold text-zinc-200">{item.user}</span>
                          {item.userRole && (
                            <span className="text-[11px] text-zinc-500">({item.userRole})</span>
                          )}
                        </div>
                        <span className="text-[11px] text-zinc-500">
                          {item.date} {item.time}
                        </span>
                      </div>

                      <div className="text-xs text-zinc-300">
                        {item.details}
                      </div>

                      <div className="text-[11px] text-zinc-400 flex items-center space-x-3 pt-1 border-t border-zinc-800/60">
                        <span>Previous: {formatCurrency(item.previousBalance, currency, exchangeRate)}</span>
                        <span>•</span>
                        <span className="font-bold text-zinc-200">
                          Amount: {formatCurrency(item.amount, currency, exchangeRate)}
                        </span>
                        <span>•</span>
                        <span>New Balance: {formatCurrency(item.newBalance, currency, exchangeRate)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setActiveAuditDebt(null)}
                  className="px-4 py-2 text-xs font-black uppercase tracking-widest text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
