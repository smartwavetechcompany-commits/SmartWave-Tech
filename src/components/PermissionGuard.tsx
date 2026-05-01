
import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Permission, hasPermission } from '../utils/permissions';
import { ShieldCheck } from 'lucide-react';

interface PermissionGuardProps {
  permission: Permission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  showError?: boolean;
}

/**
 * PRODUCTION-GRADE PERMISSION GUARD
 * Protects components or entire modules based on user capabilities.
 */
export const PermissionGuard: React.FC<PermissionGuardProps> = ({ 
  permission, 
  children, 
  fallback = null,
  showError = false
}) => {
  const { profile } = useAuth();
  
  const hasAccess = hasPermission(profile?.role, permission);

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
