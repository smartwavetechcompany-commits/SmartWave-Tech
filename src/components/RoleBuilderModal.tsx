import React, { useState } from 'react';
import { CustomRole, StaffRole } from '../types';
import { Permission, PERMISSION_GROUPS, SYSTEM_ROLE_TEMPLATES, BASE_ROLE_PERMISSIONS } from '../utils/permissions';
import { database } from '../utils/database';
import { useAuth } from '../contexts/AuthContext';
import { doc } from 'firebase/firestore';
import { db } from '../firebase';
import { 
  Shield, 
  Check, 
  X, 
  Plus, 
  Sparkles, 
  CheckSquare, 
  Square, 
  Layers, 
  HelpCircle,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  role?: CustomRole | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function RoleBuilderModal({ role, onClose, onSuccess }: Props) {
  const { profile, hotel } = useAuth();
  const hotelId = profile?.hotelId || hotel?.id;

  const [name, setName] = useState(role?.name || '');
  const [description, setDescription] = useState(role?.description || '');
  const [inheritsFrom, setInheritsFrom] = useState<StaffRole | ''>(role?.inheritsFrom || '');
  const [selectedPermissions, setSelectedPermissions] = useState<Permission[]>((role?.permissions as Permission[]) || []);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Apply template inheritance
  const handleInheritChange = (baseRole: StaffRole | '') => {
    setInheritsFrom(baseRole);
    if (baseRole) {
      const templatePerms = SYSTEM_ROLE_TEMPLATES[baseRole]?.permissions || BASE_ROLE_PERMISSIONS[baseRole] || [];
      const merged = Array.from(new Set([...selectedPermissions, ...templatePerms])) as Permission[];
      setSelectedPermissions(merged);
      toast.info(`Applied base permissions from ${baseRole}`);
    }
  };

  const togglePermission = (perm: Permission) => {
    if (selectedPermissions.includes(perm)) {
      setSelectedPermissions(selectedPermissions.filter(p => p !== perm));
    } else {
      setSelectedPermissions([...selectedPermissions, perm]);
    }
  };

  const toggleGroupAll = (permissions: Permission[]) => {
    const allSelected = permissions.every(p => selectedPermissions.includes(p));
    if (allSelected) {
      setSelectedPermissions(selectedPermissions.filter(p => !permissions.includes(p)));
    } else {
      const union = Array.from(new Set([...selectedPermissions, ...permissions]));
      setSelectedPermissions(union);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Role name is required');
      return;
    }
    if (!hotelId || hotelId === 'system') {
      toast.error('Valid hotel context required to save role');
      return;
    }

    setIsSubmitting(true);
    try {
      const roleId = role?.id || `role_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const roleRef = doc(db, 'hotels', hotelId, 'customRoles', roleId);

      const customRoleData: CustomRole = {
        id: roleId,
        hotelId,
        name: name.trim(),
        description: description.trim(),
        permissions: selectedPermissions,
        inheritsFrom: inheritsFrom ? (inheritsFrom as StaffRole) : undefined,
        isSystem: false,
        status: 'active',
        createdAt: role?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: role?.createdBy || profile?.email || 'admin'
      };

      await database.safeSet(roleRef, customRoleData, {
        hotelId,
        module: 'RBAC',
        action: role ? 'UPDATE_CUSTOM_ROLE' : 'CREATE_CUSTOM_ROLE',
        details: `${role ? 'Updated' : 'Created'} role '${customRoleData.name}' with ${selectedPermissions.length} permissions.`
      });

      toast.success(`Role '${customRoleData.name}' saved and live-synced across PMS`);
      onSuccess?.();
      onClose();
    } catch (err: any) {
      console.error('Save role error:', err);
      toast.error('Failed to save role: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-zinc-950/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-3xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 my-6 max-h-[90vh] flex flex-col">
        
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-emerald-950/30 via-zinc-900 to-zinc-900 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <Shield size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-100">
                {role ? 'Edit Custom Role' : 'Create Custom Role & Permissions'}
              </h2>
              <p className="text-xs text-zinc-400">
                Configure database-driven role capabilities. Changes synchronize instantly.
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* General info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Role Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Night Auditor, Front Desk Lead"
                required
                className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Inherit Base Role Template (Optional)
              </label>
              <select
                value={inheritsFrom}
                onChange={(e) => handleInheritChange(e.target.value as any)}
                className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 transition-colors"
              >
                <option value="">-- No base template (Manual configuration) --</option>
                <option value="frontDesk">Front Desk (Guest Check-in/Out, Rooms)</option>
                <option value="housekeeper">Housekeeping (Room statuses, Turndown)</option>
                <option value="maintenance">Maintenance (Repairs, Inspections)</option>
                <option value="accountant">Accountant (Ledgers, Payments, Financials)</option>
                <option value="manager">Manager (Staff oversight, Rate management)</option>
                <option value="hotelAdmin">Hotel Admin (Full property administrative access)</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Role Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of responsibilities and permissions"
                className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>

          {/* Granular Permission Checklist */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                  Granular Permissions Matrix
                </h3>
                <p className="text-[11px] text-zinc-500">
                  {selectedPermissions.length} capabilities selected
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedPermissions([])}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Clear All
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {PERMISSION_GROUPS.map((group) => {
                const groupPerms = group.permissions.map(p => p.id);
                const allSelected = groupPerms.every(p => selectedPermissions.includes(p));
                const someSelected = groupPerms.some(p => selectedPermissions.includes(p));

                return (
                  <div 
                    key={group.id}
                    className="p-4 bg-zinc-950/60 rounded-xl border border-zinc-800/80 space-y-3"
                  >
                    <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2.5">
                      <div>
                        <span className="text-xs font-bold text-zinc-200">
                          {group.label}
                        </span>
                        <span className="text-[11px] text-zinc-500 block">
                          {group.description}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleGroupAll(groupPerms)}
                        className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1"
                      >
                        {allSelected ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {group.permissions.map((perm) => {
                        const isChecked = selectedPermissions.includes(perm.id);
                        return (
                          <label
                            key={perm.id}
                            className={`flex items-start gap-2.5 p-2 rounded-lg cursor-pointer transition-colors ${
                              isChecked ? 'bg-emerald-500/10 border border-emerald-500/30' : 'hover:bg-zinc-900 border border-transparent'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => togglePermission(perm.id)}
                              className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500"
                            />
                            <div className="text-xs">
                              <span className={`font-medium block ${isChecked ? 'text-emerald-300' : 'text-zinc-300'}`}>
                                {perm.label}
                              </span>
                              <span className="text-[11px] text-zinc-500 block">
                                {perm.description}
                              </span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between shrink-0">
          <div className="text-xs text-zinc-500 flex items-center gap-1.5">
            <Sparkles size={14} className="text-emerald-400" />
            <span>Changes propagate in real-time across all connected staff devices.</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 text-zinc-950 font-bold rounded-xl text-xs transition-colors flex items-center gap-2 shadow-lg shadow-emerald-500/20"
            >
              {isSubmitting ? (
                <div className="w-4 h-4 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
              ) : (
                role ? 'Update Role' : 'Save & Publish Role'
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
