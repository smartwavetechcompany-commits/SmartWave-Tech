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
  hotel?: Record<string, any> | null;
  reservation?: Record<string, any> | null;
  ledgerEntries?: Array<Record<string, any>>;
  /** Optional payment amount from the triggering transaction (e.g. payment_receipt / payment.received) */
  paymentAmount?: number;
  /** Optional explicit overrides when reservation is not loaded */
  fallbackOriginalAmount?: number;
  fallbackDiscountAmount?: number;
  fallbackAmountPaid?: number;
  fallbackOutstandingBalance?: number;
  /**
   * Optional authoritative updated stay total (e.g. `meta.newTotalAmount` right after a stay
   * extension or room transfer) so email remaining balance reflects the updated stay even if
   * future extension nights are not yet posted to the ledger or Firestore reads lag.
   */
  effectiveStayTotal?: number;
  /**
   * When true (stay extension / room transfer), do not clamp remainingBalance down to a stale
   * pre-extension `reservation.ledgerBalance` or pre-extension `paymentStatus === "paid"`.
   */
  ignoreStaleReservationBalance?: boolean;
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
 * Pure zero-import calendar night difference helper (YYYY-MM-DD safe, timezone-neutral).
 */
function computeBookedNightsFromReservation(res: Record<string, any>): number {
  const ciRaw = typeof res.checkIn === "string" ? res.checkIn.split("T")[0] : "";
  const coRaw = typeof res.checkOut === "string" ? res.checkOut.split("T")[0] : "";
  if (ciRaw && coRaw) {
    const ciParts = ciRaw.split("-").map(Number);
    const coParts = coRaw.split("-").map(Number);
    if (
      ciParts.length === 3 &&
      coParts.length === 3 &&
      !ciParts.some(Number.isNaN) &&
      !coParts.some(Number.isNaN)
    ) {
      const ciUtc = Date.UTC(ciParts[0], ciParts[1] - 1, ciParts[2]);
      const coUtc = Date.UTC(coParts[0], coParts[1] - 1, coParts[2]);
      const diff = Math.round((coUtc - ciUtc) / 86_400_000);
      if (diff > 0) return diff;
    }
  }
  const explicitNights = toFiniteNumber(res.nights);
  if (explicitNights !== undefined && explicitNights > 0) {
    return Math.max(1, Math.round(explicitNights));
  }
  return 1;
}

/**
 * Pure read-only resolver for a reservation's full booked room stay total (including extensions)
 * directly from `reservation.rateSnapshot.nightlyRates` and hotel exclusive room taxes.
 *
 * Ensures that even when `recalculateReservationAccountFromLedger` has overwritten
 * `reservation.totalAmount` to posted ledger debits only (e.g. ₦151,500), emails still read
 * the full authoritative booked + extended stay total (e.g. ₦288,000), matching PMS UI/Folio/Receipt.
 */
function resolveBookedStayRoomTotalWithExclusiveTax(
  res: Record<string, any>,
  hotel?: Record<string, any> | null
): number {
  const bookedNights = computeBookedNightsFromReservation(res);
  const snapshot = res.rateSnapshot && typeof res.rateSnapshot === "object" ? res.rateSnapshot : null;
  let roomTotal = 0;

  if (snapshot && Array.isArray(snapshot.nightlyRates) && snapshot.nightlyRates.length > 0) {
    const byIndex = new Map<number, number>();
    for (const rec of snapshot.nightlyRates) {
      const idx = toFiniteNumber(rec?.nightIndex);
      const rate = toFiniteNumber(rec?.rate);
      if (idx !== undefined && rate !== undefined && rate >= 0) {
        byIndex.set(Math.round(idx), rate);
      }
    }
    const fallbackRate =
      toFiniteNumber(snapshot.originalNightlyRate) ??
      toFiniteNumber(res.nightlyRate) ??
      toFiniteNumber(res.originalNightlyRate) ??
      0;
    for (let i = 1; i <= bookedNights; i++) {
      roomTotal += byIndex.has(i) ? byIndex.get(i)! : fallbackRate;
    }
  } else {
    const explicitRate =
      toFiniteNumber(res.nightlyRate) ??
      toFiniteNumber(res.originalNightlyRate) ??
      toFiniteNumber(res.roomPrice);
    if (explicitRate !== undefined && explicitRate > 0) {
      roomTotal = explicitRate * bookedNights;
    }
  }

  const overstayNights = Math.max(0, Math.round(toFiniteNumber(res.overstayNights) ?? 0));
  if (overstayNights > 0) {
    const nightly =
      toFiniteNumber(snapshot?.originalNightlyRate) ??
      toFiniteNumber(res.nightlyRate) ??
      toFiniteNumber(res.originalNightlyRate) ??
      (bookedNights > 0 && roomTotal > 0 ? roomTotal / bookedNights : 0);
    roomTotal += overstayNights * nightly;
  }

  if (roomTotal <= 0) return 0;

  // Apply active exclusive room taxes if configured on the hotel
  const activeExclusiveRoomTaxes = Array.isArray(hotel?.taxes)
    ? hotel!.taxes.filter((t: any) => {
        const status = String(t?.status || "").toLowerCase().trim();
        const category = String(t?.category || "").toLowerCase().trim();
        return status === "active" && category !== "restaurant" && t?.isInclusive === false;
      })
    : [];

  let exclusiveTaxTotal = 0;
  for (const tax of activeExclusiveRoomTaxes) {
    const pct = toFiniteNumber(tax?.percentage) ?? 0;
    if (pct > 0) {
      exclusiveTaxTotal += roomTotal * (pct / 100);
    }
  }

  return round2(roomTotal + exclusiveTaxTotal);
}

/**
 * Computes accurate, read-only financial breakdown figures for outgoing emails
 * matching the authoritative PMS calculation (`calculateReservationAccount`).
 *
 * Strictly zero external/client imports so it runs identically in native Node 22 ESM (`node server.ts`),
 * Vite, and `tsx`.
 *
 * Example verified scenarios:
 * - Stay extension / postponement:
 *   Updated Total Stay Charges: 288,000, Paid from Guest Account: 35,900
 *   => netPayableAmount = 288,000, amountPaid = 35,900, remainingBalance = 252,100
 * - Discount settled:
 *   Original Room Charge: 100,000, Discount Granted: 20,000, Amount Paid: 80,000
 *   => netPayableAmount = 80,000, remainingBalance = 0, paymentStatus = "Fully Settled"
 */
export function computeEmailFinancialBreakdown(
  input: EmailFinancialBreakdownInput
): EmailFinancialBreakdown {
  const res = input.reservation && typeof input.reservation === "object" ? input.reservation : null;
  const resStatus = String(res?.status || "").toLowerCase();
  const entries = Array.isArray(input.ledgerEntries)
    ? input.ledgerEntries.filter((e) => e && e.voided !== true && e.status !== "voided")
    : [];
  const overrideStayTotal = toFiniteNumber(input.effectiveStayTotal);
  const triggerPayment = toFiniteNumber(input.paymentAmount);
  const isNoShowOrCancelled = resStatus === "no_show" || resStatus === "cancelled";

  // Authoritative full booked + extended stay room total from rateSnapshot (never understated
  // even when recalculateReservationAccountFromLedger overwrites reservation.totalAmount to posted debits)
  const snapshotStayTotal =
    res && !isNoShowOrCancelled
      ? resolveBookedStayRoomTotalWithExclusiveTax(res, input.hotel)
      : 0;

  // 1. Authoritative ledger + reservation reconciliation path
  if (entries.length > 0) {
    let grossDebits = 0;
    let roomAndStayTaxDebits = 0;
    let ancillaryDebits = 0;
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
      const desc = String(e.description || "").toLowerCase();
      const chargeType = String(e.chargeType || "").toLowerCase();

      if (type === "debit") {
        if (cat === "refund") {
          refundDebits += amt;
        } else if (cat === "discount") {
          discountDebits += amt;
        } else {
          grossDebits += amt;
          const isRoomOrOverstay =
            cat === "room" ||
            chargeType === "room_rate" ||
            chargeType === "overstay";
          const isAncillaryTax =
            cat === "tax" &&
            (desc.includes("restaurant") ||
              desc.includes("f&b") ||
              desc.includes("f & b") ||
              desc.includes("bar") ||
              desc.includes("kitchen") ||
              desc.includes("food") ||
              desc.includes("pos") ||
              desc.includes("bill #"));
          const isStayTax = cat === "tax" && !isAncillaryTax;

          if (isRoomOrOverstay || isStayTax) {
            roomAndStayTaxDebits += amt;
          } else {
            ancillaryDebits += amt;
          }
          if (isLedgerPenaltyEntry(e)) {
            penaltyDebits += amt;
          }
        }
      } else if (type === "credit") {
        const isDiscount = cat === "discount" || desc.includes("discount") || desc.includes("promo");
        if (isDiscount) {
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
    const baseStayTotal = Math.max(resTotal, snapshotStayTotal);
    const effectiveStayTotal =
      overrideStayTotal !== undefined && overrideStayTotal > 0
        ? Math.max(baseStayTotal, overrideStayTotal)
        : baseStayTotal;

    // Preserve No-Show / Cancelled classification: only posted penalties create liability
    if (isNoShowOrCancelled && penaltyDebits <= 0.01) {
      const netPaid = round2(Math.max(0, paymentCredits - refundDebits));
      return {
        originalAmount: round2(effectiveStayTotal > 0 ? effectiveStayTotal : grossDebits),
        discountAmount: round2(Math.max(0, discountCredits - discountDebits)),
        netPayableAmount: 0,
        amountPaid: netPaid,
        remainingBalance: 0,
        paymentStatus: "No Balance Due",
        hasFinancialData: effectiveStayTotal > 0 || grossDebits > 0 || netPaid > 0,
      };
    }

    // Reconcile full booked/extended stay charges (snapshotStayTotal vs posted room debits) + ancillary debits,
    // while also honoring any higher explicit post-extension total (e.g. authoritativeAccount.totalCharges).
    const roomStayAndAncillary =
      Math.max(roomAndStayTaxDebits, snapshotStayTotal, resTotal) + ancillaryDebits;
    const originalAmount = round2(
      isNoShowOrCancelled
        ? penaltyDebits
        : Math.max(
            grossDebits,
            roomStayAndAncillary,
            overrideStayTotal !== undefined && overrideStayTotal > 0 ? overrideStayTotal : 0
          )
    );
    const ledgerNetDiscount = round2(Math.max(0, discountCredits - discountDebits));
    const explicitFallbackDiscount = toFiniteNumber(input.fallbackDiscountAmount);
    const discountAmount =
      ledgerNetDiscount > 0
        ? ledgerNetDiscount
        : explicitFallbackDiscount !== undefined && explicitFallbackDiscount > 0
          ? round2(explicitFallbackDiscount)
          : res
            ? resolveReservationDiscount(res, originalAmount)
            : 0;
    const netPayableAmount = round2(Math.max(0, originalAmount - discountAmount));
    const recordedNetPayments = round2(Math.max(0, paymentCredits - refundDebits));
    const amountPaid =
      triggerPayment !== undefined && triggerPayment > 0 && recordedNetPayments === 0
        ? round2(triggerPayment)
        : recordedNetPayments;
    const remainingBalance = round2(Math.max(0, netPayableAmount - amountPaid));

    const paymentStatus: EmailPaymentStatusLabel =
      netPayableAmount <= 0.01
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
      remainingBalance: remainingBalance <= 0.01 ? 0 : remainingBalance,
      paymentStatus,
      hasFinancialData: originalAmount > 0 || amountPaid > 0 || discountAmount > 0,
    };
  }

  // 2. Reservation-record path (no ledger entries loaded yet)
  const rawTotalBase = Math.max(
    toFiniteNumber(res?.totalAmount) ?? toFiniteNumber(input.fallbackOriginalAmount) ?? 0,
    snapshotStayTotal
  );
  const hasAnyTotalSource =
    toFiniteNumber(res?.totalAmount) !== undefined ||
    toFiniteNumber(input.fallbackOriginalAmount) !== undefined ||
    snapshotStayTotal > 0 ||
    (overrideStayTotal !== undefined && overrideStayTotal > 0);
  const rawTotal = hasAnyTotalSource
    ? overrideStayTotal !== undefined && overrideStayTotal > 0
      ? Math.max(rawTotalBase, overrideStayTotal)
      : rawTotalBase
    : undefined;
  const rawPaid = toFiniteNumber(res?.paidAmount) ?? toFiniteNumber(input.fallbackAmountPaid);

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

  const recordedPaid = round2(Math.max(0, rawPaid ?? 0));
  const amountPaid =
    triggerPayment !== undefined && triggerPayment > 0 && recordedPaid === 0
      ? round2(triggerPayment)
      : recordedPaid;

  let remainingBalance = round2(Math.max(0, netPayableAmount - amountPaid));

  // Only respect pre-settled ledgerBalance when NOT extending/transferring a stay and snapshot doesn't exceed res.totalAmount
  const ledgerBalance = toFiniteNumber(res?.ledgerBalance);
  if (
    !input.ignoreStaleReservationBalance &&
    snapshotStayTotal <= (toFiniteNumber(res?.totalAmount) ?? 0) + 0.01 &&
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

const PAYMENT_TRIGGER_EVENTS = new Set<string>([
  "payment.received",
  "receipt.sent",
  "invoice.issued",
]);

const TRANSACTION_AMOUNT_EVENTS = new Set<string>([
  "fnb.order_posted",
  "fnb.order_voided",
  "folio.charge_posted",
  "folio.charge_voided",
  "folio.discount_applied",
  "folio.balance_transferred",
  "corporate.city_ledger_transfer",
  "corporate.payment_settled",
  "system.daily_revenue_deficit",
  "system.operational_alert",
]);

export interface NotificationEventFinancialResolution {
  financialBreakdown: EmailFinancialBreakdown;
  totalAmount?: number;
  chargeAmount?: number;
  originalAmount?: number;
  discountAmount?: number;
  amountPaid?: number;
  balanceDue?: number;
  paymentStatus?: string;
  depositAmount?: number;
  depositBalance?: number;
  refundAmount?: number;
}

/**
 * Pure, read-only resolver for email render-context financial amounts across all platform events.
 *
 * Prevents two critical inaccuracies:
 * 1. Non-payment events (F&B charge, folio charge, void, discount, balance transfer, stay extension,
 *    room transfer) NEVER pass `meta.amount` as `paymentAmount` into `computeEmailFinancialBreakdown`.
 * 2. Transaction-scoped events (e.g. posting a ₦20,000 F&B order on a ₦239,100 stay) strictly bind
 *    both `chargeAmount` ({{charge_amount}}) and `totalAmount` ({{total_amount}}) to the exact
 *    transaction amount (₦20,000), NEVER overwriting it with the cumulative stay total (₦239,100).
 */
export function resolveNotificationEventFinancials(params: {
  eventType: string;
  hotel?: Record<string, any> | null;
  reservation?: Record<string, any> | null;
  ledgerEntries?: Array<Record<string, any>>;
  meta?: Record<string, any> | null;
  corporateCurrentBalance?: number | null;
}): NotificationEventFinancialResolution {
  const { eventType, hotel, reservation, ledgerEntries, corporateCurrentBalance } = params;
  const meta = params.meta && typeof params.meta === "object" ? params.meta : {};

  const metaAmount = toFiniteNumber(meta.amount);
  const metaOutstanding = toFiniteNumber(meta.outstandingBalance);
  const metaDiscount = toFiniteNumber(meta.discountAmount);
  const metaDepositBalanceAfter = toFiniteNumber(meta.depositBalanceAfter);
  const metaAdditionalCharge = toFiniteNumber(meta.additionalCharge);
  const metaNewTotalAmount = toFiniteNumber(meta.newTotalAmount);
  const metaPriceDifference = toFiniteNumber(meta.priceDifference);
  const corpBalance = toFiniteNumber(corporateCurrentBalance);

  const isPaymentEvent = PAYMENT_TRIGGER_EVENTS.has(eventType);
  const isTransactionEvent = TRANSACTION_AMOUNT_EVENTS.has(eventType);
  const isCorporateEvent = eventType.startsWith("corporate.");
  const isStayTotalMutationEvent =
    eventType === "reservation.stay_extended" || eventType === "reservation.room_transferred";
  const effectiveStayTotalOverride =
    isStayTotalMutationEvent && metaNewTotalAmount !== undefined && metaNewTotalAmount > 0
      ? metaNewTotalAmount
      : undefined;

  const financialBreakdown = computeEmailFinancialBreakdown({
    hotel,
    reservation,
    ledgerEntries,
    paymentAmount: isPaymentEvent ? metaAmount : undefined,
    fallbackOutstandingBalance: metaOutstanding,
    fallbackDiscountAmount: metaDiscount,
    effectiveStayTotal: effectiveStayTotalOverride,
    ignoreStaleReservationBalance: isStayTotalMutationEvent,
  });

  // Base reservation/folio figures
  const originalAmount =
    financialBreakdown.originalAmount > 0 ? financialBreakdown.originalAmount : undefined;
  let discountAmount =
    financialBreakdown.discountAmount > 0 ? financialBreakdown.discountAmount : undefined;
  let amountPaid: number | undefined =
    financialBreakdown.amountPaid > 0 ? financialBreakdown.amountPaid : undefined;
  let balanceDue: number | undefined =
    isCorporateEvent && corpBalance !== undefined
      ? round2(Math.max(0, corpBalance))
      : reservation || metaOutstanding !== undefined
        ? financialBreakdown.remainingBalance
        : undefined;
  let paymentStatus: string | undefined = financialBreakdown.hasFinancialData
    ? financialBreakdown.paymentStatus
    : undefined;

  let chargeAmount: number | undefined;
  let totalAmount: number | undefined;
  let depositAmount: number | undefined;
  let depositBalance: number | undefined =
    metaDepositBalanceAfter !== undefined ? round2(Math.max(0, metaDepositBalanceAfter)) : undefined;
  let refundAmount: number | undefined;

  if (eventType === "refund.processed") {
    refundAmount = metaAmount !== undefined ? round2(Math.max(0, metaAmount)) : undefined;
    chargeAmount = refundAmount;
    totalAmount = refundAmount;
    balanceDue = undefined;
    paymentStatus = "Refund Processed";
  } else if (eventType === "deposit.received") {
    depositAmount = metaAmount !== undefined ? round2(Math.max(0, metaAmount)) : undefined;
    chargeAmount = depositAmount;
    totalAmount = depositAmount;
  } else if (isTransactionEvent) {
    // Strictly bind transaction amount to the posted/voided/discounted/transferred figure (e.g. 20,000),
    // never to the cumulative reservation total (e.g. 239,100).
    const txVal = metaAmount !== undefined ? round2(Math.max(0, metaAmount)) : undefined;
    chargeAmount = txVal;
    totalAmount = txVal;

    if (eventType === "folio.discount_applied" && txVal !== undefined) {
      discountAmount = txVal;
    }
    if (eventType === "corporate.payment_settled" && txVal !== undefined) {
      amountPaid = txVal;
    }
  } else if (eventType === "reservation.stay_extended") {
    chargeAmount =
      metaAdditionalCharge !== undefined ? round2(Math.max(0, metaAdditionalCharge)) : undefined;
    totalAmount =
      financialBreakdown.netPayableAmount > 0
        ? financialBreakdown.netPayableAmount
        : metaNewTotalAmount !== undefined
          ? round2(Math.max(0, metaNewTotalAmount))
          : undefined;
  } else if (eventType === "reservation.room_transferred") {
    chargeAmount =
      metaPriceDifference !== undefined ? round2(Math.abs(metaPriceDifference)) : undefined;
    totalAmount =
      financialBreakdown.netPayableAmount > 0
        ? financialBreakdown.netPayableAmount
        : metaNewTotalAmount !== undefined
          ? round2(Math.max(0, metaNewTotalAmount))
          : undefined;
  } else if (eventType === "payment.received" || eventType === "receipt.sent") {
    chargeAmount = metaAmount !== undefined ? round2(Math.max(0, metaAmount)) : undefined;
    amountPaid =
      metaAmount !== undefined
        ? round2(Math.max(0, metaAmount))
        : financialBreakdown.amountPaid > 0
          ? financialBreakdown.amountPaid
          : undefined;
    totalAmount =
      financialBreakdown.netPayableAmount > 0
        ? financialBreakdown.netPayableAmount
        : chargeAmount;
  } else {
    chargeAmount = metaAmount !== undefined ? round2(Math.max(0, metaAmount)) : undefined;
    totalAmount =
      financialBreakdown.netPayableAmount > 0
        ? financialBreakdown.netPayableAmount
        : chargeAmount;
  }

  return {
    financialBreakdown,
    totalAmount,
    chargeAmount,
    originalAmount,
    discountAmount,
    amountPaid,
    balanceDue,
    paymentStatus,
    depositAmount,
    depositBalance,
    refundAmount,
  };
}

