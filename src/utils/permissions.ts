
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
  | 'access_super_admin'
  | 'view_activity_logs'
  | 'edit_reservation';

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  'superAdmin': [
    'view_reports', 'void_transaction', 'delete_reservation', 'manage_staff', 
    'manage_rooms', 'process_payments', 'nightly_audit', 'bypass_inventory_limits', 
    'edit_hotel_settings', 'access_super_admin', 'view_activity_logs', 'edit_reservation'
  ],
  'hotelAdmin': [
    'view_reports', 'void_transaction', 'delete_reservation', 'manage_staff', 
    'manage_rooms', 'process_payments', 'nightly_audit', 'edit_hotel_settings', 
    'view_activity_logs', 'edit_reservation'
  ],
  'staff': [
     'manage_rooms', 'process_payments', 'nightly_audit'
  ],
  'receptionist': [
    'manage_rooms', 'process_payments', 'nightly_audit', 'view_reports'
  ],
  'frontDesk': [
    'manage_rooms', 'process_payments', 'nightly_audit', 'view_reports'
  ],
  'manager': [
    'view_reports', 'void_transaction', 'delete_reservation', 'manage_staff', 
    'manage_rooms', 'process_payments', 'nightly_audit', 'edit_hotel_settings',
    'view_activity_logs', 'edit_reservation'
  ],
  'accountant': [
    'view_reports', 'process_payments'
  ],
  'housekeeper': [
    'manage_rooms'
  ],
  'maintenance': [
    'manage_rooms'
  ],
  'kitchen': [
    'process_payments'
  ],
  'corporate': []
};

/**
 * PRODUCTION-GRADE PERMISSION CHECK
 * This replaces simple 'staff' / 'admin' checks with specific capabilities.
 */
export const hasPermission = (profile: { role?: string; permissions?: string[] } | null | undefined, permission: Permission): boolean => {
  if (!profile) return false;
  
  // Super Admins have everything
  if (profile.role === 'superAdmin') return true;

  // Check custom permissions first (assigned via Staff Management)
  if (profile.permissions && (profile.permissions as any[]).includes(permission)) {
    return true;
  }

  // Fallback to role-based defaults
  const rolePermissions = ROLE_PERMISSIONS[profile.role || ''] || [];
  return rolePermissions.includes(permission);
};

/**
 * Utility for components to check multiple permissions
 */
export const hasAnyPermission = (role: UserRole | undefined, permissions: Permission[]): boolean => {
  return permissions.some(p => hasPermission(role, p));
};
