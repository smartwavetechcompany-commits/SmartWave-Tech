import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, doc, getDocs, getDoc, query, where, orderBy } from 'firebase/firestore';
import { auth, db, handleFirestoreError } from '../firebase';
import { database } from '../utils/database';
import { useAuth } from '../contexts/AuthContext';
import { hasPermission } from '../utils/permissions';
import { TrackingCode, Hotel, TrackingCodeRequest, OperationType, GlobalAuditLog, SystemSettings, PlanType } from '../types';
import { 
  Plus, 
  Search, 
  MoreVertical, 
  Trash2, 
  RefreshCw, 
  ShieldAlert,
  History,
  Calendar,
  Key,
  Mail,
  Phone,
  CheckCircle2,
  XCircle,
  Settings,
  CreditCard,
  Receipt,
  Link as LinkIcon,
  Users,
  Building2,
  ClipboardList,
  ArrowRight
} from 'lucide-react';
import { format, isValid } from 'date-fns';
import { cn, formatCurrency, safeStringify } from '../utils';

import { useNavigate } from 'react-router-dom';
import { AuditLogs } from './AuditLogs';
import { ErrorBoundary } from './ErrorBoundary';
import { StaffManagement } from './StaffManagement';
import { SuperAdminReceipt } from './SuperAdminReceipt';

import { toast } from 'sonner';

export function SuperAdmin() {
  const navigate = useNavigate();
  const { profile, currency, exchangeRate, setSelectedHotelId } = useAuth();
  const [trackingCodes, setTrackingCodes] = useState<TrackingCode[]>([]);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [requests, setRequests] = useState<TrackingCodeRequest[]>([]);
  const [settings, setSettings] = useState<SystemSettings>({
    bankName: '',
    accountNumber: '',
    accountName: '',
    paymentInstructions: '',
    supportEmail: '',
    exchangeRate: 1500,
  });
  const [isAddingCode, setIsAddingCode] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [extendingHotel, setExtendingHotel] = useState<Hotel | null>(null);
  const [extendingCode, setExtendingCode] = useState<TrackingCode | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<TrackingCodeRequest | null>(null);
  const [filterStatus, setFilterStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [changingPlanHotel, setChangingPlanHotel] = useState<Hotel | null>(null);
  const [managingStaffHotel, setManagingStaffHotel] = useState<Hotel | null>(null);
  const [showHistoryHotel, setShowHistoryHotel] = useState<Hotel | null>(null);
  const [planChangeAmount, setPlanChangeAmount] = useState<number>(0);
  const [planChangeReason, setPlanChangeReason] = useState<string>('');
  const [newCode, setNewCode] = useState({
    duration: '1 month',
    type: 'Standard',
    price: 0,
    targetEmail: '',
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [codeSearchTerm, setCodeSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [activeTab, setActiveTab] = useState<'hotels' | 'requests' | 'codes' | 'audit' | 'settings'>('hotels');
  const [loading, setLoading] = useState(false);
  const [hasPermissionError, setHasPermissionError] = useState(false);

  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  // Real-time listeners
  useEffect(() => {
    // Wait for auth to be ready
    if (!auth.currentUser) {
      setLoading(false);
      return;
    }

    // Only proceed if superAdmin
    if (!hasPermission(profile?.role, 'access_super_admin')) {
      setHasPermissionError(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    
    // Fallback to stop rotation if listeners take too long
    const timeout = setTimeout(() => setLoading(false), 5000);

    const unsubCodes = onSnapshot(collection(db, 'trackingCodes'), (snap) => {
      setTrackingCodes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as TrackingCode)));
    }, (err: any) => {
      handleFirestoreError(err, OperationType.LIST, 'trackingCodes');
    });

    const unsubHotels = onSnapshot(collection(db, 'hotels'), (snap) => {
      setHotels(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hotel)));
    }, (err: any) => {
      handleFirestoreError(err, OperationType.LIST, 'hotels');
    });

    const unsubRequests = onSnapshot(collection(db, 'trackingCodeRequests'), (snap) => {
      setRequests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as TrackingCodeRequest)));
    }, (err: any) => {
      handleFirestoreError(err, OperationType.LIST, 'trackingCodeRequests');
    });

    const unsubSettings = onSnapshot(doc(db, 'system', 'settings'), (snap) => {
      if (snap.exists()) {
        setSettings(snap.data() as any);
      }
      setLoading(false);
    }, (err: any) => {
      handleFirestoreError(err, OperationType.GET, 'system/settings');
      setLoading(false);
    });

    return () => {
      clearTimeout(timeout);
      unsubCodes();
      unsubHotels();
      unsubRequests();
      unsubSettings();
    };
  }, [profile?.role]);

  const updateSettings = async () => {
    try {
      await database.safeSet(doc(db, 'system', 'settings'), settings, {
        hotelId: 'system',
        module: 'SuperAdmin',
        action: 'UPDATE_SYSTEM_SETTINGS',
        details: 'Updated global system settings'
      });
      toast.success('System settings updated successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'system/settings');
      toast.error('Failed to update settings');
    }
  };

  const generateCodeForRequest = async (request: TrackingCodeRequest) => {
    if (!auth.currentUser || profile?.role !== 'superAdmin') {
      toast.error('Unauthorized');
      return;
    }

    setLoading(true);
    try {
      const email = request.email.toLowerCase();
      
      // Check if there's already an active code for this email
      const q = query(
        collection(db, 'trackingCodes'),
        where('targetEmail', '==', email),
        where('status', '==', 'active')
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        toast.error('An active tracking code already exists for this email');
        return;
      }

      // Use the code if it was already generated but not approved, or generate new
      const code = request.generatedCode || Math.random().toString(36).substring(2, 10).toUpperCase();
      
      // Calculate expiry based on plan or default 30 days
      let durationMs = 30 * 24 * 60 * 60 * 1000;
      if (request.message?.includes('6 months')) durationMs = 6 * 30 * 24 * 60 * 60 * 1000;
      else if (request.message?.includes('1 year')) durationMs = 365 * 24 * 60 * 60 * 1000;

      const expiryDate = new Date(Date.now() + durationMs).toISOString();

      const tc: TrackingCode = {
        code,
        expiryDate,
        status: 'active',
        plan: (request.plan?.toLowerCase() as PlanType) || 'standard',
        maxHotels: 1,
        issuedBy: auth.currentUser.uid,
        createdAt: new Date().toISOString(),
        targetEmail: request.email
      };

      // 1. Create the tracking code
      await database.safeSet(doc(db, 'trackingCodes', code), tc, {
        hotelId: 'system',
        module: 'SuperAdmin',
        action: 'GENERATE_TRACKING_CODE',
        details: `Generated code ${code} for ${request.email}`
      });
      
      // 2. Approve the request
      await database.safeUpdate(doc(db, 'trackingCodeRequests', request.id), {
        status: 'approved',
        generatedCode: code
      }, {
        hotelId: 'system',
        module: 'SuperAdmin',
        action: 'APPROVE_CODE_REQUEST',
        details: `Approved request for ${request.hotelName}`
      });

      // 3. Log the action for UI visibility
      const log: Omit<GlobalAuditLog, 'id'> = {
        timestamp: new Date().toISOString(),
        actor: profile?.email || auth.currentUser.email || auth.currentUser.uid,
        userRole: 'superAdmin',
        action: 'APPROVE_CODE_REQUEST',
        target: `Hotel: ${request.hotelName}, Code: ${code}`
      };
      await database.safeAdd(collection(db, 'activityLogs'), log, {
        hotelId: 'system',
        module: 'SuperAdmin',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'Approved tracking code request activity'
      });

      toast.success(`Code ${code} approved for ${request.hotelName}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'trackingCodes');
      toast.error('Failed to approve request');
    } finally {
      setLoading(false);
    }
  };

  const rejectRequest = async (requestId: string) => {
    try {
      await database.safeUpdate(doc(db, 'trackingCodeRequests', requestId), { status: 'rejected' }, {
        hotelId: 'system',
        module: 'SuperAdmin',
        action: 'REJECT_CODE_REQUEST',
        details: `Rejected request ${requestId}`
      });
      toast.success('Request rejected');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `trackingCodeRequests/${requestId}`);
      toast.error('Failed to reject request');
    }
  };

  const generateCode = async () => {
    if (!auth.currentUser || profile?.role !== 'superAdmin') {
      toast.error('Unauthorized: Please wait for authentication to complete');
      return;
    }

    setLoading(true);
    try {
      if (!newCode.targetEmail) {
        toast.error('Target email is required');
        return;
      }

      const email = newCode.targetEmail.toLowerCase();
      
      // Check if there's already an active code for this email
      const q = query(
        collection(db, 'trackingCodes'),
        where('targetEmail', '==', email),
        where('status', '==', 'active')
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        toast.error('An active tracking code already exists for this email');
        return;
      }

      const code = Math.random().toString(36).substring(2, 10).toUpperCase();
      let durationMs = 30 * 24 * 60 * 60 * 1000;
      if (newCode.duration === '6 months') durationMs = 6 * 30 * 24 * 60 * 60 * 1000;
      else if (newCode.duration === '1 year') durationMs = 365 * 24 * 60 * 60 * 1000;

      const tc: TrackingCode = {
        code,
        expiryDate: new Date(Date.now() + durationMs).toISOString(),
        status: 'active',
        plan: newCode.type.toLowerCase() as PlanType,
        maxHotels: 1,
        issuedBy: auth.currentUser.uid,
        createdAt: new Date().toISOString(),
        price: newCode.price,
        targetEmail: newCode.targetEmail.toLowerCase()
      };

      await database.safeSet(doc(db, 'trackingCodes', code), tc, {
        hotelId: 'system',
        module: 'SuperAdmin',
        action: 'GENERATE_TRACKING_CODE',
        details: `Manually generated code ${code} for ${newCode.targetEmail}`
      });

      const log: Omit<GlobalAuditLog, 'id'> = {
        timestamp: new Date().toISOString(),
        actor: auth.currentUser.email || auth.currentUser.uid,
        userRole: 'superAdmin',
        action: 'GENERATE_TRACKING_CODE',
        target: `Code: ${code} (${newCode.duration})`
      };
      await database.safeAdd(collection(db, 'activityLogs'), log, {
        hotelId: 'system',
        module: 'SuperAdmin',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'Manual code generation activity'
      });

      setGeneratedCode(code);
      setNewCode({ duration: '1 month', type: 'Standard', price: 0, targetEmail: '' });
      toast.success('Tracking code generated successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'trackingCodes');
      toast.error('Failed to generate code');
    } finally {
      setLoading(false);
    }
  };

  const [customExpiryDate, setCustomExpiryDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

  // Sync custom date when modal opens
  useEffect(() => {
    if (extendingCode) {
      try {
        const d = new Date(extendingCode.expiryDate);
        if (isValid(d)) {
          setCustomExpiryDate(format(d, 'yyyy-MM-dd'));
        }
      } catch (e) {
        console.error("Invalid code date", e);
      }
    } else if (extendingHotel) {
      try {
        const d = new Date(extendingHotel.subscriptionExpiry);
        if (isValid(d)) {
          setCustomExpiryDate(format(d, 'yyyy-MM-dd'));
        }
      } catch (e) {
        console.error("Invalid hotel date", e);
      }
    }
  }, [extendingCode, extendingHotel]);

  const extendTrackingCode = async (code: TrackingCode, months: number | 'custom') => {
    if (!auth.currentUser || profile?.role !== 'superAdmin') return;

    setLoading(true);
    try {
      let newExpiry: string;
      if (months === 'custom') {
        newExpiry = new Date(customExpiryDate).toISOString();
      } else {
        const now = Date.now();
        const currentExpiry = new Date(code.expiryDate).getTime();
        // If code is already expired, start extension from NOW, otherwise add to current expiry
        const baseTime = (isNaN(currentExpiry) || currentExpiry < now) ? now : currentExpiry;
        newExpiry = new Date(baseTime + (months * 30 * 24 * 60 * 60 * 1000)).toISOString();
      }
      
      // 2. Find all linked hotels
      const codeId = code.code.trim().toUpperCase();
      const linkedHotels = hotels.filter(h => 
        (h.trackingCode?.trim().toUpperCase() === codeId) ||
        (code.usedByHotel && h.id === code.usedByHotel)
      );

      // 1. Update Tracking Code - always use code.code as it's the primary identifier
      await database.safeUpdate(doc(db, 'trackingCodes', codeId), { 
        expiryDate: newExpiry,
        status: linkedHotels.length > 0 ? 'used' : 'active'
      }, {
        hotelId: 'system',
        module: 'SuperAdmin',
        action: 'EXTEND_TRACKING_CODE',
        details: `Extended code ${codeId} expiry to ${newExpiry}`
      });
      
      for (const linkedHotel of linkedHotels) {
        try {
          await database.safeUpdate(doc(db, 'hotels', linkedHotel.id), {
            subscriptionExpiry: newExpiry,
            subscriptionStatus: 'active'
          }, {
            hotelId: linkedHotel.id,
            module: 'SuperAdmin',
            action: 'SYNC_HOTEL_EXPIRY',
            details: `Synced hotel ${linkedHotel.name} expiry with updated tracking code ${codeId}`
          });
        } catch (hotelErr: any) {
          console.error(`Failed to sync hotel ${linkedHotel.id} expiry:`, hotelErr.message);
        }
      }

      const log: Omit<GlobalAuditLog, 'id'> = {
        timestamp: new Date().toISOString(),
        actor: auth.currentUser.email || auth.currentUser.uid,
        userRole: 'superAdmin',
        action: 'EXTEND_TRACKING_CODE',
        target: `Code ${codeId}: ${months} months extension`
      };
      await database.safeAdd(collection(db, 'activityLogs'), log, {
        hotelId: 'system',
        module: 'SuperAdmin',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'Code extension activity'
      });
      
      setExtendingCode(null);
      toast.success(`Code ${codeId} and ${linkedHotels.length} linked hotels updated.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `trackingCodes/${code.code}`);
      toast.error('Failed to extend code');
    } finally {
      setLoading(false);
    }
  };

  const giveLiveAccess = async (hotel: Hotel) => {
    try {
      const now = Date.now();
      const currentExpiry = new Date(hotel.subscriptionExpiry).getTime();
      const newExpiry = new Date((currentExpiry > now ? currentExpiry : now) + (30 * 24 * 60 * 60 * 1000)).toISOString();
      
      // 1. Update Hotel
      await database.safeUpdate(doc(db, 'hotels', hotel.id), { 
        subscriptionExpiry: newExpiry,
        subscriptionStatus: 'active' 
      }, {
        hotelId: hotel.id,
        module: 'SuperAdmin',
        action: 'GIVE_LIVE_ACCESS',
        details: `Granted live access to ${hotel.name}`
      });

      // 2. Sync with Tracking Code if exists
      if (hotel.trackingCode) {
        try {
          const tcRef = doc(db, 'trackingCodes', hotel.trackingCode.trim().toUpperCase());
          const tcDoc = await getDoc(tcRef);
          if (tcDoc.exists()) {
            await database.safeUpdate(tcRef, { 
              expiryDate: newExpiry,
              status: 'used' // Ensure it's marked as used if it was somehow active/expired
            }, {
              hotelId: 'system',
              module: 'SuperAdmin',
              action: 'SYNC_TRACKING_CODE_EXPIRY',
              details: `Synced code ${hotel.trackingCode.trim().toUpperCase()} with live access grant`
            });
          }
        } catch (err: any) {
          console.error("Failed to sync tracking code:", err.message);
        }
      }

      const log: Omit<GlobalAuditLog, 'id'> = {
        timestamp: new Date().toISOString(),
        actor: profile?.email || profile?.uid || 'system',
        userRole: 'superAdmin',
        action: 'GIVE_LIVE_ACCESS',
        target: `Hotel: ${hotel.name}`
      };
      await database.safeAdd(collection(db, 'activityLogs'), log, {
        hotelId: 'system',
        module: 'SuperAdmin',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'Live access grant activity'
      });
      
      toast.success(`Live access granted to ${hotel.name}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}`);
      toast.error('Failed to grant live access');
    }
  };

  const [syncingAll, setSyncingAll] = useState(false);

  // Auto-sync on mount
  useEffect(() => {
    if (profile?.role === 'superAdmin' && hotels.length > 0 && trackingCodes.length > 0) {
      // Small delay to ensure everything is loaded
      const timer = setTimeout(() => {
        syncAllCodesWithHotels();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [profile?.role, hotels.length, trackingCodes.length]);

  const syncAllCodesWithHotels = async () => {
    if (!auth.currentUser || profile?.role !== 'superAdmin') return;
    setSyncingAll(true);
    let syncedCount = 0;
    try {
      // Create a map for faster lookup
      const hotelMapByCode = new Map<string, Hotel[]>();
      hotels.forEach(h => {
        if (h.trackingCode) {
          const code = h.trackingCode.trim().toUpperCase();
          if (!hotelMapByCode.has(code)) hotelMapByCode.set(code, []);
          hotelMapByCode.get(code)?.push(h);
        }
      });

      for (const code of trackingCodes) {
        const codeKey = code.code.trim().toUpperCase();
        const linkedHotels = hotelMapByCode.get(codeKey) || [];
        
        // Add by ID if possible
        if (code.usedByHotel) {
          const hotelById = hotels.find(h => h.id === code.usedByHotel);
          if (hotelById && !linkedHotels.find(lh => lh.id === hotelById.id)) {
            linkedHotels.push(hotelById);
          }
        }

        if (linkedHotels.length > 0) {
          // Latest expiry wins
          const latestExpiry = [
            code.expiryDate,
            ...linkedHotels.map(h => h.subscriptionExpiry)
          ].filter(Boolean).sort().pop();

          if (latestExpiry) {
            // Update Code if needed
            if (code.expiryDate !== latestExpiry || code.status !== 'used') {
              await database.safeUpdate(doc(db, 'trackingCodes', codeKey), { 
                expiryDate: latestExpiry,
                status: 'used'
              }, {
                hotelId: 'system',
                module: 'SuperAdmin',
                action: 'SYNC_AUTO',
                details: `Sync code ${codeKey} with hotels`
              });
              syncedCount++;
            }

            // Update Hotels if needed
            for (const h of linkedHotels) {
              if (h.subscriptionExpiry !== latestExpiry || h.subscriptionStatus !== 'active') {
                await database.safeUpdate(doc(db, 'hotels', h.id), {
                  subscriptionExpiry: latestExpiry,
                  subscriptionStatus: 'active'
                }, {
                  hotelId: h.id,
                  module: 'SuperAdmin',
                  action: 'SYNC_AUTO',
                  details: `Sync hotel ${h.name} with code ${codeKey}`
                });
                syncedCount++;
              }
            }
          }
        }
      }
      if (syncedCount > 0) {
        toast.success(`Background sync: Updated ${syncedCount} records.`);
      }
    } catch (err: any) {
      console.error("Auto-sync error:", err.message);
    } finally {
      setSyncingAll(false);
    }
  };

  const deleteHotel = async (hotel: Hotel) => {
    setConfirmAction({
      title: 'Delete Hotel',
      message: `Are you sure you want to delete ${hotel.name}? This will delete all hotel data including rooms, reservations, and staff profiles. This action cannot be undone.`,
      onConfirm: async () => {
        try {
          await database.safeDelete(doc(db, 'hotels', hotel.id), {
            hotelId: hotel.id,
            module: 'SuperAdmin',
            action: 'DELETE_HOTEL',
            details: `Deleted hotel ${hotel.name}`
          });
          const log: Omit<GlobalAuditLog, 'id'> = {
            timestamp: new Date().toISOString(),
            actor: profile?.email || profile?.uid || 'system',
            userRole: 'superAdmin',
            action: 'DELETE_HOTEL',
            target: `Hotel: ${hotel.name}`
          };
          await database.safeAdd(collection(db, 'activityLogs'), log, {
            hotelId: 'system',
            module: 'SuperAdmin',
            action: 'ACTIVITY_LOG_CREATE',
            details: 'Hotel deletion activity'
          });
          toast.success(`Hotel ${hotel.name} deleted`);
          setConfirmAction(null);
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel.id}`);
          toast.error('Failed to delete hotel');
        }
      }
    });
  };

  const toggleHotelStatus = async (hotel: Hotel) => {
    try {
      const newStatus = hotel.subscriptionStatus === 'active' ? 'suspended' : 'active';
      await database.safeUpdate(doc(db, 'hotels', hotel.id), { subscriptionStatus: newStatus }, {
        hotelId: hotel.id,
        module: 'SuperAdmin',
        action: 'TOGGLE_HOTEL_STATUS',
        details: `Changed subscription status for ${hotel.name} to ${newStatus}`
      });

      const log: Omit<GlobalAuditLog, 'id'> = {
        timestamp: new Date().toISOString(),
        actor: profile?.email || profile?.uid || 'system',
        userRole: 'superAdmin',
        action: 'TOGGLE_HOTEL_STATUS',
        target: `Hotel ${hotel.name}: ${newStatus}`
      };
      await database.safeAdd(collection(db, 'activityLogs'), log, {
        hotelId: 'system',
        module: 'SuperAdmin',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'Hotel status toggle activity'
      });
      toast.success(`Hotel ${hotel.name} ${newStatus}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}`);
      toast.error('Failed to update hotel status');
    }
  };

  const extendSubscription = async (hotel: Hotel, months: number | 'custom') => {
    try {
      let newExpiry: string;
      if (months === 'custom') {
        newExpiry = new Date(customExpiryDate).toISOString();
      } else {
        const now = Date.now();
        const currentExpiry = new Date(hotel.subscriptionExpiry).getTime();
        // If already expired, start extension from NOW, otherwise add to current expiry
        const baseTime = (isNaN(currentExpiry) || currentExpiry < now) ? now : currentExpiry;
        newExpiry = new Date(baseTime + (months * 30 * 24 * 60 * 60 * 1000)).toISOString();
      }
      
      // 1. Update Hotel
      await database.safeUpdate(doc(db, 'hotels', hotel.id), { 
        subscriptionExpiry: newExpiry,
        subscriptionStatus: 'active' 
      }, {
        hotelId: hotel.id,
        module: 'SuperAdmin',
        action: 'EXTEND_SUBSCRIPTION',
        details: `Extended ${hotel.name} subscription by ${months} units`
      });

      // 2. Sync with Tracking Code if exists
      if (hotel.trackingCode) {
        try {
          const tcRef = doc(db, 'trackingCodes', hotel.trackingCode.trim().toUpperCase());
          const tcDoc = await getDoc(tcRef);
          if (tcDoc.exists()) {
            await database.safeUpdate(tcRef, { 
              expiryDate: newExpiry,
              status: 'used'
            }, {
              hotelId: 'system',
              module: 'SuperAdmin',
              action: 'SYNC_TRACKING_CODE_EXPIRY',
              details: `Synced code ${hotel.trackingCode.toUpperCase()} with subscription extension`
            });
          }
        } catch (err: any) {
          console.error("Failed to sync tracking code:", err.message);
        }
      }

      const log: Omit<GlobalAuditLog, 'id'> = {
        timestamp: new Date().toISOString(),
        actor: profile?.email || profile?.uid || 'system',
        userRole: 'superAdmin',
        action: 'EXTEND_SUBSCRIPTION',
        target: `Hotel ${hotel.name}: +${months} months`
      };
      await database.safeAdd(collection(db, 'activityLogs'), log, {
        hotelId: 'system',
        module: 'SuperAdmin',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'Subscription extension activity'
      });
      
      setExtendingHotel(null);
      toast.success(`Subscription for ${hotel.name} extended by ${months} months`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}`);
      toast.error('Failed to extend subscription');
    }
  };

  const changeHotelPlan = async (hotel: Hotel, newPlan: PlanType) => {
    if (!auth.currentUser || profile?.role !== 'superAdmin') return;

    setLoading(true);
    try {
      const planFeatures = {
        standard: {
          modules: ['dashboard', 'rooms', 'frontDesk', 'settings'],
          limits: { rooms: 30, staff: 5 }
        },
        premium: {
          modules: ['dashboard', 'rooms', 'frontDesk', 'housekeeping', 'staff', 'reports', 'settings', 'guests', 'maintenance', 'corporate'],
          limits: { rooms: 100, staff: 20 }
        },
        enterprise: {
          modules: ['dashboard', 'rooms', 'frontDesk', 'housekeeping', 'kitchen', 'finance', 'reports', 'staff', 'settings', 'guests', 'maintenance', 'inventory', 'corporate'],
          limits: { rooms: 1000, staff: 100 }
        }
      };

      const features = planFeatures[newPlan];
      
      const planHistoryItem = {
        plan: newPlan,
        previousPlan: hotel.plan,
        changedAt: new Date().toISOString(),
        amount: planChangeAmount,
        reason: planChangeReason
      };

      await database.safeUpdate(doc(db, 'hotels', hotel.id), { 
        plan: newPlan,
        modulesEnabled: features.modules,
        roomLimit: features.limits.rooms,
        staffLimit: features.limits.staff,
        limits: features.limits,
        planHistory: [...(hotel.planHistory || []), planHistoryItem]
      }, {
        hotelId: hotel.id,
        module: 'SuperAdmin',
        action: 'CHANGE_HOTEL_PLAN',
        details: `Upgraded/Downgraded ${hotel.name} to ${newPlan} (Amount: ${planChangeAmount})`
      });

      // Update the tracking code associated with the hotel if it exists
      if (hotel.trackingCode) {
        try {
          const tcKey = hotel.trackingCode.trim().toUpperCase();
          const tcRef = doc(db, 'trackingCodes', tcKey);
          const tcDoc = await getDoc(tcRef);
          if (tcDoc.exists()) {
            await database.safeUpdate(tcRef, { 
              plan: newPlan,
              price: ((tcDoc.data() as TrackingCode).price || 0) + planChangeAmount
            }, {
              hotelId: 'system',
              module: 'SuperAdmin',
              action: 'UPDATE_TRACKING_CODE_PLAN',
              details: `Syncing plan change to code ${tcKey}`
            });
          }
        } catch (err: any) {
          console.error("Failed to update tracking code plan:", err.message);
        }
      }

      const log: Omit<GlobalAuditLog, 'id'> = {
        timestamp: new Date().toISOString(),
        actor: auth.currentUser.email || auth.currentUser.uid,
        userRole: 'superAdmin',
        action: 'CHANGE_HOTEL_PLAN',
        target: `Hotel ${hotel.name}: ${hotel.plan} -> ${newPlan} (Amount: ${planChangeAmount})`
      };
      await database.safeAdd(collection(db, 'activityLogs'), log, {
        hotelId: 'system',
        module: 'SuperAdmin',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'Hotel plan change activity'
      });
      
      setChangingPlanHotel(null);
      setPlanChangeAmount(0);
      setPlanChangeReason('');
      toast.success(`Plan for ${hotel.name} changed to ${newPlan}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}`);
      toast.error('Failed to change plan');
    } finally {
      setLoading(false);
    }
  };

  const safeFormat = (date: any, formatStr: string) => {
    try {
      const d = new Date(date);
      if (!isValid(d)) return 'N/A';
      return format(d, formatStr);
    } catch (e) {
      return 'N/A';
    }
  };

  const filteredHotels = hotels.filter(hotel => {
    const matchesSearch = (hotel.name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) || 
                         (hotel.trackingCode?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || hotel.subscriptionStatus === statusFilter;
    
    // Check for expired status if needed
    if (statusFilter === 'expired') {
      return matchesSearch && new Date(hotel.subscriptionExpiry).getTime() <= Date.now();
    }

    if (statusFilter === 'near_expiry') {
      const remainingDays = (new Date(hotel.subscriptionExpiry).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      return matchesSearch && hotel.subscriptionStatus === 'active' && remainingDays > 0 && remainingDays <= 7;
    }
    
    return matchesSearch && matchesStatus;
  });

  const filteredCodes = trackingCodes.filter(code => {
    const matchesSearch = (code.code?.toLowerCase() || '').includes(codeSearchTerm.toLowerCase());
    return matchesSearch;
  });

  const stats = {
    totalHotels: hotels.length,
    activeHotels: hotels.filter(h => h.subscriptionStatus === 'active' && new Date(h.subscriptionExpiry).getTime() > Date.now() + 1000).length,
    expiredHotels: hotels.filter(h => new Date(h.subscriptionExpiry).getTime() <= Date.now() + 1000).length,
    nearExpiry: hotels.filter(h => {
      const remainingDays = (new Date(h.subscriptionExpiry).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      return h.subscriptionStatus === 'active' && remainingDays > 0 && remainingDays <= 7;
    }).length,
    activeCodes: trackingCodes.filter(c => c.status === 'active').length,
    pendingRequests: requests.filter(r => r.status === 'pending').length,
  };

  if (hasPermissionError) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[400px] text-center space-y-4">
        <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center">
          <ShieldAlert size={32} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-zinc-50">Access Denied</h2>
          <p className="text-zinc-400 max-w-md mx-auto mt-2">
            You do not have the required permissions to access the SuperAdmin panel. 
            If you believe this is an error, please contact the system administrator.
          </p>
        </div>
        <button 
          onClick={() => window.location.reload()}
          className="px-6 py-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-all"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8 relative">
      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-bold text-zinc-50 mb-2">{confirmAction.title}</h3>
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
                className="flex-1 bg-red-500 text-zinc-50 font-bold py-2 rounded-lg hover:bg-red-400 transition-all active:scale-95"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-50 tracking-tight">System Control</h1>
          <p className="text-zinc-400">Manage tracking codes and hotel subscriptions</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => window.location.reload()}
            disabled={loading}
            className="p-2 text-zinc-500 hover:text-zinc-50 hover:bg-zinc-800 rounded-lg transition-all disabled:opacity-50"
            title="Refresh Page"
          >
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
          </button>
          <button 
            onClick={() => setIsAddingCode(true)}
            className="w-full sm:w-auto bg-emerald-500 text-black px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all active:scale-95"
          >
            <Plus size={18} />
            Generate Code
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-zinc-800 pb-px">
        {[
          { id: 'hotels', label: 'Hotels', icon: Building2 },
          { id: 'requests', label: 'Requests', icon: Mail },
          { id: 'codes', label: 'Tracking Codes', icon: Key },
          { id: 'audit', label: 'Global Audit', icon: ClipboardList },
          { id: 'settings', label: 'System Settings', icon: Settings },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              "flex items-center gap-2 px-6 py-3 text-sm font-bold transition-all relative",
              activeTab === tab.id 
                ? "text-emerald-500" 
                : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            <tab.icon size={16} />
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
            )}
            {tab.id === 'requests' && stats.pendingRequests > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-red-500 text-white text-[10px] rounded-full">
                {stats.pendingRequests}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      {activeTab === 'hotels' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
            <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Total Hotels</div>
            <div className="text-3xl font-bold text-zinc-50">{stats.totalHotels}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
            <div className="text-xs font-bold text-emerald-500 uppercase tracking-wider mb-1">Active</div>
            <div className="text-3xl font-bold text-zinc-50">{stats.activeHotels}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
            <div className="text-xs font-bold text-red-500 uppercase tracking-wider mb-1">Expired</div>
            <div className="text-3xl font-bold text-zinc-50">{stats.expiredHotels}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl relative overflow-hidden group cursor-pointer hover:border-amber-500/50 transition-colors" onClick={() => setStatusFilter('near_expiry')}>
            <div className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-1">Near Expiry</div>
            <div className="text-3xl font-bold text-zinc-50">{stats.nearExpiry}</div>
            {stats.nearExpiry > 0 && (
              <div className="absolute top-0 right-0 p-2">
                <div className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
              </div>
            )}
          </div>
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl relative cursor-pointer hover:border-blue-500/50 transition-colors" onClick={() => setActiveTab('requests')}>
            <div className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-1">Pending Requests</div>
            <div className="text-3xl font-bold text-zinc-50">{stats.pendingRequests}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl relative cursor-pointer hover:border-amber-500/50 transition-colors" onClick={() => setActiveTab('codes')}>
            <div className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-1">Active Codes</div>
            <div className="text-3xl font-bold text-zinc-50">{stats.activeCodes}</div>
          </div>
        </div>
      )}

      {isAddingCode && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            {!generatedCode ? (
              <>
                <h3 className="text-xl font-bold text-zinc-50 mb-6">Generate Tracking Code</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Duration</label>
                    <select 
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50"
                      value={newCode.duration}
                      onChange={(e) => setNewCode({ ...newCode, duration: e.target.value })}
                    >
                      <option>1 month</option>
                      <option>6 months</option>
                      <option>1 year</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Target Email (Required)</label>
                    <input 
                      type="email" 
                      placeholder="hotel@example.com"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 text-sm focus:border-emerald-500 outline-none"
                      value={newCode.targetEmail}
                      onChange={(e) => setNewCode({ ...newCode, targetEmail: e.target.value })}
                      required
                    />
                    <p className="text-[10px] text-zinc-500 mt-1">This code will only be valid for this email address.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Type</label>
                    <select 
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50"
                      value={newCode.type}
                      onChange={(e) => setNewCode({ ...newCode, type: e.target.value })}
                    >
                      <option>Standard</option>
                      <option>Premium</option>
                      <option>Enterprise</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Price (Optional)</label>
                    <input 
                      type="number" 
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50"
                      value={newCode.price}
                      onChange={(e) => setNewCode({ ...newCode, price: Number(e.target.value) })}
                      placeholder="Enter amount paid"
                    />
                  </div>
                </div>
                <div className="flex gap-4 mt-8">
                  <button 
                    onClick={() => setIsAddingCode(false)}
                    className="flex-1 px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-50 transition-all active:scale-95"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={generateCode}
                    className="flex-1 bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95"
                  >
                    Generate
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center">
                <div className="w-16 h-16 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Key size={32} />
                </div>
                <h3 className="text-xl font-bold text-zinc-50 mb-2">Code Generated!</h3>
                <p className="text-zinc-400 text-sm mb-6">Share this code with the hotel admin</p>
                
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 mb-8 relative group">
                  <div className="text-3xl font-mono font-bold text-emerald-500 tracking-[0.2em]">{generatedCode}</div>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(generatedCode);
                      toast.success('Code copied to clipboard!');
                    }}
                    className="mt-4 text-xs font-bold text-zinc-500 hover:text-emerald-500 transition-colors uppercase tracking-widest"
                  >
                    Click to Copy
                  </button>
                </div>

                <button 
                  onClick={() => {
                    setIsAddingCode(false);
                    setGeneratedCode(null);
                  }}
                  className="w-full bg-emerald-500 text-black font-bold py-3 rounded-lg hover:bg-emerald-400 transition-all active:scale-95"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {extendingCode && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-zinc-50 mb-2">Extend Access Code</h3>
            <p className="text-zinc-400 text-sm mb-6">Extending code: {extendingCode.code}</p>
            
            <div className="space-y-4 mb-6">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-zinc-500 uppercase">Quick Add</label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 3, 6, 12].map(months => (
                    <button 
                      key={months}
                      onClick={() => extendTrackingCode(extendingCode, months)}
                      className="bg-zinc-800 hover:bg-zinc-700 text-zinc-50 py-2 rounded-lg font-medium text-xs transition-all active:scale-95"
                    >
                      +{months}m
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-zinc-500 uppercase">Quick Correct (Reduce)</label>
                <div className="grid grid-cols-2 gap-2">
                  {[-1, -3].map(months => (
                    <button 
                      key={months}
                      onClick={() => extendTrackingCode(extendingCode, months)}
                      className="bg-red-500/10 hover:bg-red-500/20 text-red-500 py-2 rounded-lg font-medium text-xs transition-all active:scale-95 border border-red-500/20"
                    >
                      {months}m
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="pt-4 border-t border-zinc-800">
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Manually Set Expiry Date</label>
                <div className="flex gap-2">
                  <input 
                    type="date"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-50 text-sm"
                    value={customExpiryDate}
                    onChange={(e) => setCustomExpiryDate(e.target.value)}
                  />
                  <button 
                    onClick={() => extendTrackingCode(extendingCode, 'custom')}
                    className="bg-emerald-500 text-black px-4 py-2 rounded-lg text-xs font-bold hover:bg-emerald-400 transition-all active:scale-95"
                  >
                    Set
                  </button>
                </div>
              </div>
            </div>

            <button 
              onClick={() => setExtendingCode(null)}
              className="w-full mt-4 py-2 text-zinc-500 hover:text-white transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {extendingHotel && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-zinc-50 mb-2">Extend Subscription</h3>
            <p className="text-zinc-400 text-sm mb-6">Extending subscription for {extendingHotel.name}</p>
            
            <div className="space-y-4 mb-6">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-zinc-500 uppercase">Quick Add</label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 3, 6, 12].map(months => (
                    <button 
                      key={months}
                      onClick={() => extendSubscription(extendingHotel, months)}
                      className="bg-zinc-800 hover:bg-zinc-700 text-zinc-50 py-2 rounded-lg font-medium text-xs transition-all active:scale-95"
                    >
                      +{months}m
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-zinc-500 uppercase">Quick Correct (Reduce)</label>
                <div className="grid grid-cols-2 gap-2">
                  {[-1, -3].map(months => (
                    <button 
                      key={months}
                      onClick={() => extendSubscription(extendingHotel, months)}
                      className="bg-red-500/10 hover:bg-red-500/20 text-red-500 py-2 rounded-lg font-medium text-xs transition-all active:scale-95 border border-red-500/20"
                    >
                      {months}m
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="pt-4 border-t border-zinc-800">
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Manually Set Expiry Date</label>
                <div className="flex gap-2">
                  <input 
                    type="date"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-50 text-sm"
                    value={customExpiryDate}
                    onChange={(e) => setCustomExpiryDate(e.target.value)}
                  />
                  <button 
                    onClick={() => extendSubscription(extendingHotel, 'custom')}
                    className="bg-emerald-500 text-black px-4 py-2 rounded-lg text-xs font-bold hover:bg-emerald-400 transition-all active:scale-95"
                  >
                    Set
                  </button>
                </div>
              </div>
            </div>

            <button 
              onClick={() => setExtendingHotel(null)}
              className="w-full mt-4 py-2 text-zinc-500 hover:text-white transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {changingPlanHotel && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-zinc-50 mb-2">Change Subscription Plan</h3>
            <p className="text-zinc-400 text-sm mb-6">Updating plan for {changingPlanHotel.name}</p>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Upgrade Amount</label>
                <input 
                  type="number" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50"
                  value={planChangeAmount}
                  onChange={(e) => setPlanChangeAmount(Number(e.target.value))}
                  placeholder="Enter amount paid for upgrade"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Reason / Reference</label>
                <input 
                  type="text" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50"
                  value={planChangeReason}
                  onChange={(e) => setPlanChangeReason(e.target.value)}
                  placeholder="e.g. Upgrade to Premium"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {(['standard', 'premium', 'enterprise'] as PlanType[]).map(plan => (
                <button 
                  key={plan}
                  onClick={() => changeHotelPlan(changingPlanHotel, plan)}
                  disabled={changingPlanHotel.plan === plan}
                  className={cn(
                    "w-full py-3 rounded-lg font-medium transition-all active:scale-95 flex items-center justify-between px-6",
                    changingPlanHotel.plan === plan 
                      ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 cursor-default"
                      : "bg-zinc-800 hover:bg-zinc-700 text-zinc-50"
                  )}
                >
                  <span className="capitalize">{plan}</span>
                  {changingPlanHotel.plan === plan && <CheckCircle2 size={16} />}
                </button>
              ))}
            </div>
            <button 
              onClick={() => setChangingPlanHotel(null)}
              className="w-full mt-4 py-2 text-zinc-500 hover:text-white transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Manage Staff Modal */}
      {managingStaffHotel && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-zinc-50">Staff Management</h3>
                <p className="text-sm text-zinc-400">{managingStaffHotel.name}</p>
              </div>
              <button 
                onClick={() => setManagingStaffHotel(null)}
                className="p-2 text-zinc-500 hover:text-white transition-colors"
              >
                <XCircle size={24} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <StaffManagement hotelId={managingStaffHotel.id} />
            </div>
          </div>
        </div>
      )}

      <div className="space-y-8">
        {activeTab === 'hotels' && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h3 className="font-bold text-zinc-50">Registered Hotels</h3>
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                  <input 
                    type="text" 
                    placeholder="Search name or code..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-10 pr-4 py-1.5 text-sm text-zinc-50 focus:outline-none focus:border-emerald-500"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <select 
                  className="w-full sm:w-auto bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-50 focus:outline-none focus:border-emerald-500"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="expired">Expired</option>
                  <option value="near_expiry">Near Expiry (7d)</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800">
                    <th className="px-6 py-4">Hotel Name</th>
                    <th className="px-6 py-4">Tracking Code</th>
                    <th className="px-6 py-4">Expiry</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {filteredHotels.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-zinc-500 text-sm">
                        No hotels found matching your filters
                      </td>
                    </tr>
                  ) : (
                    filteredHotels.map(hotel => {
                      const expiryTime = new Date(hotel.subscriptionExpiry).getTime();
                      const isExpired = !isNaN(expiryTime) && expiryTime <= Date.now();
                      const remainingDays = !isNaN(expiryTime) ? (expiryTime - Date.now()) / (24 * 60 * 60 * 1000) : 0;
                      const isNearExpiry = !isExpired && remainingDays > 0 && remainingDays <= 7;
                      
                      return (
                        <tr key={hotel.id} className={cn("hover:bg-zinc-800/50 transition-colors", isNearExpiry && "bg-amber-500/5")}>
                          <td className="px-6 py-4">
                            <div className="text-sm font-medium text-zinc-50">{hotel.name}</div>
                            <div className="text-xs text-zinc-500">{hotel.plan}</div>
                          </td>
                          <td className="px-6 py-4 font-mono text-xs text-zinc-400">{hotel.trackingCode}</td>
                          <td className="px-6 py-4 text-xs">
                            <div className={cn(
                              isExpired ? "text-red-400 font-bold" : 
                              isNearExpiry ? "text-amber-400 font-bold" : 
                              "text-zinc-400"
                            )}>
                              {safeFormat(hotel.subscriptionExpiry, 'MMM d, yyyy')}
                              {isExpired && <span className="ml-2 text-[10px] uppercase tracking-tighter bg-red-500/10 px-1 rounded">(Expired)</span>}
                              {isNearExpiry && <span className="ml-2 text-[10px] uppercase tracking-tighter bg-amber-500/10 px-1 rounded">(Expiring Soon)</span>}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                              hotel.subscriptionStatus === 'active' ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                            )}>
                              {hotel.subscriptionStatus}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-2">
                              <button 
                                onClick={() => {
                                  setSelectedHotelId(hotel.id);
                                  toast.success(`Now managing ${hotel.name}`);
                                  navigate('/');
                                }}
                                className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all active:scale-90"
                                title="Manage Hotel Inventory & Accounts"
                              >
                                <ArrowRight size={18} />
                              </button>
                              <button 
                                onClick={() => setManagingStaffHotel(hotel)}
                                className="p-2 text-zinc-500 hover:text-white rounded-lg transition-all active:scale-90"
                                title="Manage Staff"
                              >
                                <Users size={18} />
                              </button>
                              <button 
                                onClick={() => setChangingPlanHotel(hotel)}
                                className="p-2 text-zinc-500 hover:text-emerald-500 rounded-lg transition-all active:scale-90"
                                title="Change Plan"
                              >
                                <Settings size={18} />
                              </button>
                              {hotel.planHistory && hotel.planHistory.length > 0 && (
                                <button 
                                  onClick={() => setShowHistoryHotel(hotel)}
                                  className="p-2 text-zinc-500 hover:text-indigo-500 rounded-lg transition-all active:scale-90"
                                  title="View Plan History"
                                >
                                  <History size={18} />
                                </button>
                              )}
                              <button 
                                onClick={() => giveLiveAccess(hotel)}
                                className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all active:scale-90"
                                title="Give Live Access"
                              >
                                <CheckCircle2 size={18} />
                              </button>
                              <button 
                                onClick={() => setExtendingHotel(hotel)}
                                className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-lg transition-all active:scale-90"
                                title="Extend Subscription"
                              >
                                <RefreshCw size={18} />
                              </button>
                              <button 
                                onClick={() => toggleHotelStatus(hotel)}
                                className={cn(
                                  "p-2 rounded-lg transition-all active:scale-90",
                                  hotel.subscriptionStatus === 'active' ? "text-zinc-500 hover:text-red-500" : "text-emerald-500 hover:text-emerald-400"
                                )}
                                title={hotel.subscriptionStatus === 'active' ? "Suspend Hotel" : "Activate Hotel"}
                              >
                                <ShieldAlert size={18} />
                              </button>
                              <button 
                                onClick={() => deleteHotel(hotel)}
                                className="p-2 text-zinc-500 hover:text-red-500 rounded-lg transition-all active:scale-90"
                                title="Delete Hotel"
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="font-bold text-zinc-50 flex items-center gap-2">
                <Mail size={18} className="text-emerald-500" />
                Tracking Code Requests
              </h3>
              <div className="flex gap-2">
                <button 
                  onClick={() => setFilterStatus('pending')}
                  className={cn(
                    "px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                    filterStatus === 'pending' ? "bg-emerald-500 text-black" : "bg-zinc-800 text-zinc-500 hover:text-white"
                  )}
                >
                  Pending
                </button>
                <button 
                  onClick={() => setFilterStatus('approved')}
                  className={cn(
                    "px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                    filterStatus === 'approved' ? "bg-emerald-500 text-black" : "bg-zinc-800 text-zinc-500 hover:text-white"
                  )}
                >
                  Approved
                </button>
              </div>
            </div>
            <div className="divide-y divide-zinc-800">
              {requests.filter(r => r.status === filterStatus).length === 0 ? (
                <div className="p-8 text-center text-zinc-500 text-sm">No {filterStatus} requests</div>
              ) : (
                requests.filter(r => r.status === filterStatus).map(request => {
                  const currentHotel = hotels.find(h => h.adminUIDs?.includes(request.id) || h.branding?.email?.toLowerCase() === request.email.toLowerCase());
                  const displayName = currentHotel?.name || request.hotelName;
                  
                  return (
                    <div key={request.id} className="p-6 hover:bg-zinc-800/50 transition-colors">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-zinc-50">{displayName}</span>
                            {currentHotel && currentHotel.name !== request.hotelName && (
                              <span className="text-[10px] text-zinc-500 italic">(Formerly: {request.hotelName})</span>
                            )}
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-500">
                            {request.plan}
                          </span>
                          {request.type === 'extension' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-500">
                              Extension
                            </span>
                          )}
                          {request.status === 'approved' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500">
                              Approved
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs text-zinc-500">
                          <div className="flex items-center gap-1">
                            <Mail size={12} />
                            {request.email}
                          </div>
                          <div className="flex items-center gap-1 text-zinc-400 italic">
                            "{request.message}"
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar size={12} />
                            {safeFormat(request.timestamp, 'MMM d, yyyy HH:mm')}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {request.status === 'pending' ? (
                          <>
                            <button 
                              onClick={() => generateCodeForRequest(request)}
                              className="flex-1 sm:flex-none bg-emerald-500 text-black px-4 py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all active:scale-95"
                            >
                              <CheckCircle2 size={14} />
                              Approve & Generate Code
                            </button>
                            <button 
                              onClick={() => rejectRequest(request.id)}
                              className="flex-1 sm:flex-none bg-zinc-800 text-zinc-400 px-4 py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-2 hover:bg-zinc-700 transition-all active:scale-95"
                            >
                              <XCircle size={14} />
                              Reject
                            </button>
                          </>
                        ) : (
                          <button 
                            onClick={() => setViewingReceipt(request)}
                            className="flex-1 sm:flex-none bg-zinc-800 text-zinc-50 px-4 py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-2 hover:bg-zinc-700 transition-all active:scale-95"
                          >
                            <Receipt size={14} />
                            View Receipt
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            </div>
          </div>
        )}

        {activeTab === 'codes' && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-800 space-y-4">
              <h3 className="font-bold text-zinc-50 flex items-center gap-2">
                <Key size={18} className="text-emerald-500" />
                Active Tracking Codes
              </h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="Search codes..."
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-zinc-50 focus:outline-none focus:border-emerald-500"
                    value={codeSearchTerm}
                    onChange={(e) => setCodeSearchTerm(e.target.value)}
                  />
                  <button
                    onClick={syncAllCodesWithHotels}
                    disabled={syncingAll}
                    className="bg-zinc-800 text-zinc-300 px-3 py-1.5 rounded-lg text-[10px] font-bold hover:bg-zinc-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={cn(syncingAll && "animate-spin")} />
                    {syncingAll ? 'Syncing...' : 'Sync with Hotels'}
                  </button>
                </div>
              </div>
            </div>
            <div className="divide-y divide-zinc-800 max-h-[600px] overflow-y-auto">
              {filteredCodes.length === 0 ? (
                <div className="p-8 text-center text-zinc-500 text-xs">No codes found</div>
              ) : (
                filteredCodes.map(code => {
                  const linkedHotel = hotels.find(h => 
                    (h.trackingCode?.trim().toUpperCase() === code.code?.trim().toUpperCase()) ||
                    (code.usedByHotel && h.id === code.usedByHotel)
                  );
                  
                  // Use hotel expiry if linked, otherwise use code expiry
                  // If both exist, show the LATEST one to avoid "Expired" confusion after extension
                  const hotelExpiry = linkedHotel ? new Date(linkedHotel.subscriptionExpiry).getTime() : 0;
                  const codeExpiry = new Date(code.expiryDate).getTime();
                  
                  const expiryTime = Math.max(hotelExpiry, codeExpiry);
                  const expiryToUse = new Date(expiryTime).toISOString();
                  const now = Date.now();
                  
                  // Determine status based on hotel if linked
                  const isActuallyActive = linkedHotel 
                    ? (linkedHotel.subscriptionStatus === 'active' && expiryTime > now)
                    : (code.status === 'active' && expiryTime > now);
                    
                  const isCodeExpired = !isActuallyActive && expiryTime <= now;
                  const remainingDays = !isNaN(expiryTime) ? (expiryTime - now) / (24 * 60 * 60 * 1000) : 0;
                  const isNearExpiry = !isCodeExpired && remainingDays > 0 && remainingDays <= 7;
                  
                  return (
                    <div key={code.id || code.code} className={cn("p-4 hover:bg-zinc-800/50 transition-colors group border-l-2 border-transparent", 
                      isActuallyActive ? "border-l-emerald-500" : isNearExpiry ? "border-l-amber-500" : "border-l-red-500",
                      isNearExpiry && "bg-amber-500/5"
                    )}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex flex-col">
                          <span className={cn(
                            "font-mono font-bold tracking-widest",
                            isActuallyActive ? "text-emerald-500" : isNearExpiry ? "text-amber-500" : "text-red-500"
                          )}>
                            {code.code}
                          </span>
                          {linkedHotel && (
                            <span className="text-[10px] text-zinc-500 font-bold uppercase truncate max-w-[150px]">
                              {linkedHotel.name}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                          <button 
                            onClick={() => setExtendingCode(code)}
                            className="p-1.5 text-zinc-500 hover:text-emerald-500 hover:bg-emerald-500/10 rounded"
                            title="Extend Expiry"
                          >
                            <RefreshCw size={14} />
                          </button>
                          <button 
                            onClick={() => {
                              setConfirmAction({
                                title: 'Delete Tracking Code',
                                message: `Are you sure you want to delete code ${code.code}? This action cannot be undone.`,
                                onConfirm: async () => {
                                  try {
                                    await database.safeDelete(doc(db, 'trackingCodes', code.id || code.code), {
                                      hotelId: 'system',
                                      module: 'SuperAdmin',
                                      action: 'DELETE_TRACKING_CODE',
                                      details: `Deleted tracking code ${code.code}`
                                    });
                                    toast.success('Tracking code deleted');
                                    setConfirmAction(null);
                                  } catch (err) {
                                    handleFirestoreError(err, OperationType.DELETE, `trackingCodes/${code.code}`);
                                    toast.error('Failed to delete code');
                                  }
                                }
                              });
                            }}
                            className="p-1.5 text-zinc-500 hover:text-red-500 hover:bg-red-500/10 rounded"
                            title="Delete Code"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-zinc-500 uppercase font-bold">
                        <div className="flex items-center gap-2">
                          <span>{linkedHotel?.plan || code.plan}</span>
                          {code.price !== undefined && code.price > 0 && (
                            <span className="text-emerald-500/80">({formatCurrency(code.price || 0, currency, exchangeRate)})</span>
                          )}
                        </div>
                        <span className={cn(
                          isActuallyActive ? "text-emerald-500" : isNearExpiry ? "text-amber-500" : "text-red-500"
                        )}>
                          {isActuallyActive ? `Active until ${safeFormat(expiryToUse, 'MMM d, yyyy')}` : 
                           isCodeExpired ? `Expired (${safeFormat(expiryToUse, 'MMM d, yyyy')})` :
                           `Inactive (${safeFormat(expiryToUse, 'MMM d, yyyy')})`}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {activeTab === 'audit' && (
          <ErrorBoundary>
            <AuditLogs />
          </ErrorBoundary>
        )}

        {activeTab === 'settings' && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-800">
              <h3 className="font-bold text-zinc-50 flex items-center gap-2">
                <Settings size={18} className="text-emerald-500" />
                System Settings
              </h3>
            </div>
            <div className="p-6 space-y-4 max-w-2xl">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1 flex items-center gap-1">
                    <Settings size={12} />
                    Exchange Rate (1 USD = ? NGN)
                  </label>
                  <input 
                    type="number" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 text-sm focus:border-emerald-500 outline-none"
                    value={settings.exchangeRate}
                    onChange={(e) => setSettings({ ...settings, exchangeRate: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1 flex items-center gap-1">
                    <LinkIcon size={12} />
                    Support Email
                  </label>
                  <input 
                    type="email" 
                    placeholder="support@example.com"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 text-sm focus:border-emerald-500 outline-none"
                    value={settings.supportEmail}
                    onChange={(e) => setSettings({ ...settings, supportEmail: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1 flex items-center gap-1">
                    Bank Name
                  </label>
                  <input 
                    type="text" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 text-sm focus:border-emerald-500 outline-none"
                    value={settings.bankName}
                    onChange={(e) => setSettings({ ...settings, bankName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1 flex items-center gap-1">
                    Account Number
                  </label>
                  <input 
                    type="text" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 text-sm focus:border-emerald-500 outline-none"
                    value={settings.accountNumber}
                    onChange={(e) => setSettings({ ...settings, accountNumber: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1 flex items-center gap-1">
                    Account Name
                  </label>
                  <input 
                    type="text" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 text-sm focus:border-emerald-500 outline-none"
                    value={settings.accountName}
                    onChange={(e) => setSettings({ ...settings, accountName: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1 flex items-center gap-1">
                  <CreditCard size={12} />
                  Payment Instructions
                </label>
                <textarea 
                  placeholder="Bank: Example Bank&#10;Account: 1234567890&#10;Name: Tyyl Tech PMS"
                  rows={4}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 text-sm focus:border-emerald-500 outline-none resize-none"
                  value={settings.paymentInstructions}
                  onChange={(e) => setSettings({ ...settings, paymentInstructions: e.target.value })}
                />
              </div>
              <button 
                onClick={updateSettings}
                className="w-full bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95 text-sm"
              >
                Save Settings
              </button>
            </div>
          </div>
        )}
      </div>
      {/* Plan History Modal */}
      {showHistoryHotel && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-bold text-zinc-50">Plan History</h3>
                <p className="text-zinc-400 text-sm">Subscription changes for {showHistoryHotel.name}</p>
              </div>
              <button 
                onClick={() => setShowHistoryHotel(null)}
                className="p-2 text-zinc-500 hover:text-zinc-50 rounded-lg"
              >
                <XCircle size={24} />
              </button>
            </div>

            <div className="space-y-4">
              {showHistoryHotel.planHistory?.slice().reverse().map((history, idx) => (
                <div key={idx} className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-400">
                        {history.previousPlan || 'Initial'}
                      </span>
                      <span className="text-zinc-600">→</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500">
                        {history.plan}
                      </span>
                    </div>
                    <span className="text-xs text-zinc-500">
                      {safeFormat(history.changedAt, 'MMM d, yyyy HH:mm')}
                    </span>
                  </div>
                  {history.amount !== undefined && history.amount > 0 && (
                    <div className="text-sm font-bold text-emerald-500 mb-1">
                      Amount: {formatCurrency(history.amount, currency, exchangeRate)}
                    </div>
                  )}
                  {history.reason && (
                    <p className="text-xs text-zinc-400 italic">"{history.reason}"</p>
                  )}
                </div>
              ))}
            </div>

            <button 
              onClick={() => setShowHistoryHotel(null)}
              className="w-full mt-8 bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold py-3 rounded-xl transition-all"
            >
              Close
            </button>
          </div>
        </div>
      )}
      {/* Receipt Modal */}
      {viewingReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl">
            <button 
              onClick={() => setViewingReceipt(null)}
              className="absolute top-4 right-4 z-10 p-2 bg-white/10 hover:bg-white/20 text-zinc-50 rounded-full transition-all print:hidden"
            >
              <XCircle size={20} />
            </button>
            <SuperAdminReceipt 
              request={{
                ...viewingReceipt,
                hotelName: hotels.find(h => h.adminUIDs?.includes(viewingReceipt.id) || h.branding?.email?.toLowerCase() === viewingReceipt.email.toLowerCase())?.name || viewingReceipt.hotelName
              }} 
              settings={settings} 
            />
          </div>
        </div>
      )}
    </div>
  );
}
