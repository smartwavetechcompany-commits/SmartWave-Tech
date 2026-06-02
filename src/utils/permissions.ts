
import { UserRole } from '../types';

export type Permission = 
  | 'view_reports' 
  | 'export_reports'
  | 'void_transaction' 
  | 'delete_reservation' 
  | 'edit_reservation'
  | 'process_refunds'
  | 'manage_staff' 
  | 'manage_rooms' 
  | 'create_room_blocks'
  | 'remove_room_blocks'
  | 'edit_guest_profiles'
  | 'process_payments' 
  | 'view_financial_records'
  | 'nightly_audit'
  | 'bypass_inventory_limits'
  | 'edit_hotel_settings'
  | 'access_super_admin'
  | 'view_activity_logs'
  | 'manage_roles'
  | 'access_front_desk'
  | 'manage_kitchen'
  | 'manage_inventory'
  | 'manage_maintenance'
  | 'manage_corporate';

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  'superAdmin': [
    'view_reports', 'export_reports', 'void_transaction', 'delete_reservation', 'edit_reservation', 
    'process_refunds', 'manage_staff', 'manage_rooms', 'create_room_blocks', 'remove_room_blocks', 
    'edit_guest_profiles', 'process_payments', 'view_financial_records', 'nightly_audit', 
    'bypass_inventory_limits', 'edit_hotel_settings', 'access_super_admin', 'view_activity_logs', 
    'manage_roles', 'access_front_desk', 'manage_kitchen', 'manage_inventory', 'manage_maintenance',
    'manage_corporate'
  ],
  'hotelAdmin': [
    'view_reports', 'export_reports', 'void_transaction', 'delete_reservation', 'edit_reservation', 
    'process_refunds', 'manage_staff', 'manage_rooms', 'create_room_blocks', 'remove_room_blocks', 
    'edit_guest_profiles', 'process_payments', 'view_financial_records', 'nightly_audit', 
    'edit_hotel_settings', 'view_activity_logs', 'manage_roles', 'access_front_desk', 'manage_kitchen',
    'manage_inventory', 'manage_maintenance', 'manage_corporate'
  ],
  'staff': [
     'manage_rooms', 'process_payments', 'nightly_audit', 'access_front_desk'
  ],
  'receptionist': [
    'manage_rooms', 'process_payments', 'nightly_audit', 'view_reports', 'edit_reservation', 'edit_guest_profiles',
    'access_front_desk', 'manage_corporate'
  ],
  'frontDesk': [
    'manage_rooms', 'process_payments', 'nightly_audit', 'view_reports', 'edit_reservation', 'edit_guest_profiles',
    'access_front_desk', 'manage_corporate'
  ],
  'manager': [
    'view_reports', 'export_reports', 'void_transaction', 'delete_reservation', 'edit_reservation', 
    'process_refunds', 'manage_staff', 'manage_rooms', 'create_room_blocks', 'remove_room_blocks', 
    'edit_guest_profiles', 'process_payments', 'view_financial_records', 'nightly_audit', 
    'edit_hotel_settings', 'view_activity_logs', 'manage_roles', 'access_front_desk', 'manage_kitchen',
    'manage_inventory', 'manage_maintenance', 'manage_corporate'
  ],
  'accountant': [
    'view_reports', 'process_payments', 'view_financial_records', 'export_reports', 'manage_corporate'
  ],
  'housekeeper': [
    'manage_rooms'
  ],
  'maintenance': [
    'manage_rooms', 'create_room_blocks', 'remove_room_blocks', 'manage_maintenance'
  ],
  'kitchen': [
    'process_payments', 'manage_kitchen'
  ],
  'guest': [],
  'corporate': []
};

/**
 * Checks if a user has a specific permission.
 * Supports role-based defaults, custom user permissions, and custom role inheritance.
 */
export const hasPermission = (
  profile: any, 
  permission: Permission,
  customRoles: any[] = []
): boolean => {
  if (!profile) return false;
  
  // If it's just a role string, wrap it
  const userProfile = typeof profile === 'string' ? { role: profile } : profile;
  
  const role = userProfile.role;
  const userPermissions = userProfile.permissions || [];

  // Super Admins have everything
  if (role === 'superAdmin') return true;

  // 1. Check custom user permissions
  if (userPermissions.includes(permission)) return true;

  // 2. Check Custom Role
  if (userProfile.customRoleId && customRoles.length > 0) {
    const customRole = customRoles.find(r => r.id === userProfile.customRoleId);
    if (customRole) {
      if (customRole.permissions.includes(permission)) return true;
      
      // Inheritance from a base StaffRole
      if (customRole.inheritsFrom) {
        const inheritedPermissions = ROLE_PERMISSIONS[customRole.inheritsFrom] || [];
        if (inheritedPermissions.includes(permission)) return true;
      }
    }
  }

  // 3. Fallback to base role permissions
  const rolePermissions = ROLE_PERMISSIONS[role || ''] || [];
  if (rolePermissions.includes(permission)) return true;

  // 4. Check staff role permissions if present
  if (userProfile.staffRole) {
    const staffRolePermissions = ROLE_PERMISSIONS[userProfile.staffRole] || [];
    if (staffRolePermissions.includes(permission)) return true;
  }

  return false;
};

/**
 * Utility for components to check multiple permissions
 */
export const hasAnyPermission = (profile: any, permissions: Permission[]): boolean => {
  return permissions.some(p => hasPermission(profile, p));
};
