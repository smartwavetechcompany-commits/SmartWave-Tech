import { UserRole } from '../types';

export type Permission = 
  // --- DASHBOARD ---
  | 'view_dashboard'
  | 'export_dashboard'

  // --- RESERVATIONS ---
  | 'view_reservations'
  | 'create_reservations'
  | 'edit_reservations'
  | 'cancel_reservations'
  | 'delete_reservations'

  // --- GUEST MANAGEMENT ---
  | 'view_guests'
  | 'add_guests'
  | 'edit_guests'
  | 'delete_guests'
  | 'export_guests'

  // --- ROOM MANAGEMENT ---
  | 'view_rooms'
  | 'create_rooms'
  | 'edit_rooms'
  | 'delete_rooms'
  | 'block_rooms'
  | 'unblock_rooms'

  // --- HOUSEKEEPING ---
  | 'view_housekeeping'
  | 'assign_housekeeping_tasks'
  | 'edit_housekeeping_tasks'
  | 'close_housekeeping_tasks'

  // --- F&B ---
  | 'view_fb_orders'
  | 'create_fb_orders'
  | 'edit_fb_orders'
  | 'cancel_fb_orders'
  | 'delete_fb_orders'

  // --- ACCOUNTING & LEDGER ---
  | 'view_ledger'
  | 'post_charges'
  | 'receive_payments'
  | 'process_refunds'
  | 'reverse_transactions'
  | 'export_financial_data'

  // --- REPORTS ---
  | 'view_reports'
  | 'export_reports'
  | 'print_reports'

  // --- SETTINGS ---
  | 'view_settings'
  | 'edit_settings'

  // --- USER MANAGEMENT ---
  | 'view_users'
  | 'create_users'
  | 'edit_users'
  | 'delete_users'
  | 'reset_passwords'
  | 'assign_roles'
  | 'suspend_users'
  | 'reactivate_users'

  // --- ROOM INVENTORY ---
  | 'view_inventory'
  | 'edit_inventory'
  | 'block_rooms_inventory'
  | 'release_rooms_inventory'

  // --- RATE MANAGEMENT ---
  | 'view_rates'
  | 'create_rates'
  | 'edit_rates'
  | 'delete_rates'

  // --- CHECK-IN / CHECK-OUT ---
  | 'check_in_guests'
  | 'check_out_guests'
  | 'override_checkout'
  | 'extend_stay'

  // --- CITY LEDGER & DEBT MANAGEMENT ---
  | 'view_city_ledger'
  | 'create_ledger_entries'
  | 'approve_ledger_transactions'
  | 'reverse_ledger_transactions'
  | 'view_debt_ledger'
  | 'transfer_debt'
  | 'adjust_debt'
  | 'write_off_debt'

  // --- HOUSE ACCOUNTS ---
  | 'view_house_accounts'
  | 'create_house_accounts'
  | 'edit_house_accounts'
  | 'close_house_accounts'

  // --- AUDITS ---
  | 'run_night_audit'
  | 'approve_night_audit'
  | 'reopen_audit'

  // --- PAYMENTS ---
  | 'receive_payment'
  | 'reverse_payment'
  | 'approve_refund'
  | 'void_transaction'

  // --- ADMINISTRATION ---
  | 'manage_hotels'
  | 'manage_branches'
  | 'manage_users_admin'
  | 'manage_roles_admin'
  | 'manage_permissions_admin'

  // --- LEGACY BACKWARDS-COMPATIBLE IDENTIFIERS ---
  | 'manage_staff' 
  | 'manage_rooms' 
  | 'manage_inventory'
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
  | 'manage_maintenance'
  | 'manage_corporate'
  | 'delete_reservation'
  | 'edit_reservation';

export interface PermissionGroup {
  id: string;
  label: string;
  description: string;
  permissions: { id: Permission; label: string; description?: string }[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'dashboard',
    label: 'Dashboard & Analytics',
    description: 'System-wide dashboards, metrics, and data export',
    permissions: [
      { id: 'view_dashboard', label: 'View Dashboard', description: 'Access main hotel KPI dashboard' },
      { id: 'export_dashboard', label: 'Export Dashboard Data', description: 'Download CSV and statistics' },
    ]
  },
  {
    id: 'reservations',
    label: 'Reservations & Front Desk',
    description: 'Booking operations, reservation edits, check-in, and check-out',
    permissions: [
      { id: 'view_reservations', label: 'View Reservations', description: 'View bookings list and calendar' },
      { id: 'create_reservations', label: 'Create Reservations', description: 'Book new guest stays' },
      { id: 'edit_reservations', label: 'Edit Reservations', description: 'Modify dates, rates, and room assignments' },
      { id: 'cancel_reservations', label: 'Cancel Reservations', description: 'Cancel active bookings' },
      { id: 'delete_reservations', label: 'Delete Reservations', description: 'Permanently remove booking records' },
      { id: 'check_in_guests', label: 'Check-In Guests', description: 'Mark arrivals and issue room keys' },
      { id: 'check_out_guests', label: 'Check-Out Guests', description: 'Process guest departures and balance settlement' },
      { id: 'override_checkout', label: 'Override Checkout', description: 'Bypass unpaid balance restrictions' },
      { id: 'extend_stay', label: 'Extend Stay', description: 'Add nights to existing in-house stays' },
    ]
  },
  {
    id: 'guests',
    label: 'Guest Management',
    description: 'Guest profiles, identification, and loyalty records',
    permissions: [
      { id: 'view_guests', label: 'View Guests', description: 'Browse guest CRM directory' },
      { id: 'add_guests', label: 'Add Guests', description: 'Create new guest profiles' },
      { id: 'edit_guests', label: 'Edit Guests', description: 'Update contact details, ID, preferences' },
      { id: 'delete_guests', label: 'Delete Guests', description: 'Remove guest CRM records' },
      { id: 'export_guests', label: 'Export Guest Data', description: 'Export customer list' },
    ]
  },
  {
    id: 'rooms',
    label: 'Room Management & Blocking',
    description: 'Room inventory, maintenance blocking, and status control',
    permissions: [
      { id: 'view_rooms', label: 'View Rooms', description: 'View room grid and status' },
      { id: 'create_rooms', label: 'Create Rooms', description: 'Add new rooms to property' },
      { id: 'edit_rooms', label: 'Edit Rooms', description: 'Change room numbers, types, or base rates' },
      { id: 'delete_rooms', label: 'Delete Rooms', description: 'Remove rooms from inventory' },
      { id: 'block_rooms', label: 'Block Rooms', description: 'Put rooms out-of-order or maintenance block' },
      { id: 'unblock_rooms', label: 'Unblock Rooms', description: 'Release room blocks back to inventory' },
    ]
  },
  {
    id: 'housekeeping',
    label: 'Housekeeping Operations',
    description: 'Room cleaning assignments, inspection, and status transitions',
    permissions: [
      { id: 'view_housekeeping', label: 'View Housekeeping', description: 'View cleaning schedule and room statuses' },
      { id: 'assign_housekeeping_tasks', label: 'Assign Tasks', description: 'Assign rooms to cleaners' },
      { id: 'edit_housekeeping_tasks', label: 'Edit Tasks', description: 'Update room clean/dirty states' },
      { id: 'close_housekeeping_tasks', label: 'Close Tasks', description: 'Mark cleaning tasks inspected and completed' },
    ]
  },
  {
    id: 'f_and_b',
    label: 'Food & Beverage / POS',
    description: 'Restaurant orders, kitchen queue, and room service billing',
    permissions: [
      { id: 'view_fb_orders', label: 'View F&B Orders', description: 'Browse restaurant orders and tickets' },
      { id: 'create_fb_orders', label: 'Create F&B Orders', description: 'Post food and beverage sales' },
      { id: 'edit_fb_orders', label: 'Edit F&B Orders', description: 'Modify line items and quantities' },
      { id: 'cancel_fb_orders', label: 'Cancel F&B Orders', description: 'Void or cancel kitchen orders' },
      { id: 'delete_fb_orders', label: 'Delete F&B Orders', description: 'Remove F&B order history' },
    ]
  },
  {
    id: 'accounting',
    label: 'Accounting, Ledger & City Ledger',
    description: 'Financial ledger, postings, payments, city ledger accounts, and refunds',
    permissions: [
      { id: 'view_ledger', label: 'View Ledger', description: 'Inspect guest and corporate folios' },
      { id: 'post_charges', label: 'Post Charges', description: 'Add room, service, or incidental debits' },
      { id: 'receive_payments', label: 'Receive Payments', description: 'Record cash, card, and bank receipts' },
      { id: 'process_refunds', label: 'Process Refunds', description: 'Issue refunds to customers' },
      { id: 'reverse_transactions', label: 'Reverse Transactions', description: 'Reverse accidental or disputed entries' },
      { id: 'export_financial_data', label: 'Export Financial Data', description: 'Download transaction audits' },
      { id: 'view_city_ledger', label: 'View City Ledger', description: 'Corporate accounts and receivables' },
      { id: 'view_debt_ledger', label: 'View Outstanding Debt Ledger', description: 'Access guest receivables and aging reports' },
      { id: 'transfer_debt', label: 'Transfer Debt', description: 'Transfer debt to Corporate, City Ledger, or House accounts' },
      { id: 'adjust_debt', label: 'Adjust Debt', description: 'Make approved balance adjustments and credit notes' },
      { id: 'write_off_debt', label: 'Write-Off Debt', description: 'Authorize debt write-offs with mandatory reason' },
      { id: 'create_ledger_entries', label: 'Create Ledger Entries', description: 'Post manual ledger journals' },
      { id: 'approve_ledger_transactions', label: 'Approve Transactions', description: 'Authorize high-value adjustments' },
      { id: 'reverse_ledger_transactions', label: 'Reverse Ledger Transactions', description: 'Rollback erroneous postings' },
      { id: 'view_house_accounts', label: 'View House Accounts', description: 'Internal hotel operational accounts' },
      { id: 'create_house_accounts', label: 'Create House Accounts', description: 'Open new internal billing accounts' },
      { id: 'edit_house_accounts', label: 'Edit House Accounts', description: 'Modify house account limits' },
      { id: 'close_house_accounts', label: 'Close House Accounts', description: 'Archive house account balances' },
    ]
  },
  {
    id: 'payments',
    label: 'Payment Transactions & Voids',
    description: 'Cashier transactions, receipts, and void authorizations',
    permissions: [
      { id: 'receive_payment', label: 'Receive Payment', description: 'Take payments at front desk' },
      { id: 'reverse_payment', label: 'Reverse Payment', description: 'Reverse settled receipt' },
      { id: 'approve_refund', label: 'Approve Refund', description: 'Authorize refund requests' },
      { id: 'void_transaction', label: 'Void Transaction', description: 'Void receipt or POS ticket' },
    ]
  },
  {
    id: 'audits',
    label: 'Nightly Audit Operations',
    description: 'EOD financial closing, room rate posting, and date roll',
    permissions: [
      { id: 'run_night_audit', label: 'Run Night Audit', description: 'Execute daily audit roll and auto-deductions' },
      { id: 'approve_night_audit', label: 'Approve Night Audit', description: 'Confirm and finalize audit ledger balance' },
      { id: 'reopen_audit', label: 'Reopen Audit', description: 'Re-run past business date closure' },
    ]
  },
  {
    id: 'rates_inventory',
    label: 'Rates & Store Inventory',
    description: 'Room pricing tiers, seasonal tariffs, and stock inventory',
    permissions: [
      { id: 'view_rates', label: 'View Rates', description: 'Inspect room rate tiers' },
      { id: 'create_rates', label: 'Create Rates', description: 'Configure new rate plans and discounts' },
      { id: 'edit_rates', label: 'Edit Rates', description: 'Update pricing configurations' },
      { id: 'delete_rates', label: 'Delete Rates', description: 'Remove inactive rate tiers' },
      { id: 'view_inventory', label: 'View Inventory', description: 'Check hotel store stock levels' },
      { id: 'edit_inventory', label: 'Edit Inventory', description: 'Update stock levels, POs, and transfers' },
    ]
  },
  {
    id: 'maintenance',
    label: 'Maintenance & Facility Management',
    description: 'Work orders, equipment repairs, room maintenance blocks, and inspections',
    permissions: [
      { id: 'manage_maintenance', label: 'Access Maintenance', description: 'Access work orders and equipment tracking' },
      { id: 'block_rooms', label: 'Place Room Maintenance Block', description: 'Take rooms out-of-order for repairs' },
      { id: 'unblock_rooms', label: 'Clear Maintenance Block', description: 'Release rooms back into sellable inventory' },
    ]
  },
  {
    id: 'corporate',
    label: 'Corporate Accounts & Direct Billing',
    description: 'Corporate client contracts, company ledgers, credit limits, and invoicing',
    permissions: [
      { id: 'manage_corporate', label: 'Manage Corporate Accounts', description: 'Create and manage corporate customer accounts' },
      { id: 'view_city_ledger', label: 'View Corporate Receivables', description: 'Inspect corporate billing and city ledger' },
    ]
  },
  {
    id: 'reports',
    label: 'Reports & Business Intelligence',
    description: 'Managerial, occupancy, financial, and tax reports',
    permissions: [
      { id: 'view_reports', label: 'View Reports', description: 'Access PMS reports repository' },
      { id: 'export_reports', label: 'Export Reports', description: 'Download report files in CSV / Excel' },
      { id: 'print_reports', label: 'Print Reports', description: 'Print shift and operational reports' },
    ]
  },
  {
    id: 'users',
    label: 'User Management & Security Control',
    description: 'Create staff, assign roles, reset passwords, lock/unlock accounts',
    permissions: [
      { id: 'view_users', label: 'View Users', description: 'Browse staff roster' },
      { id: 'create_users', label: 'Create Users', description: 'Add new staff members' },
      { id: 'edit_users', label: 'Edit Users', description: 'Update staff contact and department' },
      { id: 'delete_users', label: 'Delete Users', description: 'Remove staff accounts' },
      { id: 'reset_passwords', label: 'Reset Passwords', description: 'Issue temporary passwords for staff' },
      { id: 'assign_roles', label: 'Assign Roles', description: 'Modify user access roles and permissions' },
      { id: 'suspend_users', label: 'Suspend Users', description: 'Lock user accounts immediately' },
      { id: 'reactivate_users', label: 'Reactivate Users', description: 'Unlock suspended staff accounts' },
    ]
  },
  {
    id: 'administration',
    label: 'Hotel Administration & Role Builder',
    description: 'Configure hotel settings, manage branches, and build custom roles',
    permissions: [
      { id: 'view_settings', label: 'View Settings', description: 'Inspect hotel operational settings' },
      { id: 'edit_settings', label: 'Edit Settings', description: 'Modify checkout, tax, and hotel policies' },
      { id: 'manage_hotels', label: 'Manage Hotel Organization', description: 'Update property branding and setup' },
      { id: 'manage_roles_admin', label: 'Build & Manage Custom Roles', description: 'Create, clone, and edit roles' },
      { id: 'manage_permissions_admin', label: 'Manage Permissions', description: 'Granular permissions configuration' },
    ]
  }
];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.id));

// System Role Templates with granular defaults
export const SYSTEM_ROLE_TEMPLATES: Record<string, { name: string; description: string; permissions: Permission[] }> = {
  frontDeskAgent: {
    name: 'Front Desk Agent',
    description: 'Check-in, check-out, bookings, and guest folio billing',
    permissions: [
      'view_dashboard', 'view_reservations', 'create_reservations', 'edit_reservations',
      'check_in_guests', 'check_out_guests', 'extend_stay', 'view_guests', 'add_guests',
      'edit_guests', 'view_rooms', 'view_housekeeping', 'view_fb_orders', 'create_fb_orders',
      'view_ledger', 'post_charges', 'receive_payments', 'receive_payment',
      // Legacy aliases
      'access_front_desk', 'edit_guest_profiles', 'process_payments'
    ]
  },
  frontDeskSupervisor: {
    name: 'Front Desk Supervisor',
    description: 'Front desk operations plus voids, room blocks, cancellations, and night audit',
    permissions: [
      'view_dashboard', 'export_dashboard', 'view_reservations', 'create_reservations',
      'edit_reservations', 'cancel_reservations', 'check_in_guests', 'check_out_guests',
      'override_checkout', 'extend_stay', 'view_guests', 'add_guests', 'edit_guests',
      'view_rooms', 'block_rooms', 'unblock_rooms', 'view_housekeeping', 'view_fb_orders',
      'create_fb_orders', 'view_ledger', 'post_charges', 'receive_payments', 'receive_payment',
      'void_transaction', 'run_night_audit', 'view_reports', 'export_reports', 'print_reports',
      // Legacy aliases
      'access_front_desk', 'manage_rooms', 'create_room_blocks', 'remove_room_blocks',
      'edit_guest_profiles', 'process_payments', 'nightly_audit', 'view_reports'
    ]
  },
  accountant: {
    name: 'Accountant',
    description: 'Finance, ledger auditing, tax management, invoicing, and refunds',
    permissions: [
      'view_dashboard', 'export_dashboard', 'view_reservations', 'view_guests',
      'view_ledger', 'post_charges', 'receive_payments', 'process_refunds',
      'reverse_transactions', 'export_financial_data', 'view_city_ledger',
      'view_debt_ledger', 'transfer_debt', 'adjust_debt', 'write_off_debt',
      'create_ledger_entries', 'approve_ledger_transactions', 'reverse_ledger_transactions',
      'view_house_accounts', 'create_house_accounts', 'edit_house_accounts',
      'receive_payment', 'reverse_payment', 'approve_refund', 'void_transaction',
      'view_reports', 'export_reports', 'print_reports',
      // Legacy aliases
      'view_financial_records', 'process_payments', 'process_refunds', 'view_reports', 'export_reports'
    ]
  },
  nightAuditor: {
    name: 'Night Auditor',
    description: 'End-of-day financial reconciliation, room charge posting, and date rollover',
    permissions: [
      'view_dashboard', 'export_dashboard', 'view_reservations', 'view_rooms',
      'view_ledger', 'post_charges', 'receive_payments', 'run_night_audit',
      'approve_night_audit', 'reopen_audit', 'view_reports', 'export_reports', 'print_reports',
      // Legacy aliases
      'nightly_audit', 'view_financial_records', 'access_front_desk', 'view_reports'
    ]
  },
  housekeepingManager: {
    name: 'Housekeeping Manager',
    description: 'Room cleanliness, cleaning task assignments, inspection, and linen inventory',
    permissions: [
      'view_dashboard', 'view_rooms', 'block_rooms', 'unblock_rooms',
      'view_housekeeping', 'assign_housekeeping_tasks', 'edit_housekeeping_tasks',
      'close_housekeeping_tasks', 'view_inventory', 'edit_inventory',
      // Legacy aliases
      'manage_rooms', 'manage_inventory'
    ]
  },
  revenueManager: {
    name: 'Revenue Manager',
    description: 'Room pricing, rate tiers, corporate rates, room block management, and yield reports',
    permissions: [
      'view_dashboard', 'export_dashboard', 'view_reservations', 'view_rooms',
      'block_rooms', 'unblock_rooms', 'view_rates', 'create_rates', 'edit_rates', 'delete_rates',
      'view_reports', 'export_reports', 'print_reports',
      // Legacy aliases
      'manage_rooms', 'view_reports', 'export_reports', 'manage_corporate'
    ]
  },
  hotelManager: {
    name: 'Hotel Manager',
    description: 'Comprehensive property supervision across operations, staff, and finance',
    permissions: [
      ...ALL_PERMISSIONS.filter(p => !['access_super_admin'].includes(p))
    ]
  },
  generalManager: {
    name: 'General Manager',
    description: 'Full operational, administrative, and strategic authority over the hotel property',
    permissions: [
      ...ALL_PERMISSIONS.filter(p => !['access_super_admin'].includes(p))
    ]
  },
  hotelOwner: {
    name: 'Hotel Owner',
    description: 'Executive ownership role with complete configuration and financial authority',
    permissions: [
      ...ALL_PERMISSIONS.filter(p => !['access_super_admin'].includes(p))
    ]
  }
};

export const BASE_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  superAdmin: ALL_PERMISSIONS,
  hotelAdmin: ALL_PERMISSIONS.filter(p => p !== 'access_super_admin'),
  admin: ALL_PERMISSIONS.filter(p => p !== 'access_super_admin'),
  manager: SYSTEM_ROLE_TEMPLATES.hotelManager.permissions,
  frontDesk: SYSTEM_ROLE_TEMPLATES.frontDeskAgent.permissions,
  receptionist: SYSTEM_ROLE_TEMPLATES.frontDeskAgent.permissions,
  accountant: SYSTEM_ROLE_TEMPLATES.accountant.permissions,
  housekeeper: SYSTEM_ROLE_TEMPLATES.housekeepingManager.permissions,
  maintenance: ['view_rooms', 'block_rooms', 'unblock_rooms', 'view_inventory', 'manage_maintenance', 'manage_rooms'],
  kitchen: SYSTEM_ROLE_TEMPLATES.frontDeskAgent.permissions.filter(p => p.includes('fb') || p === 'manage_kitchen'),
  corporate: ['view_reservations', 'view_ledger', 'manage_corporate'],
  staff: ['view_dashboard', 'view_reservations', 'view_rooms']
};

/**
 * Maps permissions to legacy aliases to ensure zero regressions across existing screens
 */
const ALIAS_MAP: Record<string, Permission[]> = {
  reset_passwords: ['reset_passwords', 'manage_staff', 'manage_users_admin'],
  manage_staff: ['manage_staff', 'manage_users_admin', 'view_users', 'create_users', 'edit_users', 'assign_roles', 'reset_passwords'],
  manage_roles: ['manage_roles', 'manage_roles_admin', 'assign_roles', 'manage_permissions_admin'],
  manage_rooms: ['manage_rooms', 'view_rooms', 'create_rooms', 'edit_rooms', 'block_rooms', 'unblock_rooms', 'view_housekeeping'],
  view_rooms: ['view_rooms', 'manage_rooms', 'create_rooms', 'edit_rooms', 'block_rooms', 'unblock_rooms'],
  view_housekeeping: ['view_housekeeping', 'manage_rooms', 'assign_housekeeping_tasks', 'edit_housekeeping_tasks', 'close_housekeeping_tasks'],
  access_front_desk: ['access_front_desk', 'view_reservations', 'create_reservations', 'check_in_guests'],
  edit_guest_profiles: ['edit_guest_profiles', 'view_guests', 'edit_guests', 'add_guests'],
  process_payments: ['process_payments', 'receive_payments', 'receive_payment', 'post_charges'],
  view_financial_records: ['view_financial_records', 'view_ledger', 'export_financial_data', 'view_city_ledger'],
  view_debt_ledger: ['view_debt_ledger', 'view_financial_records', 'view_city_ledger', 'transfer_debt', 'adjust_debt', 'write_off_debt'],
  view_reports: ['view_reports', 'export_reports', 'print_reports'],
  export_reports: ['export_reports'],
  view_settings: ['view_settings', 'edit_hotel_settings', 'edit_settings', 'manage_roles', 'manage_roles_admin'],
  edit_hotel_settings: ['edit_hotel_settings', 'view_settings', 'edit_settings', 'manage_hotels'],
  manage_kitchen: ['manage_kitchen', 'view_fb_orders', 'create_fb_orders', 'edit_fb_orders'],
  manage_inventory: ['manage_inventory', 'view_inventory', 'edit_inventory'],
  manage_maintenance: ['manage_maintenance', 'block_rooms'],
  manage_corporate: ['manage_corporate', 'view_city_ledger'],
  nightly_audit: ['nightly_audit', 'run_night_audit', 'approve_night_audit'],
  void_transaction: ['void_transaction', 'reverse_transactions', 'reverse_payment'],
  process_refunds: ['process_refunds', 'approve_refund'],
  view_activity_logs: ['view_activity_logs', 'manage_staff', 'edit_hotel_settings'],
  view_dashboard: ['view_dashboard', 'export_dashboard', 'access_front_desk', 'view_reservations', 'manage_rooms', 'view_housekeeping', 'manage_kitchen', 'manage_inventory', 'manage_maintenance', 'manage_corporate', 'view_financial_records', 'view_reports', 'manage_staff']
};

/**
 * Checks if a user profile has a specific permission.
 * Fully database-driven: checks live customRoles, custom permissions, staffRole, and base role.
 */
export const hasPermission = (
  profile: any, 
  permission: Permission,
  customRoles: any[] = []
): boolean => {
  if (!profile) return false;
  
  // Super Admins have unrestricted access to all PMS modules
  const role = profile.role;
  if (role === 'superAdmin') return true;

  // If user account is suspended or inactive, deny all access
  if (profile.status === 'suspended' || profile.status === 'inactive') {
    return false;
  }

  // Hotel Admins have access to everything within their hotel except superAdmin portal
  if (role === 'hotelAdmin' || role === 'admin') {
    return permission !== 'access_super_admin';
  }

  const userPermissions: string[] = profile.permissions || [];
  const requiredAliases = ALIAS_MAP[permission] || [permission];

  // 1. Direct match on explicitly assigned user permissions
  if (userPermissions.length > 0) {
    if (requiredAliases.some(alias => userPermissions.includes(alias))) {
      return true;
    }
  }

  // 2. Direct match on assigned modules if present
  if (Array.isArray(profile.assignedModules) && profile.assignedModules.length > 0) {
    const modulePermMap: Record<string, string[]> = {
      dashboard: ['view_dashboard', 'export_dashboard'],
      reservations: ['access_front_desk', 'view_reservations', 'create_reservations', 'edit_reservations', 'check_in_guests', 'check_out_guests', 'extend_stay'],
      frontDesk: ['access_front_desk', 'view_reservations', 'create_reservations', 'edit_reservations', 'check_in_guests', 'check_out_guests', 'extend_stay'],
      guests: ['edit_guest_profiles', 'view_guests', 'add_guests', 'edit_guests'],
      rooms: ['manage_rooms', 'view_rooms', 'create_rooms', 'edit_rooms', 'block_rooms'],
      housekeeping: ['view_housekeeping', 'manage_rooms', 'assign_housekeeping_tasks', 'edit_housekeeping_tasks', 'close_housekeeping_tasks'],
      kitchen: ['manage_kitchen', 'view_fb_orders', 'create_fb_orders', 'edit_fb_orders'],
      inventory: ['manage_inventory', 'view_inventory', 'edit_inventory'],
      maintenance: ['manage_maintenance', 'block_rooms', 'unblock_rooms'],
      corporate: ['manage_corporate', 'view_city_ledger'],
      finance: ['view_financial_records', 'process_payments', 'view_ledger', 'post_charges', 'receive_payments', 'receive_payment', 'export_financial_data', 'view_city_ledger', 'view_debt_ledger'],
      audits: ['nightly_audit', 'run_night_audit', 'approve_night_audit', 'view_financial_records'],
      reports: ['view_reports', 'export_reports', 'print_reports'],
      staff: ['manage_staff', 'view_users', 'view_activity_logs'],
      settings: ['edit_hotel_settings', 'view_settings', 'edit_settings', 'manage_roles']
    };

    for (const modId of profile.assignedModules) {
      const allowed = modulePermMap[modId] || [];
      if (requiredAliases.some(alias => allowed.includes(alias))) {
        return true;
      }
    }
  }

  // 3. Custom Role assigned to this user
  if (profile.customRoleId && customRoles.length > 0) {
    const customRole = customRoles.find(r => r.id === profile.customRoleId);
    if (customRole && customRole.status !== 'disabled' && customRole.status !== 'archived') {
      const rolePerms = customRole.permissions || [];
      if (requiredAliases.some(alias => rolePerms.includes(alias))) {
        return true;
      }
      
      // Inheritance from a template
      if (customRole.inheritsFrom) {
        const inherited = BASE_ROLE_PERMISSIONS[customRole.inheritsFrom] || 
          SYSTEM_ROLE_TEMPLATES[customRole.inheritsFrom]?.permissions || [];
        if (requiredAliases.some(alias => inherited.includes(alias))) {
          return true;
        }
      }
    }
  }

  // 4. Fallback ONLY if no explicit permissions array has been set on the user document (legacy profiles)
  if (!profile.permissions || profile.permissions.length === 0) {
    // Fallback to Staff Role
    if (profile.staffRole) {
      const staffPerms = BASE_ROLE_PERMISSIONS[profile.staffRole] || 
        SYSTEM_ROLE_TEMPLATES[profile.staffRole]?.permissions || [];
      if (requiredAliases.some(alias => staffPerms.includes(alias))) {
        return true;
      }
    }

    // Fallback to roles array (e.g. ['frontDesk'])
    if (Array.isArray(profile.roles) && profile.roles.length > 0) {
      for (const r of profile.roles) {
        const rPerms = BASE_ROLE_PERMISSIONS[r] || [];
        if (requiredAliases.some(alias => rPerms.includes(alias))) {
          return true;
        }
      }
    }

    // Fallback to Base Role
    const basePerms = BASE_ROLE_PERMISSIONS[role] || [];
    if (requiredAliases.some(alias => basePerms.includes(alias))) {
      return true;
    }
  }

  return false;
};

/**
 * Checks whether a given PMS module is assigned to a user profile
 */
export const isPMSModuleAssigned = (
  profile: any,
  moduleId: string,
  customRoles: any[] = []
): boolean => {
  if (!profile) return false;
  if (profile.role === 'superAdmin' || profile.role === 'hotelAdmin' || profile.role === 'admin') return true;
  if (Array.isArray(profile.assignedModules) && (profile.assignedModules.includes(moduleId) || (moduleId === 'frontDesk' && profile.assignedModules.includes('reservations')) || (moduleId === 'reservations' && profile.assignedModules.includes('frontDesk')))) {
    return true;
  }
  const modulePermMap: Record<string, Permission[]> = {
    dashboard: ['view_dashboard'],
    reservations: ['access_front_desk', 'view_reservations', 'create_reservations'],
    frontDesk: ['access_front_desk', 'view_reservations', 'create_reservations'],
    guests: ['edit_guest_profiles', 'view_guests', 'add_guests'],
    rooms: ['manage_rooms', 'view_rooms'],
    housekeeping: ['view_housekeeping', 'manage_rooms', 'assign_housekeeping_tasks'],
    kitchen: ['manage_kitchen', 'view_fb_orders', 'create_fb_orders'],
    inventory: ['manage_inventory', 'view_inventory', 'edit_inventory'],
    maintenance: ['manage_maintenance', 'block_rooms'],
    corporate: ['manage_corporate', 'view_city_ledger'],
    finance: ['view_financial_records', 'view_ledger', 'process_payments', 'view_debt_ledger'],
    audits: ['nightly_audit', 'run_night_audit'],
    reports: ['view_reports', 'export_reports'],
    staff: ['manage_staff', 'view_users'],
    settings: ['edit_hotel_settings', 'view_settings']
  };
  const perms = modulePermMap[moduleId];
  if (!perms) return false;
  return perms.some(p => hasPermission(profile, p, customRoles));
};

/**
 * Utility to check multiple permissions
 */
export const hasAnyPermission = (
  profile: any, 
  permissions: Permission[],
  customRoles: any[] = []
): boolean => {
  return permissions.some(p => hasPermission(profile, p, customRoles));
};

export const hasAllPermissions = (
  profile: any, 
  permissions: Permission[],
  customRoles: any[] = []
): boolean => {
  return permissions.every(p => hasPermission(profile, p, customRoles));
};
