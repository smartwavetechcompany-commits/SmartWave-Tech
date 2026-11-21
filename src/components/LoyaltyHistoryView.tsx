import React, { useMemo, useState } from 'react';
import {
  Award,
  Search,
  Filter,
  PlusCircle,
  Download,
  RefreshCw,
  Users,
  Sparkles,
  Gift,
  TrendingUp,
  AlertTriangle,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import {
  Guest,
  Hotel,
  LedgerEntry,
  LoyaltyAccount,
  LoyaltyTransaction,
  LoyaltyTransactionType,
  Reservation,
  UserProfile,
} from '../types';
import { cn, formatCurrency } from '../utils';
import { safeFormatDate } from '../utils/dateUtils';
import {
  awardAutomaticStayPoints,
  calculateRedemptionMonetaryValue,
  canManageLoyalty,
  evaluateStayEligibilityForAutoEarn,
  getLoyaltyPolicy,
  resolveMembershipLevel,
} from '../services/loyaltyService';

interface LoyaltyHistoryViewProps {
  hotel: Hotel;
  profile: UserProfile | null;
  customRoles?: any[];
  guests: Guest[];
  loyaltyAccounts: LoyaltyAccount[];
  loyaltyTransactions: LoyaltyTransaction[];
  allReservations: Reservation[];
  allLedgerEntries: LedgerEntry[];
  currency: 'NGN' | 'USD';
  exchangeRate: number;
  onOpenManageModal: (
    guest?: Guest | null,
    action?: 'manual_award' | 'manual_deduct' | 'reversal'
  ) => void;
  onSelectGuest: (guest: Guest) => void;
}

const TYPE_OPTIONS: Array<{ value: 'all' | LoyaltyTransactionType; label: string }> = [
  { value: 'all', label: 'All Types' },
  { value: 'manual_award', label: 'Manual Award' },
  { value: 'manual_deduct', label: 'Manual Deduction' },
  { value: 'earn_auto', label: 'Automatic Stay Earn' },
  { value: 'redemption', label: 'Redemption' },
  { value: 'reversal', label: 'Reversal Adjustment' },
  { value: 'expiry', label: 'Points Expiry' },
  { value: 'tier_change', label: 'Tier Upgrade' },
  { value: 'account_activation', label: 'Account Activation' },
];

export function LoyaltyHistoryView({
  hotel,
  profile,
  customRoles = [],
  guests,
  loyaltyAccounts,
  loyaltyTransactions,
  allReservations,
  allLedgerEntries,
  currency,
  exchangeRate,
  onOpenManageModal,
  onSelectGuest,
}: LoyaltyHistoryViewProps) {
  const policy = useMemo(() => getLoyaltyPolicy(hotel), [hotel]);
  const isManager = useMemo(() => canManageLoyalty(profile, customRoles), [profile, customRoles]);

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | LoyaltyTransactionType>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isBatchSyncing, setIsBatchSyncing] = useState(false);

  const guestMap = useMemo(() => {
    const map: Record<string, Guest> = {};
    guests.forEach((g) => {
      map[g.id] = g;
    });
    return map;
  }, [guests]);

  // Programme KPIs
  const kpis = useMemo(() => {
    const activeMembers = loyaltyAccounts.filter((a) => a.isActive !== false).length;
    const totalAvailable = loyaltyAccounts.reduce((sum, a) => sum + (a.availablePoints || 0), 0);
    const totalLifetime = loyaltyAccounts.reduce((sum, a) => sum + (a.lifetimePointsEarned || 0), 0);
    const totalRedeemed = loyaltyAccounts.reduce((sum, a) => sum + (a.totalPointsRedeemed || 0), 0);
    return {
      activeMembers,
      totalAvailable,
      totalLifetime,
      totalRedeemed,
      outstandingLiabilityValue: calculateRedemptionMonetaryValue(totalAvailable, policy),
    };
  }, [loyaltyAccounts, policy]);

  // Scan eligible completed & settled stays across all guests (read-only)
  const eligibleBatchStays = useMemo(() => {
    if (!policy.enabled || !policy.enableAutoEarning) return [];
    const results: Array<{ guest: Guest; reservation: Reservation; pointsToAward: number }> = [];
    for (const res of allReservations) {
      if (res.status !== 'checked_out') continue;
      const guest =
        (res.guestId && guestMap[res.guestId]) ||
        guests.find(
          (g) =>
            Boolean(g.email) &&
            Boolean(res.guestEmail) &&
            g.email.toLowerCase().trim() === res.guestEmail!.toLowerCase().trim()
        );
      if (!guest) continue;
      const resLedger = allLedgerEntries.filter(
        (l) => l.reservationId === res.id || (l as any).bookingId === res.id
      );
      const evalRes = evaluateStayEligibilityForAutoEarn(res, hotel, resLedger, loyaltyTransactions);
      if (evalRes.eligible && evalRes.pointsToAward > 0) {
        results.push({ guest, reservation: res, pointsToAward: evalRes.pointsToAward });
      }
    }
    return results;
  }, [policy, allReservations, guestMap, guests, allLedgerEntries, hotel, loyaltyTransactions]);

  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const endMs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;

    return loyaltyTransactions
      .filter((tx) => {
        if (typeFilter !== 'all' && tx.transactionType !== typeFilter) return false;
        if (q) {
          const hay = `${tx.guestName} ${tx.guestEmail || ''} ${tx.guestId} ${tx.reason} ${tx.adminName || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        const txMs = new Date(tx.timestamp || tx.createdAt).getTime();
        if (startMs !== null && txMs < startMs) return false;
        if (endMs !== null && txMs > endMs) return false;
        return true;
      })
      .sort(
        (a, b) =>
          new Date(b.timestamp || b.createdAt).getTime() -
          new Date(a.timestamp || a.createdAt).getTime()
      );
  }, [loyaltyTransactions, searchQuery, typeFilter, startDate, endDate]);

  const sortedAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...loyaltyAccounts]
      .filter((acc) => {
        if (!q) return true;
        return `${acc.guestName} ${acc.guestEmail || ''} ${acc.membershipLevelName}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => (b.availablePoints || 0) - (a.availablePoints || 0));
  }, [loyaltyAccounts, searchQuery]);

  const handleBatchSyncStays = async () => {
    if (!profile || isBatchSyncing || eligibleBatchStays.length === 0) return;
    setIsBatchSyncing(true);
    let awardedCount = 0;
    let totalPts = 0;
    try {
      for (const item of eligibleBatchStays) {
        const resLedger = allLedgerEntries.filter(
          (l) => l.reservationId === item.reservation.id || (l as any).bookingId === item.reservation.id
        );
        const res = await awardAutomaticStayPoints(
          hotel,
          item.guest,
          item.reservation,
          resLedger,
          profile
        );
        if (res.success && !res.duplicate && res.transaction) {
          awardedCount++;
          totalPts += res.transaction.points;
        }
      }
      if (awardedCount > 0) {
        toast.success(
          `Awarded ${totalPts.toLocaleString()} loyalty points across ${awardedCount} settled stay(s).`
        );
      } else {
        toast.info('No new eligible stays pending points.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Batch stay points sync failed.');
    } finally {
      setIsBatchSyncing(false);
    }
  };

  const handleExportHistory = () => {
    if (filteredTransactions.length === 0) {
      toast.info('No loyalty transactions to export.');
      return;
    }
    const rows = filteredTransactions.map((tx) => ({
      Date: safeFormatDate(tx.timestamp || tx.createdAt, 'yyyy-MM-dd HH:mm'),
      Guest: tx.guestName,
      Email: tx.guestEmail || '',
      Type: tx.transactionType,
      PointsDelta: tx.pointsDelta,
      PreviousBalance: tx.previousBalance,
      UpdatedBalance: tx.updatedBalance,
      MonetaryValue: tx.monetaryValue ?? '',
      Reason: tx.reason,
      AuthorizedBy: tx.adminName || 'System',
      ExpiresAt: tx.expiresAt ? safeFormatDate(tx.expiresAt, 'yyyy-MM-dd') : '',
      ReservationId: tx.reservationId || '',
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Loyalty History');
    XLSX.writeFile(wb, `loyalty-transactions-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`Exported ${rows.length} loyalty transaction(s).`);
  };

  return (
    <div className="space-y-6">
      {/* Disabled Banner */}
      {!policy.enabled && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-200 space-y-1">
            <div className="font-bold text-amber-300">
              Guest Loyalty Programme is Currently Disabled
            </div>
            <p className="text-amber-200/80">
              Historical loyalty accounts and transactions remain safely readable below. To enable
              point awards, automatic stay earning, or redemptions, open{' '}
              <strong className="text-amber-100">Admin Controls → Loyalty &amp; Rewards</strong>.
            </p>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl shadow-md">
          <div className="flex items-center justify-between mb-2">
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
              <Users size={15} />
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
              Members
            </span>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Active Loyalty Accounts
          </div>
          <div className="text-2xl font-bold font-mono text-zinc-50 mt-0.5">
            {kpis.activeMembers.toLocaleString()}
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl shadow-md">
          <div className="flex items-center justify-between mb-2">
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
              <Award size={15} />
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400">
              Redeemable
            </span>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Total Available Points
          </div>
          <div className="text-2xl font-bold font-mono text-amber-400 mt-0.5">
            {kpis.totalAvailable.toLocaleString()}
          </div>
          {policy.redemptionPointValue > 0 && (
            <div className="text-[10px] text-zinc-500 mt-0.5">
              Est. value {formatCurrency(kpis.outstandingLiabilityValue, currency, exchangeRate)}
            </div>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl shadow-md">
          <div className="flex items-center justify-between mb-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <TrendingUp size={15} />
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">
              Cumulative
            </span>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Lifetime Points Earned
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-400 mt-0.5">
            {kpis.totalLifetime.toLocaleString()}
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl shadow-md">
          <div className="flex items-center justify-between mb-2">
            <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400">
              <Gift size={15} />
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-purple-400">
              Claimed
            </span>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Total Points Redeemed
          </div>
          <div className="text-2xl font-bold font-mono text-purple-400 mt-0.5">
            {kpis.totalRedeemed.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          {isManager && policy.enabled && policy.allowManualAllocation && (
            <button
              type="button"
              onClick={() => onOpenManageModal(null, 'manual_award')}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold flex items-center gap-1.5 transition-all"
            >
              <PlusCircle size={14} />
              <span>Manage Loyalty Points</span>
            </button>
          )}
          {isManager && policy.enabled && policy.enableAutoEarning && (
            <button
              type="button"
              onClick={handleBatchSyncStays}
              disabled={isBatchSyncing || eligibleBatchStays.length === 0}
              className="px-4 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 transition-all"
            >
              <RefreshCw size={14} className={cn(isBatchSyncing && 'animate-spin')} />
              <span>
                {isBatchSyncing
                  ? 'Syncing Settled Stays...'
                  : `Sync Eligible Settled Stays (${eligibleBatchStays.length})`}
              </span>
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleExportHistory}
          className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-bold flex items-center gap-1.5"
        >
          <Download size={14} />
          <span>Export Loyalty Ledger</span>
        </button>
      </div>

      {/* Active Loyalty Member Balances */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-md space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <Sparkles size={15} className="text-amber-400" />
              Guest Loyalty Balances
            </h3>
            <p className="text-xs text-zinc-400">
              Click any member to inspect their full loyalty profile &amp; redemption options
            </p>
          </div>
          <span className="text-xs text-zinc-400 font-mono">
            {sortedAccounts.length} account{sortedAccounts.length === 1 ? '' : 's'}
          </span>
        </div>

        {sortedAccounts.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-500 bg-zinc-950/50 rounded-xl border border-dashed border-zinc-800">
            No guests have an active loyalty balance yet. Use{' '}
            <strong className="text-zinc-300">Manage Loyalty Points</strong> to award points to an
            existing guest.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sortedAccounts.slice(0, 12).map((acc) => {
              const guest = guestMap[acc.guestId];
              const level = resolveMembershipLevel(acc.lifetimePointsEarned, policy.membershipLevels);
              return (
                <div
                  key={acc.id}
                  onClick={() => guest && onSelectGuest(guest)}
                  className={cn(
                    'p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-amber-500/40 transition-all flex flex-col justify-between gap-2',
                    guest && 'cursor-pointer'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-zinc-100 truncate">{acc.guestName}</div>
                      <div className="text-[10px] text-zinc-500 truncate">
                        {acc.guestEmail || acc.guestPhone || acc.guestId}
                      </div>
                    </div>
                    <span
                      className="px-2 py-0.5 rounded-full text-[9px] font-bold border shrink-0"
                      style={{
                        borderColor: `${level.color || '#f59e0b'}55`,
                        backgroundColor: `${level.color || '#f59e0b'}18`,
                        color: level.color || '#fbbf24',
                      }}
                    >
                      {level.name}
                    </span>
                  </div>
                  <div className="flex items-end justify-between pt-1 border-t border-zinc-900">
                    <div>
                      <div className="text-[9px] uppercase text-zinc-500 font-bold">Available</div>
                      <div className="text-base font-bold font-mono text-amber-400">
                        {acc.availablePoints.toLocaleString()} pts
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] uppercase text-zinc-500 font-bold">Lifetime</div>
                      <div className="text-xs font-mono text-zinc-300">
                        {acc.lifetimePointsEarned.toLocaleString()} pts
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Immutable Loyalty Transaction History */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-md space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <ShieldCheck size={16} className="text-emerald-400" />
              Loyalty Transaction History (Immutable Audit Ledger)
            </h3>
            <p className="text-xs text-zinc-400">
              Historical records cannot be modified or deleted. Corrections must be posted as a new
              adjustment entry.
            </p>
          </div>
          <span className="text-xs font-mono text-zinc-400">
            Showing {filteredTransactions.length} of {loyaltyTransactions.length}
          </span>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by guest, reason, or admin..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500/50"
            />
          </div>

          <div className="relative">
            <Filter
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 focus:outline-none focus:border-amber-500/50"
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="Start Date"
            className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 focus:outline-none focus:border-amber-500/50"
          />

          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="End Date"
            className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 focus:outline-none focus:border-amber-500/50"
          />
        </div>

        {/* Table */}
        {filteredTransactions.length === 0 ? (
          <div className="py-12 text-center text-xs text-zinc-500 bg-zinc-950/50 rounded-xl border border-dashed border-zinc-800">
            No loyalty transactions match the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/60">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  <th className="py-3 px-3">Date &amp; Time</th>
                  <th className="py-3 px-3">Guest</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3 text-right">Points</th>
                  <th className="py-3 px-3 text-right">Prev → New</th>
                  <th className="py-3 px-3">Reason</th>
                  <th className="py-3 px-3">Admin</th>
                  {isManager && policy.enabled && policy.allowManualAllocation && (
                    <th className="py-3 px-3 text-right">Action</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filteredTransactions.slice(0, 100).map((tx) => {
                  const guest = guestMap[tx.guestId];
                  return (
                    <tr key={tx.id} className="hover:bg-zinc-900/50">
                      <td className="py-2.5 px-3 whitespace-nowrap text-zinc-400 text-[11px]">
                        <div>{safeFormatDate(tx.timestamp || tx.createdAt, 'MMM d, yyyy')}</div>
                        <div className="text-[9px] text-zinc-500">
                          {safeFormatDate(tx.timestamp || tx.createdAt, 'h:mm a')}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <button
                          type="button"
                          disabled={!guest}
                          onClick={() => guest && onSelectGuest(guest)}
                          className="text-left hover:text-amber-400 transition-colors"
                        >
                          <div className="font-bold text-zinc-100">{tx.guestName}</div>
                          {tx.guestEmail && (
                            <div className="text-[10px] text-zinc-500">{tx.guestEmail}</div>
                          )}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-zinc-800 text-zinc-300 border border-zinc-700">
                          {tx.transactionType.replace('_', ' ')}
                        </span>
                      </td>
                      <td
                        className={cn(
                          'py-2.5 px-3 text-right font-mono font-bold whitespace-nowrap',
                          tx.pointsDelta > 0
                            ? 'text-emerald-400'
                            : tx.pointsDelta < 0
                              ? 'text-rose-400'
                              : 'text-zinc-400'
                        )}
                      >
                        {tx.pointsDelta > 0
                          ? `+${tx.pointsDelta.toLocaleString()}`
                          : tx.pointsDelta.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-zinc-300 whitespace-nowrap text-[11px]">
                        {tx.previousBalance.toLocaleString()} →{' '}
                        <strong className="text-zinc-100">
                          {tx.updatedBalance.toLocaleString()}
                        </strong>
                      </td>
                      <td className="py-2.5 px-3 text-zinc-300 max-w-xs">
                        <div className="truncate" title={tx.reason}>
                          {tx.reason}
                        </div>
                        {tx.monetaryValue ? (
                          <div className="text-[10px] text-purple-300">
                            Value: {formatCurrency(tx.monetaryValue, currency, exchangeRate)}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-400 text-[11px] whitespace-nowrap">
                        {tx.adminName || 'System'}
                      </td>
                      {isManager && policy.enabled && policy.allowManualAllocation && (
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {guest && (
                            <button
                              type="button"
                              onClick={() => onOpenManageModal(guest, 'reversal')}
                              title="Post a new corrective adjustment entry for this guest"
                              className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-bold inline-flex items-center gap-1"
                            >
                              <RotateCcw size={11} />
                              <span>Adjust</span>
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
