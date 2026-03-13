export type UserRole = 'superAdmin' | 'hotelAdmin' | 'staff';
export type StaffRole = 'frontDesk' | 'housekeeping' | 'kitchen' | 'it' | 'management';
export type SubscriptionStatus = 'active' | 'suspended' | 'expired';

export interface UserProfile {
  email: string;
  role: UserRole;
  hotelId: string | 'system';
  name: string;
  createdAt: string;
  status: 'active' | 'inactive';
  uid?: string;
  displayName?: string; // For compatibility
  permissions?: string[]; // For compatibility
  staffRole?: string; // For compatibility
}

export interface Hotel {
  id: string;
  name: string;
  trackingCode: string;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiry: number; // timestamp
  plan: string;
  adminUIDs: string[];
  createdAt: string;
  status?: string; // For compatibility
  expiryDate?: string; // For compatibility
  subscriptionType?: string; // For compatibility
}

export interface Room {
  id: string;
  roomNumber: string;
  number?: string; // For compatibility
  type: string;
  price: number;
  status: 'available' | 'occupied' | 'dirty' | 'maintenance' | 'clean';
  floor: number;
  capacity?: number; // For compatibility
}

export interface Reservation {
  id: string;
  guestName: string;
  roomId: string;
  roomNumber?: string; // For compatibility
  checkIn: string;
  checkOut: string;
  status: 'booked' | 'checked_in' | 'checked_out' | 'cancelled' | 'pending';
  createdBy: string;
  totalAmount?: number; // For compatibility
}

export interface HousekeepingTask {
  id: string;
  roomId: string;
  status: 'dirty' | 'cleaning' | 'clean';
  assignedTo: string;
  updatedAt: string;
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  modules: string[];
  uid: string;
}

export interface Module {
  id: string;
  name: string;
  assignedUIDs: string[];
}

export interface HotelActivityLog {
  id: string;
  action: string;
  user: string;
  module: string;
  timestamp: string;
}

export interface TrackingCode {
  id?: string; // For compatibility
  code: string;
  active: boolean;
  expiryDate: number;
  plan: string;
  maxHotels: number;
  issuedBy: string;
  status?: string; // For compatibility
  hotelId?: string; // For compatibility
  duration?: string; // For compatibility
  type?: string; // For compatibility
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

export interface Subscription {
  plan: string;
  roomLimit: number;
  staffLimit: number;
  expiresAt: number;
  status: SubscriptionStatus;
}

export interface SystemSettings {
  paymentInstructions: string;
  supportEmail: string;
}

export interface FinanceRecord {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  description: string;
  date: string;
  timestamp: string;
  hotelId: string;
}

export interface GlobalAuditLog {
  id: string;
  action: string;
  actor: string;
  target: string;
  timestamp: string;
}

export type AuditLog = GlobalAuditLog | HotelActivityLog;

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
