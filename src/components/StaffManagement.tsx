import React, { useEffect, useState } from 'react';
import { collection, query, where, doc, onSnapshot, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { database } from '../utils/database';
import { ConfirmModal } from './ConfirmModal';
import { useAuth } from '../contexts/AuthContext';
import { UserProfile, StaffRole, OperationType, CustomRole, UserRole } from '../types';
import { hasPermission, BASE_ROLE_PERMISSIONS } from '../utils/permissions';
import { RoleBuilderModal } from './RoleBuilderModal';
import { ModuleAssignmentMatrix } from './ModuleAssignmentMatrix';
import { SessionControlCenter } from './SessionControlCenter';
import { AccountCreationSummaryModal, UserSummaryData } from './AccountCreationSummaryModal';
import { AdminResetPasswordModal } from './AdminResetPasswordModal';
import { generateAccountActivationToken, resendAccountActivationEmail } from '../utils/passwordResetService';
import { provisionStaffAccount, resendStaffActivation } from '../services/staffProvisionService';
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
  const [editingPermsList, setEditingPermsList] = useState<string[]>([]);
  const [isSavingOverrides, setIsSavingOverrides] = useState(false);
  const [resettingUser, setResettingUser] = useState<UserProfile | null>(null);
  const [summaryData, setSummaryData] = useState<UserSummaryData | null>(null);

  // Pagination & Filtering state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending_activation' | 'password_reset_pending' | 'suspended' | 'disabled'>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // New staff form state with preset modules enabled by default
  const [newStaff, setNewStaff] = useState({
    fullName: '',
    email: '',
    phone: '',
    department: 'Front Office',
    employeeId: '',
    roleType: 'base' as 'base' | 'custom',
    baseRole: 'frontDesk' as StaffRole,
    customRoleId: '',
    overrides: (BASE_ROLE_PERMISSIONS['frontDesk'] || []) as string[],
    saveAsRole: false,
    customRoleName: '',
    customRoleDescription: '',
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

  // Auto-sync pending staff members if their activation token has already been used or completed
  useEffect(() => {
    if (!hotelId || !profile || staff.length === 0) return;
    const pendingMembers = staff.filter(s => s.status === 'pending_activation' && s.email);
    if (pendingMembers.length === 0) return;

    let isMounted = true;
    const syncPendingStaff = async () => {
      for (const member of pendingMembers) {
        if (!member.email) continue;
        try {
          const qTok = query(collection(db, 'activationTokens'), where('targetEmail', '==', member.email.trim().toLowerCase()));
          const snapTok = await getDocs(qTok);
          const hasUsed = snapTok.docs.some(d => d.data().isUsed === true || d.data().status === 'used');
          if (hasUsed && isMounted) {
            console.log(`[STAFF SYNC] Auto-activating verified member: ${member.email}`);
            await database.safeUpdate(doc(db, 'users', member.uid), {
              status: 'active',
              isVerified: true,
              emailVerified: true,
              temporaryPassword: null,
              initialPassword: null,
              initialTempPass: null,
              forcePasswordChange: false,
              passwordChangedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }, {
              hotelId: member.hotelId || hotelId || 'system',
              module: 'Staff Security',
              action: 'AUTO_ACTIVATE_VERIFIED_STAFF',
              details: `Auto-activated verified staff member ${member.email}`
            });
          }
        } catch (err) {
          console.warn("[STAFF SYNC] Token check notice:", err);
        }
      }
    };

    syncPendingStaff();
    return () => { isMounted = false; };
  }, [staff, hotelId, profile]);

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

    const permissionsToAssign = newStaff.overrides.length > 0
      ? newStaff.overrides
      : (BASE_ROLE_PERMISSIONS[newStaff.baseRole] || []);

    if (permissionsToAssign.length === 0) {
      toast.error('Please assign at least one module or capability to this staff member.');
      return;
    }

    let assignedRoleId = newStaff.customRoleId || undefined;
    let roleLabel = 'Custom Role';

    // If manager chose to save this module configuration as a reusable Custom Role template
    if (newStaff.roleType === 'custom' && newStaff.saveAsRole && newStaff.customRoleName.trim()) {
      try {
        const newRoleId = `role_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        await database.safeSet(doc(db, 'hotels', hotelId, 'customRoles', newRoleId), {
          id: newRoleId,
          hotelId,
          name: newStaff.customRoleName.trim(),
          description: newStaff.customRoleDescription.trim() || '',
          permissions: newStaff.overrides,
          isSystem: false,
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: profile?.email || 'admin'
        }, {
          hotelId,
          module: 'RBAC',
          action: 'CREATE_CUSTOM_ROLE',
          details: `Created reusable custom role '${newStaff.customRoleName.trim()}' with ${newStaff.overrides.length} permissions`
        });
        assignedRoleId = newRoleId;
        roleLabel = newStaff.customRoleName.trim();
        toast.success(`Saved new custom role template '${newStaff.customRoleName.trim()}'`);
      } catch (err: any) {
        console.error('Failed to create custom role template:', err);
      }
    } else if (newStaff.roleType === 'custom' && assignedRoleId) {
      const matched = customRoles.find(r => r.id === assignedRoleId);
      if (matched) roleLabel = matched.name;
    } else if (newStaff.roleType === 'base') {
      roleLabel = BASE_ROLES.find(r => r.id === newStaff.baseRole)?.label || newStaff.baseRole;
    }

    const assignedUserRole: UserRole = newStaff.roleType === 'base' && newStaff.baseRole === 'admin' ? 'hotelAdmin' : 'staff';

    try {
      toast.loading('Provisioning user in Firebase Authentication & database...');

      const result = await provisionStaffAccount({
        hotelId,
        hotelName: authHotel?.name || 'Hotel Property',
        newStaff,
        permissionsToAssign,
        assignedRoleId: newStaff.roleType === 'custom' ? assignedRoleId : undefined,
        roleLabel,
        assignedUserRole,
        profile,
        baseUrl: window.location.origin
      });

      toast.dismiss();

      const firebaseUid = result.firebaseUid;
      const staffProfile = result.staffProfile;

      // Close create form and show the activation summary modal
      setIsAddingStaff(false);
      setSummaryData({
        uid: firebaseUid,
        firebase_uid: firebaseUid,
        fullName: staffProfile.displayName || newStaff.fullName.trim(),
        username: staffProfile.email,
        email: staffProfile.email,
        phoneNumber: staffProfile.phoneNumber,
        department: staffProfile.department,
        hotelName: authHotel?.name || 'Hotel Property',
        hotelId,
        roleName: roleLabel,
        roleId: staffProfile.customRoleId || staffProfile.staffRole || staffProfile.role,
        employeeId: staffProfile.employeeId,
        activationLink: result.activationLink,
        activationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        emailDispatched: result.emailSent,
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
        overrides: (BASE_ROLE_PERMISSIONS['frontDesk'] || []) as string[],
        saveAsRole: false,
        customRoleName: '',
        customRoleDescription: '',
      });

      if (result.emailSent) {
        toast.success(`Staff user created in Firebase Auth! Activation email sent to ${staffProfile.email}`);
      } else {
        toast.info(`Staff user created in Firebase Auth. One-time activation link generated.`);
      }
    } catch (err: any) {
      toast.dismiss();
      toast.error('Failed to create staff member: ' + (err.message || 'Unknown error'));
    }
  };

  // Resend activation email helper
  const handleResendActivation = async (member: UserProfile) => {
    if (!hotelId || !member.email || !profile) return;
    try {
      toast.loading(`Regenerating Firebase activation link for ${member.email}...`);

      const result = await resendStaffActivation({
        hotelId,
        hotelName: authHotel?.name || 'Hotel Property',
        member,
        profile,
        baseUrl: window.location.origin
      });

      toast.dismiss();

      if (result.emailSent) {
        toast.success(`Activation email sent successfully to ${member.email}`);
      } else {
        toast.info(`New activation link generated for ${member.email}`);
      }

      // Display updated summary modal with fresh activation link
      setSummaryData({
        uid: member.uid,
        firebase_uid: member.firebase_uid || member.uid,
        fullName: member.displayName || member.email,
        username: member.email,
        email: member.email,
        phoneNumber: member.phoneNumber,
        department: member.department,
        hotelName: authHotel?.name || 'Hotel Property',
        hotelId,
        roleName: member.roles?.[0] || member.role,
        roleId: member.customRoleId || member.staffRole || member.role,
        employeeId: member.employeeId,
        activationLink: result.activationLink,
        activationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        emailDispatched: result.emailSent,
        status: 'pending_activation',
        createdAt: member.createdAt || new Date().toISOString(),
        createdBy: profile?.email || 'Administrator'
      });
    } catch (err: any) {
      toast.dismiss();
      toast.error(err.message || 'Failed to resend activation email');
    }
  };

  // Instantly mark a staff member as Active & Verified
  const handleDirectActivate = async (member: UserProfile) => {
    if (!hotelId || !profile) return;
    try {
      toast.loading(`Activating account for ${member.displayName || member.email}...`);
      await database.safeUpdate(doc(db, 'users', member.uid), {
        status: 'active',
        isVerified: true,
        emailVerified: true,
        temporaryPassword: null,
        initialPassword: null,
        initialTempPass: null,
        forcePasswordChange: false,
        passwordChangedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, {
        hotelId: member.hotelId || hotelId || 'system',
        module: 'Staff Security',
        action: 'DIRECT_ACTIVATE_STAFF',
        details: `Administrator manually activated staff account ${member.email}`
      });
      toast.dismiss();
      toast.success(`${member.displayName || member.email} is now Active & Verified!`);
    } catch (err: any) {
      toast.dismiss();
      toast.error(`Could not activate staff account: ${err.message}`);
    }
  };

  // Suspend / Reactivate staff member with instant real-time sync and session termination
  const handleToggleSuspend = async (member: UserProfile, willSuspend: boolean) => {
    if (!hotelId) return;

    try {
      toast.loading(willSuspend ? `Suspending ${member.email} and terminating sessions...` : `Reactivating ${member.email}...`);
      const userRef = doc(db, 'users', member.uid);

      // If reactivating: restore 'active' if they had previously set a password, else keep 'pending_activation'
      const targetStatus = willSuspend 
        ? 'suspended' 
        : (member.status === 'pending_activation' || (!member.passwordChangedAt && member.temporaryPassword)
            ? 'pending_activation' 
            : 'active');

      await database.safeUpdate(userRef, {
        status: targetStatus,
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

      // Revoke all active sessions immediately when suspending
      if (willSuspend) {
        try {
          const sessionsQuery = query(
            collection(db, 'hotels', hotelId, 'sessions'),
            where('userEmail', '==', member.email.toLowerCase())
          );
          const sessionsSnap = await getDocs(sessionsQuery);
          for (const sDoc of sessionsSnap.docs) {
            await database.safeDelete(doc(db, 'hotels', hotelId, 'sessions', sDoc.id), {
              hotelId,
              module: 'Session Control',
              action: 'SESSION_TERMINATED_ON_SUSPENSION',
              details: `Terminated session ${sDoc.id} due to staff suspension`
            }).catch(() => {});
          }
        } catch (sErr) {
          console.warn("Session cleanup warning on suspension:", sErr);
        }
      }

      toast.dismiss();
      toast.success(`Account for ${member.email} ${willSuspend ? 'suspended & all active sessions terminated' : 'successfully reactivated'}`);
      setShowConfirmSuspend(null);
    } catch (err: any) {
      toast.dismiss();
      toast.error('Failed to update account status: ' + err.message);
    }
  };

  // Permanently remove staff user and purge all associated records (no orphaned data)
  const removeStaff = async (staffUid: string, staffEmail: string) => {
    if (!hotelId) return;
    try {
      toast.loading(`Permanently removing ${staffEmail} and purging records...`);

      // 1. Call server API to delete Auth user and purge records
      let apiSuccess = false;
      try {
        const resp = await fetch('/api/auth/delete-staff-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hotelId,
            staffUid,
            staffEmail,
            adminUid: profile?.uid,
            adminEmail: profile?.email
          })
        });
        if (resp.ok) {
          apiSuccess = true;
        }
      } catch (apiErr) {
        console.warn("Server delete API notice:", apiErr);
      }

      // 2. Client-side database safeDelete cleanup as verification
      try {
        await database.safeDelete(doc(db, 'users', staffUid), {
          hotelId,
          module: 'Staff Security',
          action: 'STAFF_DELETED',
          details: `Permanently removed staff member ${staffEmail}`
        });
      } catch (delErr) {
        if (!apiSuccess) throw delErr;
      }

      toast.dismiss();
      toast.success(`Staff member ${staffEmail} and all associated records permanently purged.`);
      setShowConfirmRemove(null);
    } catch (err: any) {
      toast.dismiss();
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
                <option value="password_reset_pending">Password Reset Pending Only</option>
                <option value="suspended">Suspended Only</option>
                <option value="disabled">Disabled Only</option>
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
                            ) : member.status === 'password_reset_pending' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                <KeyRound size={11} />
                                Password Reset Pending
                              </span>
                            ) : member.status === 'suspended' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                                <UserX size={11} />
                                Suspended
                              </span>
                            ) : member.status === 'disabled' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-400 border border-zinc-700">
                                <XCircle size={11} />
                                Disabled
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                <CheckCircle2 size={11} />
                                Active
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {/* Manage Modules Button */}
                              <button
                                onClick={() => {
                                  setEditingPermissions(member);
                                  setEditingPermsList((member.permissions || member.roles || []) as string[]);
                                }}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-emerald-500/20 text-zinc-200 hover:text-emerald-300 text-xs font-semibold border border-zinc-700/60 transition-all shadow-sm"
                                title="Manage assigned modules and granular permissions for this staff member"
                              >
                                <Shield size={13} className="text-emerald-400" />
                                <span>Manage Modules</span>
                                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                                  {member.permissions?.length || member.roles?.length || 0}
                                </span>
                              </button>

                              {/* Instantly Mark Active & Verified */}
                              {member.status === 'pending_activation' && canResetPasswords && (
                                <button
                                  onClick={() => handleDirectActivate(member)}
                                  className="p-1.5 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                                  title="Instantly Mark Active & Verified"
                                >
                                  <CheckCircle2 size={16} />
                                </button>
                              )}

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

          {customRoles.length === 0 ? (
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-8 text-center max-w-lg mx-auto space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/20">
                <Shield size={24} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-zinc-100">No Custom Roles Configured Yet</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Custom roles allow you to bundle specific PMS modules (Front Desk, Rooms, Housekeeping, F&B, Finance, Night Audit) into reusable role templates for your staff.
                </p>
              </div>
              <button
                onClick={() => setIsCreatingRole(true)}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all shadow-lg shadow-emerald-500/20"
              >
                <Plus size={15} />
                Create First Custom Role
              </button>
            </div>
          ) : (
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
          )}
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

              {/* Role Selection & Module Assignment */}
              <div className="p-4 bg-zinc-950/70 rounded-xl border border-zinc-800 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-zinc-200 flex items-center gap-1.5">
                      <Shield size={14} className="text-emerald-400" />
                      Assign Role & Operational Modules *
                    </label>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Select a role preset and toggle the exact PMS modules this staff member can access.
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 size={12} />
                    <span>{newStaff.overrides.length} Capabilities Assigned</span>
                  </div>
                </div>

                {/* Preset Role Selector */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-300">Role Preset:</span>
                    <div className="flex items-center gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => {
                          const allIds = AVAILABLE_PERMISSIONS.map(p => p.id);
                          setNewStaff({ ...newStaff, overrides: allIds, roleType: 'custom' });
                        }}
                        className="text-emerald-400 hover:text-emerald-300 hover:underline"
                      >
                        Select All Modules
                      </button>
                      <span className="text-zinc-600">|</span>
                      <button
                        type="button"
                        onClick={() => {
                          const perms = newStaff.roleType === 'custom' && newStaff.customRoleId
                            ? (customRoles.find(r => r.id === newStaff.customRoleId)?.permissions || [])
                            : (BASE_ROLE_PERMISSIONS[newStaff.baseRole] || []);
                          setNewStaff({ ...newStaff, overrides: perms as string[] });
                        }}
                        className="text-zinc-400 hover:text-zinc-200 hover:underline"
                      >
                        Reset Defaults
                      </button>
                      <span className="text-zinc-600">|</span>
                      <button
                        type="button"
                        onClick={() => setNewStaff({ ...newStaff, overrides: [] })}
                        className="text-red-400 hover:text-red-300 hover:underline"
                      >
                        Clear All
                      </button>
                    </div>
                  </div>

                  <select
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 focus:border-emerald-500 outline-none"
                    value={newStaff.roleType === 'custom' && newStaff.customRoleId ? `custom_${newStaff.customRoleId}` : newStaff.baseRole}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.startsWith('custom_')) {
                        const customId = val.replace('custom_', '');
                        const r = customRoles.find(cr => cr.id === customId);
                        setNewStaff({
                          ...newStaff,
                          roleType: 'custom',
                          customRoleId: customId,
                          overrides: (r?.permissions || []) as string[]
                        });
                      } else {
                        const role = val as StaffRole;
                        const perms = BASE_ROLE_PERMISSIONS[role] || [];
                        setNewStaff({
                          ...newStaff,
                          roleType: 'base',
                          baseRole: role,
                          customRoleId: '',
                          overrides: perms as string[]
                        });
                      }
                    }}
                  >
                    <optgroup label="Standard System Roles">
                      {BASE_ROLES.map(role => (
                        <option key={role.id} value={role.id}>{role.label}</option>
                      ))}
                    </optgroup>
                    {customRoles.length > 0 && (
                      <optgroup label="Property Custom Roles">
                        {customRoles.map(cr => (
                          <option key={cr.id} value={`custom_${cr.id}`}>{cr.name} ({cr.permissions?.length || 0} perms)</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                {/* Module Assignment Matrix (Interactive & Always Visible) */}
                <div className="pt-2 border-t border-zinc-800/80">
                  <div className="mb-2">
                    <span className="text-xs font-semibold text-zinc-300 block">Assigned Modules & Granular Capabilities:</span>
                    <span className="text-[11px] text-zinc-500">Toggle any module on or off for this staff member before creating their account.</span>
                  </div>
                  <div className="max-h-64 overflow-y-auto pr-1 border border-zinc-800/80 rounded-xl p-2 bg-zinc-950/40">
                    <ModuleAssignmentMatrix
                      selectedPermissions={newStaff.overrides}
                      onChange={(perms) => setNewStaff({ ...newStaff, overrides: perms })}
                      customRoles={customRoles}
                      selectedRoleId={newStaff.customRoleId}
                      onSelectRoleId={(roleId) => setNewStaff({ ...newStaff, customRoleId: roleId })}
                      allowSaveAsRole={true}
                      saveAsRole={newStaff.saveAsRole}
                      onSaveAsRoleChange={(val) => setNewStaff({ ...newStaff, saveAsRole: val })}
                      roleName={newStaff.customRoleName}
                      onRoleNameChange={(val) => setNewStaff({ ...newStaff, customRoleName: val })}
                      roleDescription={newStaff.customRoleDescription}
                      onRoleDescriptionChange={(val) => setNewStaff({ ...newStaff, customRoleDescription: val })}
                    />
                  </div>
                </div>
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
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col space-y-4">
            <div className="flex items-start justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-zinc-50 flex items-center gap-2">
                  <Shield className="text-emerald-400" size={18} />
                  <span>Module Access & Permissions</span>
                </h3>
                <p className="text-zinc-400 text-xs mt-0.5">
                  Configure modules and granular capabilities for <strong className="text-zinc-200">{editingPermissions.displayName || editingPermissions.email}</strong>
                </p>
              </div>
              <button
                onClick={() => setEditingPermissions(null)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                <XCircle size={18} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-1">
              <ModuleAssignmentMatrix
                selectedPermissions={editingPermsList}
                onChange={(perms) => setEditingPermsList(perms)}
                customRoles={customRoles}
                selectedRoleId={editingPermissions.customRoleId}
                onSelectRoleId={(roleId) => {
                  const r = customRoles.find(cr => cr.id === roleId);
                  if (r) {
                    setEditingPermsList(r.permissions || []);
                  }
                }}
                allowSaveAsRole={false}
              />
            </div>

            <div className="pt-3 border-t border-zinc-800 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setEditingPermissions(null)}
                className="px-4 py-2 rounded-xl border border-zinc-800 text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button 
                type="button"
                disabled={isSavingOverrides}
                onClick={async () => {
                  if (!hotelId || !editingPermissions) return;
                  setIsSavingOverrides(true);
                  try {
                    await database.safeUpdate(doc(db, 'users', editingPermissions.uid), {
                      roles: editingPermsList,
                      permissions: editingPermsList,
                      updatedAt: new Date().toISOString()
                    }, {
                      hotelId,
                      module: 'Staff Security',
                      action: 'OVERRIDE_PERMISSIONS',
                      details: `Updated assigned modules and permissions (${editingPermsList.length} permissions) for ${editingPermissions.email}`
                    });

                    toast.success('Module access and permissions successfully updated');
                    setEditingPermissions(null);
                  } catch (err: any) {
                    toast.error('Failed to update: ' + err.message);
                  } finally {
                    setIsSavingOverrides(false);
                  }
                }}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-5 py-2 rounded-xl text-xs transition-colors disabled:opacity-50"
              >
                {isSavingOverrides ? 'Saving...' : 'Save Permissions'}
              </button>
            </div>
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
