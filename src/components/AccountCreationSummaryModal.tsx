import React, { useState } from 'react';
import { 
  CheckCircle2, 
  Copy, 
  Check, 
  Printer, 
  Eye, 
  EyeOff, 
  ShieldAlert, 
  User, 
  Lock, 
  Building2, 
  Calendar, 
  X,
  FileText
} from 'lucide-react';
import { toast } from 'sonner';
import { database, createAuditLog } from '../utils/database';
import { useAuth } from '../contexts/AuthContext';

export interface UserSummaryData {
  uid: string;
  fullName: string;
  username: string;
  email: string;
  phoneNumber?: string;
  department?: string;
  hotelName: string;
  hotelId: string;
  roleName: string;
  roleId: string;
  employeeId?: string;
  temporaryPassword?: string;
  forcePasswordChange: boolean;
  status: 'active' | 'inactive' | 'suspended';
  createdAt: string;
  createdBy: string;
}

interface Props {
  data: UserSummaryData;
  onClose: () => void;
}

export function AccountCreationSummaryModal({ data, onClose }: Props) {
  const { profile } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const logSecurityAction = async (action: string, details: string) => {
    try {
      await createAuditLog(
        data.hotelId || 'system',
        'Staff Security',
        action,
        details,
        'success',
        {
          targetUserId: data.uid,
          targetEmail: data.email,
          timestamp: new Date().toISOString()
        },
        {
          uid: profile?.uid,
          email: profile?.email,
          role: profile?.role,
          displayName: profile?.displayName
        }
      );
    } catch (err) {
      console.warn('Audit logging notice:', err);
    }
  };

  const copyToClipboard = async (text: string, label: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success(`${label} copied to clipboard`);
      setTimeout(() => setCopiedKey(null), 2500);
      logSecurityAction('CREDENTIAL_COPIED', `Copied ${label} for user ${data.email}`);
    } catch (err) {
      toast.error('Failed to copy to clipboard');
    }
  };

  const copyLoginCredentials = () => {
    const text = [
      `PMS LOGIN CREDENTIALS`,
      `====================`,
      `Property: ${data.hotelName}`,
      `Username: ${data.username || data.email}`,
      `Temporary Password: ${data.temporaryPassword || 'N/A'}`,
      `Must Change Password on First Login: ${data.forcePasswordChange ? 'YES' : 'NO'}`,
      `====================`,
      `Security Warning: This password is provided once. Do not share.`
    ].join('\n');

    copyToClipboard(text, 'Login credentials', 'login_credentials');
  };

  const copyFullDetails = () => {
    const text = [
      `PMS STAFF ACCOUNT SUMMARY`,
      `=========================`,
      `USER INFORMATION:`,
      `Full Name: ${data.fullName}`,
      `Email: ${data.email}`,
      `Username: ${data.username || data.email}`,
      `Phone Number: ${data.phoneNumber || 'Not specified'}`,
      `Department: ${data.department || 'General'}`,
      `Employee ID: ${data.employeeId || 'N/A'}`,
      `Assigned Hotel: ${data.hotelName}`,
      `Assigned Role: ${data.roleName}`,
      ``,
      `LOGIN INFORMATION:`,
      `Temporary Password: ${data.temporaryPassword || 'N/A'}`,
      `Force Password Change: ${data.forcePasswordChange ? 'Enabled' : 'Disabled'}`,
      `Account Status: ${data.status.toUpperCase()}`,
      ``,
      `SYSTEM AUDIT:`,
      `Created Date: ${new Date(data.createdAt).toLocaleString()}`,
      `Created By: ${data.createdBy}`,
      `User ID: ${data.uid}`,
      `Role ID: ${data.roleId}`,
      `=========================`
    ].join('\n');

    copyToClipboard(text, 'Full user details', 'full_details');
  };

  const handlePrint = () => {
    logSecurityAction('USER_DETAILS_PRINTED', `Printed account handover slip for user ${data.email}`);
    window.print();
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-zinc-950/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl bg-zinc-900 border border-emerald-500/30 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 my-8">
        
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-emerald-950/40 via-zinc-900 to-zinc-900 border-b border-zinc-800 flex items-start justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-zinc-100">Account Created Successfully</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Staff profile provisioned. Credentials will only be visible in this overlay.
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Security Caution Notice */}
        <div className="mx-6 mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3 text-xs text-amber-200">
          <ShieldAlert size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <strong className="font-semibold block text-amber-300 mb-0.5">Enterprise Security Protocol Active</strong>
            No automated email, SMS, or notification has been sent. Securely copy or print these credentials to deliver directly to the staff member. The password will not be retrievable once closed.
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Section 1: User Information */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-2">
              <User size={14} className="text-emerald-400" />
              User Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-zinc-950/60 p-4 rounded-xl border border-zinc-800/80 text-xs">
              <div>
                <span className="text-zinc-500 block">Full Name</span>
                <span className="font-medium text-zinc-200 text-sm">{data.fullName}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Email / Username</span>
                <span className="font-mono text-zinc-200">{data.email}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Phone Number</span>
                <span className="text-zinc-300">{data.phoneNumber || 'Not provided'}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Department</span>
                <span className="text-zinc-300">{data.department || 'General'}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Assigned Property</span>
                <span className="text-zinc-300 flex items-center gap-1">
                  <Building2 size={12} className="text-zinc-500" />
                  {data.hotelName}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">Assigned Role</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {data.roleName}
                </span>
              </div>
              {data.employeeId && (
                <div>
                  <span className="text-zinc-500 block">Employee ID</span>
                  <span className="font-mono text-zinc-300">{data.employeeId}</span>
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Login Information */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-2">
              <Lock size={14} className="text-amber-400" />
              Login Information
            </h3>
            <div className="bg-zinc-950/60 p-4 rounded-xl border border-zinc-800/80 space-y-3.5 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-zinc-500 block">Username</span>
                  <span className="font-mono font-medium text-zinc-200">{data.username || data.email}</span>
                </div>
                <button
                  onClick={() => copyToClipboard(data.username || data.email, 'Username', 'username')}
                  className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs flex items-center gap-1.5 transition-colors"
                >
                  {copiedKey === 'username' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  Copy Username
                </button>
              </div>

              {data.temporaryPassword && (
                <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between">
                  <div>
                    <span className="text-zinc-500 block">Temporary Password</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="font-mono font-bold text-amber-400 text-sm tracking-wider">
                        {showPassword ? data.temporaryPassword : '••••••••••••'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="text-zinc-500 hover:text-zinc-300"
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => copyToClipboard(data.temporaryPassword!, 'Temporary password', 'password')}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs flex items-center gap-1.5 transition-colors"
                  >
                    {copiedKey === 'password' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    Copy Password
                  </button>
                </div>
              )}

              <div className="pt-3 border-t border-zinc-800/80 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-zinc-500 block">Force Password Change</span>
                  <span className={`font-semibold ${data.forcePasswordChange ? 'text-emerald-400' : 'text-zinc-400'}`}>
                    {data.forcePasswordChange ? 'Yes (Mandatory on First Login)' : 'No'}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 block">Initial Account Status</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    Active
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: System Information */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-2">
              <Calendar size={14} className="text-blue-400" />
              System Audit Metadata
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-950/40 p-3 rounded-xl border border-zinc-800/60 text-[11px] text-zinc-400">
              <div>
                <span className="text-zinc-500 block">Date Created</span>
                <span>{new Date(data.createdAt).toLocaleDateString()}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Created By</span>
                <span className="truncate block" title={data.createdBy}>{data.createdBy}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">User UID</span>
                <span className="font-mono truncate block" title={data.uid}>{data.uid.substring(0, 8)}...</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Role ID</span>
                <span className="font-mono truncate block" title={data.roleId}>{data.roleId}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={copyLoginCredentials}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              {copiedKey === 'login_credentials' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              Copy Credentials
            </button>
            <button
              onClick={copyFullDetails}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              {copiedKey === 'full_details' ? <Check size={14} className="text-emerald-400" /> : <FileText size={14} />}
              Copy Full Details
            </button>
            <button
              onClick={handlePrint}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Printer size={14} />
              Print Slip
            </button>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-xl text-xs transition-colors shadow-lg shadow-emerald-500/20"
          >
            Done & Close
          </button>
        </div>

      </div>
    </div>
  );
}
