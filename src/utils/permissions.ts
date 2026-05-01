
import { UserRole } from '../types';

export type Permission = 
  | 'view_reports' 
  | 'void_transaction' 
  | 'delete_reservation' 
  | 'manage_staff' 
  | 'manage_rooms' 
  | 'process_payments' 
  | 'nightly_audit'
  | 'bypass_inventory_limits'
  | 'edit_hotel_settings'
  | 'access_super_admin';

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  'superAdmin': [
    'view_reports', 'void_transaction', 'delete_reservation', 'manage_staff', 
    'manage_rooms', 'process_payments', 'nightly_audit', 'bypass_inventory_limits', 
    'edit_hotel_settings', 'access_super_admin'
  ],
  'hotelAdmin': [
    'view_reports', 'void_transaction', 'delete_reservation', 'manage_staff', 
    'manage_rooms', 'process_payments', 'nightly_audit', 'edit_hotel_settings'
  ],
  'staff': [
    'manage_rooms', 'process_payments', 'nightly_audit'
  ],
  // You can easily add new roles here
  // 'finance': ['view_reports', 'process_payments', 'void_transaction'],
  // 'housekeeping': ['manage_rooms'],
};

/**
 * PRODUCTION-GRADE PERMISSION CHECK
 * This replaces simple 'staff' / 'admin' checks with specific capabilities.
 */
export const hasPermission = (role: UserRole | undefined, permission: Permission): boolean => {
  if (!role) return false;
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes(permission);
};

/**
 * Utility for components to check multiple permissions
 */
export const hasAnyPermission = (role: UserRole | undefined, permissions: Permission[]): boolean => {
  return permissions.some(p => hasPermission(role, p));
};
