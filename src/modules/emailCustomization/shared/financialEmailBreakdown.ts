/**
 * Read-only financial breakdown helper strictly for email presentation & placeholders.
 *
 * IMPORTANT:
 * - Never mutates reservation, folio, payment, discount, or ledger records.
 * - Never modifies PMS financial business logic or billing calculations.
 * - Ensures granted discounts are clearly shown as discounts and NEVER misclassified
 *   as an outstanding balance due in guest emails.
 */

export type EmailPaymentStatusLabel =
  | "Fully Settled"
  | "Partially Paid"
  | "Unpaid"
  | "No Balance Due";

export interface EmailFinancialBreakdownInput {
  reservation?: Record<string, any> | null;
  ledgerEntries?: Array<Record<string, any>>;
  /** Optional payment amount from the triggering transaction (e.g. payment_receipt / payment.received) */
  paymentAmount?: number;
  /** Optional explicit overrides when reservation is not loaded */
  fallbackOriginalAmount?: number;
  fallbackDiscountAmount?: number;
  fallbackAmountPaid?: number;
  fallbackOutstandingBalance?: number;
}

export interface EmailFinancialBreakdown {
  originalAmount: number;
  discountAmount: number;
  netPayableAmount: number;
  amountPaid: number;
  remainingBalance: number;
  paymentStatus: EmailPaymentStatusLabel;
  hasFinancialData: boolean;
}

function toFiniteNumber(val: unknown): number | undefined {
  if (val === null || val === undefined || val === "") return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

function round2(n: number): number {
  return Number(Math.max(0, n).toFixed(2));
}

function resolveReservationDiscount(res: Record<string, any>, originalAmount: number): number {
  const explicitTotalDiscount = toFiniteNumber(res.totalDiscount);
  if (explicitTotalDiscount !== undefined && explicitTotalDiscount > 0) {
    return round2(explicitTotalDiscount);
  }
  const rawDiscountAmount = toFiniteNumber(res.discountAmount ?? res.discount);
  if (rawDiscountAmount !== undefined && rawDiscountAmount > 0) {
    if (String(res.discountType || "").toLowerCase() === "percentage") {
      return round2((originalAmount * Math.min(100, rawDiscountAmount)) / 100);
    }
    return round2(rawDiscountAmount);
  }
  return 0;
}

function isLedgerPenaltyEntry(entry: Record<string, any>): boolean {
  if (!entry || entry.type !== "debit") return false;
  const cat = String(entry.category || "").toLowerCase();
  const chargeType = String(entry.chargeType || "").toLowerCase();
  if (cat === "no_show_penalty" || chargeType === "no_show_penalty") return true;
  if (cat === "cancellation_fee" || chargeType === "cancellation_fee") return true;
  if (cat === "penalty") return true;
  const desc = String(entry.description || "").toLowerCase();
  return (
    desc.includes("no-show penalty") ||
    desc.includes("no show penalty") ||
    desc.includes("cancellation fee") ||
    desc.includes("cancellation penalty")
  );
}

/**
 * Computes accurate, read-only financial breakdown figures for outgoing emails.
 *
 * Example verified scenario:
 * - Original Room Charge: 100,000
 * - Discount Granted: 20,000
 * - Amount Paid / Settled: 80,000
 * => netPayableAmount = 80,000, remainingBalance = 0, paymentStatus = "Fully Settled"
 *
 * Partial payment scenario:
 * - Original Room Charge: 100,000
 * - Discount Granted: 20,000
 * - Amount Paid / Settled: 50,000
 * => netPayableAmount = 80,000, remainingBalance = 30,000, paymentStatus = "Partially Paid"
 */
export function computeEmailFinancialBreakdown(
  input: EmailFinancialBreakdownInput
): EmailFinancialBreakdown {
  const res = input.reservation && typeof input.reservation === "object" ? input.reservation : null;
  const resStatus = String(res?.status || "").toLowerCase();
  const entries = Array.isArray(input.ledgerEntries)
    ? input.ledgerEntries.filter((e) => e && e.voided !== true && e.status !== "voided")
    : [];

  // 1. If authoritative ledger entries are supplied, aggregate directly without mutating ledger
  if (entries.length > 0) {
    let grossDebits = 0;
    let penaltyDebits = 0;
    let discountCredits = 0;
    let discountDebits = 0;
    let paymentCredits = 0;
    let refundDebits = 0;

    for (const e of entries) {
      const amt = toFiniteNumber(e.amount) || 0;
      if (amt <= 0) continue;
      const type = String(e.type || "").toLowerCase();
      const cat = String(e.category || "").toLowerCase();

      if (type === "debit") {
        if (cat === "refund") {
          refundDebits += amt;
        } else if (cat === "discount") {
          discountDebits += amt;
        } else {
          grossDebits += amt;
          if (isLedgerPenaltyEntry(e)) {
            penaltyDebits += amt;
          }
        }
      } else if (type === "credit") {
        if (cat === "discount") {
          discountCredits += amt;
        } else if (
          cat === "payment" ||
          cat === "deposit" ||
          cat === "city_ledger" ||
          cat === "transfer" ||
          cat === "loyalty" ||
          cat === "credit"
        ) {
          paymentCredits += amt;
        }
      }
    }

    const resTotal = toFiniteNumber(res?.totalAmount) ?? 0;
    const isNoShowOrCancelled = resStatus === "no_show" || resStatus === "cancelled";

    // Preserve No-Show / Cancelled classification: only posted penalties create liability
    if (isNoShowOrCancelled && penaltyDebits <= 0.01) {
      const netPaid = round2(Math.max(0, paymentCredits - refundDebits));
      return {
        originalAmount: round2(resTotal > 0 ? resTotal : grossDebits),
        discountAmount: round2(Math.max(0, discountCredits - discountDebits)),
        netPayableAmount: 0,
        amountPaid: netPaid,
        remainingBalance: 0,
        paymentStatus: "No Balance Due",
        hasFinancialData: resTotal > 0 || grossDebits > 0 || netPaid > 0,
      };
    }

    const originalAmount = round2(
      isNoShowOrCancelled
        ? penaltyDebits
        : Math.max(grossDebits, resTotal)
    );
    const ledgerNetDiscount = round2(Math.max(0, discountCredits - discountDebits));
    const discountAmount =
      ledgerNetDiscount > 0
        ? ledgerNetDiscount
        : res
          ? resolveReservationDiscount(res, originalAmount)
          : round2(input.fallbackDiscountAmount || 0);
    const netPayableAmount = round2(Math.max(0, originalAmount - discountAmount));
    const netPayments = round2(Math.max(0, paymentCredits - refundDebits));
    const remainingBalance = round2(Math.max(0, netPayableAmount - netPayments));

    const paymentStatus: EmailPaymentStatusLabel =
      netPayableAmount <= 0.01
        ? "No Balance Due"
        : remainingBalance <= 0.01
          ? "Fully Settled"
          : netPayments > 0.01
            ? "Partially Paid"
            : "Unpaid";

    return {
      originalAmount,
      discountAmount,
      netPayableAmount,
      amountPaid: netPayments,
      remainingBalance: remainingBalance <= 0.01 ? 0 : remainingBalance,
      paymentStatus,
      hasFinancialData: originalAmount > 0 || netPayments > 0 || discountAmount > 0,
    };
  }

  // 2. Reservation-record path (server dispatcher & module notifications without full ledger scan)
  const rawTotal = toFiniteNumber(res?.totalAmount) ?? toFiniteNumber(input.fallbackOriginalAmount);
  const rawPaid = toFiniteNumber(res?.paidAmount) ?? toFiniteNumber(input.fallbackAmountPaid);
  const triggerPayment = toFiniteNumber(input.paymentAmount);

  if (rawTotal === undefined && rawPaid === undefined && triggerPayment === undefined) {
    const fbBal = toFiniteNumber(input.fallbackOutstandingBalance);
    return {
      originalAmount: 0,
      discountAmount: round2(input.fallbackDiscountAmount || 0),
      netPayableAmount: 0,
      amountPaid: 0,
      remainingBalance: fbBal !== undefined ? round2(Math.max(0, fbBal)) : 0,
      paymentStatus: fbBal !== undefined && fbBal > 0.01 ? "Partially Paid" : "No Balance Due",
      hasFinancialData: fbBal !== undefined,
    };
  }

  const originalAmount = round2(Math.max(0, rawTotal ?? 0));
  const explicitFallbackDiscount = toFiniteNumber(input.fallbackDiscountAmount);
  const discountAmount =
    explicitFallbackDiscount !== undefined && explicitFallbackDiscount > 0
      ? round2(explicitFallbackDiscount)
      : res
        ? resolveReservationDiscount(res, originalAmount)
        : 0;

  // Preserve No-Show / Cancelled classification: unpaid booking total is NOT guest debt unless penalty posted
  const isNoShowOrCancelled = resStatus === "no_show" || resStatus === "cancelled";
  const postedPenalty =
    toFiniteNumber(res?.postedPenaltyAmount) ??
    toFiniteNumber(res?.penaltyAmount) ??
    0;
  if (isNoShowOrCancelled && postedPenalty <= 0.01) {
    const paidVal = round2(Math.max(0, rawPaid ?? 0));
    return {
      originalAmount,
      discountAmount,
      netPayableAmount: 0,
      amountPaid: paidVal,
      remainingBalance: 0,
      paymentStatus: "No Balance Due",
      hasFinancialData: originalAmount > 0 || paidVal > 0,
    };
  }

  const effectiveGross = isNoShowOrCancelled ? round2(postedPenalty) : originalAmount;
  const netPayableAmount = round2(Math.max(0, effectiveGross - discountAmount));

  // Paid amount must reflect verified payments (and never lose the triggering payment if reservation doc lags)
  const recordedPaid = round2(Math.max(0, rawPaid ?? 0));
  const amountPaid =
    triggerPayment !== undefined && triggerPayment > 0 && recordedPaid === 0
      ? round2(triggerPayment)
      : recordedPaid;

  // Authoritative remaining balance: net payable (after discount) minus actual amount paid.
  // Crucially, a granted discount NEVER appears as an outstanding balance.
  let remainingBalance = round2(Math.max(0, netPayableAmount - amountPaid));

  // If reservation has an explicit ledgerBalance reconciled by ledgerService that is smaller
  // (e.g., city ledger / additional credit applied), respect it, while NEVER exceeding netPayable - paid.
  const ledgerBalance = toFiniteNumber(res?.ledgerBalance);
  if (
    ledgerBalance !== undefined &&
    ledgerBalance >= 0 &&
    ledgerBalance < remainingBalance &&
    (res?.paymentStatus === "paid" || res?.paymentStatus === "settled" || ledgerBalance <= 0.01)
  ) {
    remainingBalance = round2(Math.max(0, ledgerBalance));
  }

  if (remainingBalance <= 0.01) {
    remainingBalance = 0;
  }

  const paymentStatus: EmailPaymentStatusLabel =
    netPayableAmount <= 0.01 && originalAmount <= 0.01
      ? "No Balance Due"
      : remainingBalance <= 0.01
        ? "Fully Settled"
        : amountPaid > 0.01
          ? "Partially Paid"
          : "Unpaid";

  return {
    originalAmount,
    discountAmount,
    netPayableAmount,
    amountPaid,
    remainingBalance,
    paymentStatus,
    hasFinancialData: originalAmount > 0 || amountPaid > 0 || discountAmount > 0,
  };
}
