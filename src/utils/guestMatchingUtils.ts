import { Guest, LoyaltyAccount } from '../types';

export interface ReturningGuestCandidate {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  idNumber?: string | null;
  idType?: string | null;
  address?: string | null;
}

export interface ReturningGuestMatch {
  guest: Guest;
  confidence: 'high' | 'medium';
  matchReasons: string[];
  score: number;
  loyaltyAccount?: LoyaltyAccount;
}

/**
 * Normalizes an email address for reliable case-insensitive comparison.
 */
export function normalizeGuestEmail(email?: string | null): string {
  if (!email) return '';
  const trimmed = String(email).trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return '';
  return trimmed;
}

/**
 * Extracts only digits from a phone number string.
 */
export function normalizePhoneDigits(phone?: string | null): string {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '');
}

/**
 * Matches two phone numbers across formatting and country-code variations
 * (e.g., "+234 801 234 5678", "2348012345678", "0801-234-5678", "08012345678").
 * Requires at least 7 digits on both numbers to prevent false matches on partial inputs.
 */
export function phonesMatch(phoneA?: string | null, phoneB?: string | null): boolean {
  const digitsA = normalizePhoneDigits(phoneA);
  const digitsB = normalizePhoneDigits(phoneB);

  if (digitsA.length < 7 || digitsB.length < 7) return false;
  if (digitsA === digitsB) return true;

  // Strip leading zeros for local-format equivalence (e.g. "08012345678" vs "8012345678")
  const strippedA = digitsA.replace(/^0+/, '');
  const strippedB = digitsB.replace(/^0+/, '');
  if (strippedA.length >= 7 && strippedA === strippedB) return true;

  // Match canonical last-10-digit subscriber suffix when both have >= 10 digits
  // Covers international prefix vs local leading-0 format (e.g. "+234 801 234 5678" vs "08012345678")
  if (digitsA.length >= 10 && digitsB.length >= 10) {
    if (digitsA.slice(-10) === digitsB.slice(-10)) return true;
  }

  // Handle cases where one has country code (12-13 digits) and the other has 10 digits without leading 0
  if (strippedA.length >= 10 && strippedB.length >= 10) {
    if (strippedA.slice(-10) === strippedB.slice(-10)) return true;
  }

  return false;
}

/**
 * Normalizes a government ID / passport number by removing spaces and punctuation.
 * Requires at least 4 alphanumeric characters to avoid matching placeholders like "N/A".
 */
export function normalizeIdNumber(idNumber?: string | null): string {
  if (!idNumber) return '';
  const cleaned = String(idNumber).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (cleaned.length < 4) return '';
  if (cleaned === 'none' || cleaned === 'null' || cleaned === 'unknown') return '';
  return cleaned;
}

/**
 * Normalizes a guest's full name by trimming, lowercasing, and collapsing whitespace.
 */
export function normalizeGuestName(name?: string | null): string {
  if (!name) return '';
  return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Splits a normalized name into sorted tokens for detecting swapped first/last names
 * (e.g., "Doe John" vs "John Doe").
 */
function getSortedNameTokens(name?: string | null): string[] {
  const norm = normalizeGuestName(name);
  if (!norm) return [];
  return norm.split(' ').filter((t) => t.length > 0).sort();
}

/**
 * Returns true if candidate and existing guest both specify a strong identifier
 * (email, phone, or ID number) that explicitly conflicts.
 * Used as a safety guard so two different people who share a name are never falsely merged.
 */
function hasConflictingStrongIdentifiers(
  candidate: ReturningGuestCandidate,
  existing: Guest
): boolean {
  const candEmail = normalizeGuestEmail(candidate.email);
  const existEmail = normalizeGuestEmail(existing.email);
  if (candEmail && existEmail && candEmail !== existEmail) {
    return true;
  }

  const candPhoneDigits = normalizePhoneDigits(candidate.phone);
  const existPhoneDigits = normalizePhoneDigits(existing.phone);
  if (candPhoneDigits.length >= 7 && existPhoneDigits.length >= 7 && !phonesMatch(candidate.phone, existing.phone)) {
    return true;
  }

  const candId = normalizeIdNumber(candidate.idNumber);
  const existId = normalizeIdNumber(existing.idNumber);
  if (candId && existId && candId !== existId) {
    return true;
  }

  return false;
}

/**
 * Detects the best matching existing guest profile for a returning guest using
 * multi-signal matching across Email, Phone (format & country-code aware),
 * Government ID Number, and Normalized Name (exact or reordered).
 *
 * When multiple profiles match (e.g., historical duplicates), tie-breaking
 * prioritizes the guest profile holding an existing loyalty account with the
 * highest accumulated points so unredeemed loyalty points keep accumulating
 * on the guest's canonical account.
 */
export function findReturningGuestMatch(
  candidate: ReturningGuestCandidate,
  existingGuests: Guest[],
  loyaltyAccountsMap?: Record<string, LoyaltyAccount>
): ReturningGuestMatch | null {
  if (!existingGuests || existingGuests.length === 0) return null;

  const candEmail = normalizeGuestEmail(candidate.email);
  const candPhoneDigits = normalizePhoneDigits(candidate.phone);
  const candId = normalizeIdNumber(candidate.idNumber);
  const candName = normalizeGuestName(candidate.name);
  const candTokens = getSortedNameTokens(candidate.name);

  if (!candEmail && candPhoneDigits.length < 7 && !candId && candName.length < 3) {
    return null;
  }

  const matches: ReturningGuestMatch[] = [];

  for (const guest of existingGuests) {
    if (!guest?.id) continue;

    let score = 0;
    let strongSignalCount = 0;
    const matchReasons: string[] = [];

    const existEmail = normalizeGuestEmail(guest.email);
    if (candEmail && existEmail && candEmail === existEmail) {
      score += 100;
      strongSignalCount++;
      matchReasons.push('Email');
    }

    if (candPhoneDigits.length >= 7 && phonesMatch(candidate.phone, guest.phone)) {
      score += 100;
      strongSignalCount++;
      matchReasons.push('Phone');
    }

    const existId = normalizeIdNumber(guest.idNumber);
    if (candId && existId && candId === existId) {
      score += 95;
      strongSignalCount++;
      matchReasons.push('ID Number');
    }

    const existName = normalizeGuestName(guest.name);
    const hasConflict = hasConflictingStrongIdentifiers(candidate, guest);

    if (candName.length >= 3 && existName.length >= 3) {
      if (candName === existName) {
        // Always add name bonus if a strong signal matched;
        // for name-only matches, block if strong identifiers explicitly conflict
        if (strongSignalCount > 0 || !hasConflict) {
          score += 40;
          matchReasons.push('Name');
        }
      } else if (candTokens.length >= 2) {
        const existTokens = getSortedNameTokens(guest.name);
        if (
          existTokens.length === candTokens.length &&
          candTokens.every((token, idx) => token === existTokens[idx])
        ) {
          if (strongSignalCount > 0 || !hasConflict) {
            score += 25;
            matchReasons.push('Name');
          }
        }
      }
    }

    if (score <= 0) continue;

    // Determine confidence level
    const isMultiWordExactName =
      candName === existName && candTokens.length >= 2 && !hasConflict;
    const confidence: 'high' | 'medium' =
      strongSignalCount > 0 || isMultiWordExactName ? 'high' : 'medium';

    const loyaltyAccount = loyaltyAccountsMap ? loyaltyAccountsMap[guest.id] : undefined;

    matches.push({
      guest,
      confidence,
      matchReasons,
      score,
      loyaltyAccount,
    });
  }

  if (matches.length === 0) return null;

  // Sort matches: highest score first, then loyalty-preserving tie-breakers
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    const aAvailPts = Math.max(0, Number(a.loyaltyAccount?.availablePoints) || 0);
    const bAvailPts = Math.max(0, Number(b.loyaltyAccount?.availablePoints) || 0);
    if (bAvailPts !== aAvailPts) return bAvailPts - aAvailPts;

    const aLifetimePts = Math.max(0, Number(a.loyaltyAccount?.lifetimePointsEarned) || 0);
    const bLifetimePts = Math.max(0, Number(b.loyaltyAccount?.lifetimePointsEarned) || 0);
    if (bLifetimePts !== aLifetimePts) return bLifetimePts - aLifetimePts;

    const aHasLoyalty = a.loyaltyAccount ? 1 : 0;
    const bHasLoyalty = b.loyaltyAccount ? 1 : 0;
    if (bHasLoyalty !== aHasLoyalty) return bHasLoyalty - aHasLoyalty;

    const aStays = Number(a.guest.totalStays) || 0;
    const bStays = Number(b.guest.totalStays) || 0;
    if (bStays !== aStays) return bStays - aStays;

    const aDeposit = Number((a.guest as any).depositBalance) || 0;
    const bDeposit = Number((b.guest as any).depositBalance) || 0;
    if (bDeposit !== aDeposit) return bDeposit - aDeposit;

    const aCreated = a.guest.createdAt ? new Date(a.guest.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bCreated = b.guest.createdAt ? new Date(b.guest.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
    return aCreated - bCreated;
  });

  return matches[0];
}

/**
 * Returns ONLY additive field updates for contact/ID fields that are currently
 * blank on the existing guest profile and non-empty on the incoming returning guest data.
 * Never overwrites existing non-empty guest fields.
 */
export function buildMissingGuestFieldUpdates(
  existingGuest: Guest,
  incoming: ReturningGuestCandidate
): Partial<Guest> {
  const updates: Partial<Guest> = {};

  const incomingEmail = incoming.email?.trim();
  if (!existingGuest.email?.trim() && incomingEmail) {
    updates.email = incomingEmail;
  }

  const incomingPhone = incoming.phone?.trim();
  if (!existingGuest.phone?.trim() && incomingPhone) {
    updates.phone = incomingPhone;
  }

  const incomingIdType = incoming.idType?.trim();
  if (!existingGuest.idType?.trim() && incomingIdType) {
    updates.idType = incomingIdType;
  }

  const incomingIdNumber = incoming.idNumber?.trim();
  if (!existingGuest.idNumber?.trim() && incomingIdNumber) {
    updates.idNumber = incomingIdNumber;
  }

  const incomingAddress = incoming.address?.trim();
  if (!existingGuest.address?.trim() && incomingAddress) {
    updates.address = incomingAddress;
  }

  return updates;
}
