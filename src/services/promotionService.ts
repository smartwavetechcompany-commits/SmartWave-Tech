import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  query, 
  where, 
  onSnapshot, 
  updateDoc, 
  arrayUnion, 
  increment,
  Unsubscribe 
} from 'firebase/firestore';
import { db } from '../firebase';
import { database } from '../utils/database';
import { Promotion, PromotionRedemption, PromotionStatus, UserProfile } from '../types';
import { differenceInDays, parseISO, format } from 'date-fns';

/**
 * Validates whether a user has authority to manage promotions
 */
export function canManagePromotions(profile: UserProfile | null): boolean {
  if (!profile) return false;
  if (profile.role === 'superAdmin') return true;
  if (profile.role === 'hotelAdmin') return true;
  if (profile.staffRole === 'admin') return true;
  if (profile.permissions?.includes('edit_hotel_settings') || profile.permissions?.includes('manage_settings')) return true;
  return false;
}

/**
 * Subscribes to real-time promotions for a hotel
 */
export function subscribePromotions(
  hotelId: string, 
  callback: (promotions: Promotion[]) => void
): Unsubscribe {
  const promotionsRef = collection(db, 'hotels', hotelId, 'promotions');
  return onSnapshot(promotionsRef, (snapshot) => {
    const list: Promotion[] = [];
    snapshot.forEach((docSnap) => {
      list.push({ id: docSnap.id, ...docSnap.data() } as Promotion);
    });
    // Sort active first, then by creation date descending
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    callback(list);
  }, (err) => {
    console.error('Failed to subscribe to promotions:', err);
    callback([]);
  });
}

/**
 * Fetches all promotions for a hotel
 */
export async function getPromotions(hotelId: string): Promise<Promotion[]> {
  if (!hotelId) return [];
  const promotionsRef = collection(db, 'hotels', hotelId, 'promotions');
  const snapshot = await getDocs(promotionsRef);
  const list: Promotion[] = [];
  snapshot.forEach((docSnap) => {
    list.push({ id: docSnap.id, ...docSnap.data() } as Promotion);
  });
  return list;
}

/**
 * Fetches a single promotion by its unique code for a hotel
 */
export async function getPromotionByCode(hotelId: string, rawCode: string): Promise<Promotion | null> {
  if (!hotelId || !rawCode) return null;
  const cleanCode = rawCode.trim().toUpperCase();
  const promotionsRef = collection(db, 'hotels', hotelId, 'promotions');
  const q = query(promotionsRef, where('code', '==', cleanCode));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  const firstDoc = snapshot.docs[0];
  return { id: firstDoc.id, ...firstDoc.data() } as Promotion;
}

export interface PromotionValidationContext {
  roomTypeId?: string;
  roomId?: string;
  checkIn: string; // YYYY-MM-DD or ISO
  checkOut: string; // YYYY-MM-DD or ISO
  bookingSource?: string;
  subtotal: number;
  roomCharges?: number;
  currency?: 'NGN' | 'USD';
  exchangeRate?: number;
  guestType?: 'individual' | 'corporate';
  corporateId?: string;
  corporateName?: string;
  corporateStatus?: 'active' | 'suspended';
  isNegotiatedRate?: boolean;
}

export interface PromotionValidationResult {
  isValid: boolean;
  errorReason?: string;
  discountAmount: number;
  originalCharge: number;
  revisedCharge: number;
  promotion?: Promotion;
}

/**
 * Validates a promotional code against reservation parameters in real-time.
 * Does NOT alter reservation state if invalid.
 */
export async function validatePromotion(
  hotelId: string, 
  rawCode: string, 
  context: PromotionValidationContext
): Promise<PromotionValidationResult> {
  const originalCharge = Number(context.subtotal || 0);

  if (!rawCode || !rawCode.trim()) {
    return {
      isValid: false,
      errorReason: 'Please enter a promotional code.',
      discountAmount: 0,
      originalCharge,
      revisedCharge: originalCharge
    };
  }

  const promo = await getPromotionByCode(hotelId, rawCode);
  if (!promo) {
    return {
      isValid: false,
      errorReason: `Promo code "${rawCode.trim().toUpperCase()}" is invalid or does not exist.`,
      discountAmount: 0,
      originalCharge,
      revisedCharge: originalCharge
    };
  }

  // 1. Status Check
  if (promo.status === 'paused') {
    return {
      isValid: false,
      errorReason: `Campaign "${promo.name}" (${promo.code}) is currently paused.`,
      discountAmount: 0,
      originalCharge,
      revisedCharge: originalCharge,
      promotion: promo
    };
  }

  if (promo.status === 'expired') {
    return {
      isValid: false,
      errorReason: `Promotion "${promo.name}" (${promo.code}) has expired.`,
      discountAmount: 0,
      originalCharge,
      revisedCharge: originalCharge,
      promotion: promo
    };
  }

  // 2. Date Validity Check
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  if (todayStr < promo.startDate) {
    return {
      isValid: false,
      errorReason: `Promotion "${promo.code}" is scheduled to start on ${promo.startDate}.`,
      discountAmount: 0,
      originalCharge,
      revisedCharge: originalCharge,
      promotion: promo
    };
  }

  if (todayStr > promo.expiryDate) {
    return {
      isValid: false,
      errorReason: `Promotion "${promo.code}" expired on ${promo.expiryDate}.`,
      discountAmount: 0,
      originalCharge,
      revisedCharge: originalCharge,
      promotion: promo
    };
  }

  // If seasonal or date-specific, check stay dates
  if (promo.type === 'seasonal' || promo.type === 'date_specific') {
    const checkInDateOnly = context.checkIn?.split('T')[0] || '';
    if (checkInDateOnly && (checkInDateOnly < promo.startDate || checkInDateOnly > promo.expiryDate)) {
      return {
        isValid: false,
        errorReason: `This seasonal promotion requires check-in between ${promo.startDate} and ${promo.expiryDate}.`,
        discountAmount: 0,
        originalCharge,
        revisedCharge: originalCharge,
        promotion: promo
      };
    }
  }

  // 3. Usage Limit Check
  if (promo.maxUses && promo.maxUses > 0 && promo.usedCount >= promo.maxUses) {
    return {
      isValid: false,
      errorReason: `Promotion "${promo.code}" has reached its maximum redemption limit (${promo.maxUses} uses).`,
      discountAmount: 0,
      originalCharge,
      revisedCharge: originalCharge,
      promotion: promo
    };
  }

  // 4. Minimum Stay Nights Check
  let stayNights = 1;
  try {
    if (context.checkIn && context.checkOut) {
      stayNights = Math.max(1, differenceInDays(parseISO(context.checkOut), parseISO(context.checkIn)));
    }
  } catch (e) {
    stayNights = 1;
  }

  if (promo.minStayNights && promo.minStayNights > 0 && stayNights < promo.minStayNights) {
    return {
      isValid: false,
      errorReason: `Promotion requires a minimum stay of ${promo.minStayNights} night${promo.minStayNights > 1 ? 's' : ''} (selected stay: ${stayNights} night${stayNights > 1 ? 's' : ''}).`,
      discountAmount: 0,
      originalCharge,
      revisedCharge: originalCharge,
      promotion: promo
    };
  }

  // 5. Minimum Booking Amount Check
  if (promo.minBookingAmount && promo.minBookingAmount > 0 && context.subtotal < promo.minBookingAmount) {
    const minFormatted = promo.currency === 'USD' 
      ? `$${promo.minBookingAmount.toLocaleString()}` 
      : `₦${promo.minBookingAmount.toLocaleString()}`;
    return {
      isValid: false,
      errorReason: `Promotion requires a minimum booking subtotal of ${minFormatted}.`,
      discountAmount: 0,
      originalCharge,
      revisedCharge: originalCharge,
      promotion: promo
    };
  }

  // 6. Eligible Room Types Check
  if (promo.eligibleRoomTypes && promo.eligibleRoomTypes.length > 0 && !promo.eligibleRoomTypes.includes('all')) {
    if (context.roomTypeId && !promo.eligibleRoomTypes.includes(context.roomTypeId)) {
      return {
        isValid: false,
        errorReason: `Promotion "${promo.code}" is not eligible for the selected room type.`,
        discountAmount: 0,
        originalCharge,
        revisedCharge: originalCharge,
        promotion: promo
      };
    }
  }

  // 7. Eligible Specific Rooms Check
  if (promo.eligibleRooms && promo.eligibleRooms.length > 0) {
    if (context.roomId && !promo.eligibleRooms.includes(context.roomId)) {
      return {
        isValid: false,
        errorReason: `Promotion "${promo.code}" is not valid for this specific room.`,
        discountAmount: 0,
        originalCharge,
        revisedCharge: originalCharge,
        promotion: promo
      };
    }
  }

  // 8. Eligible Booking Sources Check
  if (promo.eligibleBookingSources && promo.eligibleBookingSources.length > 0 && !promo.eligibleBookingSources.includes('all')) {
    if (context.bookingSource && !promo.eligibleBookingSources.some(s => s.toLowerCase() === context.bookingSource?.toLowerCase())) {
      return {
        isValid: false,
        errorReason: `Promotion "${promo.code}" is not valid for booking source "${context.bookingSource}".`,
        discountAmount: 0,
        originalCharge,
        revisedCharge: originalCharge,
        promotion: promo
      };
    }
  }

  // 9. Corporate Account Status & Eligibility Checks
  if (context.guestType === 'corporate' && context.corporateStatus === 'suspended') {
    return {
      isValid: false,
      errorReason: 'Linked corporate account is suspended. Promotional discounts cannot be applied.',
      discountAmount: 0,
      originalCharge,
      revisedCharge: originalCharge,
      promotion: promo
    };
  }

  const targetGuestType = promo.targetGuestType || 'all';
  if (targetGuestType === 'corporate_only' && context.guestType !== 'corporate') {
    return {
      isValid: false,
      errorReason: `Promotion "${promo.code}" is exclusively available for corporate accounts.`,
      discountAmount: 0,
      originalCharge,
      revisedCharge: originalCharge,
      promotion: promo
    };
  }

  if (targetGuestType === 'individual_only' && context.guestType === 'corporate') {
    return {
      isValid: false,
      errorReason: `Promotion "${promo.code}" is only valid for individual guest bookings.`,
      discountAmount: 0,
      originalCharge,
      revisedCharge: originalCharge,
      promotion: promo
    };
  }

  if (targetGuestType === 'selected_corporate') {
    if (context.guestType !== 'corporate' || !context.corporateId) {
      return {
        isValid: false,
        errorReason: `Promotion "${promo.code}" is valid only for selected corporate partner accounts.`,
        discountAmount: 0,
        originalCharge,
        revisedCharge: originalCharge,
        promotion: promo
      };
    }

    if (promo.eligibleCorporateIds && promo.eligibleCorporateIds.length > 0 && !promo.eligibleCorporateIds.includes(context.corporateId)) {
      return {
        isValid: false,
        errorReason: `Promotion "${promo.code}" is not valid for the selected corporate account.`,
        discountAmount: 0,
        originalCharge,
        revisedCharge: originalCharge,
        promotion: promo
      };
    }
  }

  // 10. Existing Corporate Negotiated Rates Stacking Check
  if (context.isNegotiatedRate && !promo.allowStackOnNegotiatedRate) {
    return {
      isValid: false,
      errorReason: `Promotion "${promo.code}" cannot be combined with existing negotiated corporate contract rates.`,
      discountAmount: 0,
      originalCharge,
      revisedCharge: originalCharge,
      promotion: promo
    };
  }

  // 11. Financial Discount Calculation
  // Determine eligible charge base (room charges only or all charges)
  const eligibleBase = (promo.appliesTo === 'room_only' && context.roomCharges !== undefined && context.roomCharges > 0)
    ? context.roomCharges
    : context.subtotal;

  let calculatedDiscount = 0;
  if (promo.discountType === 'percentage') {
    calculatedDiscount = (eligibleBase * promo.value) / 100;
    if (promo.maxDiscountCap && promo.maxDiscountCap > 0) {
      calculatedDiscount = Math.min(calculatedDiscount, promo.maxDiscountCap);
    }
  } else {
    // Fixed amount
    calculatedDiscount = promo.value;
  }

  // Discount must not exceed eligible base charge or total subtotal
  calculatedDiscount = Math.min(calculatedDiscount, eligibleBase, originalCharge);
  calculatedDiscount = Math.max(0, Number(calculatedDiscount.toFixed(2)));
  const revisedCharge = Math.max(0, Number((originalCharge - calculatedDiscount).toFixed(2)));

  return {
    isValid: true,
    discountAmount: calculatedDiscount,
    originalCharge,
    revisedCharge,
    promotion: promo
  };
}

/**
 * Creates a new promotional campaign (Hotel Admins only)
 */
export async function createPromotion(
  hotelId: string, 
  data: Omit<Promotion, 'id' | 'hotelId' | 'usedCount' | 'redemptions' | 'createdAt' | 'createdBy'>, 
  profile: UserProfile
): Promise<Promotion> {
  if (!canManagePromotions(profile)) {
    throw new Error('Access denied: Only Hotel Administrators can create promotion codes.');
  }

  const cleanCode = data.code.trim().toUpperCase().replace(/[^A-Z0-9_\-]/g, '');
  if (!cleanCode) {
    throw new Error('A valid alphanumeric promotional code is required.');
  }

  if (!data.name || !data.name.trim()) {
    throw new Error('Campaign title is required.');
  }

  if (data.value <= 0) {
    throw new Error('Discount value must be greater than zero.');
  }

  if (data.discountType === 'percentage' && data.value > 100) {
    throw new Error('Percentage discount cannot exceed 100%.');
  }

  if (data.startDate > data.expiryDate) {
    throw new Error('Start date cannot be after the expiry date.');
  }

  // Check for duplicate code in this hotel
  const existing = await getPromotionByCode(hotelId, cleanCode);
  if (existing) {
    throw new Error(`Promotional code "${cleanCode}" already exists for this hotel property.`);
  }

  const promoData: any = {
    hotelId,
    code: cleanCode,
    name: data.name.trim(),
    description: data.description?.trim() || '',
    type: data.type || 'percentage',
    discountType: data.discountType || 'percentage',
    value: Number(data.value),
    currency: data.currency || 'NGN',
    startDate: data.startDate,
    expiryDate: data.expiryDate,
    status: data.status || 'active',
    targetGuestType: data.targetGuestType || 'all',
    eligibleCorporateIds: data.eligibleCorporateIds || [],
    allowStackOnNegotiatedRate: Boolean(data.allowStackOnNegotiatedRate),
    eligibleRoomTypes: data.eligibleRoomTypes || ['all'],
    eligibleRooms: data.eligibleRooms || [],
    eligibleBookingSources: data.eligibleBookingSources || ['all'],
    minStayNights: data.minStayNights ? Number(data.minStayNights) : 0,
    minBookingAmount: data.minBookingAmount ? Number(data.minBookingAmount) : 0,
    maxUses: data.maxUses ? Number(data.maxUses) : 0,
    usedCount: 0,
    maxDiscountCap: data.maxDiscountCap ? Number(data.maxDiscountCap) : 0,
    appliesTo: data.appliesTo || 'room_only',
    combinable: Boolean(data.combinable),
    redemptions: [],
    createdAt: new Date().toISOString(),
    createdBy: profile.uid,
    createdByName: profile.name || profile.displayName || profile.email
  };

  const colRef = collection(db, 'hotels', hotelId, 'promotions');
  const docRef = await database.safeAdd(colRef, promoData, {
    hotelId,
    module: 'Promotions',
    action: 'CREATE_PROMOTION',
    details: `Created promotional code "${cleanCode}" (${data.name}) by ${profile.name || profile.email}`
  });

  return { id: docRef.id, ...promoData } as Promotion;
}

/**
 * Updates an existing promotion configuration (Hotel Admins only)
 */
export async function updatePromotion(
  hotelId: string, 
  promoId: string, 
  updates: Partial<Promotion>, 
  profile: UserProfile
): Promise<void> {
  if (!canManagePromotions(profile)) {
    throw new Error('Access denied: Only Hotel Administrators can update promotions.');
  }

  const docRef = doc(db, 'hotels', hotelId, 'promotions', promoId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) {
    throw new Error('Promotion does not exist.');
  }

  const current = snap.data() as Promotion;

  // If code changed, check duplicate
  if (updates.code && updates.code.trim().toUpperCase() !== current.code) {
    const cleanCode = updates.code.trim().toUpperCase().replace(/[^A-Z0-9_\-]/g, '');
    const duplicate = await getPromotionByCode(hotelId, cleanCode);
    if (duplicate && duplicate.id !== promoId) {
      throw new Error(`Promotional code "${cleanCode}" is already in use.`);
    }
    updates.code = cleanCode;
  }

  if (updates.startDate && updates.expiryDate && updates.startDate > updates.expiryDate) {
    throw new Error('Start date cannot be after expiry date.');
  }

  const payload: any = {
    ...updates,
    updatedAt: new Date().toISOString(),
    updatedBy: profile.uid,
    updatedByName: profile.name || profile.displayName || profile.email
  };

  await database.safeUpdate(docRef, payload, {
    hotelId,
    module: 'Promotions',
    action: 'UPDATE_PROMOTION',
    details: `Updated promotional code "${current.code}" configuration`
  });
}

/**
 * Toggles status between active and paused (Hotel Admins only)
 */
export async function togglePromotionStatus(
  hotelId: string, 
  promoId: string, 
  currentStatus: PromotionStatus, 
  profile: UserProfile
): Promise<void> {
  if (!canManagePromotions(profile)) {
    throw new Error('Access denied: Only Hotel Administrators can change promotion status.');
  }

  const newStatus: PromotionStatus = currentStatus === 'active' ? 'paused' : 'active';
  const docRef = doc(db, 'hotels', hotelId, 'promotions', promoId);

  await database.safeUpdate(docRef, { 
    status: newStatus,
    updatedAt: new Date().toISOString(),
    updatedBy: profile.uid
  }, {
    hotelId,
    module: 'Promotions',
    action: newStatus === 'active' ? 'ACTIVATE_PROMOTION' : 'PAUSE_PROMOTION',
    details: `${newStatus === 'active' ? 'Activated' : 'Paused'} promotional code`
  });
}

/**
 * Deletes a promotion (Hotel Admins only)
 */
export async function deletePromotion(
  hotelId: string, 
  promoId: string, 
  profile: UserProfile
): Promise<void> {
  if (!canManagePromotions(profile)) {
    throw new Error('Access denied: Only Hotel Administrators can delete promotions.');
  }

  const docRef = doc(db, 'hotels', hotelId, 'promotions', promoId);
  const snap = await getDoc(docRef);
  const code = snap.exists() ? (snap.data() as Promotion).code : promoId;

  await database.safeDelete(docRef, {
    hotelId,
    module: 'Promotions',
    action: 'DELETE_PROMOTION',
    details: `Deleted promotional code "${code}"`
  });
}

/**
 * Records a redemption against a promotion document
 */
export async function recordPromotionRedemption(
  hotelId: string, 
  promoId: string, 
  redemption: PromotionRedemption, 
  profile?: UserProfile | null
): Promise<void> {
  if (!hotelId || !promoId) return;
  try {
    const docRef = doc(db, 'hotels', hotelId, 'promotions', promoId);
    await updateDoc(docRef, {
      usedCount: increment(1),
      redemptions: arrayUnion({
        ...redemption,
        appliedByName: profile?.name || profile?.displayName || profile?.email || 'Staff'
      }),
      updatedAt: new Date().toISOString(),
      updatedBy: profile?.uid || 'system'
    });
  } catch (err) {
    console.error('Failed to record promotion redemption:', err);
    // Non-blocking for reservation flow to preserve operational integrity
  }
}
