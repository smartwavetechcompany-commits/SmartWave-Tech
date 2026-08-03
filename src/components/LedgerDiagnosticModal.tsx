import React, { useState, useMemo } from 'react';
import { LedgerEntry, Reservation, Guest, Hotel } from '../types';
import { validateLedgerTransaction, validateGuestAccount } from '../services/financialService';
import { ShieldAlert, AlertTriangle, CheckCircle, Search, Trash2, Filter, FileSpreadsheet, RefreshCw, X, Info } from 'lucide-react';
import { formatCurrency } from '../utils';

interface LedgerDiagnosticModalProps {
  isOpen: boolean;
  onClose: () => void;
  reservation?: Reservation | null;
  guest?: Guest | null;
  hotel: Hotel | null;
  ledgerEntries: LedgerEntry[];
  currency?: 'NGN' | 'USD' | string;
  exchangeRate?: number;
  onPurgeInvalidEntries?: (entryIds: string[]) => Promise<void>;
}

export const LedgerDiagnosticModal: React.FC<LedgerDiagnosticModalProps> = ({
  isOpen,
  onClose,
  reservation,
  guest,
  hotel,
  ledgerEntries,
  currency = 'NGN',
  exchangeRate = 1,
  onPurgeInvalidEntries
}) => {
  const safeCurrency = (currency === 'USD' ? 'USD' : 'NGN') as 'NGN' | 'USD';

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'flagged' | 'debit' | 'credit' | 'system'>('all');
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [isPurging, setIsPurging] = useState(false);
  const [purgeSuccessMsg, setPurgeSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  // Filter entries to relevant reservation or guest
  const filteredLedger = useMemo(() => {
    return ledgerEntries.filter(entry => {
      if (reservation && entry.reservationId && entry.reservationId !== reservation.id) {
        return false;
      }
      if (guest && entry.guestId && entry.guestId !== guest.id) {
        return false;
      }
      return true;
    });
  }, [ledgerEntries, reservation, guest]);

  // Audit analysis for each entry
  const auditedEntries = useMemo(() => {
    return filteredLedger.map((entry, index) => {
      const entryId = typeof entry.id === 'string' && entry.id
        ? entry.id
        : (entry as any).firestoreId || `entry-${index}-${Math.random().toString(36).substring(2, 7)}`;

      const rawSource = (entry as any).source || (entry as any).sourceModule || (entry as any).type_source;
      const sourceModule = typeof rawSource === 'string'
        ? rawSource
        : rawSource && typeof rawSource === 'object'
          ? (rawSource.name || rawSource.module || 'direct_post')
          : 'direct_post';

      const rawPostedBy = entry.postedBy;
      const postedByStr = typeof rawPostedBy === 'string'
        ? rawPostedBy
        : rawPostedBy && typeof rawPostedBy === 'object'
          ? ((rawPostedBy as any).displayName || (rawPostedBy as any).email || (rawPostedBy as any).uid || 'system')
          : 'system';

      const isSystemGenerated = postedByStr === 'system' || (entry as any).isSystemGenerated === true;
      const validation = validateLedgerTransaction(entry);
      
      const numAmount = Number(entry.amount) || 0;
      const isSuspiciousAmount = Math.abs(numAmount) > 1000000; // Flag sudden millions in credits/debits
      const isProhibitedSource = !validation.isValid;
      const isVirtual = (entry as any).isVirtual === true;

      const isFlagged = isProhibitedSource || isVirtual || isSuspiciousAmount;

      const descriptionStr = typeof entry.description === 'string' 
        ? entry.description 
        : entry.description && typeof entry.description === 'object' 
          ? JSON.stringify(entry.description) 
          : 'No description';

      const categoryStr = typeof entry.category === 'string' 
        ? entry.category 
        : entry.category && typeof entry.category === 'object' 
          ? String((entry.category as any).name || 'general') 
          : 'general';

      const chargeTypeStr = typeof entry.chargeType === 'string' 
        ? entry.chargeType 
        : entry.chargeType && typeof entry.chargeType === 'object' 
          ? String((entry.chargeType as any).name || '') 
          : '';

      let dateDisplay = 'N/A';
      if (entry.timestamp) {
        if (typeof (entry.timestamp as any).toDate === 'function') {
          dateDisplay = (entry.timestamp as any).toDate().toLocaleString();
        } else if (typeof entry.timestamp === 'number' || typeof entry.timestamp === 'string') {
          const d = new Date(entry.timestamp);
          dateDisplay = isNaN(d.getTime()) ? String(entry.timestamp) : d.toLocaleString();
        } else if (typeof entry.timestamp === 'object' && (entry.timestamp as any).seconds) {
          dateDisplay = new Date((entry.timestamp as any).seconds * 1000).toLocaleString();
        }
      }

      return {
        ...entry,
        id: entryId,
        amount: numAmount,
        sourceModule,
        postedByStr,
        descriptionStr,
        categoryStr,
        chargeTypeStr,
        dateDisplay,
        isSystemGenerated,
        validation,
        isSuspiciousAmount,
        isProhibitedSource,
        isVirtual,
        isFlagged
      };
    });
  }, [filteredLedger]);

  const flaggedCount = auditedEntries.filter(e => e.isFlagged).length;

  const displayEntries = useMemo(() => {
    return auditedEntries.filter(e => {
      if (filterType === 'flagged' && !e.isFlagged) return false;
      if (filterType === 'debit' && e.type !== 'debit') return false;
      if (filterType === 'credit' && e.type !== 'credit') return false;
      if (filterType === 'system' && !e.isSystemGenerated) return false;

      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          e.id.toLowerCase().includes(term) ||
          e.descriptionStr.toLowerCase().includes(term) ||
          e.categoryStr.toLowerCase().includes(term) ||
          e.sourceModule.toLowerCase().includes(term) ||
          e.postedByStr.toLowerCase().includes(term)
        );
      }
      return true;
    });
  }, [auditedEntries, filterType, searchTerm]);

  // Consistency audit summary using validateGuestAccount
  const guestId = guest?.id || reservation?.guestId || '';
  const validationResult = validateGuestAccount(guestId, {
    reservations: reservation ? [reservation] : [],
    hotel,
    ledgerEntries: filteredLedger,
    guestProfile: guest,
    folioBalance: reservation?.ledgerBalance
  });

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
      alert(`Purge failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 bg-zinc-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-400">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Administrative Ledger Audit & Diagnostic Utility
                {flaggedCount > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30">
                    {flaggedCount} Flagged Anomalies
                  </span>
                )}
              </h3>
              <p className="text-xs text-zinc-400">
                Auditing ledger origin for {reservation ? `Reservation #${String(reservation.id || '').slice(-6).toUpperCase()}` : guest ? `Guest: ${typeof guest.name === 'string' ? guest.name : (guest as any)?.guestName || 'Unknown'}` : 'Hotel Ledger'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Multi-point Consistency Status Banner */}
        <div className="p-4 bg-zinc-950/80 border-b border-zinc-800 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div className="p-3 bg-zinc-900/80 rounded-xl border border-zinc-800">
            <span className="text-zinc-500 block">Ledger Calculated Balance</span>
            <span className={`text-base font-bold font-mono ${validationResult.ledgerBalance > 0 ? 'text-amber-400' : validationResult.ledgerBalance < 0 ? 'text-emerald-400' : 'text-zinc-200'}`}>
              {formatCurrency(validationResult.ledgerBalance, safeCurrency, exchangeRate)}
            </span>
          </div>

          <div className="p-3 bg-zinc-900/80 rounded-xl border border-zinc-800">
            <span className="text-zinc-500 block">Stored Folio / Profile Balance</span>
            <span className="text-base font-bold font-mono text-zinc-200">
              {formatCurrency(validationResult.profileBalance, safeCurrency, exchangeRate)}
            </span>
          </div>

          <div className="p-3 bg-zinc-900/80 rounded-xl border border-zinc-800">
            <span className="text-zinc-500 block">Consistency Check</span>
            <div className="mt-0.5 flex items-center gap-1.5 font-semibold">
              {validationResult.isValid ? (
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" /> PASSED (Balanced)
                </span>
              ) : (
                <span className="text-red-400 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" /> DISCREPANCY DETECTED
                </span>
              )}
            </div>
          </div>

          <div className="p-3 bg-zinc-900/80 rounded-xl border border-zinc-800 flex flex-col justify-between">
            <span className="text-zinc-500 block">Prohibited Entries</span>
            <span className="text-xs text-zinc-400">
              {flaggedCount === 0 ? '0 Prohibited/Virtual entries' : `${flaggedCount} entry(ies) origin from forecast/projection`}
            </span>
          </div>
        </div>

        {/* Violations List if any */}
        {validationResult.violations.length > 0 && (
          <div className="p-3.5 bg-red-500/10 border-b border-red-500/20 text-xs text-red-300 flex flex-col gap-1">
            <div className="font-semibold flex items-center gap-1.5 text-red-400">
              <AlertTriangle className="w-4 h-4" /> System Multi-Point Audit Violations:
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

        {/* Control Toolbar */}
        <div className="p-4 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3 bg-zinc-900/60">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search transaction ID, description, module, postedBy..."
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

        {/* Audit Table */}
        <div className="flex-1 overflow-auto p-4">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400 font-semibold bg-zinc-950/60 sticky top-0 z-10">
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
                <th className="p-3">Transaction ID & Date</th>
                <th className="p-3">Description & Category</th>
                <th className="p-3">Source Module</th>
                <th className="p-3">System Generated</th>
                <th className="p-3">Type</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono">
              {displayEntries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-zinc-500 font-sans">
                    No ledger entries match current filter criteria.
                  </td>
                </tr>
              ) : (
                displayEntries.map(entry => {
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
                      <td className="p-3">
                        <span className="text-zinc-200 font-bold block">{String(entry.id).slice(-8).toUpperCase()}</span>
                        <span className="text-[10px] text-zinc-500 font-sans block">
                          {entry.dateDisplay}
                        </span>
                      </td>
                      <td className="p-3 font-sans">
                        <span className="text-zinc-200 font-medium block">{entry.descriptionStr || 'No description'}</span>
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">
                          Category: {entry.categoryStr} {entry.chargeTypeStr ? `(${entry.chargeTypeStr})` : ''}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${entry.isProhibitedSource ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-zinc-800 text-zinc-300'}`}>
                          {entry.sourceModule}
                        </span>
                      </td>
                      <td className="p-3 font-sans">
                        {entry.isSystemGenerated ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            System ({entry.postedByStr || 'system'})
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-400">
                            Manual ({entry.postedByStr || 'user'})
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-sans">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${entry.type === 'debit' ? 'text-amber-400 bg-amber-500/10' : 'text-emerald-400 bg-emerald-500/10'}`}>
                          {entry.type}
                        </span>
                      </td>
                      <td className="p-3 text-right font-bold">
                        <span className={entry.type === 'debit' ? 'text-zinc-200' : 'text-emerald-400'}>
                          {formatCurrency(entry.amount, safeCurrency, exchangeRate)}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        {entry.isFlagged ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30" title={typeof entry.validation?.reason === 'string' ? entry.validation.reason : 'Flagged anomaly'}>
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
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950 flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-zinc-500" />
            <span>Transactions from 'projection', 'forecast', 'preview', or 'simulation' are strictly rejected from live ledger calculation.</span>
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
