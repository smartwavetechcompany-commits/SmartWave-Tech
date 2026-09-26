import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Permission, hasPermission, isPMSModuleAssigned } from '../utils/permissions';
import { ShieldCheck } from 'lucide-react';

interface PermissionGuardProps {
  permission: Permission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  showError?: boolean;
}

/**
 * PRODUCTION-GRADE PERMISSION GUARD
 * Protects components or entire modules based on database-driven capabilities.
 * Synchronizes instantly across sessions when custom roles or permissions change.
 */
export const PermissionGuard: React.FC<PermissionGuardProps> = ({ 
  permission, 
  children, 
  fallback = null,
  showError = false
}) => {
  const { profile, customRoles } = useAuth();
  
  const hasAccess = hasPermission(profile, permission, customRoles);

  if (!hasAccess) {
    if (showError) {
      return (
        <div className="p-12 text-center flex flex-col items-center justify-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
            <ShieldCheck size={32} />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-zinc-50">Access Restricted</h2>
            <p className="text-sm text-zinc-400">You do not have permission to access this module ({permission}).</p>
          </div>
        </div>
      );
    }
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

/**
 * Centralized hook to check a user's assigned modules based on database-driven roles and permissions.
 */
export const useModuleAccess = () => {
  const { profile, customRoles } = useAuth();

  const canAccessModule = (capability: Permission | null): boolean => {
    if (!capability) return true;
    return hasPermission(profile, capability, customRoles);
  };

  const canAccessPMSModule = (moduleId: string): boolean => {
    return isPMSModuleAssigned(profile, moduleId, customRoles);
  };

  return {
    canAccessModule,
    canAccessPMSModule,
    hasPermission: (perm: Permission) => hasPermission(profile, perm, customRoles),
    profile,
    customRoles
  };
};
