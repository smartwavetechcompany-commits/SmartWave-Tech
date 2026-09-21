import React, { useState, useMemo } from 'react';
import { 
  LayoutDashboard, 
  CalendarDays, 
  Users, 
  Bed, 
  ClipboardList, 
  ChefHat, 
  Package, 
  Wrench, 
  Building2, 
  DollarSign, 
  Clock, 
  BarChart3, 
  UserCog, 
  Settings,
  ChevronDown,
  ChevronRight,
  Search,
  CheckSquare,
  Square,
  Sparkles,
  Shield,
  Layers,
  Check
} from 'lucide-react';
import { CustomRole } from '../types';
import { Permission, SYSTEM_ROLE_TEMPLATES, BASE_ROLE_PERMISSIONS } from '../utils/permissions';
import { cn } from '../utils';

export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  color: string;
  /** Primary permissions automatically granted when the module is checked */
  primaryPermissions: Permission[];
  /** Detailed sub-permissions within this module */
  granularPermissions: {
    id: Permission;
    name: string;
    description: string;
  }[];
}

export const PMS_MODULES: ModuleDefinition[] = [
  {
    id: 'dashboard',
    name: 'Dashboard & Operations',
    description: 'Property performance overview, live KPI metrics, action stream, and data export',
    icon: LayoutDashboard,
    color: 'emerald',
    primaryPermissions: ['view_dashboard', 'export_dashboard'],
    granularPermissions: [
      { id: 'view_dashboard', name: 'View Dashboard', description: 'Access live occupancy, ADR, RevPAR, and action stream' },
      { id: 'export_dashboard', name: 'Export Dashboard Data', description: 'Download CSV and operational metrics' },
    ]
  },
  {
    id: 'reservations',
    name: 'Front Desk & Calendar',
    description: 'Booking calendar, reservations roster, guest check-in, check-out, and stay extensions',
    icon: CalendarDays,
    color: 'sky',
    primaryPermissions: [
      'access_front_desk', 
      'view_reservations', 
      'create_reservations', 
      'edit_reservations', 
      'check_in_guests', 
      'check_out_guests', 
      'extend_stay'
    ],
    granularPermissions: [
      { id: 'access_front_desk', name: 'Front Desk Access', description: 'Open calendar and front desk booking workspace' },
      { id: 'view_reservations', name: 'View Reservations', description: 'Browse and inspect bookings and guest folios' },
      { id: 'create_reservations', name: 'Create Bookings', description: 'Reserve rooms and book guest stays' },
      { id: 'edit_reservations', name: 'Edit Bookings', description: 'Modify dates, rates, room assignments, and notes' },
      { id: 'check_in_guests', name: 'Check-In Guests', description: 'Mark arrivals, assign room keys, and register guests' },
      { id: 'check_out_guests', name: 'Check-Out Guests', description: 'Process departures and settle folios' },
      { id: 'extend_stay', name: 'Extend Stays', description: 'Add nights to existing in-house stays' },
      { id: 'cancel_reservations', name: 'Cancel Bookings', description: 'Cancel unconfirmed or confirmed bookings' },
      { id: 'delete_reservations', name: 'Delete Bookings', description: 'Permanently remove booking records' },
      { id: 'override_checkout', name: 'Override Checkout', description: 'Bypass balance requirements during departure' },
    ]
  },
  {
    id: 'guests',
    name: 'Guest Management (CRM)',
    description: 'Guest customer profiles, identification records, stay histories, preferences, and blacklist',
    icon: Users,
    color: 'indigo',
    primaryPermissions: ['edit_guest_profiles', 'view_guests', 'add_guests', 'edit_guests'],
    granularPermissions: [
      { id: 'edit_guest_profiles', name: 'Access Guest CRM', description: 'Open guest profiles, VIP statuses, and history' },
      { id: 'view_guests', name: 'View Guests', description: 'Search and browse hotel customer database' },
      { id: 'add_guests', name: 'Add New Guests', description: 'Register customer profiles with contact and ID info' },
      { id: 'edit_guests', name: 'Edit Guest Details', description: 'Update contact info, preferences, and documents' },
      { id: 'delete_guests', name: 'Delete Guest Profiles', description: 'Permanently delete guest CRM records' },
      { id: 'export_guests', name: 'Export Guest List', description: 'Download CSV file of hotel guests' },
    ]
  },
  {
    id: 'rooms',
    name: 'Rooms & Room Status',
    description: 'Property room inventory, live room status matrix, maintenance blocking, and room setup',
    icon: Bed,
    color: 'violet',
    primaryPermissions: ['manage_rooms', 'view_rooms'],
    granularPermissions: [
      { id: 'manage_rooms', name: 'Manage Rooms', description: 'Control room inventory and operational statuses' },
      { id: 'view_rooms', name: 'View Rooms Grid', description: 'Inspect room cards, availability, and statuses' },
      { id: 'create_rooms', name: 'Add New Rooms', description: 'Add room units to hotel property' },
      { id: 'edit_rooms', name: 'Edit Room Configuration', description: 'Update room numbers, floor, type, and base tariff' },
      { id: 'block_rooms', name: 'Block Rooms (OOO)', description: 'Put rooms out of order for repairs or deep cleaning' },
      { id: 'unblock_rooms', name: 'Release Room Blocks', description: 'Return blocked rooms to sellable inventory' },
      { id: 'delete_rooms', name: 'Delete Rooms', description: 'Remove room units permanently' },
    ]
  },
  {
    id: 'housekeeping',
    name: 'Housekeeping Operations',
    description: 'Room cleaning task assignments, turn-down status, housekeeping inspection, and linen management',
    icon: ClipboardList,
    color: 'teal',
    primaryPermissions: [
      'manage_rooms', 
      'view_housekeeping', 
      'assign_housekeeping_tasks', 
      'edit_housekeeping_tasks', 
      'close_housekeeping_tasks'
    ],
    granularPermissions: [
      { id: 'view_housekeeping', name: 'View Cleaning Queue', description: 'See rooms needing cleaning, inspection, or turn-down' },
      { id: 'assign_housekeeping_tasks', name: 'Assign Rooms to Staff', description: 'Delegate cleaning duties to attendants' },
      { id: 'edit_housekeeping_tasks', name: 'Update Clean Status', description: 'Mark rooms clean, dirty, or in-progress' },
      { id: 'close_housekeeping_tasks', name: 'Inspect & Finalize Tasks', description: 'Verify cleanliness and release to front desk' },
    ]
  },
  {
    id: 'kitchen',
    name: 'Food & Beverage / POS',
    description: 'Restaurant dining orders, kitchen display system, breakfast list, and room service billing',
    icon: ChefHat,
    color: 'amber',
    primaryPermissions: ['manage_kitchen', 'view_fb_orders', 'create_fb_orders', 'edit_fb_orders'],
    granularPermissions: [
      { id: 'manage_kitchen', name: 'Access F&B & Kitchen', description: 'Open restaurant order terminal and breakfast roster' },
      { id: 'view_fb_orders', name: 'View Orders', description: 'Inspect dining, breakfast, and room service orders' },
      { id: 'create_fb_orders', name: 'Create Orders', description: 'Post new restaurant food & beverage tickets' },
      { id: 'edit_fb_orders', name: 'Modify Orders', description: 'Update ticket quantities, instructions, and items' },
      { id: 'cancel_fb_orders', name: 'Cancel / Void Orders', description: 'Void restaurant tickets with mandatory audit' },
      { id: 'delete_fb_orders', name: 'Delete Orders', description: 'Remove historical F&B orders' },
    ]
  },
  {
    id: 'inventory',
    name: 'Store Inventory & Supplies',
    description: 'Hotel stock levels, warehouse inventory, purchase requisitions, and supplies usage',
    icon: Package,
    color: 'orange',
    primaryPermissions: ['manage_inventory', 'view_inventory', 'edit_inventory'],
    granularPermissions: [
      { id: 'manage_inventory', name: 'Manage Inventory', description: 'Full access to stock items and procurement' },
      { id: 'view_inventory', name: 'View Stock Levels', description: 'Check remaining supplies, linens, and items' },
      { id: 'edit_inventory', name: 'Update Inventory', description: 'Receive new stock, adjust counts, and record usage' },
    ]
  },
  {
    id: 'maintenance',
    name: 'Maintenance & Work Orders',
    description: 'Facility repair tickets, equipment servicing, out-of-order rooms, and inspections',
    icon: Wrench,
    color: 'blue',
    primaryPermissions: ['manage_maintenance', 'block_rooms', 'unblock_rooms'],
    granularPermissions: [
      { id: 'manage_maintenance', name: 'Access Maintenance', description: 'View and create facility work orders' },
      { id: 'block_rooms', name: 'Place Maintenance Block', description: 'Lock rooms for urgent plumbing, electrical or repairs' },
      { id: 'unblock_rooms', name: 'Clear Maintenance Block', description: 'Sign off on repairs and restore room to service' },
    ]
  },
  {
    id: 'corporate',
    name: 'Corporate Accounts & Direct Billing',
    description: 'Corporate client profiles, negotiated contracts, credit terms, and company billing ledger',
    icon: Building2,
    color: 'cyan',
    primaryPermissions: ['manage_corporate', 'view_city_ledger'],
    granularPermissions: [
      { id: 'manage_corporate', name: 'Manage Corporate Accounts', description: 'Create and update corporate client profiles' },
      { id: 'view_city_ledger', name: 'View Corporate Invoicing', description: 'Inspect corporate balances, aging, and accounts' },
    ]
  },
  {
    id: 'finance',
    name: 'Finance, Ledgers & Cashiering',
    description: 'Financial ledger, payment processing, charge postings, refunds, void transactions, and Debt Ledger (AR)',
    icon: DollarSign,
    color: 'emerald',
    primaryPermissions: [
      'view_financial_records', 
      'process_payments', 
      'view_ledger', 
      'post_charges', 
      'receive_payments', 
      'receive_payment', 
      'export_financial_data', 
      'view_city_ledger', 
      'view_debt_ledger'
    ],
    granularPermissions: [
      { id: 'view_financial_records', name: 'View Financial Records', description: 'Open financial summaries, cash drawer, and balances' },
      { id: 'view_ledger', name: 'View Folios & Ledgers', description: 'Inspect guest, group, and house account folios' },
      { id: 'post_charges', name: 'Post Charges', description: 'Debit rooms with extra charges, amenities, or services' },
      { id: 'receive_payments', name: 'Receive Payments', description: 'Process cash, card, and electronic payment receipts' },
      { id: 'process_refunds', name: 'Process Refunds', description: 'Issue refunds to guests upon checkout or dispute' },
      { id: 'approve_refund', name: 'Approve High-Value Refunds', description: 'Authorize refunds exceeding managerial limit' },
      { id: 'void_transaction', name: 'Void Transactions', description: 'Void incorrect postings with audit trail justification' },
      { id: 'reverse_transactions', name: 'Reverse Transactions', description: 'Reverse settled ledger transactions' },
      { id: 'view_debt_ledger', name: 'Outstanding Debt (AR)', description: 'Manage accounts receivable, unpaid folios, and debtor aging' },
      { id: 'transfer_debt', name: 'Transfer Debt', description: 'Transfer balances to Corporate, City Ledger, or House folios' },
      { id: 'adjust_debt', name: 'Adjust Debt', description: 'Post approved balance adjustments and credit notes' },
      { id: 'write_off_debt', name: 'Write-Off Bad Debt', description: 'Authorize debt write-offs with mandatory reason' },
      { id: 'export_financial_data', name: 'Export Financial Data', description: 'Download CSV and Excel files of accounting ledgers' },
    ]
  },
  {
    id: 'audits',
    name: 'Nightly Audit Operations',
    description: 'End-of-day business date roll, room charge posting, automatic tariff deductions, and ledger closing',
    icon: Clock,
    color: 'amber',
    primaryPermissions: ['nightly_audit', 'run_night_audit', 'approve_night_audit', 'view_financial_records'],
    granularPermissions: [
      { id: 'nightly_audit', name: 'Access Nightly Audit', description: 'Open EOD audit dashboard and pre-audit checklists' },
      { id: 'run_night_audit', name: 'Execute Nightly Audit', description: 'Roll system date and trigger room rate postings' },
      { id: 'approve_night_audit', name: 'Approve & Finalize Audit', description: 'Confirm balanced books and close business day' },
      { id: 'reopen_audit', name: 'Reopen Audit', description: 'Re-run or review past business date closures' },
    ]
  },
  {
    id: 'reports',
    name: 'Reports & Business Intelligence',
    description: 'Daily summary sheets (DSS), managerial reports, occupancy statistics, tax reports, and exports',
    icon: BarChart3,
    color: 'purple',
    primaryPermissions: ['view_reports', 'export_reports', 'print_reports'],
    granularPermissions: [
      { id: 'view_reports', name: 'View Reports', description: 'Browse all operational, financial, and tax reports' },
      { id: 'export_reports', name: 'Export Reports', description: 'Export report data in CSV or Excel format' },
      { id: 'print_reports', name: 'Print Reports', description: 'Format and send reports to physical printers' },
    ]
  },
  {
    id: 'staff',
    name: 'Staff Management & Security',
    description: 'Staff directory, role assignments, password resets, activation emails, and session termination',
    icon: UserCog,
    color: 'rose',
    primaryPermissions: ['manage_staff', 'view_users', 'view_activity_logs'],
    granularPermissions: [
      { id: 'manage_staff', name: 'Manage Staff', description: 'Full oversight of hotel personnel and access rights' },
      { id: 'view_users', name: 'View Staff Roster', description: 'Browse employee list and active statuses' },
      { id: 'create_users', name: 'Provision Staff Accounts', description: 'Create and dispatch activation links to new employees' },
      { id: 'edit_users', name: 'Edit Staff Profiles', description: 'Update contact info, departments, and employee IDs' },
      { id: 'delete_users', name: 'Remove Staff Members', description: 'Permanently remove staff accounts' },
      { id: 'reset_passwords', name: 'Reset Passwords', description: 'Dispatch secure activation/reset emails to staff' },
      { id: 'assign_roles', name: 'Assign Roles & Permissions', description: 'Change user roles and custom permissions' },
      { id: 'suspend_users', name: 'Suspend & Force-Logout', description: 'Instantly revoke access and terminate live sessions' },
      { id: 'view_activity_logs', name: 'View Activity Logs', description: 'Inspect audit trail of staff actions and edits' },
    ]
  },
  {
    id: 'settings',
    name: 'Hotel Settings & Administration',
    description: 'Hotel property details, check-in/out policies, tax rates, currency setup, and custom role builder',
    icon: Settings,
    color: 'zinc',
    primaryPermissions: ['edit_hotel_settings', 'view_settings', 'edit_settings', 'manage_roles'],
    granularPermissions: [
      { id: 'edit_hotel_settings', name: 'Manage Hotel Settings', description: 'Update property contact, branding, and rules' },
      { id: 'view_settings', name: 'View Settings', description: 'Inspect system settings and policy configurations' },
      { id: 'edit_settings', name: 'Edit Operational Policies', description: 'Configure room block policies, refunds, and taxes' },
      { id: 'manage_roles', name: 'Manage Custom Roles', description: 'Create, modify, and delete custom RBAC roles' },
    ]
  }
];

export interface ModuleAssignmentMatrixProps {
  selectedPermissions: string[];
  onChange: (permissions: string[]) => void;
  customRoles?: CustomRole[];
  selectedRoleId?: string;
  onSelectRoleId?: (roleId: string) => void;
  allowSaveAsRole?: boolean;
  saveAsRole?: boolean;
  onSaveAsRoleChange?: (save: boolean) => void;
  roleName?: string;
  onRoleNameChange?: (name: string) => void;
  roleDescription?: string;
  onRoleDescriptionChange?: (desc: string) => void;
  disabled?: boolean;
}

export function ModuleAssignmentMatrix({
  selectedPermissions,
  onChange,
  customRoles = [],
  selectedRoleId,
  onSelectRoleId,
  allowSaveAsRole = true,
  saveAsRole = false,
  onSaveAsRoleChange,
  roleName = '',
  onRoleNameChange,
  roleDescription = '',
  onRoleDescriptionChange,
  disabled = false
}: ModuleAssignmentMatrixProps) {
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');

  // Toggle all permissions for a specific module
  const toggleModule = (module: ModuleDefinition) => {
    if (disabled) return;
    const allModulePerms = [
      ...module.primaryPermissions,
      ...module.granularPermissions.map(p => p.id)
    ];
    const isFullyAssigned = allModulePerms.every(p => selectedPermissions.includes(p));

    if (isFullyAssigned) {
      // Remove all permissions belonging to this module
      onChange(selectedPermissions.filter(p => !allModulePerms.includes(p as Permission)));
    } else {
      // Add all permissions belonging to this module
      const combined = Array.from(new Set([...selectedPermissions, ...allModulePerms]));
      onChange(combined);
    }
  };

  // Toggle a single granular permission
  const togglePermission = (permId: Permission) => {
    if (disabled) return;
    if (selectedPermissions.includes(permId)) {
      onChange(selectedPermissions.filter(p => p !== permId));
    } else {
      onChange([...selectedPermissions, permId]);
    }
  };

  // Toggle accordion expand
  const toggleExpand = (moduleId: string) => {
    setExpandedModules(prev => ({ ...prev, [moduleId]: !prev[moduleId] }));
  };

  // Quick Preset Handlers
  const applyPreset = (presetName: string) => {
    if (disabled) return;
    let targetPerms: string[] = [];

    switch (presetName) {
      case 'frontDesk':
        targetPerms = [
          ...PMS_MODULES.find(m => m.id === 'dashboard')?.primaryPermissions || [],
          ...PMS_MODULES.find(m => m.id === 'reservations')?.primaryPermissions || [],
          ...PMS_MODULES.find(m => m.id === 'guests')?.primaryPermissions || [],
          ...PMS_MODULES.find(m => m.id === 'rooms')?.primaryPermissions || [],
          'view_housekeeping',
          'view_fb_orders',
          'create_fb_orders',
          'view_ledger',
          'post_charges',
          'receive_payments',
          'receive_payment'
        ];
        break;

      case 'housekeeping':
        targetPerms = [
          ...PMS_MODULES.find(m => m.id === 'housekeeping')?.primaryPermissions || [],
          'view_rooms',
          'manage_rooms'
        ];
        break;

      case 'kitchen':
        targetPerms = [
          ...PMS_MODULES.find(m => m.id === 'kitchen')?.primaryPermissions || [],
        ];
        break;

      case 'maintenance':
        targetPerms = [
          ...PMS_MODULES.find(m => m.id === 'maintenance')?.primaryPermissions || [],
          'view_rooms',
          'view_inventory'
        ];
        break;

      case 'accountant':
        targetPerms = [
          ...PMS_MODULES.find(m => m.id === 'dashboard')?.primaryPermissions || [],
          ...PMS_MODULES.find(m => m.id === 'finance')?.primaryPermissions || [],
          ...PMS_MODULES.find(m => m.id === 'audits')?.primaryPermissions || [],
          ...PMS_MODULES.find(m => m.id === 'reports')?.primaryPermissions || [],
          'view_reservations',
          'view_guests'
        ];
        break;

      case 'nightAuditor':
        targetPerms = [
          ...PMS_MODULES.find(m => m.id === 'dashboard')?.primaryPermissions || [],
          ...PMS_MODULES.find(m => m.id === 'reservations')?.primaryPermissions || [],
          ...PMS_MODULES.find(m => m.id === 'rooms')?.primaryPermissions || [],
          ...PMS_MODULES.find(m => m.id === 'finance')?.primaryPermissions || [],
          ...PMS_MODULES.find(m => m.id === 'audits')?.primaryPermissions || [],
          ...PMS_MODULES.find(m => m.id === 'reports')?.primaryPermissions || [],
        ];
        break;

      case 'manager':
        targetPerms = PMS_MODULES
          .filter(m => m.id !== 'settings')
          .flatMap(m => [...m.primaryPermissions, ...m.granularPermissions.map(p => p.id)]);
        break;

      case 'all':
        targetPerms = PMS_MODULES.flatMap(m => [
          ...m.primaryPermissions,
          ...m.granularPermissions.map(p => p.id)
        ]);
        break;

      case 'clear':
        targetPerms = [];
        break;
    }

    onChange(Array.from(new Set(targetPerms)));
  };

  // Handle selecting an existing Custom Role from dropdown
  const handleRoleSelection = (roleId: string) => {
    onSelectRoleId?.(roleId);
    if (!roleId) {
      return;
    }
    const role = customRoles.find(r => r.id === roleId);
    if (role && role.permissions) {
      let rolePerms = [...role.permissions];
      if (role.inheritsFrom) {
        const base = BASE_ROLE_PERMISSIONS[role.inheritsFrom] || 
          SYSTEM_ROLE_TEMPLATES[role.inheritsFrom]?.permissions || [];
        rolePerms = Array.from(new Set([...rolePerms, ...base]));
      }
      onChange(rolePerms as string[]);
    }
  };

  // Filter modules based on search
  const filteredModules = useMemo(() => {
    if (!searchQuery.trim()) return PMS_MODULES;
    const query = searchQuery.toLowerCase();
    return PMS_MODULES.filter(m => {
      const matchName = m.name.toLowerCase().includes(query);
      const matchDesc = m.description.toLowerCase().includes(query);
      const matchPerms = m.granularPermissions.some(p => 
        p.name.toLowerCase().includes(query) || 
        p.description.toLowerCase().includes(query) ||
        p.id.toLowerCase().includes(query)
      );
      return matchName || matchDesc || matchPerms;
    });
  }, [searchQuery]);

  // Count active modules
  const activeModuleCount = useMemo(() => {
    return PMS_MODULES.filter(m => {
      const allPerms = [...m.primaryPermissions, ...m.granularPermissions.map(p => p.id)];
      return allPerms.some(p => selectedPermissions.includes(p));
    }).length;
  }, [selectedPermissions]);

  return (
    <div className="space-y-4 pt-1">
      {/* Existing Custom Role Template Selector (if any roles exist or direct assignment) */}
      <div className="p-3.5 bg-zinc-950/80 rounded-xl border border-zinc-800 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
            <Shield size={14} className="text-emerald-400" />
            <span>Custom Role Template</span>
          </label>
          {selectedRoleId && (
            <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
              Loaded Template
            </span>
          )}
        </div>

        <select
          disabled={disabled}
          value={selectedRoleId || ''}
          onChange={(e) => handleRoleSelection(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none transition-colors"
        >
          <option value="">-- Direct Custom Module Assignment (No saved role) --</option>
          {customRoles.map(role => (
            <option key={role.id} value={role.id}>
              {role.name} ({role.permissions?.length || 0} permissions assigned)
            </option>
          ))}
        </select>

        {customRoles.length === 0 && (
          <p className="text-[11px] text-zinc-400 leading-normal">
            No pre-saved custom roles yet. Select the modules below to assign them directly to this staff member, and optionally save as a reusable custom role template.
          </p>
        )}
      </div>

      {/* Modules Assignment Header & Quick Presets */}
      <div className="p-4 bg-zinc-950/90 rounded-xl border border-zinc-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-200 flex items-center gap-2">
              <Layers size={15} className="text-emerald-400" />
              <span>Modules to Assign</span>
            </h4>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Toggle entire modules or expand for fine-grained capability control.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
              {activeModuleCount} of {PMS_MODULES.length} Modules Active
            </span>
            <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-zinc-900 text-zinc-400 border border-zinc-800">
              {selectedPermissions.length} Capabilities
            </span>
          </div>
        </div>

        {/* Quick Role Preset Pills */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1">
              <Sparkles size={11} className="text-amber-400" />
              Quick Module Presets:
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => applyPreset('all')}
                className="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold"
              >
                Select All
              </button>
              <span className="text-zinc-700">•</span>
              <button
                type="button"
                onClick={() => applyPreset('clear')}
                className="text-[10px] text-zinc-400 hover:text-zinc-200"
              >
                Clear All
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'frontDesk', label: 'Front Desk' },
              { id: 'housekeeping', label: 'Housekeeping' },
              { id: 'kitchen', label: 'Food & Beverage' },
              { id: 'maintenance', label: 'Maintenance' },
              { id: 'accountant', label: 'Accountant' },
              { id: 'nightAuditor', label: 'Night Auditor' },
              { id: 'manager', label: 'Operations Manager' },
            ].map(preset => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-emerald-400 rounded-lg text-[11px] font-medium border border-zinc-800 transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search modules or specific permissions (e.g. reservations, refunds, inventory)..."
            className="w-full pl-8 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors"
          />
        </div>
      </div>

      {/* Module Cards List */}
      <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
        {filteredModules.map((module) => {
          const Icon = module.icon;
          const allModulePerms = [
            ...module.primaryPermissions,
            ...module.granularPermissions.map(p => p.id)
          ];
          const assignedPermsInModule = allModulePerms.filter(p => selectedPermissions.includes(p));
          const isFullyAssigned = allModulePerms.length > 0 && assignedPermsInModule.length === allModulePerms.length;
          const isPartiallyAssigned = assignedPermsInModule.length > 0 && !isFullyAssigned;
          const isExpanded = !!expandedModules[module.id] || !!searchQuery.trim();

          return (
            <div
              key={module.id}
              className={cn(
                "rounded-xl border transition-all overflow-hidden",
                isFullyAssigned
                  ? "bg-zinc-900/90 border-emerald-500/40 shadow-sm shadow-emerald-950/20"
                  : isPartiallyAssigned
                    ? "bg-zinc-900/60 border-amber-500/30"
                    : "bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700/80"
              )}
            >
              {/* Module Header Row */}
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* Master Checkbox */}
                  <button
                    type="button"
                    onClick={() => toggleModule(module)}
                    className="p-0.5 rounded text-zinc-400 hover:text-emerald-400 focus:outline-none shrink-0"
                    title={isFullyAssigned ? "Revoke module access" : "Grant module access"}
                  >
                    {isFullyAssigned ? (
                      <div className="w-5 h-5 rounded bg-emerald-500 text-zinc-950 flex items-center justify-center font-bold">
                        <Check size={14} strokeWidth={3} />
                      </div>
                    ) : isPartiallyAssigned ? (
                      <div className="w-5 h-5 rounded bg-amber-500/20 border border-amber-500 text-amber-400 flex items-center justify-center font-bold text-xs">
                        -
                      </div>
                    ) : (
                      <Square size={20} className="text-zinc-600 hover:text-zinc-400" />
                    )}
                  </button>

                  {/* Icon & Details */}
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                      isFullyAssigned 
                        ? "bg-emerald-500/20 text-emerald-400" 
                        : isPartiallyAssigned 
                          ? "bg-amber-500/20 text-amber-400"
                          : "bg-zinc-800 text-zinc-400"
                    )}>
                      <Icon size={16} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-xs font-bold truncate",
                          isFullyAssigned 
                            ? "text-emerald-300" 
                            : isPartiallyAssigned 
                              ? "text-amber-300" 
                              : "text-zinc-200"
                        )}>
                          {module.name}
                        </span>

                        {isFullyAssigned ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 uppercase tracking-wider shrink-0">
                            Full Access
                          </span>
                        ) : isPartiallyAssigned ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 uppercase tracking-wider shrink-0">
                            {assignedPermsInModule.length} Active
                          </span>
                        ) : (
                          <span className="text-[9px] font-medium px-1.5 py-0.2 rounded bg-zinc-800/80 text-zinc-500 uppercase tracking-wider shrink-0">
                            No Access
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-400 truncate mt-0.5">
                        {module.description}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Fine-tune Drawer Toggle */}
                <button
                  type="button"
                  onClick={() => toggleExpand(module.id)}
                  className="px-2 py-1 rounded-lg hover:bg-zinc-800 text-[11px] font-semibold text-zinc-400 hover:text-zinc-200 flex items-center gap-1 shrink-0 transition-colors"
                >
                  <span>Fine-tune</span>
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              </div>

              {/* Granular Capabilities Accordion Drawer */}
              {isExpanded && (
                <div className="px-4 pb-3.5 pt-2 bg-zinc-950/80 border-t border-zinc-800/80 space-y-2">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 flex items-center justify-between">
                    <span>Granular Capabilities ({assignedPermsInModule.length}/{allModulePerms.length})</span>
                    <button
                      type="button"
                      onClick={() => toggleModule(module)}
                      className="text-emerald-400 hover:text-emerald-300 text-[10px] lowercase"
                    >
                      {isFullyAssigned ? 'uncheck module' : 'grant all in module'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {module.granularPermissions.map((perm) => {
                      const isGranted = selectedPermissions.includes(perm.id);
                      return (
                        <label
                          key={perm.id}
                          className={cn(
                            "flex items-start gap-2.5 p-2 rounded-lg cursor-pointer border text-xs transition-colors",
                            isGranted 
                              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200" 
                              : "bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={isGranted}
                            onChange={() => togglePermission(perm.id)}
                            className="mt-0.5 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500"
                          />
                          <div className="min-w-0">
                            <span className={cn(
                              "font-semibold block text-[11px]",
                              isGranted ? "text-emerald-300" : "text-zinc-300"
                            )}>
                              {perm.name}
                            </span>
                            <span className="text-[10px] text-zinc-500 block leading-tight">
                              {perm.description}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Save as Reusable Custom Role Template Option */}
      {allowSaveAsRole && (
        <div className="p-3.5 bg-zinc-950/90 rounded-xl border border-zinc-800/90 space-y-2.5">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={saveAsRole}
              onChange={(e) => onSaveAsRoleChange?.(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500"
            />
            <div>
              <span className="text-xs font-bold text-zinc-200">
                Save as a Reusable Custom Role in the Property Library
              </span>
              <span className="text-[11px] text-zinc-500 block">
                Enable other staff members to easily reuse this exact module and permission preset.
              </span>
            </div>
          </label>

          {saveAsRole && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-zinc-800/80 animate-in fade-in-50 duration-150">
              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                  Custom Role Name *
                </label>
                <input
                  type="text"
                  required={saveAsRole}
                  value={roleName}
                  onChange={(e) => onRoleNameChange?.(e.target.value)}
                  placeholder="e.g., Night Shift Supervisor, Lead Concierge"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                  Role Description (Optional)
                </label>
                <input
                  type="text"
                  value={roleDescription}
                  onChange={(e) => onRoleDescriptionChange?.(e.target.value)}
                  placeholder="e.g., Handles night audit, bookings, and cash folios"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
