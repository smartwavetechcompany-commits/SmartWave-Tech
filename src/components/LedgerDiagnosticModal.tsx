import React, { useState, useMemo } from 'react';
import { LedgerEntry, Reservation, Guest, Hotel } from '../types';
import { validateLedgerTransaction, validateGuestAccount } from '../services/financialService';
import { 
  ShieldAlert, 
  AlertTriangle, 
  CheckCircle, 
  Search, 
  Trash2, 
  X, 
  Info,
  ArrowUpDown,
  Download,
  FileSpreadsheet
} from 'lucide-react';
import { formatCurrency } from '../utils';

export interface LedgerDiagnosticModalProps {
  isOpen: boolean;
  onClose: () => void;
  reservation?: Reservation | null;
  guest?: Guest | null;
  hotel: Hotel | null;
  ledgerEntries?: LedgerEntry[];
  currency?: 'NGN' | 'USD' | string;
  exchangeRate?: number;
  onPurgeInvalidEntries?: (entryIds: string[]) => Promise<void>;
}

/**
 * Standardizes transaction type into one of the 13 canonical folio categories.
 * Unknown or unclassified types return 'Unknown Transaction'.
 */
export function resolveTransactionType(entry: any): string {
  if (!entry || typeof entry !== 'object') return 'Unknown Transaction';

  const cat = String(entry.category || '').toLowerCase();
  const chargeType = String(entry.chargeType || '').toLowerCase();
  const desc = String(entry.description || '').toLowerCase();
  const type = String(entry.type || '').toLowerCase();
  const source = String(entry.source || entry.sourceModule || (entry as any).type_source || '').toLowerCase();

  // Corporate transfer / City ledger
  if (
    cat.includes('city_ledger') || 
    cat.includes('corporate') || 
    desc.includes('city ledger') || 
    desc.includes('corporate transfer') ||
    source.includes('city_ledger')
  ) {
    return 'Corporate Transfer';
  }

  // Transfer between guests / folios
  if (
    cat.includes('transfer') || 
    desc.includes('transfer') || 
    source.includes('transfer')
  ) {
    return 'Transfer';
  }

  // Early checkout credit
  if (
    desc.includes('early checkout') || 
    cat.includes('early_checkout')
  ) {
    return 'Early Checkout Credit';
  }

  // Checkout adjustment
  if (
    desc.includes('checkout adjustment') || 
    cat.includes('checkout_adjustment')
  ) {
    return 'Checkout Adjustment';
  }

  // Overstay charge
  if (
    desc.includes('overstay') || 
    cat.includes('overstay') || 
    chargeType.includes('overstay')
  ) {
    return 'Overstay Charge';
  }

  // Room charge
  if (
    cat === 'room' || 
    cat.includes('room_charge') || 
    desc.includes('room charge') || 
    desc.includes('night') || 
    chargeType === 'room'
  ) {
    return 'Room Charge';
  }

  // F&B charge
  if (
    cat === 'restaurant' || 
    cat === 'bar' || 
    cat === 'f&b' || 
    cat.includes('food') || 
    cat.includes('beverage') || 
    desc.includes('f&b') || 
    desc.includes('restaurant') ||
    desc.includes('dining') ||
    desc.includes('breakfast')
  ) {
    return 'F&B Charge';
  }

  // Laundry charge
  if (
    cat === 'laundry' || 
    desc.includes('laundry') || 
    chargeType.includes('laundry')
  ) {
    return 'Laundry Charge';
  }

  // Tax charge
  if (
    cat === 'tax' || 
    desc.includes('tax') || 
    cat.includes('vat') || 
    chargeType.includes('tax')
  ) {
    return 'Tax Charge';
  }

  // Discounts
  if (
    cat === 'discount' || 
    desc.includes('discount') || 
    chargeType.includes('discount')
  ) {
    return 'Discount';
  }

  // Refund
  if (
    cat === 'refund' || 
    desc.includes('refund') || 
    chargeType.includes('refund')
  ) {
    return 'Refund';
  }

  // Payment
  if (
    type === 'credit' || 
    cat === 'payment' || 
    cat === 'settlement' || 
    desc.includes('payment') || 
    desc.includes('settle') ||
    desc.includes('paid')
  ) {
    return 'Payment';
  }

  // Manual adjustment / charge
  if (
    cat === 'manual' || 
    cat === 'adjustment' || 
    desc.includes('manual') || 
    desc.includes('adjustment') || 
    cat === 'service' || 
    cat === 'other'
  ) {
    return 'Manual Adjustment';
  }

  return 'Unknown Transaction';
}

/**
 * Safely extracts timestamp in milliseconds from Firestore Timestamp, Date, string, or number.
 */
function getTimestampMs(ts: any): number {
  if (!ts) return 0;
  if (typeof ts.toDate === 'function') {
    try {
      return ts.toDate().getTime();
    } catch {
      return 0;
    }
  }
  if (typeof ts === 'object' && ts.seconds !== undefined) {
    return Number(ts.seconds) * 1000 + (Number(ts.nanoseconds || 0) / 1000000);
  }
  if (typeof ts === 'number') {
    return isNaN(ts) ? 0 : ts;
  }
  if (typeof ts === 'string') {
    const parsed = new Date(ts).getTime();
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export const LedgerDiagnosticModal: React.FC<LedgerDiagnosticModalProps> = ({
  isOpen,
  onClose,
  reservation,
  guest,
  hotel,
  ledgerEntries = [],
  currency = 'NGN',
  exchangeRate = 1,
  onPurgeInvalidEntries
}) => {
  // CRITICAL RULE OF HOOKS: All hooks are declared at the very top level, unconditionally!
  const safeCurrency = (currency === 'USD' ? 'USD' : 'NGN') as 'NGN' | 'USD';

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'flagged' | 'debit' | 'credit' | 'system'>('all');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc'); // Default chronological (earliest to latest)
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [isPurging, setIsPurging] = useState(false);
  const [purgeSuccessMsg, setPurgeSuccessMsg] = useState<string | null>(null);

  // 1. Filter entries to relevant reservation or guest
  const filteredLedger = useMemo(() => {
    const safeList = Array.isArray(ledgerEntries) ? ledgerEntries.filter(Boolean) : [];
    return safeList.filter(entry => {
      if (!entry) return false;
      if (reservation && entry.reservationId && entry.reservationId !== reservation.id) {
        return false;
      }
      if (guest && entry.guestId && entry.guestId !== guest.id) {
        return false;
      }
      return true;
    });
  }, [ledgerEntries, reservation, guest]);

  // 2. Audit analysis and dynamic chronological running balance recalculation
  const auditedEntries = useMemo(() => {
    // First, sort all filtered entries chronologically (ascending) for true mathematical running balance
    const sortedChronological = [...filteredLedger].sort((a, b) => {
      const timeA = getTimestampMs(a.timestamp);
      const timeB = getTimestampMs(b.timestamp);
      if (timeA !== timeB) return timeA - timeB;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    let runningAccumulator = 0;

    return sortedChronological.map((entry: any, index: number) => {
      try {
        const entryId = typeof entry.id === 'string' && entry.id
          ? entry.id
          : (entry.firestoreId || `entry-${index}`);

        const rawAmount = Number(entry.amount);
        const validAmount = isNaN(rawAmount) ? 0 : Math.abs(rawAmount);

        let safeDebit = 0;
        let safeCredit = 0;

        if (entry.type === 'debit') {
          safeDebit = validAmount;
        } else if (entry.type === 'credit') {
          safeCredit = validAmount;
        } else if (entry.debit !== undefined && entry.debit !== null) {
          safeDebit = Math.max(0, Number(entry.debit) || 0);
          safeCredit = Math.max(0, Number(entry.credit) || 0);
        } else {
          // Infer fallback
          const inferredType = resolveTransactionType(entry);
          if (inferredType === 'Payment' || inferredType === 'Discount' || inferredType === 'Early Checkout Credit') {
            safeCredit = validAmount;
          } else {
            safeDebit = validAmount;
          }
        }

        // Dynamic chronological running balance recalculation: runningBalance = previousBalance + debit - credit
        runningAccumulator = Number((runningAccumulator + safeDebit - safeCredit).toFixed(2));
        const safeBalance = runningAccumulator;

        // Transaction Type Resolution
        const transactionType = resolveTransactionType(entry);

        // Safe User display
        let userDisplay = 'System';
        const rawUser = entry.postedBy || entry.userId || entry.user;
        if (typeof rawUser === 'string' && rawUser.trim()) {
          userDisplay = rawUser;
        } else if (rawUser && typeof rawUser === 'object') {
          userDisplay = rawUser.displayName || rawUser.name || rawUser.email || rawUser.uid || 'System';
        }

        const isSystemGenerated = userDisplay.toLowerCase() === 'system' || entry.isSystemGenerated === true;

        // Safe Description
        const description = typeof entry.description === 'string'
          ? entry.description
          : entry.description && typeof entry.description === 'object'
            ? JSON.stringify(entry.description)
            : 'No description';

        // Safe Category
        const category = typeof entry.category === 'string'
          ? entry.category
          : entry.category && typeof entry.category === 'object'
            ? String(entry.category.name || 'general')
            : 'general';

        // Safe Source
        const rawSource = entry.source || entry.sourceModule || entry.type_source;
        const sourceModule = typeof rawSource === 'string'
          ? rawSource
          : rawSource && typeof rawSource === 'object'
            ? (rawSource.name || rawSource.module || 'direct_post')
            : 'direct_post';

        // Date Display
        const tsMs = getTimestampMs(entry.timestamp);
        let dateDisplay = 'N/A';
        if (tsMs > 0) {
          const d = new Date(tsMs);
          dateDisplay = isNaN(d.getTime())
            ? 'N/A'
            : d.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });
        }

        // Validation against corruption or virtual leaks
        const validation = validateLedgerTransaction(entry);
        const isSuspiciousAmount = Math.abs(validAmount) > 1000000;
        const isProhibitedSource = !validation.isValid;
        const isVirtual = entry.isVirtual === true;
        const isFlagged = isProhibitedSource || isVirtual || isSuspiciousAmount;

        return {
          id: entryId,
          timestamp: tsMs,
          transactionType,
          description,
          category,
          sourceModule,
          debit: safeDebit,
          credit: safeCredit,
          balance: safeBalance,
          userId: userDisplay,
          dateDisplay,
          isSystemGenerated,
          validation,
          isSuspiciousAmount,
          isProhibitedSource,
          isVirtual,
          isFlagged
        };
      } catch (itemErr) {
        console.error('Ledger Audit Crash', {
          folioId: reservation?.id || 'unknown',
          guestId: guest?.id || reservation?.guestId || 'unknown',
          transactionId: entry?.id || `corrupted-${index}`,
          error: itemErr
        });

        // Gracefully sanitize corrupted historical record so it never crashes rendering
        return {
          id: entry?.id || `corrupted-${index}`,
          timestamp: 0,
          transactionType: 'Unknown Transaction',
          description: 'Corrupted Historical Record',
          category: 'error',
          sourceModule: 'unknown',
          debit: 0,
          credit: 0,
          balance: runningAccumulator,
          userId: 'Unknown',
          dateDisplay: 'Invalid Date',
          isSystemGenerated: false,
          validation: { isValid: false, reason: 'Corrupted record' },
          isSuspiciousAmount: false,
          isProhibitedSource: true,
          isVirtual: false,
          isFlagged: true
        };
      }
    });
  }, [filteredLedger, reservation, guest]);

  const flaggedCount = auditedEntries.filter(e => e.isFlagged).length;

  // 3. Filtered and sorted display entries
  const displayEntries = useMemo(() => {
    let result = auditedEntries.filter(e => {
      if (filterType === 'flagged' && !e.isFlagged) return false;
      if (filterType === 'debit' && e.debit <= 0) return false;
      if (filterType === 'credit' && e.credit <= 0) return false;
      if (filterType === 'system' && !e.isSystemGenerated) return false;

      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          e.id.toLowerCase().includes(term) ||
          e.transactionType.toLowerCase().includes(term) ||
          e.description.toLowerCase().includes(term) ||
          e.sourceModule.toLowerCase().includes(term) ||
          e.userId.toLowerCase().includes(term)
        );
      }
      return true;
    });

    if (sortOrder === 'desc') {
      result = [...result].reverse();
    }

    return result;
  }, [auditedEntries, filterType, searchTerm, sortOrder]);

  // 4. Consistency audit summary
  const guestId = guest?.id || reservation?.guestId || '';
  const validationResult = useMemo(() => {
    return validateGuestAccount(guestId, {
      reservations: reservation ? [reservation] : [],
      hotel,
      ledgerEntries: filteredLedger,
      guestProfile: guest,
      folioBalance: reservation?.ledgerBalance
    });
  }, [guestId, reservation, hotel, filteredLedger, guest]);

  // Actions
  const toggleSelectEntry = (id: string) => {
    const next = new Set(selectedEntries);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedEntries(next);
  };

  const selectAllFlagged = () => {
    const flaggedIds = auditedEntries.filter(e => e.isFlagged).map(e => e.id);
    setSelectedEntries(new Set(flaggedIds));
  };

  const handlePurgeSelected = async () => {
    if (selectedEntries.size === 0 || !onPurgeInvalidEntries) return;
    if (!window.confirm(`Are you sure you want to purge ${selectedEntries.size} selected transaction entry(ies) from the live ledger?`)) return;

    setIsPurging(true);
    setPurgeSuccessMsg(null);
    try {
      await onPurgeInvalidEntries(Array.from(selectedEntries));
      setPurgeSuccessMsg(`Successfully purged ${selectedEntries.size} invalid entry(ies) from the ledger.`);
      setSelectedEntries(new Set());
    } catch (err: any) {
      console.error('Ledger Audit Crash', {
        folioId: reservation?.id || 'unknown',
        guestId: guestId || 'unknown',
        transactionId: Array.from(selectedEntries).join(','),
        error: err?.message || String(err)
      });
      alert(`Purge failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsPurging(false);
    }
  };

  // CSV Export
  const exportToCSV = () => {
    const headers = ['Date', 'Type', 'Description', 'Debit', 'Credit', 'Running Balance', 'User', 'ID'];
    const rows = auditedEntries.map(e => [
      `"${e.dateDisplay}"`,
      `"${e.transactionType}"`,
      `"${e.description.replace(/"/g, '""')}"`,
      e.debit.toFixed(2),
      e.credit.toFixed(2),
      e.balance.toFixed(2),
      `"${e.userId}"`,
      `"${e.id}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Ledger_Audit_${reservation?.id || guestId || 'hotel'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // CRITICAL: Safe return only after ALL hooks have been invoked
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 bg-zinc-950/70">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-400">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Ledger Audit & Diagnostics
                {flaggedCount > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30">
                    {flaggedCount} Flagged
                  </span>
                )}
              </h3>
              <p className="text-xs text-zinc-400">
                {reservation 
                  ? `Reservation #${String(reservation.id || '').slice(-6).toUpperCase()} • Room ${reservation.roomNumber || 'Unassigned'} • Guest: ${reservation.guestName || 'Unknown'}`
                  : guest 
                    ? `Guest Account: ${guest.name || (guest as any)?.guestName || 'Unknown'}`
                    : 'Hotel Financial Ledger'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportToCSV}
              title="Export Ledger Audit CSV"
              className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors flex items-center gap-1.5 text-xs"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Multi-point Consistency Status Banner */}
        <div className="p-4 bg-zinc-950/80 border-b border-zinc-800 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="p-3 bg-zinc-900/80 rounded-xl border border-zinc-800">
            <span className="text-zinc-500 block text-[11px] uppercase tracking-wider">Audit Calculated Balance</span>
            <span className={`text-base font-bold font-mono ${validationResult.ledgerBalance > 0 ? 'text-amber-400' : validationResult.ledgerBalance < 0 ? 'text-emerald-400' : 'text-zinc-200'}`}>
              {formatCurrency(validationResult.ledgerBalance, safeCurrency, exchangeRate)}
            </span>
          </div>

          <div className="p-3 bg-zinc-900/80 rounded-xl border border-zinc-800">
            <span className="text-zinc-500 block text-[11px] uppercase tracking-wider">Stored Folio Balance</span>
            <span className="text-base font-bold font-mono text-zinc-200">
              {formatCurrency(validationResult.profileBalance, safeCurrency, exchangeRate)}
            </span>
          </div>

          <div className="p-3 bg-zinc-900/80 rounded-xl border border-zinc-800">
            <span className="text-zinc-500 block text-[11px] uppercase tracking-wider">Consistency Check</span>
            <div className="mt-0.5 flex items-center gap-1.5 font-semibold">
              {validationResult.isValid ? (
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" /> Balanced
                </span>
              ) : (
                <span className="text-red-400 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" /> Discrepancy
                </span>
              )}
            </div>
          </div>

          <div className="p-3 bg-zinc-900/80 rounded-xl border border-zinc-800 flex flex-col justify-between">
            <span className="text-zinc-500 block text-[11px] uppercase tracking-wider">Transaction Count</span>
            <span className="text-sm font-bold text-zinc-300 font-mono">
              {auditedEntries.length} Records ({flaggedCount} Flagged)
            </span>
          </div>
        </div>

        {/* Violations Notice */}
        {validationResult.violations.length > 0 && (
          <div className="p-3.5 bg-red-500/10 border-b border-red-500/20 text-xs text-red-300 flex flex-col gap-1">
            <div className="font-semibold flex items-center gap-1.5 text-red-400">
              <AlertTriangle className="w-4 h-4" /> Integrity Audit Violations:
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-[11px] text-red-300 font-mono">
              {validationResult.violations.map((v, i) => (
                <li key={i}>{typeof v === 'string' ? v : JSON.stringify(v)}</li>
              ))}
            </ul>
          </div>
        )}

        {purgeSuccessMsg && (
          <div className="p-3 bg-emerald-500/10 border-b border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> {purgeSuccessMsg}
          </div>
        )}

        {/* Toolbar */}
        <div className="p-4 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3 bg-zinc-900/60">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search date, type, description, user, or ID..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500/50"
              />
            </div>

            <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs">
              <button
                onClick={() => setFilterType('all')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${filterType === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}
              >
                All ({auditedEntries.length})
              </button>
              <button
                onClick={() => setFilterType('flagged')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${filterType === 'flagged' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'text-zinc-400 hover:text-white'}`}
              >
                Flagged ({flaggedCount})
              </button>
              <button
                onClick={() => setFilterType('debit')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${filterType === 'debit' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}
              >
                Debits
              </button>
              <button
                onClick={() => setFilterType('credit')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${filterType === 'credit' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}
              >
                Credits
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              {sortOrder === 'asc' ? 'Oldest First' : 'Newest First'}
            </button>

            {flaggedCount > 0 && (
              <button
                onClick={selectAllFlagged}
                className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 rounded-xl text-xs font-medium transition-colors"
              >
                Select Flagged ({flaggedCount})
              </button>
            )}

            {onPurgeInvalidEntries && selectedEntries.size > 0 && (
              <button
                onClick={handlePurgeSelected}
                disabled={isPurging}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Purge Selected ({selectedEntries.size})
              </button>
            )}
          </div>
        </div>

        {/* REQUIRED AUDIT VIEW TABLE: | Date | Type | Description | Debit | Credit | Running Balance | User | */}
        <div className="flex-1 overflow-auto p-4">
          {displayEntries.length === 0 ? (
            <div className="p-12 text-center text-zinc-500 font-sans flex flex-col items-center justify-center">
              <FileSpreadsheet className="w-10 h-10 text-zinc-600 mb-2 opacity-60" />
              <p className="text-sm font-semibold text-zinc-400">No Ledger Transactions Found</p>
              <p className="text-xs text-zinc-600 mt-1">
                {searchTerm || filterType !== 'all' 
                  ? 'Try clearing the search or filter criteria.' 
                  : 'This guest or reservation has no recorded financial transactions in the live ledger.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 font-semibold bg-zinc-950/80 sticky top-0 z-10 backdrop-blur-sm">
                  <th className="p-3 w-8">
                    <input
                      type="checkbox"
                      checked={selectedEntries.size > 0 && selectedEntries.size === displayEntries.length}
                      onChange={e => {
                        if (e.target.checked) setSelectedEntries(new Set(displayEntries.map(d => d.id)));
                        else setSelectedEntries(new Set());
                      }}
                      className="rounded bg-zinc-900 border-zinc-700 text-amber-500 focus:ring-amber-500/20"
                    />
                  </th>
                  <th className="p-3 whitespace-nowrap">Date</th>
                  <th className="p-3 whitespace-nowrap">Type</th>
                  <th className="p-3">Description</th>
                  <th className="p-3 text-right whitespace-nowrap">Debit</th>
                  <th className="p-3 text-right whitespace-nowrap">Credit</th>
                  <th className="p-3 text-right whitespace-nowrap">Running Balance</th>
                  <th className="p-3 whitespace-nowrap">User</th>
                  <th className="p-3 text-center whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono">
                {displayEntries.map(entry => {
                  const isSelected = selectedEntries.has(entry.id);
                  return (
                    <tr
                      key={entry.id}
                      className={`hover:bg-zinc-800/40 transition-colors ${entry.isFlagged ? 'bg-red-500/5 hover:bg-red-500/10' : ''} ${isSelected ? 'bg-amber-500/10' : ''}`}
                    >
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectEntry(entry.id)}
                          className="rounded bg-zinc-900 border-zinc-700 text-amber-500 focus:ring-amber-500/20"
                        />
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className="text-zinc-200 font-medium block">{entry.dateDisplay}</span>
                        <span className="text-[10px] text-zinc-500 block font-mono">
                          ID: {String(entry.id).slice(-8).toUpperCase()}
                        </span>
                      </td>
                      <td className="p-3 whitespace-nowrap font-sans">
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-zinc-800 text-zinc-200 border border-zinc-700">
                          {entry.transactionType}
                        </span>
                      </td>
                      <td className="p-3 font-sans">
                        <span className="text-zinc-200 font-medium block">{entry.description}</span>
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">
                          Module: {entry.sourceModule} • Category: {entry.category}
                        </span>
                      </td>
                      <td className="p-3 text-right font-bold whitespace-nowrap">
                        {entry.debit > 0 ? (
                          <span className="text-amber-400">
                            {formatCurrency(entry.debit, safeCurrency, exchangeRate)}
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="p-3 text-right font-bold whitespace-nowrap">
                        {entry.credit > 0 ? (
                          <span className="text-emerald-400">
                            {formatCurrency(entry.credit, safeCurrency, exchangeRate)}
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="p-3 text-right font-bold whitespace-nowrap">
                        <span className={entry.balance > 0 ? 'text-amber-400' : entry.balance < 0 ? 'text-emerald-400' : 'text-zinc-400'}>
                          {formatCurrency(entry.balance, safeCurrency, exchangeRate)}
                        </span>
                      </td>
                      <td className="p-3 whitespace-nowrap font-sans">
                        <span className="text-xs text-zinc-300 block font-medium">{entry.userId}</span>
                        {entry.isSystemGenerated && (
                          <span className="text-[9px] text-blue-400 block font-semibold uppercase tracking-wider">
                            Automated
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center whitespace-nowrap font-sans">
                        {entry.isFlagged ? (
                          <span 
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30" 
                            title={typeof entry.validation?.reason === 'string' ? entry.validation.reason : 'Flagged anomaly'}
                          >
                            <AlertTriangle className="w-3 h-3" /> Flagged
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-emerald-400">
                            <CheckCircle className="w-3 h-3" /> Valid
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950 flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-zinc-500 shrink-0" />
            <span>Running balance formula: <code className="text-amber-400 font-mono">Running Balance = Previous Balance + Debit - Credit</code>.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl font-medium transition-colors"
          >
            Close Audit
          </button>
        </div>
      </div>
    </div>
  );
};

// Aliases for seamless imports across the application
export const LedgerAuditModal = LedgerDiagnosticModal;
export const AuditLedger = LedgerDiagnosticModal;
export const LedgerHistory = LedgerDiagnosticModal;
export const GuestLedger = LedgerDiagnosticModal;
export const FolioLedger = LedgerDiagnosticModal;
