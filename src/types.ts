export type UserRole = 'superAdmin' | 'hotelAdmin' | 'staff';
export type StaffRole = 'receptionist' | 'housekeeper' | 'manager' | 'accountant' | 'frontDesk';
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
  subscriptionExpiry?: string;
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
  limits?: {
    rooms: number;
    staff: number;
  };
  adminUIDs?: string[];
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

export interface Room {
  id: string;
  roomNumber: string;
  type: string;
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
  roomId: string;
  roomNumber: string;
  checkIn: string;
  checkOut: string;
  status: 'pending' | 'checked_in' | 'checked_out' | 'cancelled';
  totalAmount: number;
  paidAmount: number;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  notes?: string;
  createdAt: string;
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
  totalStays: number;
  totalSpent: number;
  lastStay?: string;
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
