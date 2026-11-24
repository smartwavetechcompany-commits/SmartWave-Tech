import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import {
  AuditLog,
  CityLedgerAccountStatus,
  CityLedgerAccountType,
  CityLedgerInvoice,
  CorporateAccount,
  Hotel,
  LedgerEntry,
  Reservation,
} from '../types';
import {
  buildCityLedgerAccountStatement,
  buildCityLedgerAgeingReport,
  buildCityLedgerReconciliation,
  canPerformCityLedgerAction,
  CITY_LEDGER_ACCOUNT_STATUS_LABELS,
  CITY_LEDGER_ACCOUNT_TYPE_LABELS,
  CITY_LEDGER_INVOICE_STATUS_LABELS,
  computeCityLedgerInvoiceStatus,
  computeDueDate,
  formatISODateOnly,
  getEffectiveAccountStatus,
  getEffectiveAccountType,
  isCityLedgerAccountActive,
  resolveAccountSettlementDays,
  roundMoney,
} from '../services/cityLedgerCore';
import {
  applyCityLedgerInvoiceAdjustment,
  cancelCityLedgerInvoice,
  createCityLedgerInvoice,
  issueCityLedgerInvoice,
  recordCityLedgerInvoicePayment,
} from '../services/cityLedgerService';
import { cn, downloadCsvContent, escapeCsvCell, formatCurrency } from '../utils';
import { safeFormatDate } from '../utils/dateUtils';
import { printDocument } from '../utils/printUtils';
import { exportTableToPDF } from '../utils/pdfExport';
import { toast } from 'sonner';
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  Download,
  FileText,
  History,
  Plus,
  Printer,
  Scale,
  Send,
  ShieldCheck,
  Sliders,
  X,
} from 'lucide-react';

interface CorporateFolioInvoicesPanelProps {
  hotel: Hotel;
  account: CorporateAccount;
  invoices: CityLedgerInvoice[];
  profile: any;
  customRoles: any[];
  currency: 'NGN' | 'USD';
  exchangeRate: number;
}

export function CorporateFolioInvoicesPanel({
  hotel,
  account,
  invoices,
  profile,
  customRoles,
  currency,
  exchangeRate,
}: CorporateFolioInvoicesPanelProps) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [paymentModalInv, setPaymentModalInv] = useState<CityLedgerInvoice | null>(null);
  const [adjustModalInv, setAdjustModalInv] = useState<CityLedgerInvoice | null>(null);
  const [cancelModalInv, setCancelModalInv] = useState<CityLedgerInvoice | null>(null);
  const [previewModalInv, setPreviewModalInv] = useState<CityLedgerInvoice | null>(null);
  const [busy, setBusy] = useState(false);

  const defaultIssueDate = formatISODateOnly(new Date());
  const defaultDueDate = computeDueDate(defaultIssueDate, resolveAccountSettlementDays(account));

  const [newInv, setNewInv] = useState({
    sourceType: 'direct_invoice' as CityLedgerInvoice['sourceType'],
    description: '',
    originalAmount: 0,
    issueDate: defaultIssueDate,
    dueDate: defaultDueDate,
    eventReference: '',
    initialStatus: 'issued' as 'draft' | 'issued',
    postNewLedgerDebit: false,
    notes: '',
  });

  const [payForm, setPayForm] = useState({
    amount: 0,
    paymentDate: defaultIssueDate,
    paymentMethod: 'transfer' as 'cash' | 'card' | 'transfer' | 'cheque' | 'other',
    reference: '',
    notes: '',
  });

  const [adjForm, setAdjForm] = useState({
    type: 'credit_note' as 'credit_note' | 'debit_adjustment' | 'reversal',
    amount: 0,
    reason: '',
    approvedBy: profile?.displayName || profile?.name || profile?.email || '',
  });

  const [cancelReason, setCancelReason] = useState('');

  const canCreate = canPerformCityLedgerAction(profile, 'create_invoice', customRoles);
  const canIssue = canPerformCityLedgerAction(profile, 'issue_invoice', customRoles);
  const canPay = canPerformCityLedgerAction(profile, 'record_payment', customRoles);
  const canAdjust = canPerformCityLedgerAction(profile, 'apply_adjustment', customRoles);
  const canCancel = canPerformCityLedgerAction(profile, 'cancel_invoice', customRoles);
  const accountActive = isCityLedgerAccountActive(account);

  const accountInvoices = useMemo(() => {
    const now = new Date();
    return invoices
      .filter(i => i.corporateId === account.id)
      .map(i => ({ ...i, status: computeCityLedgerInvoiceStatus(i, now) }))
      .filter(i => (statusFilter === 'all' ? true : i.status === statusFilter));
  }, [invoices, account.id, statusFilter]);

  const totals = useMemo(() => {
    const active = accountInvoices.filter(i => i.status !== 'cancelled' && i.status !== 'draft');
    return {
      billed: roundMoney(active.reduce((s, i) => s + (i.originalAmount || 0) + (i.adjustmentsNet || 0), 0)),
      paid: roundMoney(active.reduce((s, i) => s + (i.amountPaid || 0), 0)),
      outstanding: roundMoney(active.reduce((s, i) => s + (i.outstandingAmount || 0), 0)),
      overdueCount: active.filter(i => i.status === 'overdue').length,
    };
  }, [accountInvoices]);

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setBusy(true);
      const created = await createCityLedgerInvoice(
        hotel.id,
        {
          corporateId: account.id,
          sourceType: newInv.sourceType,
          description: newInv.description,
          originalAmount: Number(newInv.originalAmount) || 0,
          issueDate: newInv.issueDate,
          dueDate: newInv.dueDate,
          eventReference: newInv.eventReference || undefined,
          initialStatus: newInv.initialStatus,
          postNewLedgerDebit: newInv.postNewLedgerDebit,
          revenueAlreadyRecognized: !newInv.postNewLedgerDebit,
          notes: newInv.notes || undefined,
        },
        profile,
        customRoles
      );
      toast.success(`Invoice ${created.invoiceNumber} created (${CITY_LEDGER_INVOICE_STATUS_LABELS[created.status]})`);
      setShowCreateModal(false);
      setNewInv({
        sourceType: 'direct_invoice',
        description: '',
        originalAmount: 0,
        issueDate: formatISODateOnly(new Date()),
        dueDate: computeDueDate(new Date(), resolveAccountSettlementDays(account)),
        eventReference: '',
        initialStatus: 'issued',
        postNewLedgerDebit: false,
        notes: '',
      });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create City Ledger invoice');
    } finally {
      setBusy(false);
    }
  };

  const handleIssueDraft = async (inv: CityLedgerInvoice) => {
    try {
      setBusy(true);
      await issueCityLedgerInvoice(hotel.id, inv.id, profile, customRoles);
      toast.success(`Invoice ${inv.invoiceNumber} issued`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to issue invoice');
    } finally {
      setBusy(false);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModalInv) return;
    try {
      setBusy(true);
      const result = await recordCityLedgerInvoicePayment(
        hotel.id,
        paymentModalInv.id,
        {
          amount: Number(payForm.amount) || 0,
          paymentDate: payForm.paymentDate,
          paymentMethod: payForm.paymentMethod,
          reference: payForm.reference,
          notes: payForm.notes,
        },
        profile,
        customRoles
      );
      if (result.isDuplicate) {
        toast.info('Duplicate payment prevented — this payment reference was already recorded.');
      } else {
        toast.success(
          result.updatedInvoice.status === 'paid'
            ? `Invoice ${paymentModalInv.invoiceNumber} is now PAID in full.`
            : `Partial payment recorded. Remaining balance: ${formatCurrency(result.updatedInvoice.outstandingAmount, currency, exchangeRate)}`
        );
      }
      setPaymentModalInv(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to record payment');
    } finally {
      setBusy(false);
    }
  };

  const handleApplyAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustModalInv) return;
    try {
      setBusy(true);
      await applyCityLedgerInvoiceAdjustment(
        hotel.id,
        adjustModalInv.id,
        {
          type: adjForm.type,
          amount: Number(adjForm.amount) || 0,
          reason: adjForm.reason,
          approvedBy: adjForm.approvedBy,
        },
        profile,
        customRoles
      );
      toast.success(`Adjustment applied to ${adjustModalInv.invoiceNumber}`);
      setAdjustModalInv(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to apply adjustment');
    } finally {
      setBusy(false);
    }
  };

  const handleCancelInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelModalInv) return;
    try {
      setBusy(true);
      await cancelCityLedgerInvoice(hotel.id, cancelModalInv.id, cancelReason, profile, customRoles);
      toast.success(`Invoice ${cancelModalInv.invoiceNumber} cancelled`);
      setCancelModalInv(null);
      setCancelReason('');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to cancel invoice');
    } finally {
      setBusy(false);
    }
  };

  const handlePrintInvoice = (inv: CityLedgerInvoice) => {
    setPreviewModalInv(inv);
  };

  const handleExportInvoicePDF = (inv: CityLedgerInvoice) => {
    exportTableToPDF({
      title: `City Ledger Invoice — ${inv.invoiceNumber}`,
      subtitle: `Account: ${account.name} | Issued: ${inv.issueDate} | Due: ${inv.dueDate} | Status: ${CITY_LEDGER_INVOICE_STATUS_LABELS[inv.status]}`,
      hotelName: hotel.name || 'Hotel Property',
      hotelAddress: hotel.branding?.address,
      hotelPhone: hotel.branding?.phone,
      hotelEmail: hotel.branding?.email,
      generatedBy: profile?.displayName || profile?.name || profile?.email || 'Finance',
      currency,
      filename: `invoice_${inv.invoiceNumber}.pdf`,
      headers: ['Description', 'Original', 'Adjustments', 'Paid', 'Balance Due'],
      rows: [
        [
          inv.description,
          formatCurrency(inv.originalAmount, currency, exchangeRate),
          formatCurrency(inv.adjustmentsNet || 0, currency, exchangeRate),
          formatCurrency(inv.amountPaid, currency, exchangeRate),
          formatCurrency(inv.outstandingAmount, currency, exchangeRate),
        ],
      ],
    });
    toast.success(`Invoice ${inv.invoiceNumber} PDF exported`);
  };

  const statusBadgeClass = (st: CityLedgerInvoice['status']) => {
    switch (st) {
      case 'paid':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
      case 'partially_paid':
        return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
      case 'overdue':
        return 'bg-red-500/15 text-red-400 border-red-500/30';
      case 'issued':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
      case 'draft':
        return 'bg-zinc-800 text-zinc-300 border-zinc-700';
      case 'cancelled':
        return 'bg-zinc-900 text-zinc-500 border-zinc-800 line-through';
      default:
        return 'bg-zinc-800 text-zinc-400 border-zinc-700';
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Total Invoiced</div>
          <div className="text-lg font-bold text-zinc-50 mt-1">{formatCurrency(totals.billed, currency, exchangeRate)}</div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Collected on Invoices</div>
          <div className="text-lg font-bold text-emerald-400 mt-1">{formatCurrency(totals.paid, currency, exchangeRate)}</div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Open Invoice Balance</div>
          <div className="text-lg font-bold text-rose-400 mt-1">{formatCurrency(totals.outstanding, currency, exchangeRate)}</div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Overdue Invoices</div>
          <div className="text-lg font-bold text-amber-400 mt-1">{totals.overdueCount}</div>
        </div>
      </div>

      {!accountActive && (
        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-center gap-2">
          <AlertCircle size={16} className="shrink-0" />
          <span>
            This account is currently <strong>{CITY_LEDGER_ACCOUNT_STATUS_LABELS[getEffectiveAccountStatus(account)]}</strong>. New invoices and credit transfers are blocked until approved and active, while payments on existing open invoices remain permitted.
          </span>
        </div>
      )}

      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-zinc-50 uppercase tracking-wider">City Ledger Invoices</h3>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-300 focus:outline-none focus:border-emerald-500"
            >
              <option value="all">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="issued">Issued</option>
              <option value="partially_paid">Partially Paid</option>
              <option value="overdue">Overdue</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          {canCreate && (
            <button
              type="button"
              disabled={!accountActive}
              onClick={() => setShowCreateModal(true)}
              className="px-3.5 py-2 bg-emerald-500 text-black rounded-xl text-xs font-bold hover:bg-emerald-400 disabled:opacity-40 flex items-center gap-1.5 transition-all"
            >
              <Plus size={14} /> Create Invoice
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800 bg-zinc-900/40">
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Description / Source</th>
                <th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Outstanding</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {accountInvoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-xs text-zinc-500">
                    No City Ledger invoices found for this filter. Invoices are created automatically on guest folio transfers or manually above.
                  </td>
                </tr>
              ) : (
                accountInvoices.map(inv => {
                  const expanded = expandedInvoiceId === inv.id;
                  const canAcceptPayment =
                    canPay && inv.status !== 'draft' && inv.status !== 'cancelled' && inv.status !== 'paid' && inv.outstandingAmount > 0.01;
                  return (
                    <React.Fragment key={inv.id}>
                      <tr className="hover:bg-zinc-900/50 transition-colors">
                        <td className="px-4 py-3.5">
                          <button
                            type="button"
                            onClick={() => setExpandedInvoiceId(expanded ? null : inv.id)}
                            className="flex items-center gap-1 text-xs font-mono font-bold text-emerald-400 hover:text-emerald-300"
                          >
                            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            {inv.invoiceNumber}
                          </button>
                          <div className="text-[10px] text-zinc-500 mt-0.5 capitalize">
                            {inv.sourceType.replace('_', ' ')}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="text-xs font-semibold text-zinc-100">{inv.description}</div>
                          <div className="text-[10px] text-zinc-500 flex items-center gap-2 flex-wrap mt-0.5">
                            {inv.folioNumber && <span>Folio: {inv.folioNumber}</span>}
                            {inv.guestName && <span>Guest: {inv.guestName}</span>}
                            {inv.roomNumber && <span>Room {inv.roomNumber}</span>}
                            {inv.revenueAlreadyRecognized && (
                              <span className="text-emerald-500/80">Revenue Already Recognized</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-zinc-400">
                          <div>Issued: {inv.issueDate}</div>
                          <div className={cn(inv.status === 'overdue' ? 'text-red-400 font-bold' : 'text-zinc-500')}>
                            Due: {inv.dueDate}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold uppercase border', statusBadgeClass(inv.status))}>
                            {CITY_LEDGER_INVOICE_STATUS_LABELS[inv.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right text-xs font-bold text-zinc-200">
                          {formatCurrency(inv.originalAmount, currency, exchangeRate)}
                          {(inv.adjustmentsNet || 0) !== 0 && (
                            <div className="text-[10px] text-amber-400">
                              Adj: {inv.adjustmentsNet! > 0 ? '+' : ''}{formatCurrency(inv.adjustmentsNet || 0, currency, exchangeRate)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right text-xs font-bold text-emerald-400">
                          {formatCurrency(inv.amountPaid, currency, exchangeRate)}
                        </td>
                        <td className={cn('px-4 py-3.5 text-right text-xs font-bold', inv.outstandingAmount > 0.01 ? 'text-rose-400' : 'text-emerald-400')}>
                          {formatCurrency(inv.outstandingAmount, currency, exchangeRate)}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex justify-end items-center gap-1.5 flex-wrap">
                            {inv.status === 'draft' && canIssue && (
                              <button
                                type="button"
                                disabled={busy || !accountActive}
                                onClick={() => handleIssueDraft(inv)}
                                className="px-2 py-1 bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500 hover:text-white rounded-lg text-[10px] font-bold flex items-center gap-1"
                              >
                                <Send size={11} /> Issue
                              </button>
                            )}
                            {canAcceptPayment && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPayForm({
                                    amount: inv.outstandingAmount,
                                    paymentDate: formatISODateOnly(new Date()),
                                    paymentMethod: 'transfer',
                                    reference: '',
                                    notes: '',
                                  });
                                  setPaymentModalInv(inv);
                                }}
                                className="px-2.5 py-1 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500 hover:text-black rounded-lg text-[10px] font-bold flex items-center gap-1"
                              >
                                <CreditCard size={11} /> Pay
                              </button>
                            )}
                            {canAdjust && inv.status !== 'cancelled' && inv.status !== 'draft' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setAdjForm({
                                    type: 'credit_note',
                                    amount: 0,
                                    reason: '',
                                    approvedBy: profile?.displayName || profile?.name || profile?.email || '',
                                  });
                                  setAdjustModalInv(inv);
                                }}
                                className="p-1.5 text-amber-400 hover:bg-amber-500/10 rounded-lg"
                                title="Apply Authorized Adjustment / Credit Note"
                              >
                                <Sliders size={14} />
                              </button>
                            )}
                            {canCancel && inv.status !== 'cancelled' && (inv.amountPaid || 0) <= 0.01 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCancelReason('');
                                  setCancelModalInv(inv);
                                }}
                                className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg"
                                title="Cancel Invoice"
                              >
                                <Ban size={14} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handlePrintInvoice(inv)}
                              className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg"
                              title="Preview & Print Invoice"
                            >
                              <Printer size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-zinc-900/30">
                          <td colSpan={8} className="px-6 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                              <div className="space-y-2">
                                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                                  Payment History ({(inv.payments || []).length})
                                </div>
                                {(inv.payments || []).length === 0 ? (
                                  <div className="text-zinc-500 italic">No payments recorded against this invoice yet.</div>
                                ) : (
                                  <div className="space-y-1.5">
                                    {(inv.payments || []).map(p => (
                                      <div key={p.id} className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2">
                                        <div>
                                          <div className="text-zinc-200 font-semibold">
                                            {p.paymentDate} • {p.paymentMethod.toUpperCase()}
                                            {p.reference ? ` • Ref: ${p.reference}` : ''}
                                          </div>
                                          <div className="text-[10px] text-zinc-500">
                                            By {p.recordedByName}{p.notes ? ` — ${p.notes}` : ''}
                                          </div>
                                        </div>
                                        <div className="font-bold text-emerald-400">
                                          {formatCurrency(p.amount, currency, exchangeRate)}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="space-y-2">
                                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                                  Adjustments & Audit Notes ({(inv.adjustments || []).length})
                                </div>
                                {(inv.adjustments || []).length === 0 ? (
                                  <div className="text-zinc-500 italic">No adjustments applied to this invoice.</div>
                                ) : (
                                  <div className="space-y-1.5">
                                    {(inv.adjustments || []).map(a => (
                                      <div key={a.id} className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2">
                                        <div>
                                          <div className="text-zinc-200 font-semibold capitalize">
                                            {a.type.replace('_', ' ')} — {a.reason}
                                          </div>
                                          <div className="text-[10px] text-zinc-500">
                                            Approved by {a.approvedBy} • Recorded by {a.recordedByName}
                                          </div>
                                        </div>
                                        <div className="font-bold text-amber-400">
                                          {a.type === 'debit_adjustment' ? '+' : '-'}{formatCurrency(a.amount, currency, exchangeRate)}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Invoice Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-zinc-50">Create City Ledger Invoice</h3>
                <p className="text-xs text-zinc-400">{account.name}</p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-zinc-500 hover:text-zinc-100">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateInvoice} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Invoice Source</label>
                  <select
                    value={newInv.sourceType}
                    onChange={(e) => setNewInv({ ...newInv, sourceType: e.target.value as any })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
                  >
                    <option value="direct_invoice">Direct Corporate Billing</option>
                    <option value="corporate_stay">Corporate Stay Summary</option>
                    <option value="event_billing">Event / Banquet Billing</option>
                    <option value="group_booking">Group Booking Invoice</option>
                    <option value="folio_transfer">Transferred Guest Folio</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Initial Status</label>
                  <select
                    value={newInv.initialStatus}
                    onChange={(e) => setNewInv({ ...newInv, initialStatus: e.target.value as any })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
                  >
                    <option value="issued">Issued Immediately</option>
                    <option value="draft">Save as Draft</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Description</label>
                <input
                  required
                  type="text"
                  value={newInv.description}
                  onChange={(e) => setNewInv({ ...newInv, description: e.target.value })}
                  placeholder="e.g. Q3 Corporate Accommodation / Conference Banquet Billing"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Amount ({currency})</label>
                  <input
                    required
                    type="number"
                    min="1"
                    step="0.01"
                    value={newInv.originalAmount || ''}
                    onChange={(e) => setNewInv({ ...newInv, originalAmount: Number(e.target.value) })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Issue Date</label>
                  <input
                    required
                    type="date"
                    value={newInv.issueDate}
                    onChange={(e) =>
                      setNewInv({
                        ...newInv,
                        issueDate: e.target.value,
                        dueDate: computeDueDate(e.target.value, resolveAccountSettlementDays(account)),
                      })
                    }
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Due Date</label>
                  <input
                    required
                    type="date"
                    value={newInv.dueDate}
                    onChange={(e) => setNewInv({ ...newInv, dueDate: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
                  />
                </div>
              </div>
              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-zinc-950 border border-zinc-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newInv.postNewLedgerDebit}
                  onChange={(e) => setNewInv({ ...newInv, postNewLedgerDebit: e.target.checked })}
                  className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-emerald-500"
                />
                <div className="text-[11px] text-zinc-300">
                  <div className="font-bold">Post as new unbilled corporate charge to ledger</div>
                  <div className="text-zinc-500">
                    Leave unchecked for transferred guest folios or stays already posted to the PMS ledger so revenue is never double-counted.
                  </div>
                </div>
              </label>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 py-2.5 bg-emerald-500 text-black rounded-xl text-xs font-bold hover:bg-emerald-400 disabled:opacity-50"
                >
                  {busy ? 'Creating...' : 'Create Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Partial / Full Invoice Payment Modal */}
      {paymentModalInv && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-zinc-50">Record Invoice Payment</h3>
                <p className="text-xs text-zinc-400">{paymentModalInv.invoiceNumber} — {account.name}</p>
              </div>
              <button onClick={() => setPaymentModalInv(null)} className="text-zinc-500 hover:text-zinc-100">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleRecordPayment} className="p-5 space-y-4">
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex justify-between items-center text-xs">
                <span className="text-zinc-400">Remaining Invoice Balance</span>
                <span className="text-base font-bold text-rose-400">
                  {formatCurrency(paymentModalInv.outstandingAmount, currency, exchangeRate)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Payment Amount</label>
                  <input
                    required
                    type="number"
                    min="0.01"
                    max={paymentModalInv.outstandingAmount}
                    step="0.01"
                    value={payForm.amount || ''}
                    onChange={(e) => setPayForm({ ...payForm, amount: Number(e.target.value) })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Payment Date</label>
                  <input
                    required
                    type="date"
                    value={payForm.paymentDate}
                    onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Method</label>
                  <select
                    value={payForm.paymentMethod}
                    onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value as any })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
                  >
                    <option value="transfer">Bank Transfer</option>
                    <option value="cash">Cash</option>
                    <option value="card">Card / POS</option>
                    <option value="cheque">Cheque</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Transaction Reference</label>
                  <input
                    type="text"
                    value={payForm.reference}
                    onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                    placeholder="e.g. TRF-88412"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Notes</label>
                <input
                  type="text"
                  value={payForm.notes}
                  onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
                  placeholder="Optional payment note or installment label..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPaymentModalInv(null)}
                  className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || payForm.amount <= 0 || payForm.amount > paymentModalInv.outstandingAmount + 0.01}
                  className="flex-1 py-2.5 bg-emerald-500 text-black rounded-xl text-xs font-bold hover:bg-emerald-400 disabled:opacity-50"
                >
                  {busy ? 'Recording...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjustment / Credit Note Modal */}
      {adjustModalInv && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-zinc-50">Authorized Invoice Adjustment</h3>
                <p className="text-xs text-zinc-400">{adjustModalInv.invoiceNumber}</p>
              </div>
              <button onClick={() => setAdjustModalInv(null)} className="text-zinc-500 hover:text-zinc-100">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleApplyAdjustment} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Adjustment Type</label>
                  <select
                    value={adjForm.type}
                    onChange={(e) => setAdjForm({ ...adjForm, type: e.target.value as any })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
                  >
                    <option value="credit_note">Credit Note (-)</option>
                    <option value="reversal">Reversal (-)</option>
                    <option value="debit_adjustment">Debit Adjustment (+)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Amount</label>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={adjForm.amount || ''}
                    onChange={(e) => setAdjForm({ ...adjForm, amount: Number(e.target.value) })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Approved By</label>
                <input
                  required
                  type="text"
                  value={adjForm.approvedBy}
                  onChange={(e) => setAdjForm({ ...adjForm, approvedBy: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Audit Reason</label>
                <textarea
                  required
                  rows={3}
                  value={adjForm.reason}
                  onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })}
                  placeholder="Enter mandatory justification for adjustment..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 resize-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setAdjustModalInv(null)} className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="flex-1 py-2.5 bg-amber-500 text-black rounded-xl text-xs font-bold hover:bg-amber-400 disabled:opacity-50">
                  {busy ? 'Applying...' : 'Apply Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Invoice Modal */}
      {cancelModalInv && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-zinc-800">
              <h3 className="text-lg font-bold text-zinc-50">Cancel Invoice {cancelModalInv.invoiceNumber}</h3>
              <p className="text-xs text-zinc-400 mt-0.5">Cancelled invoices remain preserved in the audit trail and are excluded from Debt Ageing.</p>
            </div>
            <form onSubmit={handleCancelInvoice} className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Cancellation Reason</label>
                <textarea
                  required
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Enter mandatory reason for cancellation..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 resize-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setCancelModalInv(null)} className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold">
                  Keep Invoice
                </button>
                <button type="submit" disabled={busy} className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-xs font-bold hover:bg-red-400 disabled:opacity-50">
                  {busy ? 'Cancelling...' : 'Confirm Cancel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Invoice Preview Modal */}
      {previewModalInv && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[95] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl my-auto">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950">
              <span className="text-sm font-bold text-zinc-100">Invoice Preview — {previewModalInv.invoiceNumber}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleExportInvoicePDF(previewModalInv)}
                  className="px-3 py-1.5 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 rounded-xl text-xs font-bold flex items-center gap-1"
                >
                  <FileText size={13} /> PDF
                </button>
                <button
                  type="button"
                  onClick={() =>
                    printDocument(document.getElementById('city-ledger-invoice-preview'), {
                      title: `${hotel.name || 'Hotel'} - Invoice ${previewModalInv.invoiceNumber}`,
                      pageSize: 'A4 portrait',
                      pageMargin: '10mm',
                    })
                  }
                  className="px-3 py-1.5 bg-emerald-500 text-black hover:bg-emerald-400 rounded-xl text-xs font-bold flex items-center gap-1"
                >
                  <Printer size={13} /> Print
                </button>
                <button type="button" onClick={() => setPreviewModalInv(null)} className="text-zinc-500 hover:text-zinc-100 p-1">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div id="city-ledger-invoice-preview" data-printable="true" className="p-8 bg-white text-zinc-900 space-y-6">
              <div className="flex justify-between items-start border-b border-zinc-200 pb-4">
                <div>
                  <h2 className="text-xl font-black text-zinc-900">{hotel.name || 'Hotel Property'}</h2>
                  {hotel.branding?.address && <p className="text-xs text-zinc-600">{hotel.branding.address}</p>}
                  <p className="text-xs text-zinc-600">{[hotel.branding?.phone, hotel.branding?.email].filter(Boolean).join(' | ')}</p>
                </div>
                <div className="text-right">
                  <div className="text-xs font-black uppercase tracking-widest text-emerald-700">City Ledger Invoice</div>
                  <div className="text-lg font-mono font-bold text-zinc-900">{previewModalInv.invoiceNumber}</div>
                  <div className="text-xs text-zinc-600">Issued: {previewModalInv.issueDate} | Due: {previewModalInv.dueDate}</div>
                  <div className="text-xs font-bold uppercase text-zinc-800 mt-0.5">
                    Status: {CITY_LEDGER_INVOICE_STATUS_LABELS[previewModalInv.status]}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-xs bg-zinc-50 p-4 rounded-xl border border-zinc-200">
                <div>
                  <div className="text-[10px] font-bold uppercase text-zinc-500 mb-1">Bill To</div>
                  <div className="font-bold text-sm text-zinc-900">{account.name}</div>
                  <div>{CITY_LEDGER_ACCOUNT_TYPE_LABELS[getEffectiveAccountType(account)]}</div>
                  {account.accountReference && <div>Ref: {account.accountReference}</div>}
                  <div>Attn: {account.contactPerson}</div>
                  <div>{account.email} {account.phone ? `| ${account.phone}` : ''}</div>
                  {(account.billingAddress || account.address) && <div>{account.billingAddress || account.address}</div>}
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-zinc-500 mb-1">Billing Details</div>
                  <div>Payment Terms: <strong>{account.paymentTerms || `Net ${resolveAccountSettlementDays(account)}`}</strong></div>
                  {previewModalInv.folioNumber && <div>Source Folio: <strong>{previewModalInv.folioNumber}</strong></div>}
                  {previewModalInv.guestName && (
                    <div>Guest: <strong>{previewModalInv.guestName}</strong>{previewModalInv.roomNumber ? ` (Room ${previewModalInv.roomNumber})` : ''}</div>
                  )}
                  {previewModalInv.eventReference && <div>Event Ref: <strong>{previewModalInv.eventReference}</strong></div>}
                </div>
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b-2 border-zinc-300 text-[10px] uppercase text-zinc-600">
                    <th className="py-2">Description</th>
                    <th className="py-2 text-right">Original</th>
                    <th className="py-2 text-right">Adjustments</th>
                    <th className="py-2 text-right">Paid</th>
                    <th className="py-2 text-right">Balance Due</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-zinc-200">
                    <td className="py-3 font-medium text-zinc-900">{previewModalInv.description}</td>
                    <td className="py-3 text-right">{formatCurrency(previewModalInv.originalAmount, currency, exchangeRate)}</td>
                    <td className="py-3 text-right">{formatCurrency(previewModalInv.adjustmentsNet || 0, currency, exchangeRate)}</td>
                    <td className="py-3 text-right text-emerald-700 font-semibold">{formatCurrency(previewModalInv.amountPaid, currency, exchangeRate)}</td>
                    <td className="py-3 text-right font-bold text-zinc-900">{formatCurrency(previewModalInv.outstandingAmount, currency, exchangeRate)}</td>
                  </tr>
                </tbody>
              </table>
              {(previewModalInv.payments || []).length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase text-zinc-500 mb-2">Payments Recorded</div>
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 text-[10px] uppercase text-zinc-500">
                        <th className="py-1.5">Date</th>
                        <th className="py-1.5">Method</th>
                        <th className="py-1.5">Reference</th>
                        <th className="py-1.5">Recorded By</th>
                        <th className="py-1.5 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(previewModalInv.payments || []).map(p => (
                        <tr key={p.id} className="border-b border-zinc-100">
                          <td className="py-1.5">{p.paymentDate}</td>
                          <td className="py-1.5 uppercase">{p.paymentMethod}</td>
                          <td className="py-1.5">{p.reference || '—'}</td>
                          <td className="py-1.5">{p.recordedByName}</td>
                          <td className="py-1.5 text-right font-semibold">{formatCurrency(p.amount, currency, exchangeRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="text-[10px] text-zinc-500 border-t border-zinc-200 pt-3 flex justify-between">
                <span>Generated by {profile?.displayName || profile?.name || profile?.email || 'Finance'}</span>
                <span>{new Date().toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface CorporateFolioStatementPanelProps {
  hotel: Hotel;
  account: CorporateAccount;
  ledgerEntries: LedgerEntry[];
  invoices: CityLedgerInvoice[];
  profile: any;
  currency: 'NGN' | 'USD';
  exchangeRate: number;
}

export function CorporateFolioStatementPanel({
  hotel,
  account,
  ledgerEntries,
  invoices,
  profile,
  currency,
  exchangeRate,
}: CorporateFolioStatementPanelProps) {
  const today = formatISODateOnly(new Date());
  const firstOfMonth = `${today.slice(0, 8)}01`;
  const [startDate, setStartDate] = useState<string>(firstOfMonth);
  const [endDate, setEndDate] = useState<string>(today);

  const statement = useMemo(
    () =>
      buildCityLedgerAccountStatement(account, ledgerEntries, invoices, {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      }),
    [account, ledgerEntries, invoices, startDate, endDate]
  );

  const applyPreset = (days: number | 'all') => {
    const end = new Date();
    setEndDate(formatISODateOnly(end));
    if (days === 'all') {
      setStartDate('');
      return;
    }
    const start = new Date(end.getTime());
    start.setDate(start.getDate() - days);
    setStartDate(formatISODateOnly(start));
  };

  const handlePrintStatement = () => {
    printDocument(document.getElementById('city-ledger-statement-printable'), {
      title: `${hotel.name || 'Hotel'} - Account Statement - ${account.name}`,
      pageSize: 'A4 portrait',
      pageMargin: '8mm',
    });
  };

  const handleExportPDF = () => {
    exportTableToPDF({
      title: `City Ledger Account Statement — ${account.name}`,
      subtitle: `Period: ${statement.periodStart} to ${statement.periodEnd} | Opening: ${formatCurrency(statement.openingBalance, currency, exchangeRate)} | Closing: ${formatCurrency(statement.closingBalance, currency, exchangeRate)}`,
      hotelName: hotel.name || 'Hotel Property',
      hotelAddress: hotel.branding?.address,
      hotelPhone: hotel.branding?.phone,
      hotelEmail: hotel.branding?.email,
      generatedBy: profile?.displayName || profile?.name || profile?.email || 'Finance',
      currency,
      filename: `statement_${account.name.replace(/[^a-zA-Z0-9]/g, '_')}_${statement.periodEnd}.pdf`,
      headers: ['Date', 'Reference', 'Type', 'Description', 'Debit', 'Credit', 'Balance'],
      rows: [
        [statement.periodStart, 'OPENING', 'BAL', 'Opening Balance', '-', '-', formatCurrency(statement.openingBalance, currency, exchangeRate)],
        ...statement.lines.map(l => [
          safeFormatDate(l.date, 'yyyy-MM-dd'),
          l.reference,
          l.type.toUpperCase(),
          l.description,
          l.debit > 0 ? formatCurrency(l.debit, currency, exchangeRate) : '-',
          l.credit > 0 ? formatCurrency(l.credit, currency, exchangeRate) : '-',
          formatCurrency(l.runningBalance, currency, exchangeRate),
        ]),
      ],
    });
    toast.success('Account statement PDF exported');
  };

  const handleExportCSV = () => {
    const headers = ['Date', 'Reference', 'Type', 'Description', 'Debit', 'Credit', 'RunningBalance'];
    const rows = [
      [statement.periodStart, 'OPENING', 'opening', 'Opening Balance', 0, 0, statement.openingBalance],
      ...statement.lines.map(l => [
        safeFormatDate(l.date, 'yyyy-MM-dd'),
        l.reference,
        l.type,
        l.description,
        l.debit,
        l.credit,
        l.runningBalance,
      ]),
    ];
    const csv = [headers.join(','), ...rows.map(r => r.map(escapeCsvCell).join(','))].join('\r\n');
    downloadCsvContent(csv, `statement_${account.name.replace(/\s+/g, '_')}_${statement.periodEnd}.csv`);
    toast.success('Account statement CSV exported');
  };

  return (
    <div className="space-y-6">
      <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-zinc-500 uppercase">From</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-200"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-zinc-500 uppercase">To</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-200"
            />
          </div>
          <button type="button" onClick={() => applyPreset(30)} className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-[10px] font-bold text-zinc-300 rounded-lg border border-zinc-800">
            Last 30d
          </button>
          <button type="button" onClick={() => applyPreset(90)} className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-[10px] font-bold text-zinc-300 rounded-lg border border-zinc-800">
            Last 90d
          </button>
          <button type="button" onClick={() => applyPreset('all')} className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-[10px] font-bold text-zinc-300 rounded-lg border border-zinc-800">
            All Time
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handlePrintStatement} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-bold flex items-center gap-1.5">
            <Printer size={13} /> Print
          </button>
          <button type="button" onClick={handleExportCSV} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-bold flex items-center gap-1.5">
            <Download size={13} /> CSV
          </button>
          <button type="button" onClick={handleExportPDF} className="px-3 py-1.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 rounded-xl text-xs font-bold flex items-center gap-1.5">
            <FileText size={13} /> PDF
          </button>
        </div>
      </div>

      <div id="city-ledger-statement-printable" data-printable="true" className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="text-[10px] font-bold text-zinc-500 uppercase">Opening Balance</div>
          <div className="text-base font-bold text-zinc-100 mt-1">{formatCurrency(statement.openingBalance, currency, exchangeRate)}</div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="text-[10px] font-bold text-zinc-500 uppercase">Invoices / Charges</div>
          <div className="text-base font-bold text-amber-400 mt-1">{formatCurrency(statement.invoicesRaised, currency, exchangeRate)}</div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="text-[10px] font-bold text-zinc-500 uppercase">Payments Received</div>
          <div className="text-base font-bold text-emerald-400 mt-1">{formatCurrency(statement.paymentsReceived, currency, exchangeRate)}</div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="text-[10px] font-bold text-zinc-500 uppercase">Adjustments</div>
          <div className="text-base font-bold text-blue-400 mt-1">{formatCurrency(statement.adjustmentsNet, currency, exchangeRate)}</div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="text-[10px] font-bold text-zinc-500 uppercase">Closing Balance</div>
          <div className={cn('text-base font-bold mt-1', statement.closingBalance > 0.01 ? 'text-rose-400' : 'text-emerald-400')}>
            {formatCurrency(statement.closingBalance, currency, exchangeRate)}
          </div>
        </div>
      </div>

      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800 bg-zinc-900/40">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Debit</th>
                <th className="px-4 py-3 text-right">Credit</th>
                <th className="px-4 py-3 text-right">Running Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 text-xs">
              <tr className="bg-zinc-900/30">
                <td className="px-4 py-3 text-zinc-400">{statement.periodStart}</td>
                <td className="px-4 py-3 font-mono text-zinc-400">OPENING</td>
                <td className="px-4 py-3"><span className="px-1.5 py-0.5 bg-zinc-800 text-zinc-300 rounded text-[9px] font-bold uppercase">Balance</span></td>
                <td className="px-4 py-3 font-semibold text-zinc-200">Opening Balance Brought Forward</td>
                <td className="px-4 py-3 text-right text-zinc-500">—</td>
                <td className="px-4 py-3 text-right text-zinc-500">—</td>
                <td className="px-4 py-3 text-right font-bold text-zinc-100">{formatCurrency(statement.openingBalance, currency, exchangeRate)}</td>
              </tr>
              {statement.lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-zinc-500 italic">
                    No ledger activity during the selected statement period.
                  </td>
                </tr>
              ) : (
                statement.lines.map(line => (
                  <tr key={line.id} className="hover:bg-zinc-900/40">
                    <td className="px-4 py-3 text-zinc-400">{safeFormatDate(line.date, 'yyyy-MM-dd')}</td>
                    <td className="px-4 py-3 font-mono text-zinc-300">{line.reference}</td>
                    <td className="px-4 py-3">
                      <span className="px-1.5 py-0.5 bg-zinc-800 text-zinc-300 rounded text-[9px] font-bold uppercase">{line.type}</span>
                    </td>
                    <td className="px-4 py-3 text-zinc-200">{line.description}</td>
                    <td className="px-4 py-3 text-right font-semibold text-rose-400">
                      {line.debit > 0 ? formatCurrency(line.debit, currency, exchangeRate) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-400">
                      {line.credit > 0 ? formatCurrency(line.credit, currency, exchangeRate) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-zinc-100">
                      {formatCurrency(line.runningBalance, currency, exchangeRate)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
  );
}

interface CorporateFolioAuditTrailPanelProps {
  hotelId: string;
  accountId: string;
}

export function CorporateFolioAuditTrailPanel({ hotelId, accountId }: CorporateFolioAuditTrailPanelProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hotelId || !accountId) return;
    const q = query(collection(db, 'hotels', hotelId, 'activityLogs'), where('module', '==', 'City Ledger'));
    const unsub = onSnapshot(
      q,
      snap => {
        const list = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as AuditLog))
          .filter(
            l =>
              l.targetId === accountId ||
              (l.metadata && (l.metadata as any).corporateId === accountId) ||
              (l.newValue && (l.newValue as any).corporateId === accountId)
          )
          .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
        setLogs(list);
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );
    return () => {
      try {
        unsub();
      } catch (_) {}
    };
  }, [hotelId, accountId]);

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History size={16} className="text-emerald-400" />
          <h3 className="text-sm font-bold text-zinc-50 uppercase tracking-wider">Immutable City Ledger Audit Trail</h3>
        </div>
        <span className="text-[10px] font-bold text-zinc-500 uppercase">{logs.length} Event(s)</span>
      </div>
      <div className="divide-y divide-zinc-800 max-h-[460px] overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-xs text-zinc-500">Loading audit events...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500 italic">
            No City Ledger audit events recorded yet for this account.
          </div>
        ) : (
          logs.map(log => (
            <div key={log.id} className="p-4 hover:bg-zinc-900/40 transition-colors space-y-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded bg-zinc-800 text-emerald-400 font-mono text-[10px] font-bold">
                  {log.action}
                </span>
                <span className="text-[11px] text-zinc-500">
                  {safeFormatDate(log.timestamp, 'MMM d, yyyy HH:mm:ss')}
                </span>
              </div>
              <div className="text-xs text-zinc-200">{log.details}</div>
              <div className="text-[10px] text-zinc-500 flex items-center gap-3 flex-wrap">
                <span>User: <strong className="text-zinc-300">{log.userName || log.userEmail || log.userId}</strong> ({log.userRole})</span>
                {(log.metadata as any)?.transactionRef && (
                  <span>Ref: <strong className="font-mono text-zinc-300">{(log.metadata as any).transactionRef}</strong></span>
                )}
                {log.oldValue && (
                  <span>Prev: <code className="text-zinc-400">{JSON.stringify(log.oldValue)}</code></span>
                )}
                {log.newValue && (
                  <span>New: <code className="text-emerald-400/90">{JSON.stringify(log.newValue)}</code></span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface CityLedgerAgeingAndReconciliationPanelProps {
  hotel: Hotel | null;
  profile: any;
  corporateAccounts: CorporateAccount[];
  invoices: CityLedgerInvoice[];
  ledgerEntries: LedgerEntry[];
  reservations: Reservation[];
  outstandingGuestBalancesTotal: number;
  currency: 'NGN' | 'USD';
  exchangeRate: number;
  onOpenAccountFolio?: (account: CorporateAccount) => void;
  lockedAccountId?: string;
}

export function CityLedgerAgeingAndReconciliationPanel({
  hotel,
  profile,
  corporateAccounts,
  invoices,
  ledgerEntries,
  reservations,
  outstandingGuestBalancesTotal,
  currency,
  exchangeRate,
  onOpenAccountFolio,
  lockedAccountId,
}: CityLedgerAgeingAndReconciliationPanelProps) {
  const [asOfDate, setAsOfDate] = useState<string>(formatISODateOnly(new Date()));
  const [accountTypeFilter, setAccountTypeFilter] = useState<CityLedgerAccountType | 'all'>('all');
  const [accountStatusFilter, setAccountStatusFilter] = useState<CityLedgerAccountStatus | 'all'>('all');
  const [selectedAccountId, setSelectedAccountId] = useState<string>(lockedAccountId || 'all');
  const [viewMode, setViewMode] = useState<'consolidated' | 'invoices'>('consolidated');

  const effectiveAccountId = lockedAccountId || (selectedAccountId === 'all' ? undefined : selectedAccountId);

  const ageingReport = useMemo(
    () =>
      buildCityLedgerAgeingReport(corporateAccounts, invoices, ledgerEntries, {
        asOfDate: new Date(`${asOfDate}T12:00:00`),
        accountId: effectiveAccountId,
        accountType: accountTypeFilter,
        accountStatus: accountStatusFilter,
      }),
    [corporateAccounts, invoices, ledgerEntries, asOfDate, effectiveAccountId, accountTypeFilter, accountStatusFilter]
  );

  const reconciliation = useMemo(
    () =>
      buildCityLedgerReconciliation({
        ledgerEntries,
        reservations,
        corporateAccounts,
        invoices,
        outstandingGuestBalancesTotal,
      }),
    [ledgerEntries, reservations, corporateAccounts, invoices, outstandingGuestBalancesTotal]
  );

  const handleExportAgeingCSV = () => {
    if (viewMode === 'consolidated') {
      const headers = ['Account', 'Category', 'Status', 'Terms', '0-30 Days', '31-60 Days', '61-90 Days', '>90 Days', 'Total Outstanding', 'Overdue Total'];
      const rows = ageingReport.accounts.map(r => [
        r.accountName,
        CITY_LEDGER_ACCOUNT_TYPE_LABELS[r.accountType],
        CITY_LEDGER_ACCOUNT_STATUS_LABELS[r.accountStatus],
        r.paymentTerms,
        r.bucket0To30,
        r.bucket31To60,
        r.bucket61To90,
        r.bucketOver90,
        r.totalOutstanding,
        r.overdueTotal,
      ]);
      const csv = [headers.join(','), ...rows.map(r => r.map(escapeCsvCell).join(','))].join('\r\n');
      downloadCsvContent(csv, `city_ledger_ageing_${asOfDate}.csv`);
    } else {
      const headers = ['Invoice #', 'Account', 'Issue Date', 'Due Date', 'Days Past Due', 'Bucket', 'Original', 'Paid', 'Outstanding', 'Status'];
      const rows = ageingReport.invoices.map(inv => [
        inv.invoiceNumber,
        inv.accountName,
        inv.issueDate,
        inv.dueDate,
        inv.daysPastDue,
        inv.bucket,
        inv.originalAmount,
        inv.amountPaid,
        inv.outstandingAmount,
        inv.status,
      ]);
      const csv = [headers.join(','), ...rows.map(r => r.map(escapeCsvCell).join(','))].join('\r\n');
      downloadCsvContent(csv, `city_ledger_invoice_ageing_${asOfDate}.csv`);
    }
    toast.success('Debt Ageing CSV exported');
  };

  const handleExportAgeingPDF = () => {
    const hotelName = hotel?.name || 'Hotel Property';
    const cleanHotel = hotelName.replace(/[^a-zA-Z0-9]/g, '_');
    exportTableToPDF({
      title: 'City Ledger Debt Ageing Report',
      subtitle: `As of ${ageingReport.asOfDate} | 0-30: ${formatCurrency(ageingReport.summary.bucket0To30, currency, exchangeRate)} | 31-60: ${formatCurrency(ageingReport.summary.bucket31To60, currency, exchangeRate)} | 61-90: ${formatCurrency(ageingReport.summary.bucket61To90, currency, exchangeRate)} | >90: ${formatCurrency(ageingReport.summary.bucketOver90, currency, exchangeRate)}`,
      hotelName,
      hotelAddress: hotel?.branding?.address,
      hotelPhone: hotel?.branding?.phone,
      hotelEmail: hotel?.branding?.email,
      generatedBy: profile?.displayName || profile?.name || profile?.email || 'Finance',
      currency,
      filename: `${cleanHotel}_city_ledger_ageing_${ageingReport.asOfDate}.pdf`,
      headers: ['Account', 'Category', '0-30 Days', '31-60 Days', '61-90 Days', '>90 Days', 'Total Open'],
      rows: ageingReport.accounts.map(r => [
        r.accountName,
        CITY_LEDGER_ACCOUNT_TYPE_LABELS[r.accountType],
        formatCurrency(r.bucket0To30, currency, exchangeRate),
        formatCurrency(r.bucket31To60, currency, exchangeRate),
        formatCurrency(r.bucket61To90, currency, exchangeRate),
        formatCurrency(r.bucketOver90, currency, exchangeRate),
        formatCurrency(r.totalOutstanding, currency, exchangeRate),
      ]),
    });
    toast.success('Debt Ageing PDF exported');
  };

  const handlePrintAgeing = () => {
    printDocument(document.getElementById('city-ledger-ageing-printable'), {
      title: `${hotel?.name || 'Hotel'} - City Ledger Debt Ageing Report (${ageingReport.asOfDate})`,
      pageSize: 'A4 landscape',
      pageMargin: '8mm',
    });
  };

  return (
    <div className="space-y-6">
      {/* Financial Reconciliation Summary (Consolidated view only) */}
      {!lockedAccountId && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
                <Scale size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-50">City Ledger & Revenue Reconciliation</h3>
                <p className="text-[11px] text-zinc-400">
                  Separates earned revenue from guest transfers and receivables collections — zero duplicate revenue recognition.
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck size={12} /> Zero Transfer Revenue Duplication Verified
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="bg-zinc-950 border border-zinc-800 p-3.5 rounded-2xl">
              <div className="text-[9px] font-bold text-zinc-500 uppercase">Revenue Earned</div>
              <div className="text-sm font-bold text-zinc-100 mt-1">{formatCurrency(reconciliation.revenueEarned, currency, exchangeRate)}</div>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 p-3.5 rounded-2xl">
              <div className="text-[9px] font-bold text-zinc-500 uppercase">Direct Guest Collected</div>
              <div className="text-sm font-bold text-emerald-400 mt-1">{formatCurrency(reconciliation.directGuestCashBankCollected, currency, exchangeRate)}</div>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 p-3.5 rounded-2xl">
              <div className="text-[9px] font-bold text-zinc-500 uppercase">Outstanding Guest Bal.</div>
              <div className="text-sm font-bold text-amber-400 mt-1">{formatCurrency(reconciliation.outstandingGuestBalances, currency, exchangeRate)}</div>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 p-3.5 rounded-2xl">
              <div className="text-[9px] font-bold text-zinc-500 uppercase">Transferred to City Ledger</div>
              <div className="text-sm font-bold text-blue-400 mt-1">{formatCurrency(reconciliation.transferredToCityLedger, currency, exchangeRate)}</div>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 p-3.5 rounded-2xl">
              <div className="text-[9px] font-bold text-zinc-500 uppercase">Corporate AR (Gross)</div>
              <div className="text-sm font-bold text-purple-400 mt-1">{formatCurrency(reconciliation.corporateReceivablesGross, currency, exchangeRate)}</div>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 p-3.5 rounded-2xl">
              <div className="text-[9px] font-bold text-zinc-500 uppercase">City Ledger Collections</div>
              <div className="text-sm font-bold text-teal-400 mt-1">{formatCurrency(reconciliation.cityLedgerCollections, currency, exchangeRate)}</div>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 p-3.5 rounded-2xl">
              <div className="text-[9px] font-bold text-zinc-500 uppercase">Remaining City Ledger AR</div>
              <div className="text-sm font-bold text-rose-400 mt-1">{formatCurrency(reconciliation.remainingCityLedgerReceivables, currency, exchangeRate)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Ageing Buckets KPI Strip */}
      <div id="city-ledger-ageing-printable" data-printable="true" className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">0 – 30 Days</div>
          <div className="text-lg font-bold text-zinc-50 mt-1">{formatCurrency(ageingReport.summary.bucket0To30, currency, exchangeRate)}</div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">31 – 60 Days</div>
          <div className="text-lg font-bold text-zinc-50 mt-1">{formatCurrency(ageingReport.summary.bucket31To60, currency, exchangeRate)}</div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="text-[10px] font-bold text-orange-400 uppercase tracking-wider">61 – 90 Days</div>
          <div className="text-lg font-bold text-zinc-50 mt-1">{formatCurrency(ageingReport.summary.bucket61To90, currency, exchangeRate)}</div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">&gt; 90 Days</div>
          <div className="text-lg font-bold text-rose-400 mt-1">{formatCurrency(ageingReport.summary.bucketOver90, currency, exchangeRate)}</div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Overdue ({ageingReport.summary.overdueInvoiceCount} Open)</div>
          <div className="text-lg font-bold text-red-400 mt-1">{formatCurrency(ageingReport.summary.overdueTotal, currency, exchangeRate)}</div>
        </div>
      </div>

      {/* Filters & Export Bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden">
        <div className="p-5 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-zinc-50">Dynamic Debt Ageing Report</h3>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-200"
              title="Ageing As-Of Date"
            />
            {!lockedAccountId && (
              <>
                <select
                  value={accountTypeFilter}
                  onChange={(e) => setAccountTypeFilter(e.target.value as any)}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-300"
                >
                  <option value="all">All Categories</option>
                  {(Object.keys(CITY_LEDGER_ACCOUNT_TYPE_LABELS) as CityLedgerAccountType[]).map(t => (
                    <option key={t} value={t}>{CITY_LEDGER_ACCOUNT_TYPE_LABELS[t]}</option>
                  ))}
                </select>
                <select
                  value={accountStatusFilter}
                  onChange={(e) => setAccountStatusFilter(e.target.value as any)}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-300"
                >
                  <option value="all">All Statuses</option>
                  {(Object.keys(CITY_LEDGER_ACCOUNT_STATUS_LABELS) as CityLedgerAccountStatus[]).map(st => (
                    <option key={st} value={st}>{CITY_LEDGER_ACCOUNT_STATUS_LABELS[st]}</option>
                  ))}
                </select>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-300 max-w-[200px]"
                >
                  <option value="all">All City Ledger Accounts</option>
                  {corporateAccounts.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex bg-zinc-950 border border-zinc-800 rounded-xl p-0.5 text-[10px] font-bold">
              <button
                type="button"
                onClick={() => setViewMode('consolidated')}
                className={cn('px-2.5 py-1 rounded-lg', viewMode === 'consolidated' ? 'bg-emerald-500 text-black' : 'text-zinc-400')}
              >
                By Account
              </button>
              <button
                type="button"
                onClick={() => setViewMode('invoices')}
                className={cn('px-2.5 py-1 rounded-lg', viewMode === 'invoices' ? 'bg-emerald-500 text-black' : 'text-zinc-400')}
              >
                By Invoice ({ageingReport.invoices.length})
              </button>
            </div>
            <button type="button" onClick={handlePrintAgeing} className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-bold flex items-center gap-1">
              <Printer size={13} /> Print
            </button>
            <button type="button" onClick={handleExportAgeingCSV} className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-bold flex items-center gap-1">
              <Download size={13} /> CSV
            </button>
            <button type="button" onClick={handleExportAgeingPDF} className="px-2.5 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 rounded-xl text-xs font-bold flex items-center gap-1">
              <FileText size={13} /> PDF
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {viewMode === 'consolidated' ? (
            <table className="w-full text-left">
              <thead>
                <tr className="bg-zinc-950/50 border-b border-zinc-800 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                  <th className="px-5 py-3">Account</th>
                  <th className="px-4 py-3">Terms</th>
                  <th className="px-4 py-3 text-right">0–30 Days</th>
                  <th className="px-4 py-3 text-right">31–60 Days</th>
                  <th className="px-4 py-3 text-right">61–90 Days</th>
                  <th className="px-4 py-3 text-right">&gt;90 Days</th>
                  <th className="px-4 py-3 text-right">Total Open</th>
                  {onOpenAccountFolio && <th className="px-4 py-3 text-right">Folio</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-xs">
                {ageingReport.accounts.length === 0 ? (
                  <tr>
                    <td colSpan={onOpenAccountFolio ? 8 : 7} className="px-6 py-10 text-center text-zinc-500 italic">
                      No open unpaid City Ledger receivables for the selected filters. (Paid, cancelled, and draft invoices are excluded.)
                    </td>
                  </tr>
                ) : (
                  ageingReport.accounts.map(row => {
                    const matchedAcc = corporateAccounts.find(c => c.id === row.accountId);
                    return (
                      <tr key={row.accountId} className="hover:bg-zinc-800/40">
                        <td className="px-5 py-3.5">
                          <div className="font-bold text-zinc-100">{row.accountName}</div>
                          <div className="text-[10px] text-zinc-500">
                            {CITY_LEDGER_ACCOUNT_TYPE_LABELS[row.accountType]} • {row.openInvoiceCount} open item(s)
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-zinc-400">{row.paymentTerms}</td>
                        <td className="px-4 py-3.5 text-right text-zinc-200">{formatCurrency(row.bucket0To30, currency, exchangeRate)}</td>
                        <td className="px-4 py-3.5 text-right text-amber-400">{formatCurrency(row.bucket31To60, currency, exchangeRate)}</td>
                        <td className="px-4 py-3.5 text-right text-orange-400">{formatCurrency(row.bucket61To90, currency, exchangeRate)}</td>
                        <td className="px-4 py-3.5 text-right font-bold text-rose-400">{formatCurrency(row.bucketOver90, currency, exchangeRate)}</td>
                        <td className="px-4 py-3.5 text-right font-bold text-zinc-50">{formatCurrency(row.totalOutstanding, currency, exchangeRate)}</td>
                        {onOpenAccountFolio && (
                          <td className="px-4 py-3.5 text-right">
                            {matchedAcc && (
                              <button
                                type="button"
                                onClick={() => onOpenAccountFolio(matchedAcc)}
                                className="px-2.5 py-1 bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500 hover:text-white rounded-lg text-[10px] font-bold"
                              >
                                Invoices / Statement
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="bg-zinc-950/50 border-b border-zinc-800 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                  <th className="px-5 py-3">Invoice #</th>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Issue / Due</th>
                  <th className="px-4 py-3 text-right">Days Past Due</th>
                  <th className="px-4 py-3">Bucket</th>
                  <th className="px-4 py-3 text-right">Original</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-xs">
                {ageingReport.invoices.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-10 text-center text-zinc-500 italic">
                      No open City Ledger invoices found.
                    </td>
                  </tr>
                ) : (
                  ageingReport.invoices.map(item => (
                    <tr key={item.invoiceId} className="hover:bg-zinc-800/40">
                      <td className="px-5 py-3 font-mono font-bold text-emerald-400">
                        {item.invoiceNumber}
                        {item.isUninvoicedLedgerFallback && (
                          <div className="text-[9px] font-sans text-zinc-500">Legacy Ledger Balance</div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-zinc-100">{item.accountName}</td>
                      <td className="px-4 py-3 text-zinc-400">
                        <div>{item.issueDate}</div>
                        <div className={cn(item.daysPastDue > 0 ? 'text-rose-400 font-semibold' : 'text-zinc-500')}>Due {item.dueDate}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-zinc-200">{item.daysPastDue}d</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px] font-bold">{item.bucket} Days</span>
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-300">{formatCurrency(item.originalAmount, currency, exchangeRate)}</td>
                      <td className="px-4 py-3 text-right text-emerald-400">{formatCurrency(item.amountPaid, currency, exchangeRate)}</td>
                      <td className="px-4 py-3 text-right font-bold text-rose-400">{formatCurrency(item.outstandingAmount, currency, exchangeRate)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
