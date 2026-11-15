import { addDays, format } from 'date-fns';
import {
  CorporateRate,
  Hotel,
  LedgerEntry,
  RateConfiguration,
  RateSourceType,
  Reservation,
  ReservationExtensionRateRecord,
  ReservationNightlyRateRecord,
  ReservationRateSnapshot,
  Room,
  RoomType
} from '../types';
import { calculateStayDuration } from './dateUtils';

export interface ApplicableRoomRateResult {
  rate: number;
  rateSource: RateSourceType;
  effectiveDate: string;
}

export interface NightRateLookupResult {
  nightIndex: number;
  rate: number;
  rateSource: RateSourceType;
  segment: 'original' | 'extension';
  effectiveDate: string;
  extensionId?: string;
}

/**
 * Safely shifts a YYYY-MM-DD date string by deltaDays using local calendar arithmetic
 * so timezone offsets never drift the calendar day.
 */
function addDaysToDateString(dateStr: string, deltaDays: number): string {
  if (!dateStr) return format(addDays(new Date(), deltaDays), 'yyyy-MM-dd');
  const clean = dateStr.split('T')[0];
  const parts = clean.split('-').map(Number);
  if (parts.length === 3 && !parts.some(isNaN)) {
    const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
    return format(addDays(d, deltaDays), 'yyyy-MM-dd');
  }
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return format(addDays(parsed, deltaDays), 'yyyy-MM-dd');
  }
  return format(addDays(new Date(), deltaDays), 'yyyy-MM-dd');
}

function getLocalDayOfWeek(dateStr: string): number {
  const clean = (dateStr || '').split('T')[0];
  const parts = clean.split('-').map(Number);
  if (parts.length === 3 && !parts.some(isNaN)) {
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0).getDay();
  }
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date().getDay() : parsed.getDay();
}

/**
 * Resolves the currently applicable room rate at booking or stay-extension confirmation time.
 * Keeps rate lookup uniform across FrontDesk preview, booking creation, and stay extensions.
 */
export function resolveApplicableRoomRate(params: {
  room?: Room | null;
  roomType?: RoomType | null;
  rateConfigs?: RateConfiguration[];
  corporateRates?: CorporateRate[];
  corporateId?: string | null;
  targetDate?: string | Date;
  rateOption?: 'auto' | 'base' | 'weekend' | 'weekday' | 'custom';
  customRate?: number;
}): ApplicableRoomRateResult {
  const {
    room,
    roomType,
    rateConfigs = [],
    corporateRates = [],
    corporateId,
    targetDate = new Date(),
    rateOption = 'auto',
    customRate
  } = params;

  const targetDateStr =
    typeof targetDate === 'string'
      ? targetDate.split('T')[0]
      : format(targetDate, 'yyyy-MM-dd');

  if (rateOption === 'custom' && customRate !== undefined && !isNaN(Number(customRate))) {
    return {
      rate: Math.max(0, Number(customRate)),
      rateSource: 'custom_override',
      effectiveDate: targetDateStr
    };
  }

  // 1. Active corporate negotiated rate (only when in automatic resolution mode)
  if (rateOption === 'auto' && corporateId && corporateRates.length > 0 && room) {
    const activeCorp = corporateRates.find(r => {
      if (r.status && r.status !== 'active') return false;
      if (r.corporateId && r.corporateId !== corporateId) return false;
      const matchesType =
        (room.roomTypeId && r.roomTypeId === room.roomTypeId) ||
        (room.type && r.roomType === room.type);
      if (!matchesType) return false;
      const startStr = (r.startDate || '').split('T')[0];
      const endStr = (r.endDate || '').split('T')[0];
      if (startStr && targetDateStr < startStr) return false;
      if (endStr && targetDateStr > endStr) return false;
      return true;
    });
    if (activeCorp && activeCorp.rate > 0) {
      return {
        rate: activeCorp.rate,
        rateSource: 'corporate_contract',
        effectiveDate: targetDateStr
      };
    }
  }

  const resolvedRoomTypeId = room?.roomTypeId || roomType?.id;
  const matchingConfig = resolvedRoomTypeId
    ? rateConfigs.find(rc => rc.roomTypeId === resolvedRoomTypeId)
    : undefined;

  // 2. Explicit rate option overrides
  if (rateOption === 'base') {
    if (matchingConfig?.baseRate && matchingConfig.baseRate > 0) {
      return { rate: matchingConfig.baseRate, rateSource: 'rate_configuration', effectiveDate: targetDateStr };
    }
    if (room?.price && room.price > 0) {
      return { rate: room.price, rateSource: 'room_rate', effectiveDate: targetDateStr };
    }
    return { rate: roomType?.basePrice || 0, rateSource: 'rate_configuration', effectiveDate: targetDateStr };
  }

  if (rateOption === 'weekend') {
    if (matchingConfig?.weekendRate && matchingConfig.weekendRate > 0) {
      return { rate: matchingConfig.weekendRate, rateSource: 'weekend_rate', effectiveDate: targetDateStr };
    }
    return { rate: room?.price || roomType?.basePrice || 0, rateSource: 'room_rate', effectiveDate: targetDateStr };
  }

  if (rateOption === 'weekday') {
    if (matchingConfig?.weekdayRate && matchingConfig.weekdayRate > 0) {
      return { rate: matchingConfig.weekdayRate, rateSource: 'weekday_rate', effectiveDate: targetDateStr };
    }
    return { rate: room?.price || roomType?.basePrice || 0, rateSource: 'room_rate', effectiveDate: targetDateStr };
  }

  // 3. Automatic rate resolution: seasonal -> weekend/weekday -> room price / baseRate
  if (matchingConfig) {
    if (Array.isArray(matchingConfig.seasonalRates)) {
      const seasonal = matchingConfig.seasonalRates.find(
        s => s.startDate <= targetDateStr && s.endDate >= targetDateStr && s.rate > 0
      );
      if (seasonal) {
        return {
          rate: seasonal.rate,
          rateSource: 'seasonal_rate',
          effectiveDate: targetDateStr
        };
      }
    }

    const day = getLocalDayOfWeek(targetDateStr);
    if ((day === 0 || day === 6) && matchingConfig.weekendRate && matchingConfig.weekendRate > 0) {
      return {
        rate: matchingConfig.weekendRate,
        rateSource: 'weekend_rate',
        effectiveDate: targetDateStr
      };
    }
    if (day !== 0 && day !== 6 && matchingConfig.weekdayRate && matchingConfig.weekdayRate > 0) {
      return {
        rate: matchingConfig.weekdayRate,
        rateSource: 'weekday_rate',
        effectiveDate: targetDateStr
      };
    }
  }

  // 4. Individual room price edited by management (e.g., in Rooms module)
  // Prefer room.price when set and either no rateConfig baseRate exists or room.price differs from roomType.basePrice
  if (room?.price && room.price > 0) {
    if (
      matchingConfig?.baseRate &&
      matchingConfig.baseRate > 0 &&
      roomType?.basePrice !== undefined &&
      room.price === roomType.basePrice
    ) {
      return {
        rate: matchingConfig.baseRate,
        rateSource: 'rate_configuration',
        effectiveDate: targetDateStr
      };
    }
    return {
      rate: room.price,
      rateSource: 'room_rate',
      effectiveDate: targetDateStr
    };
  }

  if (matchingConfig?.baseRate && matchingConfig.baseRate > 0) {
    return {
      rate: matchingConfig.baseRate,
      rateSource: 'rate_configuration',
      effectiveDate: targetDateStr
    };
  }

  return {
    rate: roomType?.basePrice || 0,
    rateSource: 'rate_configuration',
    effectiveDate: targetDateStr
  };
}

/**
 * Creates a clean initial rate snapshot for a newly confirmed booking / walk-in stay.
 */
export function buildInitialRateSnapshot(params: {
  checkIn: string;
  nights: number;
  nightlyRate: number;
  rateSource?: RateSourceType;
  effectiveDate?: string;
}): ReservationRateSnapshot {
  const safeNights = Math.max(1, Math.round(params.nights || 1));
  const safeRate = Math.max(0, Number(params.nightlyRate) || 0);
  const effectiveDate = params.effectiveDate || (params.checkIn || '').split('T')[0] || format(new Date(), 'yyyy-MM-dd');
  const source: RateSourceType = params.rateSource || 'room_rate';

  const nightlyRates: ReservationNightlyRateRecord[] = [];
  for (let i = 1; i <= safeNights; i++) {
    nightlyRates.push({
      nightIndex: i,
      date: addDaysToDateString(params.checkIn, i - 1),
      rate: safeRate,
      source,
      segment: 'original',
      effectiveDate
    });
  }

  return {
    originalNightlyRate: safeRate,
    originalRateSource: source,
    originalEffectiveDate: effectiveDate,
    nightlyRates,
    extensions: [],
    lastUpdatedAt: new Date().toISOString()
  };
}

/**
 * Resolves the agreed original nightly rate of an existing reservation WITHOUT pulling
 * current/latest room catalog prices ahead of stored reservation/ledger financials.
 */
export function resolveLegacyOriginalRate(
  res: Reservation,
  hotel?: Hotel | null,
  ledgerEntries?: LedgerEntry[]
): number {
  if (res.rateSnapshot?.originalNightlyRate && res.rateSnapshot.originalNightlyRate > 0) {
    return res.rateSnapshot.originalNightlyRate;
  }
  if (res.originalNightlyRate && res.originalNightlyRate > 0) {
    return res.originalNightlyRate;
  }
  if (res.nightlyRate && res.nightlyRate > 0) {
    return res.nightlyRate;
  }

  // Check matching reservation room debit entries in ledger (prefer Night 1 / earliest)
  if (ledgerEntries && ledgerEntries.length > 0) {
    const roomDebits = ledgerEntries.filter(
      e =>
        (!e.reservationId || e.reservationId === res.id) &&
        e.type === 'debit' &&
        (e.category === 'room' || e.chargeType === 'room_rate')
    );

    if (roomDebits.length > 0) {
      const sorted = [...roomDebits].sort(
        (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
      );
      const firstRoomDebit = sorted.find(e => e.referenceId === `${res.id}_NIGHT_1`) || sorted[0];

      if (firstRoomDebit.appliedNightlyRate && firstRoomDebit.appliedNightlyRate > 0) {
        return Number(firstRoomDebit.appliedNightlyRate.toFixed(2));
      }

      if (firstRoomDebit.amount > 0) {
        const inclusiveTax = ledgerEntries.find(
          e =>
            (!e.reservationId || e.reservationId === res.id) &&
            e.type === 'debit' &&
            e.category === 'tax' &&
            e.description?.toLowerCase().includes('[inclusive]') &&
            (e.timestamp === firstRoomDebit.timestamp ||
              (firstRoomDebit.id && e.description?.includes(firstRoomDebit.id)))
        );
        return Number((firstRoomDebit.amount + (inclusiveTax?.amount || 0)).toFixed(2));
      }
    }
  }

  // Infer from stored reservation totalAmount (subtracting exclusive taxes if recorded)
  const bookedNights = Math.max(
    1,
    calculateStayDuration(res.checkIn, res.checkOut).bookedNights || res.nights || 1
  );
  if (res.totalAmount && res.totalAmount > 0) {
    const exclusiveTaxRecorded = (res.taxDetails || [])
      .filter(t => !t.isInclusive)
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const inferredBaseTotal = Math.max(0, res.totalAmount - exclusiveTaxRecorded);
    if (inferredBaseTotal > 0) {
      return Number((inferredBaseTotal / bookedNights).toFixed(2));
    }
    return Number((res.totalAmount / bookedNights).toFixed(2));
  }

  // Last-resort fallback only when the reservation has zero stored rate/total/ledger data
  if ((hotel as any)?.rooms && res.roomId) {
    const room = ((hotel as any).rooms as any[]).find(r => r.id === res.roomId);
    if (room && room.price > 0) {
      return room.price;
    }
  }

  return 0;
}

/**
 * Returns an existing snapshot unchanged, or synthesizes a legacy-safe snapshot from the
 * reservation's already agreed rate so original nights are permanently frozen.
 */
export function ensureBaseRateSnapshot(
  res: Reservation,
  hotel?: Hotel | null,
  ledgerEntries?: LedgerEntry[]
): ReservationRateSnapshot {
  const bookedNights = Math.max(
    1,
    calculateStayDuration(res.checkIn, res.checkOut).bookedNights || res.nights || 1
  );

  if (res.rateSnapshot && Array.isArray(res.rateSnapshot.nightlyRates) && res.rateSnapshot.nightlyRates.length > 0) {
    const baseRate = res.rateSnapshot.originalNightlyRate || resolveLegacyOriginalRate(res, hotel, ledgerEntries);
    const baseSource = res.rateSnapshot.originalRateSource || 'room_rate';
    const baseEffDate =
      res.rateSnapshot.originalEffectiveDate ||
      (res.checkIn || '').split('T')[0] ||
      format(new Date(), 'yyyy-MM-dd');

    // Fill any missing indices conservatively without mutating already-recorded nights
    const existingByIndex = new Map<number, ReservationNightlyRateRecord>();
    res.rateSnapshot.nightlyRates.forEach(r => existingByIndex.set(r.nightIndex, { ...r }));

    const mergedRates: ReservationNightlyRateRecord[] = [];
    for (let i = 1; i <= bookedNights; i++) {
      const existing = existingByIndex.get(i);
      if (existing) {
        mergedRates.push(existing);
      } else {
        mergedRates.push({
          nightIndex: i,
          date: addDaysToDateString(res.checkIn, i - 1),
          rate: baseRate,
          source: baseSource,
          segment: 'original',
          effectiveDate: baseEffDate
        });
      }
    }
    // Preserve any records beyond bookedNights if present
    res.rateSnapshot.nightlyRates.forEach(r => {
      if (r.nightIndex > bookedNights) {
        mergedRates.push({ ...r });
      }
    });

    return {
      ...res.rateSnapshot,
      originalNightlyRate: baseRate,
      originalRateSource: baseSource,
      originalEffectiveDate: baseEffDate,
      nightlyRates: mergedRates,
      extensions: res.rateSnapshot.extensions ? [...res.rateSnapshot.extensions] : []
    };
  }

  const agreedRate = resolveLegacyOriginalRate(res, hotel, ledgerEntries);
  const inferredSource: RateSourceType =
    res.originalNightlyRate || res.nightlyRate ? 'room_rate' : 'legacy_inferred';

  return buildInitialRateSnapshot({
    checkIn: res.checkIn,
    nights: bookedNights,
    nightlyRate: agreedRate,
    rateSource: inferredSource,
    effectiveDate: (res.checkIn || '').split('T')[0]
  });
}

/**
 * Appends approved extension nights onto a reservation's rate snapshot using ONLY the
 * extension rate resolved at extension confirmation time, while leaving all previously
 * booked/confirmed nights untouched.
 */
export function appendExtensionToRateSnapshot(params: {
  res: Reservation;
  previousCheckOut: string;
  newCheckOut: string;
  extraNights: number;
  extensionRate: number;
  extensionRateSource?: RateSourceType;
  confirmedBy?: string;
  hotel?: Hotel | null;
  ledgerEntries?: LedgerEntry[];
}): ReservationRateSnapshot {
  const {
    res,
    previousCheckOut,
    newCheckOut,
    extraNights,
    extensionRate,
    extensionRateSource = 'extension_rate',
    confirmedBy,
    hotel,
    ledgerEntries
  } = params;

  const baseSnapshot = ensureBaseRateSnapshot(res, hotel, ledgerEntries);
  const existingDurationNights = Math.max(
    1,
    calculateStayDuration(res.checkIn, previousCheckOut).bookedNights || res.nights || baseSnapshot.nightlyRates.length || 1
  );

  // Preserve existing nightly records up to previous booked duration untouched
  const preservedRates = baseSnapshot.nightlyRates.filter(r => r.nightIndex <= existingDurationNights);
  const startNightIndex = existingDurationNights + 1;
  const endNightIndex = existingDurationNights + Math.max(0, extraNights);
  const nowIso = new Date().toISOString();
  const effectiveDate = (previousCheckOut || '').split('T')[0] || addDaysToDateString(res.checkIn, existingDurationNights);
  const extensionId = `ext_${Date.now()}_${startNightIndex}_${endNightIndex}`;
  const safeExtRate = Math.max(0, Number(extensionRate) || 0);

  const appendedRates: ReservationNightlyRateRecord[] = [];
  for (let idx = startNightIndex; idx <= endNightIndex; idx++) {
    appendedRates.push({
      nightIndex: idx,
      date: addDaysToDateString(res.checkIn, idx - 1),
      rate: safeExtRate,
      source: extensionRateSource,
      segment: 'extension',
      effectiveDate,
      extensionId
    });
  }

  const extensionRecord: ReservationExtensionRateRecord = {
    id: extensionId,
    confirmedAt: nowIso,
    effectiveDate,
    previousCheckOut,
    newCheckOut,
    addedNights: Math.max(0, extraNights),
    startNightIndex,
    endNightIndex,
    nightlyRate: safeExtRate,
    rateSource: extensionRateSource,
    confirmedBy
  };

  return {
    ...baseSnapshot,
    nightlyRates: [...preservedRates, ...appendedRates],
    extensions: [...(baseSnapshot.extensions || []), extensionRecord],
    lastUpdatedAt: nowIso
  };
}

/**
 * Returns the exact saved nightly rate for stay night index `nightIndex` (1-indexed).
 * Never falls back to live catalog room prices when the reservation has a stored/agreed rate.
 */
export function getNightlyRateForStayIndex(
  res: Reservation,
  nightIndex: number,
  hotel?: Hotel | null,
  ledgerEntries?: LedgerEntry[]
): NightRateLookupResult {
  const safeIndex = Math.max(1, Math.round(nightIndex || 1));

  if (res.rateSnapshot && Array.isArray(res.rateSnapshot.nightlyRates)) {
    const exactMatch = res.rateSnapshot.nightlyRates.find(r => r.nightIndex === safeIndex);
    if (exactMatch) {
      return {
        nightIndex: safeIndex,
        rate: Number(exactMatch.rate || 0),
        rateSource: exactMatch.source || 'room_rate',
        segment: exactMatch.segment || 'original',
        effectiveDate: exactMatch.effectiveDate || (res.checkIn || '').split('T')[0],
        extensionId: exactMatch.extensionId
      };
    }

    // Check extension windows if explicit per-night list missed it
    const matchingExt = res.rateSnapshot.extensions?.find(
      ext => safeIndex >= ext.startNightIndex && safeIndex <= ext.endNightIndex
    );
    if (matchingExt) {
      return {
        nightIndex: safeIndex,
        rate: Number(matchingExt.nightlyRate || 0),
        rateSource: matchingExt.rateSource || 'extension_rate',
        segment: 'extension',
        effectiveDate: matchingExt.effectiveDate,
        extensionId: matchingExt.id
      };
    }
  }

  // Fallback to already posted ledger entry for this exact night index if available
  if (ledgerEntries && ledgerEntries.length > 0) {
    const nightDebit = ledgerEntries.find(
      e =>
        (!e.reservationId || e.reservationId === res.id) &&
        e.type === 'debit' &&
        e.referenceId === `${res.id}_NIGHT_${safeIndex}`
    );
    if (nightDebit && (nightDebit.appliedNightlyRate || nightDebit.amount) > 0) {
      return {
        nightIndex: safeIndex,
        rate: Number((nightDebit.appliedNightlyRate || nightDebit.amount).toFixed(2)),
        rateSource: nightDebit.rateSource || 'legacy_inferred',
        segment: nightDebit.rateSegment === 'extension' ? 'extension' : 'original',
        effectiveDate: nightDebit.effectiveDate || addDaysToDateString(res.checkIn, safeIndex - 1)
      };
    }
  }

  const originalRate = resolveLegacyOriginalRate(res, hotel, ledgerEntries);
  return {
    nightIndex: safeIndex,
    rate: originalRate,
    rateSource: res.rateSnapshot?.originalRateSource || (res.originalNightlyRate || res.nightlyRate ? 'room_rate' : 'legacy_inferred'),
    segment: 'original',
    effectiveDate: res.rateSnapshot?.originalEffectiveDate || (res.checkIn || '').split('T')[0] || addDaysToDateString(res.checkIn, safeIndex - 1)
  };
}

/**
 * Calculates exact total room accommodation cost across `bookedNights` by summing
 * each night's snapshot rate (supporting original rate + distinct extension rate segments).
 */
export function calculateBookedRoomTotal(
  res: Reservation,
  bookedNights: number,
  hotel?: Hotel | null,
  ledgerEntries?: LedgerEntry[]
): number {
  const safeNights = Math.max(0, Math.round(bookedNights || 0));
  if (safeNights === 0) return 0;

  if (
    !res.rateSnapshot ||
    (!res.rateSnapshot.extensions?.length &&
      res.rateSnapshot.nightlyRates?.every(n => n.rate === res.rateSnapshot!.originalNightlyRate))
  ) {
    const singleRate = resolveLegacyOriginalRate(res, hotel, ledgerEntries);
    return Number((singleRate * safeNights).toFixed(2));
  }

  let total = 0;
  for (let i = 1; i <= safeNights; i++) {
    total += getNightlyRateForStayIndex(res, i, hotel, ledgerEntries).rate;
  }
  return Number(total.toFixed(2));
}

/**
 * Computes the exact overstay charge amount for overstay night index `overstayNightIndex`
 * while preserving the hotel's configured overstay policy (`grace`, `partial`, `full`) and
 * using the reservation's saved nightly rate (never live catalog prices).
 */
export function computeOverstayNightAmount(params: {
  nightlyRate: number;
  hotel?: Hotel | null;
  overstayNightIndex: number;
  hoursPastDeadline: number;
}): number {
  const { nightlyRate, hotel, overstayNightIndex, hoursPastDeadline } = params;
  const safeRate = Math.max(0, Number(nightlyRate) || 0);
  if (safeRate <= 0) return 0;

  const policy = hotel?.overstayPolicy || 'grace';
  if (policy === 'partial' && overstayNightIndex === 1) {
    const partialHours = hotel?.overstayPartialHours ?? 3;
    if (hoursPastDeadline <= partialHours) {
      const partialPercentage = hotel?.overstayPartialPercentage ?? 50;
      return Number((safeRate * (partialPercentage / 100)).toFixed(2));
    }
  }

  return Number(safeRate.toFixed(2));
}
