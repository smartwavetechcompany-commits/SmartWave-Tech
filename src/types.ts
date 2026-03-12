export type UserRole = 'superAdmin' | 'hotelAdmin' | 'staff';
export type StaffRole = 'frontDesk' | 'housekeeping' | 'kitchen' | 'it' | 'management';

export type SubscriptionStatus = 'active' | 'suspended' | 'expired';

export interface TrackingCode {
  id: string;
  code: string;
  expiryDate: string;
  duration: string; // '1 month', '6 months', etc.
  type: string;
  status: SubscriptionStatus;
  hotelId?: string;
}

export interface Hotel {
  id: string;
  name: string;
  trackingCode: string;
  expiryDate: string;
  status: SubscriptionStatus;
  subscriptionType: string;
  createdAt: string;
  adminUIDs: string[];
}

export interface UserProfile {
  uid: string;
  email: string;
  hotelId: string | 'system'; // 'system' for superAdmin
  role: UserRole;
  staffRole?: StaffRole;
  permissions: string[];
  status: 'active' | 'inactive';
  displayName?: string;
  assignedModules?: string[]; // For staff
}

export interface TrackingCodeRequest {
  id: string;
  hotelName: string;
  email: string;
  phone: string;
  plan: string;
  status: 'pending' | 'approved' | 'rejected';
  timestamp: string;
  generatedCode?: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userEmail: string;
  action: string;
  resource: string;
  hotelId: string;
}

export interface Room {
  id: string;
  number: string;
  type: string;
  status: 'vacant' | 'occupied' | 'dirty' | 'clean' | 'maintenance' | 'out_of_service';
  price: number;
  floor: string;
  capacity: number;
}

export interface Reservation {
  id: string;
  guestName: string;
  roomId: string;
  roomNumber: string;
  checkIn: string;
  checkOut: string;
  status: 'pending' | 'checked_in' | 'checked_out' | 'cancelled';
  totalAmount: number;
  paidAmount: number;
}

export type FinanceRecord = {
  id: string;
  type: 'income' | 'expense';
  category: string;
  amount: number;
  timestamp: string;
  description: string;
};

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
