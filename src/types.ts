export type UserRole = 'superAdmin' | 'hotelAdmin' | 'staff';
export type StaffRole = 'receptionist' | 'housekeeper' | 'manager' | 'accountant' | 'frontDesk' | 'kitchen' | 'maintenance' | 'admin' | 'corporate';
export type SubscriptionStatus = 'active' | 'expired' | 'suspended';
export type PlanType = 'standard' | 'premium' | 'enterprise';

export interface Tax {
  id: string;
  name: string;
  percentage: number;
  isInclusive: boolean;
  showOnReceipt: boolean;
  status: 'active' | 'inactive';
  category: 'all' | 'room' | 'restaurant' | 'service';
}

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
  hasCompletedOnboarding?: boolean;
}

export interface HotelBranding {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  address?: string;
  phone?: string;
  email?: string;
  footerNotes?: string;
  organizationName?: string;
  accountNumber?: string;
  bankName?: string;
  greeting?: string;
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
  taxes?: Tax[];
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
  targetEmail?: string; // New field: The only email allowed to use this code
}

export interface GlobalAuditLog {
  id: string;
  timestamp: string;
  actor: string;
  userRole?: UserRole;
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
  userRole?: UserRole;
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
  price: number;
  paymentMethod: 'cash' | 'card' | 'transfer' | 'room';
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
  accountId?: string;
  supplierId?: string;
  guestId?: string;
  referenceId?: string;
  status?: 'pending' | 'completed' | 'cancelled';
}

export interface Supplier {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  category: string;
  balance: number;
  createdAt: string;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  balance: number;
  description?: string;
  parentAccountId?: string;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  items: {
    inventoryItemId: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }[];
  totalAmount: number;
  status: 'pending' | 'approved' | 'received' | 'cancelled';
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  timestamp: string;
  dueDate?: string;
}

export interface Commission {
  id: string;
  agentName: string;
  reservationId: string;
  amount: number;
  percentage: number;
  status: 'pending' | 'paid';
  timestamp: string;
}

export interface StockAdjustment {
  id: string;
  inventoryItemId: string;
  previousQuantity: number;
  newQuantity: number;
  difference: number;
  reason: string;
  timestamp: string;
  userId: string;
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
  userRole?: UserRole;
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
