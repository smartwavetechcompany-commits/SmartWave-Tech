import React, { useState } from 'react';
import { 
  CheckCircle2, 
  Copy, 
  Check, 
  Printer, 
  ShieldCheck, 
  User, 
  Lock, 
  Building2, 
  Calendar, 
  X,
  FileText,
  MailCheck,
  Clock,
  Send
} from 'lucide-react';
import { toast } from 'sonner';
import { createAuditLog } from '../utils/database';
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
  activationLink?: string;
  activationExpiresAt?: string;
  emailDispatched?: boolean;
  temporaryPassword?: string;
  forcePasswordChange?: boolean;
  status: 'active' | 'pending_activation' | 'suspended';
  createdAt: string;
  createdBy: string;
}

interface Props {
  data: UserSummaryData;
  onClose: () => void;
  onResendActivation?: () => void;
}

export function AccountCreationSummaryModal({ data, onClose, onResendActivation }: Props) {
  const { profile } = useAuth();
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

  const copyActivationInstructions = () => {
    const text = [
      `HOTEL PMS ACCOUNT ACTIVATION INVITATION`,
      `=======================================`,
      `Property: ${data.hotelName}`,
      `Staff Member: ${data.fullName}`,
      `Registered Email: ${data.email}`,
      `Assigned Role: ${data.roleName}`,
      `Account Status: Pending Activation`,
      `=======================================`,
      `ACTIVATION LINK (Expires in 24 Hours):`,
      `${data.activationLink || 'Check your registered email inbox for the link.'}`,
      `=======================================`,
      `SECURITY NOTICE:`,
      `Default passwords are not issued. You must create your own personal`,
      `password using the secure activation link above before signing in.`
    ].join('\n');

    copyToClipboard(text, 'Activation instructions', 'activation_instructions');
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
      `SECURITY & ACTIVATION:`,
      `Account Status: ${data.status.toUpperCase()}`,
      `Activation Link: ${data.activationLink || 'Sent via email'}`,
      `Link Valid Until: ${data.activationExpiresAt ? new Date(data.activationExpiresAt).toLocaleString() : '24 Hours'}`,
      `Default Password: NONE (Staff creates their own password)`,
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
              <h2 className="text-lg font-bold text-zinc-100">
                {data.emailDispatched ? 'Staff Account Created & Activation Sent' : 'Staff Account Created'}
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5 flex items-center gap-1.5">
                Account provisioned in <span className="text-amber-400 font-medium">Pending Activation</span> status.
                {data.emailDispatched ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    <CheckCircle2 size={10} />
                    Activation Sent
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    <Clock size={10} />
                    Link Ready
                  </span>
                )}
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

        {/* Security & Compliance Banner */}
        <div className="mx-6 mt-4 p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-3 text-xs text-emerald-300">
          <ShieldCheck size={18} className="text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1 leading-relaxed">
            <strong className="font-semibold block text-emerald-300">
              Security Protocol Enforced (No Default Passwords)
            </strong>
            <p className="text-emerald-200/90">
              In accordance with hotel security standards, default passwords are not generated or assigned. An activation email with a secure, one-time link has been dispatched to <strong>{data.email}</strong>. The staff member will create their own password to activate their account.
            </p>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Section 1: User Profile */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-2">
              <User size={14} className="text-emerald-400" />
              Staff Profile Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-zinc-950/60 p-4 rounded-xl border border-zinc-800/80 text-xs">
              <div>
                <span className="text-zinc-500 block">Full Name</span>
                <span className="font-medium text-zinc-200 text-sm">{data.fullName}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Registered Email</span>
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

          {/* Section 2: Activation & Onboarding */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-2">
              <MailCheck size={14} className="text-amber-400" />
              Account Activation Status
            </h3>
            <div className="bg-zinc-950/60 p-4 rounded-xl border border-zinc-800/80 space-y-3.5 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-zinc-500 block">Current Account Status</span>
                  <span className="inline-flex items-center gap-1.5 font-bold text-amber-400 mt-0.5">
                    <Clock size={13} className="text-amber-400" />
                    Pending Activation
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-zinc-500 block">Activation Link Expiry</span>
                  <span className="font-mono text-zinc-300">
                    {data.activationExpiresAt ? new Date(data.activationExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '24 Hours from creation'}
                  </span>
                </div>
              </div>

              {/* Direct Activation Link Display */}
              {data.activationLink && (
                <div className="pt-3 border-t border-zinc-800/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400 font-semibold flex items-center gap-1.5">
                      <Lock size={12} className="text-emerald-400" />
                      One-Time Activation URL (Single-Use):
                    </span>
                    <button
                      onClick={() => copyToClipboard(data.activationLink!, 'Activation URL', 'activation_url')}
                      className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-semibold flex items-center gap-1.5 transition-colors"
                    >
                      {copiedKey === 'activation_url' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      Copy Link
                    </button>
                  </div>
                  <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 font-mono text-[11px] break-all select-all">
                    {data.activationLink}
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-zinc-800/80 text-[11px] text-zinc-400 flex items-center justify-between">
                <span>The staff member must click this link to establish their password before accessing the PMS.</span>
                {onResendActivation && (
                  <button
                    type="button"
                    onClick={onResendActivation}
                    className="ml-2 text-emerald-400 hover:text-emerald-300 font-semibold inline-flex items-center gap-1 shrink-0"
                  >
                    <Send size={11} />
                    Resend Email
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Section 3: Audit Metadata */}
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
              onClick={copyActivationInstructions}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              {copiedKey === 'activation_instructions' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              Copy Activation Instructions
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
