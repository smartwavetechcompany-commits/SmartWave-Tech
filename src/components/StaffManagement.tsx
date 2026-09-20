import React, { useEffect, useState } from 'react';
import { collection, query, where, doc, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { database } from '../utils/database';
import { ConfirmModal } from './ConfirmModal';
import { useAuth } from '../contexts/AuthContext';
import { UserProfile, StaffRole, OperationType, CustomRole, UserRole } from '../types';
import { hasPermission } from '../utils/permissions';
import { RoleBuilderModal } from './RoleBuilderModal';
import { SessionControlCenter } from './SessionControlCenter';
import { AccountCreationSummaryModal, UserSummaryData } from './AccountCreationSummaryModal';
import { AdminResetPasswordModal } from './AdminResetPasswordModal';
import { generateAccountActivationToken, resendAccountActivationEmail } from '../utils/passwordResetService';
import { 
  UserPlus, 
  Search, 
  Shield, 
  Trash2, 
  Mail,
  User as UserIcon,
  CheckCircle2,
  XCircle,
  Lock,
  RefreshCw,
  Download,
  Users,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  Laptop,
  Plus,
  Edit2,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  UserX,
  Phone,
  Building,
  Hash,
  Clock,
  MailCheck,
  Send
} from 'lucide-react';
import { cn, exportToCSV, safeStringify } from '../utils';
import { toast } from 'sonner';

const BASE_ROLES: { id: StaffRole; label: string }[] = [
  { id: 'frontDesk', label: 'Front Desk' },
  { id: 'housekeeper', label: 'Housekeeper' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'accountant', label: 'Accountant' },
  { id: 'manager', label: 'Manager' },
  { id: 'admin', label: 'Hotel Administrator' },
];

const AVAILABLE_PERMISSIONS = [
  { id: 'access_front_desk', label: 'Front Desk Access' },
  { id: 'manage_rooms', label: 'Manage Rooms & Status' },
  { id: 'create_room_blocks', label: 'Block Rooms' },
  { id: 'remove_room_blocks', label: 'Unblock Rooms' },
  { id: 'edit_guest_profiles', label: 'Guest Management' },
  { id: 'process_payments', label: 'Process Payments' },
  { id: 'view_financial_records', label: 'Financial Records' },
  { id: 'post_charges', label: 'Post Charges to Folio' },
  { id: 'audit_ledger', label: 'Audit Ledger' },
  { id: 'issue_refunds', label: 'Issue Refunds' },
  { id: 'nightly_audit', label: 'Nightly Audit' },
  { id: 'manage_kitchen', label: 'Kitchen & F&B' },
  { id: 'manage_inventory', label: 'Inventory Access' },
  { id: 'manage_maintenance', label: 'Maintenance Access' },
  { id: 'manage_corporate', label: 'Corporate Accounts' },
  { id: 'manage_staff', label: 'Staff Management' },
  { id: 'manage_roles', label: 'Roles & Access Control' },
  { id: 'view_reports', label: 'View Reports' },
  { id: 'export_reports', label: 'Export Reports' },
  { id: 'edit_hotel_settings', label: 'Hotel Settings' },
  { id: 'view_activity_logs', label: 'Activity Logs' },
];

const DEPARTMENTS = [
  'Front Office',
  'Housekeeping',
  'Food & Beverage',
  'Maintenance / Engineering',
  'Finance & Accounting',
  'Sales & Marketing',
  'Human Resources',
  'Management',
  'Security'
];

export function StaffManagement({ hotelId: propHotelId }: { hotelId?: string }) {
  const { hotel: authHotel, profile, customRoles } = useAuth();
  const hotelId = propHotelId || authHotel?.id;

  const [activeTab, setActiveTab] = useState<'members' | 'roles' | 'sessions'>('members');
  const [staff, setStaff] = useState<UserProfile[]>([]);
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);
  const [isCreatingRole, setIsCreatingRole] = useState(false);
  const [editingPermissions, setEditingPermissions] = useState<UserProfile | null>(null);
  const [resettingUser, setResettingUser] = useState<UserProfile | null>(null);
  const [summaryData, setSummaryData] = useState<UserSummaryData | null>(null);

  // Pagination & Filtering state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending_activation' | 'suspended'>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // New staff form state
  const [newStaff, setNewStaff] = useState({
    fullName: '',
    email: '',
    phone: '',
    department: 'Front Office',
    employeeId: '',
    roleType: 'base' as 'base' | 'custom',
    baseRole: 'frontDesk' as StaffRole,
    customRoleId: '',
    overrides: [] as string[],
  });

  const [hasPermissionError, setHasPermissionError] = useState(false);
  const [showConfirmRemove, setShowConfirmRemove] = useState<{ uid: string; email: string } | null>(null);
  const [showConfirmSuspend, setShowConfirmSuspend] = useState<{ member: UserProfile; willSuspend: boolean } | null>(null);

  // Role-based permission check for staff password reset
  const canResetPasswords = profile && (
    profile.role === 'hotelAdmin' || 
    profile.role === 'superAdmin' || 
    hasPermission(profile, 'reset_passwords', customRoles) || 
    hasPermission(profile, 'manage_staff', customRoles)
  );

  // Real-time Staff Listener
  useEffect(() => {
    if (!hotelId || !profile || hasPermissionError) return;

    const q = query(collection(db, 'users'), where('hotelId', '==', hotelId));
    const unsub = onSnapshot(q, (snap) => {
      setStaff(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    }, (err: any) => {
      handleFirestoreError(err, OperationType.LIST, 'users');
      if (err.code === 'permission-denied') {
        setHasPermissionError(true);
      }
    });

    return () => unsub();
  }, [hotelId, profile?.uid, hasPermissionError]);

  // Add staff submission
  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotelId) return;

    if (!hasPermission(profile, 'manage_staff', customRoles) && !hasPermission(profile, 'manage_roles', customRoles)) {
      toast.error("You do not have permission to add staff members.");
      return;
    }

    if (!newStaff.email || !newStaff.email.includes('@')) {
      toast.error('Please enter a valid email address.');
      return;
    }

    const existing = staff.some(s => s.email?.toLowerCase() === newStaff.email.trim().toLowerCase());
    if (existing) {
      toast.error(`A staff member with email ${newStaff.email} already exists.`);
      return;
    }

    const tempUid = `staff_${Math.random().toString(36).substring(2, 9)}`;
    const assignedUserRole: UserRole = newStaff.roleType === 'base' && newStaff.baseRole === 'admin' ? 'hotelAdmin' : 'staff';
    const roleLabel = newStaff.roleType === 'base'
      ? (BASE_ROLES.find(r => r.id === newStaff.baseRole)?.label || newStaff.baseRole)
      : (customRoles.find(r => r.id === newStaff.customRoleId)?.name || 'Custom Role');

    const staffProfile: UserProfile = {
      uid: tempUid,
      email: newStaff.email.trim().toLowerCase(),
      hotelId,
      role: assignedUserRole,
      staffRole: newStaff.roleType === 'base' ? newStaff.baseRole : undefined,
      customRoleId: newStaff.roleType === 'custom' ? newStaff.customRoleId : undefined,
      displayName: newStaff.fullName.trim(),
      phoneNumber: newStaff.phone.trim() || undefined,
      department: newStaff.department,
      employeeId: newStaff.employeeId.trim() || undefined,
      status: 'pending_activation',
      isLocked: false,
      roles: newStaff.roleType === 'base' ? [newStaff.baseRole] : [],
      permissions: newStaff.overrides,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      toast.loading('Provisioning staff account and dispatching activation link...');

      await database.safeSet(doc(db, 'users', tempUid), staffProfile, {
        hotelId,
        module: 'Staff Security',
        action: 'CREATE_STAFF_ACCOUNT',
        details: `Created staff account for ${staffProfile.email} with role '${roleLabel}' in Pending Activation status`,
        metadata: {
          uid: tempUid,
          email: staffProfile.email,
          role: roleLabel,
          status: 'pending_activation'
        }
      });

      // Generate secure activation token and dispatch email
      const activationResult = await generateAccountActivationToken({
        hotelId,
        hotelName: authHotel?.name || 'Hotel Property',
        targetUser: staffProfile,
        adminProfile: profile!,
        durationMinutes: 1440
      });

      // Role compliance audit log
      try {
        await database.safeAdd(collection(db, 'GlobalAuditLog'), {
          timestamp: new Date().toISOString(),
          actorId: profile?.uid || 'unknown',
          actorEmail: profile?.email || 'unknown',
          actorRole: profile?.role || 'unknown',
          targetUserId: tempUid,
          targetUserEmail: staffProfile.email,
          targetUserName: staffProfile.displayName,
          assignedRoles: [staffProfile.role, ...(staffProfile.roles || [])],
          hotelId,
          action: 'STAFF_ACCOUNT_CREATED',
          details: `Provisioned staff profile in Pending Activation. Single-use 24h activation link dispatched to ${staffProfile.email}.`
        }, {
          hotelId,
          module: 'Staff Security',
          action: 'STAFF_ACCOUNT_CREATED_AUDIT',
          details: 'Compliance audit log for staff creation'
        });
      } catch (logErr) {
        console.warn("Global audit log notice:", logErr);
      }

      toast.dismiss();

      // Close create form and show the activation summary modal
      setIsAddingStaff(false);
      setSummaryData({
        uid: tempUid,
        fullName: staffProfile.displayName || '',
        username: staffProfile.email,
        email: staffProfile.email,
        phoneNumber: staffProfile.phoneNumber,
        department: staffProfile.department,
        hotelName: authHotel?.name || 'Hotel Property',
        hotelId,
        roleName: roleLabel,
        roleId: staffProfile.customRoleId || staffProfile.staffRole || staffProfile.role,
        employeeId: staffProfile.employeeId,
        activationLink: activationResult.activationUrl,
        activationExpiresAt: activationResult.token.expiresAt,
        emailDispatched: activationResult.emailSent,
        status: 'pending_activation',
        createdAt: staffProfile.createdAt || new Date().toISOString(),
        createdBy: profile?.email || 'Administrator'
      });

      // Reset form
      setNewStaff({
        fullName: '',
        email: '',
        phone: '',
        department: 'Front Office',
        employeeId: '',
        roleType: 'base',
        baseRole: 'frontDesk',
        customRoleId: '',
        overrides: []
      });

      if (activationResult.emailSent) {
        toast.success(`Account created! Activation email dispatched to ${staffProfile.email}`);
      } else {
        toast.success('Account created in Pending Activation. Activation link generated.');
      }
    } catch (err: any) {
      toast.dismiss();
      handleFirestoreError(err, OperationType.WRITE, `users/${tempUid}`);
      toast.error('Failed to create staff member: ' + err.message);
    }
  };

  // Resend activation email helper
  const handleResendActivation = async (member: UserProfile) => {
    if (!hotelId || !member.email || !profile) return;
    try {
      toast.loading(`Sending activation email to ${member.email}...`);
      const res = await resendAccountActivationEmail(
        hotelId,
        authHotel?.name || 'Hotel Property',
        member,
        profile,
        1440
      );
      toast.dismiss();
      if (res.emailSent) {
        toast.success(`Activation email successfully sent to ${member.email}`);
      } else {
        toast.success(`Activation link generated for ${member.email}`);
      }
    } catch (err: any) {
      toast.dismiss();
      toast.error(err.message || 'Failed to resend activation email');
    }
  };

  // Suspend / Reactivate staff member with instant real-time sync
  const handleToggleSuspend = async (member: UserProfile, willSuspend: boolean) => {
    if (!hotelId) return;

    try {
      const userRef = doc(db, 'users', member.uid);
      await database.safeUpdate(userRef, {
        status: willSuspend ? 'suspended' : 'active',
        isLocked: willSuspend,
        forceLogout: willSuspend, // Triggers instant logout across all devices!
        lockedReason: willSuspend ? `Suspended by ${profile?.email || 'Administrator'}` : null,
        updatedAt: new Date().toISOString()
      }, {
        hotelId,
        module: 'Account Status',
        action: willSuspend ? 'USER_ACCOUNT_SUSPENDED' : 'USER_ACCOUNT_REACTIVATED',
        details: `${willSuspend ? 'Suspended' : 'Reactivated'} account for ${member.email}`
      });

      toast.success(`Account for ${member.email} ${willSuspend ? 'suspended & logged out' : 'reactivated'}`);
      setShowConfirmSuspend(null);
    } catch (err: any) {
      toast.error('Failed to update account status: ' + err.message);
    }
  };

  // Remove staff
  const removeStaff = async (staffUid: string, staffEmail: string) => {
    if (!hotelId) return;
    try {
      await database.safeDelete(doc(db, 'users', staffUid), {
        hotelId,
        module: 'Staff',
        action: 'DELETE_STAFF',
        details: `Deleted staff member ${staffEmail}`
      });
      toast.success('Staff member removed');
      setShowConfirmRemove(null);
    } catch (err: any) {
      toast.error('Failed to remove staff member: ' + err.message);
    }
  };

  // Delete custom role
  const deleteCustomRole = async (roleId: string, roleName: string) => {
    if (!hotelId) return;
    try {
      await database.safeDelete(doc(db, 'hotels', hotelId, 'customRoles', roleId), {
        hotelId,
        module: 'RBAC',
        action: 'DELETE_CUSTOM_ROLE',
        details: `Deleted custom role '${roleName}'`
      });
      toast.success(`Role '${roleName}' deleted`);
    } catch (err: any) {
      toast.error('Failed to delete role: ' + err.message);
    }
  };

  // Filtered and paginated staff
  const filteredStaff = staff.filter(member => {
    const search = searchTerm.toLowerCase();
    const matchesSearch = 
      (member.displayName?.toLowerCase() || '').includes(search) || 
      (member.email?.toLowerCase() || '').includes(search) ||
      (member.employeeId?.toLowerCase() || '').includes(search);
    
    const matchesStatus = statusFilter === 'all' || member.status === statusFilter;
    const matchesDept = departmentFilter === 'all' || member.department === departmentFilter;
    const matchesRole = roleFilter === 'all' || 
      member.role === roleFilter || 
      member.staffRole === roleFilter || 
      member.customRoleId === roleFilter;

    return matchesSearch && matchesStatus && matchesDept && matchesRole;
  });

  const totalPages = Math.max(1, Math.ceil(filteredStaff.length / pageSize));
  const paginatedStaff = filteredStaff.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleExport = () => {
    const dataToExport = filteredStaff.map(s => ({
      Name: s.displayName || 'N/A',
      Email: s.email,
      Department: s.department || 'N/A',
      Role: s.staffRole || s.role,
      Status: s.status || 'active',
      ForcePasswordChange: s.forcePasswordChange ? 'Yes' : 'No',
      CreatedAt: s.createdAt ? new Date(s.createdAt).toLocaleDateString() : 'N/A'
    }));
    exportToCSV(dataToExport, `staff_roster_${new Date().toISOString().split('T')[0]}.csv`);
    toast.success('Staff list exported successfully');
  };

  if (profile?.role !== 'hotelAdmin' && profile?.role !== 'superAdmin') {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-[60vh] text-center">
        <Lock size={48} className="text-zinc-700 mb-4" />
        <h2 className="text-xl font-bold text-zinc-50 mb-2">Access Restricted</h2>
        <p className="text-zinc-400">Only hotel administrators can manage staff and security settings.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-7xl mx-auto">
      
      {/* Confirmation Modals */}
      <ConfirmModal
        isOpen={!!showConfirmRemove}
        title="Remove Staff Member"
        message={`Are you sure you want to permanently remove ${showConfirmRemove?.email}? This action cannot be undone.`}
        onConfirm={() => showConfirmRemove && removeStaff(showConfirmRemove.uid, showConfirmRemove.email)}
        onCancel={() => setShowConfirmRemove(null)}
        type="danger"
        confirmText="Remove Staff"
      />

      <ConfirmModal
        isOpen={!!showConfirmSuspend}
        title={showConfirmSuspend?.willSuspend ? "Suspend Staff Account" : "Reactivate Staff Account"}
        message={showConfirmSuspend?.willSuspend 
          ? `Are you sure you want to suspend ${showConfirmSuspend.member.email}? Their active sessions will be terminated immediately and they will be locked out of the PMS.`
          : `Reactivate access for ${showConfirmSuspend?.member.email}?`}
        onConfirm={() => showConfirmSuspend && handleToggleSuspend(showConfirmSuspend.member, showConfirmSuspend.willSuspend)}
        onCancel={() => setShowConfirmSuspend(null)}
        type={showConfirmSuspend?.willSuspend ? "danger" : "warning"}
        confirmText={showConfirmSuspend?.willSuspend ? "Suspend & Terminate Sessions" : "Reactivate Account"}
      />

      {/* One-Time Account Creation Summary Modal */}
      {summaryData && (
        <AccountCreationSummaryModal
          data={summaryData}
          onClose={() => setSummaryData(null)}
        />
      )}

      {/* Admin Password Reset Modal */}
      {resettingUser && (
        <AdminResetPasswordModal
          user={resettingUser}
          onClose={() => setResettingUser(null)}
        />
      )}

      {/* Role Builder Modal */}
      {(isCreatingRole || editingRole) && (
        <RoleBuilderModal
          role={editingRole}
          onClose={() => {
            setIsCreatingRole(false);
            setEditingRole(null);
          }}
        />
      )}

      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-zinc-50 tracking-tight flex items-center gap-3">
            <Users className="text-emerald-400" />
            Staff & Security Control
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Enterprise user management, granular RBAC permissions, password policies, and live session control.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 px-3.5 py-2 rounded-xl text-xs font-semibold border border-zinc-800 transition-colors"
          >
            <Download size={15} />
            Export CSV
          </button>
          <button 
            onClick={() => setIsAddingStaff(true)}
            className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
          >
            <UserPlus size={16} />
            Add Staff Member
          </button>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="flex border-b border-zinc-800 gap-2">
        <button
          onClick={() => setActiveTab('members')}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors",
            activeTab === 'members'
              ? "border-emerald-500 text-emerald-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          )}
        >
          <Users size={16} />
          Staff Directory ({staff.length})
        </button>

        <button
          onClick={() => setActiveTab('roles')}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors",
            activeTab === 'roles'
              ? "border-emerald-500 text-emerald-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          )}
        >
          <Shield size={16} />
          Custom Roles & Permissions ({customRoles.length})
        </button>

        <button
          onClick={() => setActiveTab('sessions')}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors",
            activeTab === 'sessions'
              ? "border-emerald-500 text-emerald-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          )}
        >
          <Laptop size={16} />
          Session Control Center
        </button>
      </div>

      {/* Tab 1: Staff Directory */}
      {activeTab === 'members' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search staff by name, email, or ID..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-9 pr-4 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as any);
                  setCurrentPage(1);
                }}
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-300 focus:outline-none focus:border-emerald-500"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="pending_activation">Pending Activation Only</option>
                <option value="suspended">Suspended Only</option>
              </select>

              {/* Department Filter */}
              <select
                value={departmentFilter}
                onChange={(e) => {
                  setDepartmentFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-300 focus:outline-none focus:border-emerald-500"
              >
                <option value="all">All Departments</option>
                {DEPARTMENTS.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Staff Table */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950/70 border-b border-zinc-800 text-zinc-400 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3.5 px-4">Staff Member</th>
                    <th className="py-3.5 px-4">Department</th>
                    <th className="py-3.5 px-4">Role</th>
                    <th className="py-3.5 px-4">Account Security</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {paginatedStaff.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-zinc-500">
                        No staff members found matching the filters.
                      </td>
                    </tr>
                  ) : (
                    paginatedStaff.map((member) => {
                      const isSuspended = member.status === 'suspended';
                      const roleName = member.customRoleId 
                        ? (customRoles.find(r => r.id === member.customRoleId)?.name || 'Custom Role')
                        : (BASE_ROLES.find(r => r.id === (member.staffRole || member.role))?.label || member.role);

                      return (
                        <tr key={member.uid} className="hover:bg-zinc-800/40 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs ${
                                member.status === 'pending_activation' 
                                  ? 'bg-amber-500/10 text-amber-400'
                                  : isSuspended 
                                    ? 'bg-red-500/10 text-red-400' 
                                    : 'bg-zinc-800 text-zinc-200'
                              }`}>
                                {member.displayName?.charAt(0).toUpperCase() || 'S'}
                              </div>
                              <div>
                                <span className="font-semibold text-zinc-200 block">
                                  {member.displayName || 'Unnamed Staff'}
                                </span>
                                <span className="text-[11px] text-zinc-500 font-mono block">
                                  {member.email}
                                </span>
                                {member.employeeId && (
                                  <span className="text-[10px] text-zinc-600 block">
                                    ID: {member.employeeId}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="py-3.5 px-4 text-zinc-300">
                            {member.department || 'General'}
                          </td>

                          <td className="py-3.5 px-4">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-200 border border-zinc-700/50">
                              <Shield size={12} className="text-emerald-400" />
                              {roleName}
                            </span>
                          </td>

                          <td className="py-3.5 px-4">
                            {member.status === 'pending_activation' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400">
                                <Clock size={12} />
                                Awaiting Activation
                              </span>
                            ) : member.forcePasswordChange ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400">
                                <KeyRound size={12} />
                                Change on Login
                              </span>
                            ) : (
                              <span className="text-[11px] text-zinc-400">Active & Verified</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4">
                            {member.status === 'pending_activation' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                <Clock size={11} />
                                Pending Activation
                              </span>
                            ) : isSuspended ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                                <UserX size={11} />
                                Suspended
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                <CheckCircle2 size={11} />
                                Active
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Resend Activation Email (One-time 24h link) */}
                              {member.status === 'pending_activation' && canResetPasswords && (
                                <button
                                  onClick={() => handleResendActivation(member)}
                                  className="p-1.5 rounded-lg text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
                                  title="Resend Account Activation Email"
                                >
                                  <MailCheck size={16} />
                                </button>
                              )}

                              {/* Visible Admin Password Reset action on every user account */}
                              {canResetPasswords && (
                                <button
                                  onClick={() => setResettingUser(member)}
                                  className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                                  title="Reset Staff Password (Dispatches Secure Reset Email)"
                                >
                                  <KeyRound size={16} />
                                </button>
                              )}

                              {/* Suspend / Reactivate */}
                              {member.uid !== profile?.uid && member.role !== 'hotelAdmin' && (
                                <button
                                  onClick={() => setShowConfirmSuspend({ member, willSuspend: !isSuspended })}
                                  className={`p-1.5 rounded-lg transition-colors ${
                                    isSuspended 
                                      ? 'text-emerald-400 hover:bg-emerald-500/10' 
                                      : 'text-zinc-400 hover:text-red-400 hover:bg-red-500/10'
                                  }`}
                                  title={isSuspended ? "Reactivate Account" : "Suspend Account & Terminate Sessions"}
                                >
                                  {isSuspended ? <UserCheck size={16} /> : <UserX size={16} />}
                                </button>
                              )}

                              {/* Manage Overrides */}
                              <button
                                onClick={() => setEditingPermissions(member)}
                                className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 transition-colors"
                                title="Permissions Overrides"
                              >
                                <Lock size={16} />
                              </button>

                              {/* Remove */}
                              {member.uid !== profile?.uid && member.role !== 'hotelAdmin' && (
                                <button
                                  onClick={() => setShowConfirmRemove({ uid: member.uid, email: member.email })}
                                  className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                                  title="Remove Staff"
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="p-4 bg-zinc-950/60 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
              <span>
                Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredStaff.length)} of {filteredStaff.length} members
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="px-2 text-zinc-300 font-medium">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Custom Roles & RBAC Matrix */}
      {activeTab === 'roles' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-zinc-100">Granular Role-Based Access Control</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Define reusable property roles with granular permissions that update live across all staff sessions.
              </p>
            </div>
            <button
              onClick={() => setIsCreatingRole(true)}
              className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-lg shadow-emerald-500/20"
            >
              <Plus size={16} />
              Create Custom Role
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {customRoles.map((role) => (
              <div 
                key={role.id}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-zinc-100 text-sm flex items-center gap-2">
                      <Shield size={16} className="text-emerald-400" />
                      {role.name}
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1">
                      {role.description || 'No description provided.'}
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800/80 text-xs space-y-1.5">
                  <div className="flex justify-between text-zinc-400">
                    <span>Base Template:</span>
                    <span className="font-medium text-zinc-200">{role.inheritsFrom || 'Custom'}</span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Capabilities:</span>
                    <span className="font-semibold text-emerald-400">{role.permissions?.length || 0} permissions</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                  {(role.permissions || []).slice(0, 5).map(p => (
                    <span key={p} className="px-2 py-0.5 bg-zinc-950 text-zinc-400 rounded text-[10px] uppercase font-mono">
                      {p}
                    </span>
                  ))}
                  {(role.permissions || []).length > 5 && (
                    <span className="px-2 py-0.5 bg-zinc-950 text-zinc-500 rounded text-[10px]">
                      +{(role.permissions || []).length - 5} more
                    </span>
                  )}
                </div>

                <div className="pt-2 border-t border-zinc-800 flex items-center justify-end gap-2">
                  <button
                    onClick={() => setEditingRole(role)}
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1 transition-colors"
                  >
                    <Edit2 size={13} />
                    Edit Role
                  </button>
                  <button
                    onClick={() => deleteCustomRole(role.id, role.name)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Delete Role"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Active Sessions */}
      {activeTab === 'sessions' && (
        <SessionControlCenter />
      )}

      {/* Add Staff Modal */}
      {isAddingStaff && (
        <div className="fixed inset-0 bg-zinc-950/85 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-xl my-6 shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-6 bg-gradient-to-r from-emerald-950/30 via-zinc-900 to-zinc-900 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-zinc-50">Provision Staff Member</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Configure profile, assign roles, and enforce security policies</p>
              </div>
              <button 
                onClick={() => setIsAddingStaff(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              >
                <XCircle size={18} />
              </button>
            </div>

            <form onSubmit={handleAddStaff} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Full Name *</label>
                  <input 
                    required
                    type="text" 
                    placeholder="Jane Doe"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-100 focus:border-emerald-500 outline-none"
                    value={newStaff.fullName}
                    onChange={(e) => setNewStaff({ ...newStaff, fullName: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Email / Username *</label>
                  <input 
                    required
                    type="email" 
                    placeholder="staff@hotel.com"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-100 focus:border-emerald-500 outline-none"
                    value={newStaff.email}
                    onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Phone Number</label>
                  <input 
                    type="tel" 
                    placeholder="+1 234 567 8900"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-100 focus:border-emerald-500 outline-none"
                    value={newStaff.phone}
                    onChange={(e) => setNewStaff({ ...newStaff, phone: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Employee ID</label>
                  <input 
                    type="text" 
                    placeholder="EMP-104"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-100 focus:border-emerald-500 outline-none"
                    value={newStaff.employeeId}
                    onChange={(e) => setNewStaff({ ...newStaff, employeeId: e.target.value })}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Department</label>
                  <select
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-100 focus:border-emerald-500 outline-none"
                    value={newStaff.department}
                    onChange={(e) => setNewStaff({ ...newStaff, department: e.target.value })}
                  >
                    {DEPARTMENTS.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Role Selection */}
              <div className="p-4 bg-zinc-950/60 rounded-xl border border-zinc-800 space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-300">
                  Role Assignment
                </label>
                
                <div className="flex gap-4 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="roleType"
                      checked={newStaff.roleType === 'base'}
                      onChange={() => setNewStaff({ ...newStaff, roleType: 'base' })}
                      className="text-emerald-500"
                    />
                    <span className="text-zinc-200">Standard System Role</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="roleType"
                      checked={newStaff.roleType === 'custom'}
                      onChange={() => setNewStaff({ ...newStaff, roleType: 'custom' })}
                      className="text-emerald-500"
                    />
                    <span className="text-zinc-200">Custom Role ({customRoles.length})</span>
                  </label>
                </div>

                {newStaff.roleType === 'base' ? (
                  <select
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-100 focus:border-emerald-500 outline-none"
                    value={newStaff.baseRole}
                    onChange={(e) => setNewStaff({ ...newStaff, baseRole: e.target.value as StaffRole })}
                  >
                    {BASE_ROLES.map(role => (
                      <option key={role.id} value={role.id}>{role.label}</option>
                    ))}
                  </select>
                ) : (
                  <select
                    required
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-100 focus:border-emerald-500 outline-none"
                    value={newStaff.customRoleId}
                    onChange={(e) => setNewStaff({ ...newStaff, customRoleId: e.target.value })}
                  >
                    <option value="">-- Choose custom role --</option>
                    {customRoles.map(role => (
                      <option key={role.id} value={role.id}>{role.name} ({role.permissions?.length || 0} permissions)</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Account Activation & Security Policy */}
              <div className="p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/20 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                  <ShieldCheck size={16} />
                  <span>Secure Account Activation Policy</span>
                </div>
                <div className="text-xs text-zinc-300 space-y-2 leading-relaxed">
                  <p>
                    Compliant with hotel security and PCI-DSS standards:
                  </p>
                  <ul className="list-disc list-inside space-y-1.5 text-zinc-400 text-[11px]">
                    <li>Staff members <strong className="text-zinc-200">do not receive a default password</strong>.</li>
                    <li>The system will immediately dispatch a secure <strong className="text-zinc-200">one-time activation link</strong> to the staff's registered email.</li>
                    <li>The link expires after <strong className="text-zinc-200">24 hours</strong> and becomes invalid immediately after use.</li>
                    <li>The account will remain in <strong className="text-amber-400">Pending Activation</strong> status until the staff member creates their own password.</li>
                  </ul>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  type="button"
                  onClick={() => setIsAddingStaff(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-800 text-xs font-semibold text-zinc-400 hover:text-zinc-50 transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 bg-emerald-500 text-zinc-950 text-xs font-bold py-2.5 rounded-xl hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20"
                >
                  Create Staff Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Permissions Overrides Modal */}
      {editingPermissions && (
        <div className="fixed inset-0 bg-zinc-950/85 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <h3 className="text-lg font-bold text-zinc-50">Permission Overrides</h3>
            <p className="text-zinc-400 text-xs mb-4">
              Fine-tune specific capabilities for {editingPermissions.displayName || editingPermissions.email}
            </p>
            
            <div className="space-y-1.5 flex-1 overflow-y-auto pr-1">
              {AVAILABLE_PERMISSIONS.map(perm => {
                const currentPerms = (editingPermissions.roles || editingPermissions.permissions || []) as string[];
                const isGranted = currentPerms.includes(perm.id);

                return (
                  <button
                    key={perm.id}
                    onClick={async () => {
                      if (!hotelId) return;
                      const next = isGranted 
                        ? currentPerms.filter(p => p !== perm.id) 
                        : [...currentPerms, perm.id];

                      try {
                        await database.safeUpdate(doc(db, 'users', editingPermissions.uid), {
                          roles: next,
                          permissions: next,
                          updatedAt: new Date().toISOString()
                        }, {
                          hotelId,
                          module: 'Staff Security',
                          action: 'OVERRIDE_PERMISSIONS',
                          details: `Updated permission overrides for ${editingPermissions.email}`
                        });

                        setEditingPermissions({
                          ...editingPermissions,
                          permissions: next
                        });
                        toast.success('Permission updated');
                      } catch (err: any) {
                        toast.error('Failed to update: ' + err.message);
                      }
                    }}
                    className={cn(
                      "w-full flex items-center justify-between p-2.5 rounded-xl border text-xs transition-colors",
                      isGranted 
                        ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300" 
                        : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                    )}
                  >
                    <span>{perm.label}</span>
                    {isGranted ? <CheckCircle2 size={16} className="text-emerald-400" /> : <XCircle size={16} className="text-zinc-600" />}
                  </button>
                );
              })}
            </div>

            <button 
              onClick={() => setEditingPermissions(null)}
              className="w-full mt-4 bg-emerald-500 text-zinc-950 font-bold py-2 rounded-xl text-xs hover:bg-emerald-400 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Admin Password Reset Modal (Email Token & Live Sync) */}
      {resettingUser && (
        <AdminResetPasswordModal
          user={resettingUser}
          onClose={() => setResettingUser(null)}
          onSuccess={() => setResettingUser(null)}
        />
      )}

      {/* Account Creation / Activation Summary Modal */}
      {summaryData && (
        <AccountCreationSummaryModal
          data={summaryData}
          onClose={() => setSummaryData(null)}
          onResendActivation={async () => {
            if (!summaryData.email || !hotelId || !profile) return;
            const targetMember = staff.find(s => s.uid === summaryData.uid) || {
              uid: summaryData.uid,
              email: summaryData.email,
              displayName: summaryData.fullName,
              role: 'staff',
              hotelId
            } as UserProfile;
            try {
              toast.loading(`Resending activation email to ${summaryData.email}...`);
              const res = await resendAccountActivationEmail(
                hotelId,
                summaryData.hotelName,
                targetMember,
                profile,
                1440
              );
              toast.dismiss();
              if (res.emailSent) {
                toast.success(`Activation email resent to ${summaryData.email}`);
              } else {
                toast.success(`Activation link regenerated for ${summaryData.email}`);
              }
            } catch (err: any) {
              toast.dismiss();
              toast.error(err.message || 'Failed to resend activation email');
            }
          }}
        />
      )}

    </div>
  );
}
