import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { database } from '../utils/database';
import { HotelSettings } from '../types';
import { DEFAULT_SETTINGS } from '../constants';
import { 
  ShieldCheck, 
  CreditCard, 
  Calendar, 
  Warehouse, 
  DollarSign, 
  UserCog, 
  Briefcase, 
  Activity, 
  Bell, 
  ShieldAlert, 
  FileText,
  Save,
  CheckCircle2,
  XCircle,
  Info,
  Clock,
  History,
  Lock,
  Smartphone,
  Eye,
  Trash2
} from 'lucide-react';
import { cn, safeStringify } from '../utils';
import { toast } from 'sonner';

import { useSettings } from '../hooks/useSettings';

const DEFAULT_SETTINGS_LOCAL = DEFAULT_SETTINGS;

export function AdminSettings() {
  const { hotel, profile } = useAuth();
  const [activeTab, setActiveTab ] = useState<keyof HotelSettings>('checkout');
  const { settings, setSettings } = useSettings();
  const [localSettings, setLocalSettings] = useState<HotelSettings>(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync with remote settings from real-time hook when no pending local edits
  useEffect(() => {
    if (!hasChanges) {
      setLocalSettings(settings);
    }
  }, [settings, hasChanges]);

  const saveSettings = async (updatedSettings: HotelSettings, group?: keyof HotelSettings, key? : string) => {
    if (!hotel?.id) return;
    setIsSaving(true);
    try {
      // Use Firestore dot notation to update nesting safely without overwriting other groups
      const updateData: any = {};
      if (group && key) {
        updateData[`settings.${group}.${key}`] = (updatedSettings[group] as any)[key];
      } else if (group) {
        updateData[`settings.${group}`] = updatedSettings[group];
      } else {
        updateData.settings = updatedSettings;
      }

      await database.safeUpdate(doc(db, 'hotels', hotel.id), updateData, {
        hotelId: hotel.id,
        module: 'Admin Settings',
        action: 'UPDATE_ADMIN_SETTINGS',
        details: `Updated hotel operational controls${group ? ` (${group})` : ''}`,
        metadata: {
          group,
          key,
          value: group && key ? (updatedSettings[group] as any)[key] : undefined
        }
      });
      setSettings(updatedSettings);
      toast.success('Settings updated in real-time');
      setHasChanges(false);
    } catch (err: any) {
      console.error("Save admin settings error:", err);
      toast.error('Failed to update settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggle = (group: keyof HotelSettings, key: string) => {
    const updated = {
      ...localSettings,
      [group]: {
        ...(localSettings[group] as any),
        [key]: !(localSettings[group] as any)[key]
      }
    };
    setLocalSettings(updated);
    saveSettings(updated, group, key);
  };

  const handleInputChange = (group: keyof HotelSettings, key: string, value: any) => {
    setLocalSettings((prev) => ({
      ...prev,
      [group]: {
        ...(prev[group] as any),
        [key]: value
      }
    }));
    setHasChanges(true); // Inputs wait for manual save or blur
  };

  const handleInputBlur = (group: keyof HotelSettings, key: string) => {
    if (hasChanges) {
      saveSettings(localSettings, group, key);
    }
  };

  const tabs: { id: keyof HotelSettings; label: string; icon: any; color: string }[] = [
    { id: 'checkout', label: 'Checkout', icon: CreditCard, color: 'text-emerald-500' },
    { id: 'reservations', label: 'Reservations', icon: Calendar, color: 'text-blue-500' },
    { id: 'roomBlocking', label: 'Room Blocking', icon: Warehouse, color: 'text-amber-500' },
    { id: 'checkIn', label: 'Check-In', icon: CheckCircle2, color: 'text-teal-500' },
    { id: 'financial', label: 'Financial', icon: DollarSign, color: 'text-emerald-600' },
    { id: 'payments', icon: CreditCard, label: 'Payments', color: 'text-purple-500' },
    { id: 'guests', label: 'Guest Management', icon: UserCog, color: 'text-orange-500' },
    { id: 'housekeeping', label: 'Housekeeping', icon: Warehouse, color: 'text-zinc-400' },
    { id: 'staff', label: 'Staff Perms', icon: Briefcase, color: 'text-indigo-500' },
    { id: 'auditLogs', label: 'Audit & Activity', icon: Activity, color: 'text-red-500' },
    { id: 'reporting', label: 'Reporting', icon: FileText, color: 'text-sky-500' },
    { id: 'notifications', label: 'Notifications', icon: Bell, color: 'text-yellow-500' },
    { id: 'security', label: 'Security', icon: ShieldCheck, color: 'text-rose-500' },
  ];

  const renderToggle = (group: keyof HotelSettings, key: string, label: string, description?: string) => {
    const isEnabled = (localSettings?.[group] as any)?.[key] ?? (DEFAULT_SETTINGS_LOCAL?.[group] as any)?.[key] ?? false;
    return (
      <div className="flex items-start justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-xl hover:bg-zinc-900/50 transition-colors">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-zinc-50">{label}</p>
          {description && <p className="text-xs text-zinc-500 max-w-md">{description}</p>}
        </div>
        <button
          onClick={() => handleToggle(group, key)}
          className={cn(
            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none",
            isEnabled ? "bg-emerald-500" : "bg-zinc-800"
          )}
        >
          <span
            className={cn(
              "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
              isEnabled ? "translate-x-6" : "translate-x-1"
            )}
          />
        </button>
      </div>
    );
  };

  const renderInput = (group: keyof HotelSettings, key: string, label: string, type: string = 'number', description?: string) => {
    const rawVal = (localSettings?.[group] as any)?.[key] ?? (DEFAULT_SETTINGS_LOCAL?.[group] as any)?.[key];
    return (
      <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-xl">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-zinc-50">{label}</p>
          {description && <p className="text-xs text-zinc-500">{description}</p>}
        </div>
        <input
          type={type}
          value={rawVal !== undefined && rawVal !== null ? rawVal : ''}
          onChange={(e) => handleInputChange(group, key, type === 'number' ? parseFloat(e.target.value) : e.target.value)}
          onBlur={() => handleInputBlur(group, key)}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-50 outline-none focus:border-emerald-500 w-24 text-right"
        />
      </div>
    );
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-zinc-50 tracking-tight flex items-center gap-3">
            <ShieldCheck className="text-emerald-500" />
            Admin Controls
          </h1>
          <p className="text-zinc-400">Configure operational rules and system-wide policies</p>
        </div>
        <button
          onClick={() => saveSettings(localSettings)}
          disabled={isSaving}
          className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-6 py-2 rounded-lg font-black flex items-center gap-2 hover:bg-emerald-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:scale-100"
        >
          <div className={cn("w-2 h-2 rounded-full", isSaving ? "bg-amber-500 animate-pulse" : "bg-emerald-500")} />
          {isSaving ? 'Syncing...' : 'Settings Auto-Saved'}
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        {/* Navigation */}
        <aside className="space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all group",
                activeTab === tab.id 
                  ? "bg-emerald-600/10 text-emerald-500 border border-emerald-500/20" 
                  : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-50 border border-transparent"
              )}
            >
              <tab.icon size={18} className={cn("transition-colors", activeTab === tab.id ? tab.color : "group-hover:text-zinc-400")} />
              {tab.label}
            </button>
          ))}
        </aside>

        {/* Content Area */}
        <main className="md:col-span-3 space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 min-h-[500px]">
            {activeTab === 'checkout' && (
              <div className="space-y-4">
                <header className="mb-6 flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/10 rounded-lg">
                    <CreditCard className="text-emerald-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-50">Checkout Rules</h3>
                    <p className="text-sm text-zinc-500">Control payment obligations and restrictions for exiting guests</p>
                  </div>
                </header>
                {renderToggle('checkout', 'allowBalanceOutstanding', 'Allow Checkout with Outstanding Balance', 'Permit guests to check out even if they still have unpaid charges.')}
                {renderToggle('checkout', 'preventOwingGuestCheckout', 'Strict Zero-Balance Checkout', 'Enforce settling all debts before the checkout process can complete.')}
                {renderToggle('checkout', 'requireApprovalForDebtCheckout', 'Require Approval for Debt Checkout', 'Manager code or approval required to proceed with outstanding balances.')}
                {renderToggle('checkout', 'autoMarkUnpaidAsDebt', 'Auto-mark Unpaid as Bad Debt', 'Automatically classify residual balances as uncollectible after checkout.')}
                {renderToggle('checkout', 'allowPartialPaymentCheckout', 'Allow Partial Payment Checkout', 'Enable guests to pay some but not all of the bill during checkout.')}
                {renderToggle('checkout', 'requireFullPaymentBeforeCheckout', 'Hard Pay-First Rule', 'Disable the checkout button until the ledger balance is zero.')}
                {renderToggle('checkout', 'allowPostpaidCheckout', 'Enable Postpaid Checkout', 'Special flag for contract guests or corporate accounts.')}
                {renderToggle('checkout', 'enableUnpaidWarningPopup', 'Unpaid Balance Alerts', 'Show a warning notification if checkout is attempted with a pending balance.')}
                {renderToggle('checkout', 'autoGenerateOutstandingInvoice', 'Auto-generate Outstanding Invoice', 'Automatically create and email an invoice for remaining debt.')}
                {renderInput('checkout', 'gracePeriod', 'Late Checkout Grace Period (Minutes)', 'number', 'The cushion period in minutes after standard checkout time before late fees apply (e.g. 15-30 minutes).')}
              </div>
            )}

            {activeTab === 'reservations' && (
              <div className="space-y-4">
                <header className="mb-6 flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Calendar className="text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-50">Booking Logic</h3>
                    <p className="text-sm text-zinc-500">Configure how reservations are edited, cancelled, and managed</p>
                  </div>
                </header>
                {renderToggle('reservations', 'allowEditing', 'Enable Reservation Editing', 'Allow staff to modify stay dates, room types, or guest info.')}
                {renderToggle('reservations', 'allowCancellation', 'Allow Cancellations', 'Staff can void pending or confirmed bookings.')}
                {renderToggle('reservations', 'allowConfirmation', 'Enable Confirmation Flow', 'Require manual confirmation for incoming pending reservations.')}
                {renderToggle('reservations', 'allowNoShow', 'No-Show Attribution', 'Allow marking reservations as missed/no-show.')}
                {renderToggle('reservations', 'preventOverbooking', 'Strict Inventory Lock', 'Prevent booking a room if it would exceed total capacity for that category.')}
                {renderToggle('reservations', 'allowDoubleBookingOverride', 'Double Booking Pass-through', 'Allow admins to intentionally overlap bookings on the same room.')}
                {renderToggle('reservations', 'requireApprovalForEdits', 'Edits Require Approval', 'Manager must approve changes to existing confirmed reservations.')}
                {renderToggle('reservations', 'autoReleaseNoShow', 'Auto-release No-shows', 'Automatically free up blocked inventory for missed arrivals.')}
                {renderInput('reservations', 'autoCancelUnpaidTimeMinutes', 'Unpaid Auto-cancel Buffer (Mins)', 'Time after which an unpaid reservation is automatically cancelled.')}
                {renderToggle('reservations', 'allowWalkIn', 'Allow Walk-in Bookings', 'Enable instant same-day bookings via the front desk.')}
              </div>
            )}

            {activeTab === 'roomBlocking' && (
              <div className="space-y-4">
                <header className="mb-6 flex items-center gap-3">
                  <div className="p-2 bg-amber-500/10 rounded-lg">
                    <Warehouse className="text-amber-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-50">Room Blocking Settings</h3>
                    <p className="text-sm text-zinc-500">Manage maintenance, cleaning, and unavailability logic</p>
                  </div>
                </header>
                {renderToggle('roomBlocking', 'allowBlocking', 'Global Room Blocking', 'Enable the utility to take rooms out of service.')}
                {renderToggle('roomBlocking', 'allowUnblocking', 'Enable Unblocking', 'Allow staff to return rooms to active inventory.')}
                {renderToggle('roomBlocking', 'allowRecurringBlocks', 'Enable Recurring Blocks', 'Support daily or weekly maintenance schedules for specific rooms.')}
                {renderToggle('roomBlocking', 'allowMaintenanceBlocks', 'Allow Maintenance Categorization', 'Explicitly mark blocked rooms for repair/maintenance.')}
                {renderToggle('roomBlocking', 'allowHousekeepingBlocks', 'Allow Cleaning Blocks', 'Temporary blocks for deep cleaning tasks.')}
                {renderToggle('roomBlocking', 'allowPartialDayBlocks', 'Partial-day Blocking', 'Support blocking rooms for specific hours only.')}
                {renderToggle('roomBlocking', 'requireReasonForBlock', 'Mandatory Block Reason', 'Require staff to select a category or provide a note before blocking.')}
                {renderToggle('roomBlocking', 'preventBookingBlocked', 'Hard-lock Blocked Rooms', 'Remove blocked rooms entirely from the availability search results.')}
                {renderToggle('roomBlocking', 'autoExpireTempBlocks', 'Auto-expire Temporary Blocks', 'Blocks with end dates automatically lift at the set time.')}
              </div>
            )}

            {activeTab === 'checkIn' && (
              <div className="space-y-4">
                <header className="mb-6 flex items-center gap-3">
                  <div className="p-2 bg-teal-500/10 rounded-lg">
                    <CheckCircle2 className="text-teal-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-50">Check-In Protocols</h3>
                    <p className="text-sm text-zinc-500">Rules for welcoming and registering guests</p>
                  </div>
                </header>
                {renderToggle('checkIn', 'allowEarlyCheckIn', 'Permit Early Check-In', 'Allow staff to check in guests before the default check-in time.')}
                {renderToggle('checkIn', 'requireRoomInspection', 'Room Clean Lock', 'Only allow check-in to rooms marked as "Clean".')}
                {renderToggle('checkIn', 'preventCheckInDirty', 'Strict Hygiene Check', 'Block check-in attempts to "Dirty" rooms.')}
                {renderToggle('checkIn', 'preventCheckInMaintenance', 'Block Maintenance Check-In', 'Prevent check-in attempts to "Maintenance" or out-of-service rooms.')}
                {renderToggle('checkIn', 'allowManualRoomOverride', 'Manual Room Assignment', 'Allow changing the assigned room during the check-in process.')}
                {renderToggle('checkIn', 'requirePaymentBeforeCheckIn', 'Pre-payment Requirement', 'Enforce a minimum or full payment before the guest record is activated.')}
                {renderToggle('checkIn', 'allowCheckInPendingBalance', 'Allow Pending Balance Check-In', 'Permit guests to check in with zero upfront payment.')}
              </div>
            )}

            {activeTab === 'financial' && (
              <div className="space-y-4">
                <header className="mb-6 flex items-center gap-3">
                  <div className="p-2 bg-emerald-600/10 rounded-lg">
                    <DollarSign className="text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-50">Accounting Polices</h3>
                    <p className="text-sm text-zinc-500">Govern refunds, discounts, and ledger health</p>
                  </div>
                </header>
                {renderToggle('financial', 'allowRefunds', 'Enable Refund Processing', 'Allow the reversal of payments back to guests.')}
                {renderToggle('financial', 'requireApprovalForRefunds', 'Refunds Require Approval', 'Manager/Admin override required for all refund transactions.')}
                {renderToggle('financial', 'allowDiscounts', 'Enable Discount Engine', 'Support manual price adjustments on folios.')}
                {renderToggle('financial', 'requireApprovalForLargeDiscounts', 'Cap Discount Visibility', 'Require approval for discounts exceeding a set threshold.')}
                {renderInput('financial', 'largeDiscountThreshold', 'Large Discount Limit (%)', 'Percentage above which approval is mandated.')}
                {renderToggle('financial', 'allowManualLedgerAdjustments', 'Allow Ledger Write-Ins', 'Permit direct manual debits/credits to the guest ledger.')}
                {renderToggle('financial', 'allowExpenseManagement', 'Staff Expense Access', 'Allow roles with finance access to create petty cash or expense entries.')}
                {renderToggle('financial', 'allowFinancialReportViewing', 'Finance Report Access', 'Toggle visibility of the "Finance" module for relevant staff.')}
                {renderToggle('financial', 'allowExportingReports', 'Enable CSV/PDF Exports', 'Allow downloading financial data for external processing.')}
                {renderToggle('financial', 'allowInvoiceEditingAfterPayment', 'Post-Payment Invoice Edits', 'Allow changing descriptions on invoices after they are marked as paid.')}
                {renderToggle('financial', 'lockInvoicesAfterCheckout', 'Seal Folios on Exit', 'Prevent any further changes to a folio once the guest has checked out.')}
              </div>
            )}

            {activeTab === 'payments' && (
              <div className="space-y-4">
                <header className="mb-6 flex items-center gap-3">
                  <div className="p-2 bg-purple-500/10 rounded-lg">
                    <CreditCard className="text-purple-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-50">Transaction Protocols</h3>
                    <p className="text-sm text-zinc-500">Manage how money moves in the system</p>
                  </div>
                </header>
                {renderToggle('payments', 'allowSplitPayments', 'Split Payment Support', 'Allow multiple payments of different amounts toward one folio.')}
                {renderToggle('payments', 'allowMultipleMethods', 'Mix & Match Methods', 'Permit combinations (e.g., Cash + Transfer) in a single session.')}
                {renderToggle('payments', 'allowOfflinePayments', 'Manual Offline Payments', 'Allow recording payments without real-time processor verification.')}
                {renderToggle('payments', 'requireTransactionReference', 'ID Requirement', 'Mandate a reference number for all card and transfer transactions.')}
                {renderToggle('payments', 'requirePaymentProofUpload', 'Evidence Uploads', 'Ask staff to upload receipts or screenshots for transfers.')}
                {renderToggle('payments', 'allowPaymentReversal', 'Payment Reversal Utility', 'Support undoing the last payment entry if errors occur.')}
                {renderToggle('payments', 'trackPaymentStaff', 'Payment Ownership Tracking', 'Always log the staff member who processed the payment.')}
                {renderToggle('payments', 'autoSendReceipts', 'Auto-E-Receipts', 'Automatically email PDF receipts to guests upon payment confirmation.')}
              </div>
            )}

            {activeTab === 'guests' && (
              <div className="space-y-4">
                <header className="mb-6 flex items-center gap-3">
                  <div className="p-2 bg-orange-500/10 rounded-lg">
                    <UserCog className="text-orange-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-50">CRM & Profiles</h3>
                    <p className="text-sm text-zinc-500">Policy for guest data and communication</p>
                  </div>
                </header>
                {renderToggle('guests', 'allowProfileEditing', 'Enable Profile Updates', 'Allow staff to change guest phone, email, or preference tags.')}
                {renderToggle('guests', 'allowDeletion', 'Enable Guest Deletion', 'Allow removing guest records from the CRM (Danger Zone).')}
                {renderToggle('guests', 'allowBlacklisting', 'Blacklist Management', 'Enable flag for "Do Not Rent" (DNR) guests.')}
                {renderToggle('guests', 'allowLoyaltyEditing', 'Loyalty adjustments', 'Allow staff to manually edit stay counts or loyalty data.')}
                {renderToggle('guests', 'allowEmailCommunication', 'CRM Email Utility', 'Support sending manual messages via the guest card.')}
                {renderToggle('guests', 'allowHistoryViewing', 'Universal History Access', 'Allow visibility of past reservations across all staff roles.')}
                {renderToggle('guests', 'requireIdVerification', 'ID Attachment Lock', 'Block check-in if no ID document is linked to the profile.')}
                {renderToggle('guests', 'requirePhoneVerification', 'Valid Phone Requirement', 'Enforce phone number format validation.')}
              </div>
            )}

            {activeTab === 'housekeeping' && (
              <div className="space-y-4">
                <header className="mb-6 flex items-center gap-3">
                  <div className="p-2 bg-zinc-500/10 rounded-lg">
                    <Warehouse className="text-zinc-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-50">Cleaning Workflow</h3>
                    <p className="text-sm text-zinc-500">Synchronize floor status with reception</p>
                  </div>
                </header>
                {renderToggle('housekeeping', 'allowStatusUpdates', 'Mobile Status Updates', 'Allow staff to update room hygiene status from housekeeping module.')}
                {renderToggle('housekeeping', 'allowDirtyToCleanChanges', 'Enable Dirty-to-Clean Flow', 'Allow immediate flipping of room status after cleaning.')}
                {renderToggle('housekeeping', 'requireConfirmationForAvailability', 'Housekeeping Hand-off', 'Rooms stay "Inspected" and unavailable until reception accepts them.')}
                {renderToggle('housekeeping', 'preventOccupiedOverride', 'Occupied Room Shield', 'Prevent status changes on rooms marked as "Occupied" by Front Desk.')}
                {renderToggle('housekeeping', 'autoSyncStatusAfterCheckout', 'Sync on Checkout', 'Automatically flip rooms to "Dirty" exactly when checkout occurs.')}
              </div>
            )}

            {activeTab === 'staff' && (
              <div className="space-y-4">
                <header className="mb-6 flex items-center gap-3">
                  <div className="p-2 bg-indigo-500/10 rounded-lg">
                    <Briefcase className="text-indigo-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-50">Role & Hierarchy</h3>
                    <p className="text-sm text-zinc-500">Advanced staff access management</p>
                  </div>
                </header>
                {renderToggle('staff', 'allowActivityTracking', 'Full Activity Logging', 'Log every page visit and data read in the staff audit trail.')}
                {renderToggle('staff', 'allowSessionMonitoring', 'Monitor Active Sessions', 'Allow admins to see who is currently logged in and from where.')}
                {renderToggle('staff', 'restrictByDepartment', 'Department Silos', 'Restrict staff visibility to only their assigned modules (e.g. F&B only sees F&B).')}
                {renderToggle('staff', 'enableRoleInheritance', 'Grant Inherited Permissions', 'Enable custom roles to inherit base capabilities from standard roles.')}
              </div>
            )}

            {activeTab === 'auditLogs' && (
              <div className="space-y-4">
                <header className="mb-6 flex items-center gap-3">
                  <div className="p-2 bg-red-500/10 rounded-lg">
                    <Activity className="text-red-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-50">Trail & Compliance</h3>
                    <p className="text-sm text-zinc-500">Log retention and tracking rules</p>
                  </div>
                </header>
                {renderToggle('auditLogs', 'enableFullLogging', 'Global Audit Trail', 'Enable comprehensive system logging for all write operations.')}
                {renderToggle('auditLogs', 'trackReservations', 'Capture Booking Changes', 'Log every date, rate, or status change on reservations.')}
                {renderToggle('auditLogs', 'trackPayments', 'Audit Ledger Activity', 'Detailed logging for payment processing and reversals.')}
                {renderToggle('auditLogs', 'trackRoomChanges', 'Monitor Room Operations', 'Trail for status flips, blockers, and maintenance flags.')}
                {renderToggle('auditLogs', 'trackAuthEvents', 'Auth Monitoring', 'Log every login, logout, and password change attempt.')}
                {renderToggle('auditLogs', 'trackDeletions', 'Deletion Surveillance', 'Zero-tolerance logging for all deleted records.')}
                {renderToggle('auditLogs', 'restrictLogVisibility', 'Admin-only Logs', 'Only "hotelAdmin" and specified roles can view audit trails.')}
              </div>
            )}

            {activeTab === 'reporting' && (
              <div className="space-y-4">
                <header className="mb-6 flex items-center gap-3">
                  <div className="p-2 bg-sky-500/10 rounded-lg">
                    <FileText className="text-sky-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-50">Data & Analytics</h3>
                    <p className="text-sm text-zinc-500">Configure report visibility and exports</p>
                  </div>
                </header>
                {renderToggle('reporting', 'allowExports', 'Universal Data Export', 'Allow CSV/PDF downloads across all reporting categories.')}
                {renderToggle('reporting', 'allowScheduledReports', 'Automated Email Reports', 'Enable system to send daily/weekly digests to admins.')}
                {renderToggle('reporting', 'allowFiltering', 'Advanced Query Filters', 'Enable deep filtering on date, staff, and category in reports.')}
                {renderToggle('reporting', 'allowRevenueAnalytics', 'Revenue Visualization', 'Enable RevPAR, ADR, and Occupancy trend charts.')}
                {renderToggle('reporting', 'allowOccupancyAnalytics', 'Occupancy Heatmaps', 'Show room-level utilization analytics.')}
                {renderToggle('reporting', 'restrictSensitiveReports', 'Financial Sensitivity', 'Block revenue reports from being visible to non-management staff.')}
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="space-y-4">
                <header className="mb-6 flex items-center gap-3">
                  <div className="p-2 bg-yellow-500/10 rounded-lg">
                    <Bell className="text-yellow-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-50">System Alerts</h3>
                    <p className="text-sm text-zinc-500">Manage real-time push and email notifications</p>
                  </div>
                </header>
                {renderToggle('notifications', 'sendReservationAlerts', 'New Booking Alerts', 'Notify staff/admin when a new reservation is created.')}
                {renderToggle('notifications', 'sendPaymentAlerts', 'Payment Confirmation Alerts', 'Instant push notification for confirmed payments.')}
                {renderToggle('notifications', 'sendNoShowAlerts', 'No-Show Notifications', 'Alert when arrivals are overdue.')}
                {renderToggle('notifications', 'sendMaintenanceAlerts', 'Technical Issue Alerts', 'Notify maintenance when a new issue is reported.')}
                {renderToggle('notifications', 'sendOverduePaymentAlerts', 'Collection Alerts', 'Daily alert for folios with aging debt.')}
                {renderToggle('notifications', 'sendRoomStatusAlerts', 'Cleaning Status Updates', 'Notify Front Desk when housekeeping completes a room.')}
                {renderToggle('notifications', 'enableEmail', 'Email Bridge', 'Forward critical alerts to admin email address.')}
                {renderToggle('notifications', 'enableSms', 'SMS Integration', 'Enable Short Message Service for emergency alerts (Requires config).')}
                <div className="h-px bg-zinc-800 my-4" />
                {renderToggle('notifications', 'enableLowBalanceAlerts', 'Enable Low Balance Alerts', 'Trigger real-time credit warnings whenever a corporate account available credit dips.')}
                {renderToggle('notifications', 'lowBalanceAlertMinorDips', 'Alert on Every Minor Dip', 'If enabled, triggers alerts on every minor debt increase. If disabled, alerts only trigger when available credit breaches the major threshold limit.')}
                
                {((localSettings?.notifications as any)?.enableLowBalanceAlerts ?? true) && (
                  <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-50">Notify Specific Finance Roles</p>
                      <p className="text-xs text-zinc-500">Only users with the selected roles will receive low balance toast alerts.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { id: 'hotelAdmin', label: 'Admin (Full Access)' },
                        { id: 'manager', label: 'Manager' },
                        { id: 'accountant', label: 'Accountant' },
                        { id: 'frontDesk', label: 'Front Desk' },
                        { id: 'housekeeper', label: 'Housekeeper' },
                        { id: 'maintenance', label: 'Maintenance' },
                      ].map((role) => {
                        const activeRoles = (localSettings?.notifications as any)?.lowBalanceAlertRoles ?? ['hotelAdmin', 'manager', 'accountant'];
                        const isChecked = activeRoles.includes(role.id);
                        return (
                          <button
                            key={role.id}
                            type="button"
                            onClick={() => {
                              const updatedRoles = isChecked
                                ? activeRoles.filter((r: string) => r !== role.id)
                                : [...activeRoles, role.id];
                              const updated = {
                                ...localSettings,
                                notifications: {
                                  ...localSettings.notifications,
                                  lowBalanceAlertRoles: updatedRoles,
                                },
                              };
                              setLocalSettings(updated);
                              saveSettings(updated, 'notifications', 'lowBalanceAlertRoles');
                            }}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all border",
                              isChecked
                                ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30 font-black"
                                : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300"
                            )}
                          >
                            {role.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'security' && (
              <div className="space-y-4">
                <header className="mb-6 flex items-center gap-3">
                  <div className="p-2 bg-rose-500/10 rounded-lg">
                    <ShieldCheck className="text-rose-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-50">Hardened Security</h3>
                    <p className="text-sm text-zinc-500">Global account and session protection</p>
                  </div>
                </header>
                {renderToggle('security', 'require2FAForAdmins', 'Enforce MFA for Admins', 'Require multi-factor authentication for all "hotelAdmin" logins.')}
                {renderInput('security', 'forcePasswordResetDays', 'Password Expiry (Days)', 'Forced rotation interval. Set to 0 to disable.')}
                {renderInput('security', 'sessionTimeoutMinutes', 'Auto-Logout Buffer (Mins)', 'Idle time after which the active session is terminated.')}
                {renderToggle('security', 'enableIpTracking', 'IP & Device Logging', 'Log and display login location data in activity logs.')}
                {renderToggle('security', 'restrictMultipleLogins', 'Block Simultaneous Logins', 'Force logout of previous session when a new one starts.')}
                {renderInput('security', 'lockAccountAfterFailedAttempts', 'Max Lockout Threshold', 'Failed logins before account is suspended.')}
                {renderToggle('security', 'requireApprovalForSensitiveActions', 'Consent for High-Risk Actions', 'Require a second admin to confirm deletions or large reversals.')}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
