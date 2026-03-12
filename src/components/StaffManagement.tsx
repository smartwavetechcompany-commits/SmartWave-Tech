import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, doc, setDoc, deleteDoc, addDoc } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { UserProfile, StaffRole, OperationType } from '../types';
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
  ChevronRight
} from 'lucide-react';
import { cn } from '../utils';

const AVAILABLE_PERMISSIONS = [
  { id: 'frontDesk', label: 'Front Desk' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'housekeeping', label: 'Housekeeping' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'finance', label: 'Finance' },
  { id: 'reports', label: 'Reports' },
  { id: 'staff', label: 'Staff Management' },
  { id: 'settings', label: 'Settings' },
];

export function StaffManagement({ hotelId: propHotelId }: { hotelId?: string }) {
  const { hotel: authHotel, profile } = useAuth();
  const hotelId = propHotelId || authHotel?.id;
  const [staff, setStaff] = useState<UserProfile[]>([]);
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [editingPermissions, setEditingPermissions] = useState<UserProfile | null>(null);
  const [newStaff, setNewStaff] = useState({
    email: '',
    displayName: '',
    role: 'staff' as const,
    staffRole: 'frontDesk' as StaffRole,
  });

  const [hasPermissionError, setHasPermissionError] = useState(false);

  useEffect(() => {
    setHasPermissionError(false);
  }, [profile?.uid, hotelId]);

  useEffect(() => {
    if (!hotelId || !profile || hasPermissionError) return;
    
    const q = query(collection(db, 'users'), where('hotelId', '==', hotelId));
    
    const unsubscribe = onSnapshot(q, 
      (snap) => {
        setStaff(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
      }, 
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'users');
        if (err.code === 'permission-denied') {
          setHasPermissionError(true);
        }
      }
    );

    return () => unsubscribe();
  }, [hotelId, profile?.uid, hasPermissionError]);

  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  const addStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotelId) return;

    const tempUid = `staff_${Math.random().toString(36).substr(2, 9)}`;
    const staffProfile: UserProfile = {
      uid: tempUid,
      email: newStaff.email,
      hotelId: hotelId,
      role: 'staff',
      staffRole: newStaff.staffRole,
      permissions: [newStaff.staffRole],
      status: 'active',
      displayName: newStaff.displayName,
    };

    try {
      await setDoc(doc(db, 'users', tempUid), staffProfile);
      
      // Log the action
      await addDoc(collection(db, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid,
        userEmail: profile?.email,
        action: 'CREATE_STAFF',
        resource: `Staff: ${newStaff.email} (${newStaff.staffRole})`,
        hotelId: hotelId
      });

      setIsAddingStaff(false);
      setNewStaff({ email: '', displayName: '', role: 'staff', staffRole: 'frontDesk' });
      showNotification('Staff member added successfully');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, `users/${tempUid}`);
    }
  };

  const removeStaff = async (staffUid: string, staffEmail: string) => {
    if (!hotelId) return;

    setConfirmAction({
      title: 'Remove Staff',
      message: `Are you sure you want to remove ${staffEmail}?`,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'users', staffUid));
          
          // Log the action
          await addDoc(collection(db, 'activityLogs'), {
            timestamp: new Date().toISOString(),
            userId: profile?.uid,
            userEmail: profile?.email,
            action: 'DELETE_STAFF',
            resource: `Staff: ${staffEmail}`,
            hotelId: hotelId
          });
          showNotification('Staff member removed');
          setConfirmAction(null);
        } catch (err: any) {
          handleFirestoreError(err, OperationType.DELETE, `users/${staffUid}`);
        }
      }
    });
  };

  const togglePermission = async (member: UserProfile, permissionId: string) => {
    if (!hotelId) return;
    
    const currentPermissions = member.permissions || [];
    const newPermissions = currentPermissions.includes(permissionId)
      ? currentPermissions.filter(p => p !== permissionId)
      : [...currentPermissions, permissionId];
      
    try {
      await setDoc(doc(db, 'users', member.uid), { permissions: newPermissions }, { merge: true });
      
      // Update local state for immediate feedback
      setEditingPermissions(prev => prev ? { ...prev, permissions: newPermissions } : null);
      
      // Log the action
      await addDoc(collection(db, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid,
        userEmail: profile?.email,
        action: 'UPDATE_STAFF_PERMISSIONS',
        resource: `Staff: ${member.email}, Permission: ${permissionId}`,
        hotelId: hotelId
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${member.uid}`);
    }
  };

  return (
    <div className="p-8 space-y-8 relative">
      {/* Notification Toast */}
      {notification && (
        <div className={cn(
          "fixed top-4 right-4 z-[100] px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300",
          notification.type === 'success' ? "bg-emerald-500 text-black" : "bg-red-500 text-white"
        )}>
          {notification.type === 'success' ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
          <span className="font-bold">{notification.message}</span>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-2">{confirmAction.title}</h3>
            <p className="text-zinc-400 text-sm mb-8 leading-relaxed">{confirmAction.message}</p>
            <div className="flex gap-4">
              <button 
                onClick={() => setConfirmAction(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white transition-all active:scale-95"
              >
                Cancel
              </button>
              <button 
                onClick={confirmAction.onConfirm}
                className="flex-1 bg-red-500 text-white font-bold py-2 rounded-lg hover:bg-red-400 transition-all active:scale-95"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Staff Management</h1>
          <p className="text-zinc-400">Manage your hotel's team and roles</p>
        </div>
        <button 
          onClick={() => setIsAddingStaff(true)}
          className="w-full sm:w-auto bg-emerald-500 text-black px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all active:scale-95"
        >
          <UserPlus size={18} />
          Add Staff Member
        </button>
      </header>

      {isAddingStaff && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-6">Add Staff Member</h3>
            <form onSubmit={addStaff} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Full Name</label>
                <input 
                  required
                  type="text" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={newStaff.displayName}
                  onChange={(e) => setNewStaff({ ...newStaff, displayName: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Email Address</label>
                <input 
                  required
                  type="email" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={newStaff.email}
                  onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Staff Role</label>
                <select 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={newStaff.staffRole}
                  onChange={(e) => setNewStaff({ ...newStaff, staffRole: e.target.value as StaffRole })}
                >
                  <option value="frontDesk">Front Desk</option>
                  <option value="housekeeping">Housekeeping</option>
                  <option value="kitchen">Kitchen</option>
                  <option value="it">IT Support</option>
                  <option value="management">Management</option>
                </select>
              </div>
              <div className="flex gap-4 mt-8">
                <button 
                  type="button"
                  onClick={() => setIsAddingStaff(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95"
                >
                  Add Member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="font-bold text-white">Team Members</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
            <input 
              type="text" 
              placeholder="Search staff..."
              className="bg-zinc-950 border border-zinc-800 rounded-lg pl-10 pr-4 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800">
                <th className="px-6 py-4">Member</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Permissions</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {staff.map(member => (
                <tr key={member.uid} className="hover:bg-zinc-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400">
                        <UserIcon size={20} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">{member.displayName || 'Unnamed Staff'}</div>
                        <div className="text-xs text-zinc-500 flex items-center gap-1">
                          <Mail size={12} />
                          {member.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <Shield size={14} className="text-emerald-500" />
                      <span className="capitalize">
                        {member.role === 'hotelAdmin' ? 'Hotel Admin' : (member.staffRole || 'Staff')}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {(member.permissions || []).slice(0, 2).map(p => (
                        <span key={p} className="px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded text-[10px] uppercase font-bold">
                          {p}
                        </span>
                      ))}
                      {(member.permissions || []).length > 2 && (
                        <span className="px-1.5 py-0.5 bg-zinc-800 text-zinc-500 rounded text-[10px] font-bold">
                          +{(member.permissions || []).length - 2}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                      member.status === 'active' ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                    )}>
                      {member.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => setEditingPermissions(member)}
                        className="p-2 text-zinc-500 hover:text-emerald-500 transition-colors"
                        title="Manage Permissions"
                      >
                        <Lock size={18} />
                      </button>
                      {member.role !== 'hotelAdmin' && (
                        <button 
                          onClick={() => removeStaff(member.uid, member.email)}
                          className="p-2 text-zinc-500 hover:text-red-500 transition-colors"
                          title="Remove Staff"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editingPermissions && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-2">Manage Permissions</h3>
            <p className="text-zinc-400 text-sm mb-6">Setting permissions for {editingPermissions.displayName || editingPermissions.email}</p>
            
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
              {AVAILABLE_PERMISSIONS.map(permission => {
                const isGranted = (editingPermissions.permissions || []).includes(permission.id);
                return (
                  <button
                    key={permission.id}
                    onClick={() => togglePermission(editingPermissions, permission.id)}
                    className={cn(
                      "w-full flex items-center justify-between p-3 rounded-xl border transition-all active:scale-[0.98]",
                      isGranted 
                        ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-500" 
                        : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                    )}
                  >
                    <span className="text-sm font-medium">{permission.label}</span>
                    {isGranted ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                  </button>
                );
              })}
            </div>

            <button 
              onClick={() => setEditingPermissions(null)}
              className="w-full mt-8 bg-emerald-500 text-black font-bold py-3 rounded-lg hover:bg-emerald-400 transition-all active:scale-95"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
