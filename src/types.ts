export type UserRole = 'superAdmin' | 'hotelAdmin' | 'staff';
export type StaffRole = 'receptionist' | 'housekeeper' | 'manager' | 'accountant' | 'frontDesk' | 'kitchen' | 'maintenance' | 'admin' | 'corporate';
export type SubscriptionStatus = 'active' | 'expired' | 'suspended';
export type PlanType = 'standard' | 'premium' | 'enterprise';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  hotelId: string;
  createdAt: string;
  status: 'active' | 'inactive';
  displayName?: string;
  permissions?: string[]; // For staff module access
  staffRole?: StaffRole;
  roles?: StaffRole[]; // Multi-role support
  subscriptionExpiry?: string;
}

export interface HotelBranding {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  address?: string;
  phone?: string;
  email?: string;
  footerNotes?: string;
}

export interface Hotel {
  id: string;
  name: string;
  plan: PlanType;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiry: string; // ISO string
  trackingCode: string;
  createdAt: string;
  roomLimit: number;
  staffLimit: number;
  modulesEnabled: string[];
  branding?: HotelBranding;
  limits?: {
    rooms: number;
    staff: number;
  };
  adminUIDs?: string[];
  website?: string;
  planHistory?: {
    plan: PlanType;
    previousPlan?: PlanType;
    changedAt: string;
    amount?: number;
    reason?: string;
  }[];
}

export interface TrackingCode {
  id?: string;
  code: string;
  plan: PlanType;
  expiryDate: string; // ISO string
  status: 'active' | 'used' | 'expired';
  maxHotels: number;
  issuedBy: string;
  createdAt: string;
  price?: number;
  usedByHotel?: string;
  hotelId?: string; // For backward compatibility or tracking usage
}

export interface GlobalAuditLog {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
}

export interface SystemSettings {
  bankName: string;
  accountNumber: string;
  accountName: string;
  paymentInstructions: string;
  supportEmail: string;
  exchangeRate: number;
}

export interface TrackingCodeRequest {
  id: string;
  hotelName: string;
  email: string;
  phone?: string;
  plan: PlanType;
  status: 'pending' | 'approved' | 'rejected';
  timestamp: string;
  paymentReceiptUrl?: string;
  message?: string;
  type?: 'new' | 'extension';
  generatedCode?: string;
}

export interface AuditLog {
  id: string;
  action: string;
  userId: string;
  userEmail: string;
  hotelId: string;
  timestamp: string;
  details: string;
}

export interface RoomType {
  id: string;
  name: string;
  description?: string;
  basePrice: number;
  capacity: number;
  amenities: string[];
}

export interface Room {
  id: string;
  roomNumber: string;
  type: string;
  roomTypeId?: string; // Link to RoomType
  price: number;
  status: 'clean' | 'dirty' | 'occupied' | 'maintenance' | 'vacant' | 'out_of_service';
  floor: string;
  capacity: number;
  amenities?: string[];
  description?: string;
  images?: string[];
}

export interface Reservation {
  id: string;
  guestName: string;
  guestEmail?: string;
  guestPhone?: string;
  guestId?: string; // Link to Guest profile
  corporateId?: string; // Link to CorporateAccount
  roomId: string;
  roomNumber: string;
  checkIn: string;
  checkOut: string;
  nights?: number;
  status: 'pending' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show';
  totalAmount: number;
  paidAmount: number;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  notes?: string;
  corporateReference?: string;
  createdAt: string;
  ledgerEntries?: LedgerEntry[]; // Changed from string[] to LedgerEntry[]
}

export interface KitchenOrder {
  id: string;
  roomNumber: string;
  items: string;
  status: 'pending' | 'preparing' | 'ready' | 'delivered';
  timestamp: string;
  category: 'food' | 'drink' | 'other';
  notes?: string;
  preparedAt?: string;
  readyAt?: string;
  deliveredAt?: string;
}

export interface FinanceRecord {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  description: string;
  timestamp: string;
  paymentMethod: 'cash' | 'card' | 'transfer';
}

export interface InventoryItem {
  id: string;
  name: string;
  category: 'food' | 'drink' | 'cleaning' | 'other';
  quantity: number;
  unit: string;
  minThreshold: number;
  lastUpdated: string;
}

export interface MaintenanceRequest {
  id: string;
  roomNumber: string;
  issue: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  reportedBy: string;
  assignedTo?: string;
  timestamp: string;
  completedAt?: string;
  notes?: string;
}

export interface Guest {
  id: string;
  name: string;
  email: string;
  phone: string;
  idType?: string;
  idNumber?: string;
  address?: string;
  notes?: string;
  tags?: string[]; // VIP, Corporate, Frequent, etc.
  preferences?: string[];
  corporateId?: string; // Link to CorporateAccount
  ledgerBalance: number;
  totalStays: number;
  totalSpent: number;
  lastStay?: string;
  stayHistory?: string[]; // Reservation IDs
  createdAt?: string;
}

export interface LedgerEntry {
  id: string;
  guestId: string;
  corporateId?: string; // Link to CorporateAccount
  hotelId: string;
  type: 'debit' | 'credit';
  amount: number;
  description: string;
  timestamp: string;
  reservationId?: string; // Link to Reservation
  referenceId?: string; // e.g. Reservation ID, Kitchen Order ID
  category: 'room' | 'restaurant' | 'service' | 'payment' | 'transfer' | 'corporate';
  postedBy: string;
}

export interface CorporateAccount {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  contactPerson: string;
  taxId: string;
  creditLimit: number;
  currentBalance: number;
  billingCycle: 'weekly' | 'monthly' | 'quarterly';
  status: 'active' | 'suspended';
  createdAt: string;
}

export interface CorporateRate {
  id: string;
  corporateId: string;
  roomType: string;
  roomTypeId?: string; // Link to RoomType
  rate: number;
  currency: 'NGN' | 'USD';
  startDate: string;
  endDate: string;
  discountType?: 'percentage' | 'fixed';
  discountValue?: number;
  conditions?: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface DailyOperationsStats {
  arrivals: number;
  checkIns: number;
  checkOuts: number;
  inHouse: number;
  occupancyRate: number;
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  userId: string;
  userEmail: string;
  action: string;
  resource: string;
  hotelId: string;
  module?: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}
