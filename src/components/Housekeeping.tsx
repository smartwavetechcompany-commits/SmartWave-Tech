import React, { useEffect, useState, useMemo } from 'react';
import { collection, query, where, doc, onSnapshot, writeBatch, orderBy, limit } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { database } from '../utils/database';
import { useAuth } from '../contexts/AuthContext';
import { 
  Room, 
  OperationType, 
  UserProfile, 
  Reservation, 
  MaintenanceRequest, 
  InventoryItem,
  HousekeepingInspectionRecord,
  HousekeepingBriefing,
  HousekeepingIncident,
  HousekeepingGuestRequest
} from '../types';
import { 
  ClipboardList, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  RefreshCw, 
  Search, 
  Download, 
  Filter, 
  X, 
  CheckSquare, 
  Square, 
  Calendar, 
  User as UserIcon,
  Sparkles,
  Wrench,
  Package,
  Plus,
  AlertTriangle,
  RotateCcw,
  FileText,
  Users,
  Eye,
  Award,
  ArrowRight,
  Send,
  Check,
  Megaphone,
  CheckCheck,
  ChevronRight,
  Briefcase,
  Shirt,
  FlaskConical,
  Layers,
  SlidersHorizontal,
  Info
} from 'lucide-react';
import { cn, exportToCSV } from '../utils';
import { hasPermission } from '../utils/permissions';
import { canUpdateRoomStatus } from '../utils/policyUtils';
import { format, isWithinInterval, parseISO, isToday } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

import { RoomProfileModal } from './housekeeping/RoomProfileModal';
import { HousekeepingInventory } from './housekeeping/HousekeepingInventory';
import { HousekeepingLostAndFound } from './housekeeping/HousekeepingLostAndFound';
import { HousekeepingLinen } from './housekeeping/HousekeepingLinen';
import { HousekeepingChemicals } from './housekeeping/HousekeepingChemicals';
import { HousekeepingDailyLogView } from './housekeeping/HousekeepingDailyLog';
import { HousekeepingStaffManagement } from './housekeeping/HousekeepingStaffManagement';

// Standard Checklists based on Housekeeping Blueprint
const BEDROOM_CHECKLIST_ITEMS = [
  { id: 'bed_made', label: 'Bed properly made' },
  { id: 'linen_changed', label: 'Linen changed' },
  { id: 'pillows_arranged', label: 'Pillows arranged' },
  { id: 'curtains_checked', label: 'Curtains checked' },
  { id: 'furniture_dusted', label: 'Furniture dusted' },
  { id: 'floor_cleaned', label: 'Floor cleaned & vacuumed' },
  { id: 'mirrors_cleaned', label: 'Mirrors cleaned' },
];

const BATHROOM_CHECKLIST_ITEMS = [
  { id: 'toilet_cleaned', label: 'Toilet cleaned & sanitized' },
  { id: 'shower_cleaned', label: 'Shower / tub cleaned' },
  { id: 'sink_cleaned', label: 'Sink cleaned & faucets polished' },
  { id: 'mirror_cleaned', label: 'Mirror cleaned' },
  { id: 'towels_replaced', label: 'Towels replaced (Bath, Hand, Mat)' },
  { id: 'toiletries_replenished', label: 'Toiletries replenished' },
  { id: 'floor_cleaned', label: 'Bathroom floor cleaned' },
];

const GUEST_SUPPLIES_ITEMS = [
  { id: 'water', label: 'Drinking water bottles' },
  { id: 'tea', label: 'Tea bags replenished' },
  { id: 'coffee', label: 'Coffee / Nescafé sachets' },
  { id: 'sugar', label: 'Sugar (White & Brown)' },
  { id: 'creamer', label: 'Creamer packets' },
  { id: 'tissue', label: 'Facial tissue box' },
  { id: 'toiletries', label: 'Soap, shampoo & dental kit' },
];

const INSPECTION_CHECKLIST_ITEMS = [
  { id: 'bed_presentation', label: 'Bed presentation & tightness' },
  { id: 'bathroom', label: 'Bathroom hygiene & sanitation' },
  { id: 'floor', label: 'Floor cleanliness & carpets' },
  { id: 'dusting', label: 'Dusting & surface wipe-down' },
  { id: 'glass_mirrors', label: 'Glass, windows & mirrors' },
  { id: 'amenities', label: 'Guest supplies & amenities setup' },
  { id: 'linen', label: 'Fresh linen quality & condition' },
  { id: 'odour', label: 'Room odour & fresh ventilation' },
  { id: 'lighting', label: 'Lighting, switches & lamps working' },
  { id: 'air_conditioning', label: 'Air conditioning cooling / heating' },
  { id: 'overall', label: 'Overall presentation & guest-ready feel' },
];

type HousekeepingTab = 
  | 'overview' 
  | 'cleaning' 
  | 'inspections' 
  | 'assignments' 
  | 'staff' 
  | 'inventory' 
  | 'linen' 
  | 'chemicals' 
  | 'lost_and_found' 
  | 'daily_log' 
  | 'requests' 
  | 'briefings' 
  | 'reports';

export function Housekeeping() {
  const navigate = useNavigate();
  const { hotel, profile } = useAuth();

  // Navigation Tab State
  const [activeTab, setActiveTab] = useState<HousekeepingTab>('overview');
  const [activeProfileRoom, setActiveProfileRoom] = useState<Room | null>(null);

  // Core Data Collections
  const [rooms, setRooms] = useState<Room[]>([]);
  const [staff, setStaff] = useState<UserProfile[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequest[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [inspections, setInspections] = useState<HousekeepingInspectionRecord[]>([]);
  const [briefings, setBriefings] = useState<HousekeepingBriefing[]>([]);
  const [incidents, setIncidents] = useState<HousekeepingIncident[]>([]);
  const [guestRequests, setGuestRequests] = useState<HousekeepingGuestRequest[]>([]);

  // Filtering & Search
  const [filter, setFilter] = useState<'all' | 'my_rooms' | 'dirty' | 'cleaning' | 'awaiting_inspection' | 'clean' | 'maintenance' | 'occupied' | 'failed'>('all');
  const [roomTypeFilter, setRoomTypeFilter] = useState<string>('all');
  const [floorFilter, setFloorFilter] = useState<string>('all');
  const [staffFilter, setStaffFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'roomNumber' | 'status' | 'floor' | 'priority'>('priority');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isLoading, setIsLoading] = useState(true);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });

  // Bulk Actions
  const [roomNotes, setRoomNotes] = useState<Record<string, string>>({});
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);
  const [assignStaffId, setAssignStaffId] = useState<string>('');

  // Modals
  const [activeCleaningRoom, setActiveCleaningRoom] = useState<Room | null>(null);
  const [bedroomChecklist, setBedroomChecklist] = useState<Record<string, boolean>>({});
  const [bathroomChecklist, setBathroomChecklist] = useState<Record<string, boolean>>({});
  const [suppliesChecklist, setSuppliesChecklist] = useState<Record<string, boolean>>({});
  const [cleaningNotes, setCleaningNotes] = useState('');

  const [activeInspectionRoom, setActiveInspectionRoom] = useState<Room | null>(null);
  const [inspectionChecklist, setInspectionChecklist] = useState<Record<string, boolean>>({});
  const [inspectionRemarks, setInspectionRemarks] = useState('');

  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [maintenanceForm, setMaintenanceForm] = useState({
    roomNumber: '',
    category: 'Plumbing',
    issue: '',
    priority: 'high' as MaintenanceRequest['priority'],
    blockRoom: false
  });

  const [showBriefingModal, setShowBriefingModal] = useState(false);
  const [briefingForm, setBriefingForm] = useState({
    shift: 'morning' as HousekeepingBriefing['shift'],
    topic: 'Guest Service — Small Things That Wow Guests',
    attendance: [] as string[],
    announcements: '',
    safetyReminders: 'Always wear protective gloves when handling sanitation chemicals.'
  });

  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [incidentForm, setIncidentForm] = useState({
    roomNumber: '',
    staffId: '',
    description: '',
    actionTaken: ''
  });

  const [showGuestRequestModal, setShowGuestRequestModal] = useState(false);
  const [guestRequestForm, setGuestRequestForm] = useState({
    roomNumber: '',
    item: 'Extra Towels',
    quantity: 2,
    priority: 'normal' as HousekeepingGuestRequest['priority'],
    notes: '',
    assignedTo: ''
  });

  const [hasPermissionError, setHasPermissionError] = useState(false);

  useEffect(() => {
    setHasPermissionError(false);
  }, [profile?.uid, hotel?.id]);

  // 1. Fetch Rooms
  useEffect(() => {
    if (!hotel?.id || !profile || hasPermissionError) return;
    setIsLoading(true);
    const q = query(collection(db, 'hotels', hotel.id, 'rooms'));
    
    const unsub = onSnapshot(q, (snap) => {
      setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
      setIsLoading(false);
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/rooms`);
      if (error.code === 'permission-denied') {
        setHasPermissionError(true);
      }
      setIsLoading(false);
    });

    return () => unsub();
  }, [hotel?.id, profile?.uid, hasPermissionError]);

  // 2. Fetch Staff
  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const q = query(collection(db, 'users'), where('hotelId', '==', hotel.id));
    const unsub = onSnapshot(q, (snap) => {
      setStaff(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    });
    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  // 3. Fetch In-house Guests
  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const q = query(
      collection(db, 'hotels', hotel.id, 'reservations'),
      where('status', '==', 'checked_in')
    );
    const unsub = onSnapshot(q, (snap) => {
      setReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
    });
    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  // 4. Fetch Maintenance Requests (Integration)
  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const q = query(collection(db, 'hotels', hotel.id, 'maintenance'), limit(50));
    const unsub = onSnapshot(q, (snap) => {
      setMaintenanceRequests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MaintenanceRequest)));
    });
    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  // 5. Fetch Inventory Low-Stock (Integration)
  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const q = query(collection(db, 'hotels', hotel.id, 'inventory'), limit(100));
    const unsub = onSnapshot(q, (snap) => {
      setInventoryItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem)));
    });
    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  // 6. Fetch Housekeeping Inspections
  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const q = query(collection(db, 'hotels', hotel.id, 'housekeeping_inspections'), orderBy('timestamp', 'desc'), limit(100));
    const unsub = onSnapshot(q, (snap) => {
      setInspections(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as HousekeepingInspectionRecord)));
    }, () => {});
    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  // 7. Fetch Briefings
  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const q = query(collection(db, 'hotels', hotel.id, 'housekeeping_briefings'), orderBy('timestamp', 'desc'), limit(50));
    const unsub = onSnapshot(q, (snap) => {
      setBriefings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as HousekeepingBriefing)));
    }, () => {});
    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  // 8. Fetch Incidents
  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const q = query(collection(db, 'hotels', hotel.id, 'housekeeping_incidents'), orderBy('timestamp', 'desc'), limit(50));
    const unsub = onSnapshot(q, (snap) => {
      setIncidents(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as HousekeepingIncident)));
    }, () => {});
    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  // 9. Fetch Guest Requests
  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const q = query(collection(db, 'hotels', hotel.id, 'housekeeping_requests'), orderBy('requestedAt', 'desc'), limit(50));
    const unsub = onSnapshot(q, (snap) => {
      setGuestRequests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as HousekeepingGuestRequest)));
    }, () => {});
    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  // --- PERMISSIONS ---
  const canEditTasks = hasPermission(profile, 'edit_housekeeping_tasks') || hasPermission(profile, 'manage_rooms') || profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin';
  const canAssignTasks = hasPermission(profile, 'assign_housekeeping_tasks') || hasPermission(profile, 'manage_rooms') || profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin';
  const canCloseTasks = hasPermission(profile, 'close_housekeeping_tasks') || hasPermission(profile, 'manage_rooms') || profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin';

  // --- METRICS COMPUTATION ---
  const metrics = useMemo(() => {
    const total = rooms.length;
    const clean = rooms.filter(r => r.status === 'clean' || r.housekeepingStatus === 'ready').length;
    const dirty = rooms.filter(r => r.status === 'dirty').length;
    const cleaning = rooms.filter(r => r.status === 'cleaning').length;
    const awaitingInspection = rooms.filter(r => r.status === 'inspected' || r.housekeepingStatus === 'awaiting_inspection').length;
    const maintenance = rooms.filter(r => r.status === 'maintenance' || r.status === 'out_of_service' || r.status === 'out_of_order').length;
    const occupied = reservations.length;
    const failed = rooms.filter(r => r.housekeepingStatus === 'failed').length;

    // Maintenance active defects count
    const activeMaintenanceCount = maintenanceRequests.filter(m => m.status !== 'completed').length;

    // Low stock count from inventory
    const lowStockCount = inventoryItems.filter(i => (i.quantity || 0) <= (i.minThreshold || 5)).length;

    // Today's inspections pass rate
    const todayInspections = inspections.filter(ins => {
      try {
        return ins.timestamp && isToday(parseISO(ins.timestamp));
      } catch {
        return false;
      }
    });
    const passedToday = todayInspections.filter(ins => ins.result === 'passed').length;
    const passRate = todayInspections.length > 0 ? Math.round((passedToday / todayInspections.length) * 100) : 100;

    return {
      total,
      clean,
      dirty,
      cleaning,
      awaitingInspection,
      maintenance,
      occupied,
      failed,
      activeMaintenanceCount,
      lowStockCount,
      todayInspectionsCount: todayInspections.length,
      passRate
    };
  }, [rooms, reservations, maintenanceRequests, inventoryItems, inspections]);

  // --- ROOM STATUS WORKFLOW ENGINE ---
  /**
   * Enforces the workflow:
   * Dirty -> Cleaning -> Awaiting Inspection -> Passed/Ready or Failed/Correction Required -> Re-inspection
   */
  const updateRoomStatus = async (
    roomId: string, 
    status: Room['status'], 
    options?: {
      assignedTo?: string;
      priority?: Room['cleaningPriority'];
      housekeepingStatus?: Room['housekeepingStatus'];
      notes?: string;
    }
  ) => {
    if (!hotel?.id || !profile) return;
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;

    if (options?.assignedTo !== undefined && options.assignedTo !== room.assignedTo) {
      if (!canAssignTasks) {
        toast.error('Access denied: You do not have permission to assign housekeeping tasks.');
        return;
      }
    }

    if (status !== room.status) {
      if (!canEditTasks && !canCloseTasks) {
        toast.error('Access denied: You do not have permission to change room housekeeping status.');
        return;
      }
    }

    // Policy check for status updates
    const policy = canUpdateRoomStatus(hotel, profile, room, status);
    if (!policy.allowed) {
      toast.error(policy.message || 'Action denied by hotel policy');
      return;
    }

    const now = new Date().toISOString();
    const updateData: any = { 
      status,
      updatedAt: now
    };

    if (options?.housekeepingStatus) {
      updateData.housekeepingStatus = options.housekeepingStatus;
    } else {
      if (status === 'clean') updateData.housekeepingStatus = 'ready';
      else if (status === 'dirty') updateData.housekeepingStatus = 'dirty';
      else if (status === 'cleaning') updateData.housekeepingStatus = 'cleaning';
      else if (status === 'inspected') updateData.housekeepingStatus = 'awaiting_inspection';
    }

    if (options?.assignedTo !== undefined) updateData.assignedTo = options.assignedTo;
    if (options?.priority) updateData.cleaningPriority = options.priority;
    if (options?.notes !== undefined) updateData.notes = options.notes;

    if (status === 'clean') updateData.lastCleanedAt = now;
    if (status === 'cleaning') updateData.cleaningStartedAt = now;
    if (status === 'maintenance' || status === 'dirty') updateData.lastFlaggedAt = now;

    try {
      await database.safeSet(doc(db, 'hotels', hotel.id, 'rooms', roomId), updateData, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'HOUSEKEEPING_UPDATE',
        details: `Updated room ${room.roomNumber} status to ${status} (${updateData.housekeepingStatus || status})`
      });

      await database.safeAdd(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: now,
        userId: profile.uid,
        userEmail: profile.email || 'system',
        userRole: profile.role || 'staff',
        action: 'HOUSEKEEPING_STATUS_CHANGE',
        resource: `Room ${room.roomNumber}: ${status.toUpperCase()} [${updateData.housekeepingStatus || ''}]`,
        hotelId: hotel.id,
        module: 'Housekeeping'
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'Room status update logged'
      });

      toast.success(`Room ${room.roomNumber} set to ${status.replace(/_/g, ' ')}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms/${roomId}`);
      toast.error('Failed to update room status');
    }
  };

  // --- CLEANING MODAL HANDLERS ---
  const handleStartCleaning = (room: Room) => {
    setActiveCleaningRoom(room);
    setBedroomChecklist({});
    setBathroomChecklist({});
    setSuppliesChecklist({});
    setCleaningNotes(room.notes || '');

    // Set room to cleaning state immediately
    if (room.status !== 'cleaning') {
      updateRoomStatus(room.id, 'cleaning', {
        housekeepingStatus: 'cleaning',
        assignedTo: room.assignedTo || profile?.uid
      });
    }
  };

  const handleCompleteCleaning = async () => {
    if (!activeCleaningRoom || !hotel?.id || !profile) return;

    const roomId = activeCleaningRoom.id;
    const roomNumber = activeCleaningRoom.roomNumber;
    const now = new Date().toISOString();

    try {
      // 1. Advance room to "Awaiting Inspection" (room.status = 'inspected', housekeepingStatus = 'awaiting_inspection')
      await database.safeSet(doc(db, 'hotels', hotel.id, 'rooms', roomId), {
        status: 'inspected',
        housekeepingStatus: 'awaiting_inspection',
        lastCleanedAt: now,
        notes: cleaningNotes,
        updatedAt: now
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'CLEANING_COMPLETED',
        details: `Room ${roomNumber} cleaning completed and submitted for supervisor inspection`
      });

      // 2. Save Cleaning Record under hotel
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'housekeeping_cleanings'), {
        roomId,
        roomNumber,
        housekeeperId: profile.uid,
        housekeeperName: profile.displayName || profile.email,
        completedAt: now,
        bedroomChecklist,
        bathroomChecklist,
        suppliesChecklist,
        notes: cleaningNotes,
        status: 'awaiting_inspection'
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'CLEANING_RECORD_SAVED',
        details: `Checklist completed for Room ${roomNumber}`
      });

      toast.success(`Room ${roomNumber} cleaning completed! Sent for Supervisor Inspection.`);
      setActiveCleaningRoom(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms/${roomId}`);
      toast.error('Failed to submit cleaning checklist');
    }
  };

  const handleCheckAllCleaning = () => {
    const allBed: Record<string, boolean> = {};
    BEDROOM_CHECKLIST_ITEMS.forEach(i => allBed[i.id] = true);
    setBedroomChecklist(allBed);

    const allBath: Record<string, boolean> = {};
    BATHROOM_CHECKLIST_ITEMS.forEach(i => allBath[i.id] = true);
    setBathroomChecklist(allBath);

    const allSupplies: Record<string, boolean> = {};
    GUEST_SUPPLIES_ITEMS.forEach(i => allSupplies[i.id] = true);
    setSuppliesChecklist(allSupplies);
  };

  // --- INSPECTION MODAL HANDLERS ---
  const handleOpenInspection = (room: Room) => {
    setActiveInspectionRoom(room);
    // Pre-fill inspection items as checked by default for fast verification
    const initial: Record<string, boolean> = {};
    INSPECTION_CHECKLIST_ITEMS.forEach(i => initial[i.id] = true);
    setInspectionChecklist(initial);
    setInspectionRemarks('');
  };

  const handleInspectionDecision = async (decision: 'passed' | 'failed') => {
    if (!activeInspectionRoom || !hotel?.id || !profile) return;

    if (!canCloseTasks) {
      toast.error('Access denied: Only Housekeeping Supervisors or Administrators can conduct room inspections.');
      return;
    }

    const room = activeInspectionRoom;
    const now = new Date().toISOString();
    const passedCount = Object.values(inspectionChecklist).filter(Boolean).length;
    const totalCount = INSPECTION_CHECKLIST_ITEMS.length;
    const score = Math.round((passedCount / totalCount) * 100);

    try {
      if (decision === 'passed') {
        // Status: Passed -> Clean & Ready for Guest
        await database.safeSet(doc(db, 'hotels', hotel.id, 'rooms', room.id), {
          status: 'clean',
          housekeepingStatus: 'ready',
          lastInspectedAt: now,
          lastInspectorId: profile.uid,
          lastInspectionResult: 'passed',
          notes: inspectionRemarks || 'Inspected and certified clean',
          updatedAt: now
        }, {
          hotelId: hotel.id,
          module: 'Housekeeping',
          action: 'ROOM_INSPECTION_PASSED',
          details: `Room ${room.roomNumber} passed inspection (${score}%) - Ready for guest`
        });
        toast.success(`Room ${room.roomNumber} PASSED! Marked Clean & Ready for Guest.`);
      } else {
        // Status: Failed -> Correction Required (Room goes back to Dirty / Correction)
        await database.safeSet(doc(db, 'hotels', hotel.id, 'rooms', room.id), {
          status: 'dirty',
          housekeepingStatus: 'failed',
          lastInspectedAt: now,
          lastInspectorId: profile.uid,
          lastInspectionResult: 'failed',
          notes: `Correction Required: ${inspectionRemarks || 'Items failed during inspection'}`,
          updatedAt: now
        }, {
          hotelId: hotel.id,
          module: 'Housekeeping',
          action: 'ROOM_INSPECTION_FAILED',
          details: `Room ${room.roomNumber} failed inspection (${score}%) - Correction required`
        });
        toast.error(`Room ${room.roomNumber} marked as FAILED. Correction required.`);
      }

      // Log Inspection Record
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'housekeeping_inspections'), {
        roomId: room.id,
        roomNumber: room.roomNumber,
        inspectorId: profile.uid,
        inspectorName: profile.displayName || profile.email,
        housekeeperId: room.assignedTo || '',
        housekeeperName: staff.find(s => s.uid === room.assignedTo)?.displayName || 'Unassigned',
        timestamp: now,
        score,
        result: decision,
        checklist: inspectionChecklist,
        remarks: inspectionRemarks,
        correctionsNeeded: decision === 'failed' ? inspectionRemarks : ''
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'INSPECTION_LOG_CREATED',
        details: `Room ${room.roomNumber} inspection ${decision.toUpperCase()}`
      });

      setActiveInspectionRoom(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms/${room.id}`);
      toast.error('Failed to submit inspection record');
    }
  };

  // --- BULK OPERATIONS ---
  const toggleRoomSelection = (roomId: string) => {
    setSelectedRoomIds(prev => 
      prev.includes(roomId) ? prev.filter(id => id !== roomId) : [...prev, roomId]
    );
  };

  const handleBulkAssign = async () => {
    if (!hotel?.id || selectedRoomIds.length === 0 || !assignStaffId) return;
    const loadingToast = toast.loading(`Assigning ${selectedRoomIds.length} rooms...`);
    const now = new Date().toISOString();
    const staffMember = staff.find(s => s.uid === assignStaffId);

    try {
      const batch = writeBatch(db);
      selectedRoomIds.forEach(roomId => {
        batch.update(doc(db, 'hotels', hotel.id!, 'rooms', roomId), { 
          assignedTo: assignStaffId,
          updatedAt: now
        });
      });

      await database.commitBatch(hotel.id, batch, {
        module: 'Housekeeping',
        action: 'HOUSEKEEPING_BULK_ASSIGN',
        details: `Assigned ${selectedRoomIds.length} rooms to ${staffMember?.displayName || assignStaffId}`
      });

      toast.dismiss(loadingToast);
      toast.success(`Assigned ${selectedRoomIds.length} rooms to ${staffMember?.displayName || staffMember?.email}`);
      setSelectedRoomIds([]);
      setAssignStaffId('');
    } catch (err) {
      toast.dismiss(loadingToast);
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms/bulk-assign`);
      toast.error('Failed to assign rooms');
    }
  };

  const handleBulkUpdate = async (status: Room['status']) => {
    if (!hotel?.id || selectedRoomIds.length === 0) return;
    const loadingToast = toast.loading(`Updating ${selectedRoomIds.length} rooms...`);
    const now = new Date().toISOString();

    try {
      const batch = writeBatch(db);
      for (const roomId of selectedRoomIds) {
        const room = rooms.find(r => r.id === roomId);
        if (!room) continue;

        const policy = canUpdateRoomStatus(hotel, profile, room, status);
        if (!policy.allowed) {
          toast.error(`Policy violation for Room ${room.roomNumber}: ${policy.message}`);
          setSelectedRoomIds([]);
          toast.dismiss(loadingToast);
          return;
        }

        const updateData: any = { 
          status, 
          housekeepingStatus: status === 'clean' ? 'ready' : (status === 'dirty' ? 'dirty' : status),
          updatedAt: now
        };
        if (status === 'clean') updateData.lastCleanedAt = now;
        if (status === 'maintenance' || status === 'dirty') updateData.lastFlaggedAt = now;

        batch.update(doc(db, 'hotels', hotel.id!, 'rooms', roomId), updateData);
      }

      await database.commitBatch(hotel.id, batch, {
        module: 'Housekeeping',
        action: 'HOUSEKEEPING_BULK_UPDATE',
        details: `Bulk updated ${selectedRoomIds.length} rooms to ${status}`
      });

      toast.dismiss(loadingToast);
      toast.success(`Updated ${selectedRoomIds.length} rooms to ${status.replace(/_/g, ' ')}`);
      setSelectedRoomIds([]);
    } catch (err) {
      toast.dismiss(loadingToast);
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms/bulk`);
      toast.error('Failed to update rooms');
    }
  };

  // --- MAINTENANCE REPORTING INTEGRATION ---
  const handleReportMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !maintenanceForm.roomNumber || !maintenanceForm.issue) {
      toast.error('Please specify room number and defect description');
      return;
    }

    const now = new Date().toISOString();
    try {
      // 1. Create ticket in existing maintenance collection
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'maintenance'), {
        roomNumber: maintenanceForm.roomNumber,
        issue: `[${maintenanceForm.category}] ${maintenanceForm.issue}`,
        priority: maintenanceForm.priority,
        status: 'pending',
        reportedBy: profile.displayName || profile.email,
        reportedByUid: profile.uid,
        timestamp: now,
        notes: `Reported by Housekeeping Department. Category: ${maintenanceForm.category}`
      }, {
        hotelId: hotel.id,
        module: 'Maintenance',
        action: 'MAINTENANCE_REQUEST_CREATE',
        details: `Housekeeping defect report for Room ${maintenanceForm.roomNumber}`
      });

      // 2. Optionally put room into maintenance block
      if (maintenanceForm.blockRoom) {
        const room = rooms.find(r => r.roomNumber === maintenanceForm.roomNumber);
        if (room) {
          await updateRoomStatus(room.id, 'maintenance', {
            notes: `Maintenance defect: ${maintenanceForm.issue}`
          });
        }
      }

      toast.success(`Maintenance ticket created for Room ${maintenanceForm.roomNumber}`);
      setShowMaintenanceModal(false);
      setMaintenanceForm({
        roomNumber: '',
        category: 'Plumbing',
        issue: '',
        priority: 'high',
        blockRoom: false
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/maintenance`);
      toast.error('Failed to log maintenance request');
    }
  };

  // --- STAND-UP BRIEFING HANDLER ---
  const handleSaveBriefing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !briefingForm.topic) return;

    const now = new Date().toISOString();
    try {
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'housekeeping_briefings'), {
        date: format(new Date(), 'yyyy-MM-dd'),
        shift: briefingForm.shift,
        supervisorId: profile.uid,
        supervisorName: profile.displayName || profile.email,
        topic: briefingForm.topic,
        attendance: briefingForm.attendance,
        announcements: briefingForm.announcements,
        safetyReminders: briefingForm.safetyReminders,
        timestamp: now
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'BRIEFING_RECORD_SAVED',
        details: `Daily Stand-up Briefing saved for ${briefingForm.shift} shift`
      });

      toast.success('Daily Stand-up Briefing recorded successfully');
      setShowBriefingModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/housekeeping_briefings`);
      toast.error('Failed to save briefing');
    }
  };

  // --- GUEST REQUEST HANDLER ---
  const handleSaveGuestRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !guestRequestForm.roomNumber || !guestRequestForm.item) return;

    const room = rooms.find(r => r.roomNumber === guestRequestForm.roomNumber);
    const now = new Date().toISOString();

    try {
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'housekeeping_requests'), {
        roomId: room?.id || '',
        roomNumber: guestRequestForm.roomNumber,
        item: guestRequestForm.item,
        quantity: guestRequestForm.quantity,
        notes: guestRequestForm.notes,
        priority: guestRequestForm.priority,
        status: 'received',
        assignedTo: guestRequestForm.assignedTo,
        assignedStaffName: staff.find(s => s.uid === guestRequestForm.assignedTo)?.displayName || '',
        requestedAt: now
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'GUEST_REQUEST_LOGGED',
        details: `Guest request for Room ${guestRequestForm.roomNumber}: ${guestRequestForm.item}`
      });

      toast.success(`Request for Room ${guestRequestForm.roomNumber} logged`);
      setShowGuestRequestModal(false);
      setGuestRequestForm({
        roomNumber: '',
        item: 'Extra Towels',
        quantity: 2,
        priority: 'normal',
        notes: '',
        assignedTo: ''
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/housekeeping_requests`);
      toast.error('Failed to log guest request');
    }
  };

  const handleUpdateGuestRequestStatus = async (requestId: string, status: HousekeepingGuestRequest['status']) => {
    if (!hotel?.id) return;
    try {
      await database.safeSet(doc(db, 'hotels', hotel.id, 'housekeeping_requests', requestId), {
        status,
        ...(status === 'completed' ? { completedAt: new Date().toISOString() } : {})
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'GUEST_REQUEST_UPDATE',
        details: `Request ${requestId} status updated to ${status}`
      });
      toast.success(`Request marked as ${status}`);
    } catch (err) {
      toast.error('Failed to update request');
    }
  };

  // --- FILTERED ROOMS ---
  const filteredRooms = useMemo(() => {
    return rooms.filter(r => {
      // 1. Filter by Quick Mode / Status
      if (filter === 'my_rooms') {
        if (r.assignedTo !== profile?.uid) return false;
      } else if (filter === 'dirty') {
        if (r.status !== 'dirty') return false;
      } else if (filter === 'cleaning') {
        if (r.status !== 'cleaning') return false;
      } else if (filter === 'awaiting_inspection') {
        if (r.status !== 'inspected' && r.housekeepingStatus !== 'awaiting_inspection') return false;
      } else if (filter === 'clean') {
        if (r.status !== 'clean' && r.housekeepingStatus !== 'ready') return false;
      } else if (filter === 'maintenance') {
        if (r.status !== 'maintenance' && r.status !== 'out_of_service' && r.status !== 'out_of_order') return false;
      } else if (filter === 'occupied') {
        if (!reservations.some(res => res.roomId === r.id)) return false;
      } else if (filter === 'failed') {
        if (r.housekeepingStatus !== 'failed') return false;
      }

      // 2. Room Type Filter
      if (roomTypeFilter !== 'all' && r.type !== roomTypeFilter) return false;

      // 3. Floor Filter
      if (floorFilter !== 'all' && r.floor?.toString() !== floorFilter) return false;

      // 4. Staff Filter
      if (staffFilter !== 'all') {
        if (staffFilter === 'unassigned') {
          if (r.assignedTo) return false;
        } else if (r.assignedTo !== staffFilter) {
          return false;
        }
      }

      // 5. Search Query (Number, Status, Notes, Type, Cleaner name)
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const cleanerName = staff.find(s => s.uid === r.assignedTo)?.displayName?.toLowerCase() || '';
        const guestName = reservations.find(res => res.roomId === r.id)?.guestName?.toLowerCase() || '';
        const match = 
          r.roomNumber.toLowerCase().includes(query) ||
          r.status.toLowerCase().includes(query) ||
          (r.notes || '').toLowerCase().includes(query) ||
          r.type.toLowerCase().includes(query) ||
          cleanerName.includes(query) ||
          guestName.includes(query);
        if (!match) return false;
      }

      return true;
    });
  }, [rooms, filter, roomTypeFilter, floorFilter, staffFilter, searchQuery, reservations, staff, profile?.uid]);

  // --- SORTED ROOMS ---
  const sortedRooms = useMemo(() => {
    return [...filteredRooms].sort((a, b) => {
      let result = 0;
      if (sortBy === 'priority') {
        const pOrder: Record<string, number> = { urgent: 4, high: 3, normal: 2, low: 1 };
        const pA = pOrder[a.cleaningPriority || 'normal'] || 2;
        const pB = pOrder[b.cleaningPriority || 'normal'] || 2;
        result = pA - pB;
      } else if (sortBy === 'status') {
        result = a.status.localeCompare(b.status);
      } else if (sortBy === 'floor') {
        result = Number(a.floor || 0) - Number(b.floor || 0);
      } else {
        result = a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true });
      }
      return sortOrder === 'desc' ? -result : result;
    });
  }, [filteredRooms, sortBy, sortOrder]);

  const roomTypes = useMemo(() => Array.from(new Set(rooms.map(r => r.type).filter(Boolean))), [rooms]);
  const floors = useMemo(() => Array.from(new Set(rooms.map(r => r.floor?.toString()).filter(Boolean))).sort((a, b) => Number(a) - Number(b)), [rooms]);

  // --- EXPORT FUNCTION ---
  const handleExportHousekeeping = () => {
    const dataToExport = filteredRooms.map(r => {
      const activeRes = reservations.find(res => res.roomId === r.id);
      const cleaner = staff.find(s => s.uid === r.assignedTo);
      return {
        Room: r.roomNumber,
        Type: r.type,
        Floor: r.floor,
        HousekeepingStatus: (r.housekeepingStatus || r.status).replace(/_/g, ' ').toUpperCase(),
        Occupancy: activeRes ? `Occupied (${activeRes.guestName})` : 'Vacant',
        Priority: (r.cleaningPriority || 'normal').toUpperCase(),
        AssignedStaff: cleaner?.displayName || cleaner?.email || 'Unassigned',
        LastCleaned: r.lastCleanedAt ? format(parseISO(r.lastCleanedAt), 'yyyy-MM-dd HH:mm') : 'N/A',
        Notes: r.notes || ''
      };
    });
    exportToCSV(dataToExport, `housekeeping_operations_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    toast.success('Housekeeping operational report exported');
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* 1. Header with Primary Context and Quick Action Launcher */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
              <ClipboardList size={22} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black text-zinc-50 tracking-tight">Housekeeping Operations</h1>
              <p className="text-xs sm:text-sm text-zinc-400">Complete room turnaround, cleaning checklist, inspections & shift management</p>
            </div>
          </div>
        </div>

        {/* Quick Action Launcher Toolbar (Blueprint Section 1) */}
        <div className="flex flex-wrap items-center gap-2">
          <button 
            onClick={() => {
              const firstDirty = rooms.find(r => r.status === 'dirty');
              if (firstDirty) handleStartCleaning(firstDirty);
              else setActiveTab('cleaning');
            }}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold rounded-xl transition-all active:scale-95 shadow-md shadow-emerald-500/10"
            title="Start Cleaning next dirty room"
          >
            <Sparkles size={14} />
            <span>Start Cleaning</span>
          </button>

          <button 
            onClick={() => setShowMaintenanceModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs font-bold rounded-xl transition-all active:scale-95"
            title="Report Maintenance Defect"
          >
            <Wrench size={14} />
            <span>Report Maintenance</span>
          </button>

          <button 
            onClick={() => setActiveTab('inventory')}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-xs font-bold rounded-xl transition-all active:scale-95"
            title="Add / Manage Inventory"
          >
            <Package size={14} />
            <span>Add Inventory</span>
          </button>

          <button 
            onClick={() => setActiveTab('lost_and_found')}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 text-xs font-bold rounded-xl transition-all active:scale-95"
            title="Hotel Lost & Found"
          >
            <Briefcase size={14} />
            <span>Lost & Found</span>
          </button>

          <button 
            onClick={() => setActiveTab('inspections')}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs font-bold rounded-xl transition-all active:scale-95"
            title="Room Quality Inspection"
          >
            <Eye size={14} />
            <span>Room Inspection</span>
          </button>

          <button 
            onClick={() => setShowBriefingModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 text-xs font-bold rounded-xl transition-all active:scale-95"
            title="Conduct Daily Stand-up Briefing"
          >
            <Megaphone size={14} />
            <span>Daily Briefing</span>
          </button>

          <button 
            onClick={handleExportHousekeeping}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 text-xs font-bold rounded-xl transition-all active:scale-95"
            title="Export Report"
          >
            <Download size={14} />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </header>

      {/* Real-time Housekeeping Alerts Banner (Blueprint Section 18) */}
      {(metrics.awaitingInspection > 0 || metrics.activeMaintenanceCount > 0 || metrics.lowStockCount > 0) && (
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 flex items-center gap-1">
              <AlertTriangle size={12} className="text-amber-400" />
              Live Alerts:
            </span>
            {metrics.awaitingInspection > 0 && (
              <button 
                onClick={() => setActiveTab('inspections')}
                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-all flex items-center gap-1.5 animate-pulse"
              >
                <Clock size={12} />
                <span>{metrics.awaitingInspection} Awaiting Inspection</span>
              </button>
            )}
            {metrics.activeMaintenanceCount > 0 && (
              <button 
                onClick={() => setShowMaintenanceModal(true)}
                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30 transition-all flex items-center gap-1.5"
              >
                <Wrench size={12} />
                <span>{metrics.activeMaintenanceCount} Maintenance Issues</span>
              </button>
            )}
            {metrics.lowStockCount > 0 && (
              <button 
                onClick={() => setActiveTab('inventory')}
                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 transition-all flex items-center gap-1.5"
              >
                <Package size={12} />
                <span>{metrics.lowStockCount} Low-Stock Items</span>
              </button>
            )}
          </div>
          <span className="text-[11px] text-zinc-500 font-mono">Live Firestore Sync Active</span>
        </div>
      )}

      {/* 2. Housekeeping Operational Dashboard Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-2.5 sm:gap-3">
        <div className="bg-zinc-900/80 border border-zinc-800/80 p-3 rounded-xl flex flex-col justify-between">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Total Rooms</span>
          <div className="text-xl sm:text-2xl font-black text-zinc-50 mt-1">{metrics.total}</div>
        </div>

        <div className="bg-zinc-900/80 border border-emerald-500/20 p-3 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Clean & Ready</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-emerald-400 mt-1">{metrics.clean}</div>
        </div>

        <div className="bg-zinc-900/80 border border-red-500/20 p-3 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Dirty</span>
            <span className="w-2 h-2 rounded-full bg-red-500" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-red-400 mt-1">{metrics.dirty}</div>
        </div>

        <div className="bg-zinc-900/80 border border-blue-500/20 p-3 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Occupied</span>
            <span className="w-2 h-2 rounded-full bg-blue-500" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-blue-400 mt-1">{metrics.occupied}</div>
        </div>

        <div className="bg-zinc-900/80 border border-purple-500/20 p-3 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">Cleaning</span>
            <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-purple-400 mt-1">{metrics.cleaning}</div>
        </div>

        <div className="bg-zinc-900/80 border border-amber-500/20 p-3 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Awaiting Insp.</span>
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-bounce" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-amber-400 mt-1">{metrics.awaitingInspection}</div>
        </div>

        <div className="bg-zinc-900/80 border border-zinc-800/80 p-3 rounded-xl flex flex-col justify-between">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Out of Order</span>
          <div className="text-xl sm:text-2xl font-black text-zinc-300 mt-1">{metrics.maintenance}</div>
        </div>

        {/* Maintenance Integration Quick Card */}
        <div 
          onClick={() => setShowMaintenanceModal(true)}
          className="bg-zinc-900/80 border border-amber-500/30 p-3 rounded-xl flex flex-col justify-between cursor-pointer hover:bg-amber-500/5 transition-all group"
          title="Click to report or review maintenance defects"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Maintenance</span>
            <Wrench size={12} className="text-amber-400 group-hover:rotate-45 transition-transform" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-amber-400 mt-1">{metrics.activeMaintenanceCount}</div>
        </div>

        {/* Inventory Integration Quick Card */}
        <div 
          onClick={() => setActiveTab('inventory')}
          className="bg-zinc-900/80 border border-emerald-500/30 p-3 rounded-xl flex flex-col justify-between cursor-pointer hover:bg-emerald-500/5 transition-all group"
          title="Click to view Housekeeping Inventory"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Low Supplies</span>
            <Package size={12} className="text-emerald-400 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-emerald-400 mt-1">{metrics.lowStockCount}</div>
        </div>
      </div>

      {/* 3. Navigation Tabs (Complete Blueprint Genesis to Revelation) */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar border-b border-zinc-800/80 pb-2">
        <button
          onClick={() => setActiveTab('overview')}
          className={cn(
            "px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2",
            activeTab === 'overview'
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"
          )}
        >
          <ClipboardList size={14} />
          <span>Room Board</span>
          <span className="text-[10px] font-mono px-1 rounded bg-black/20">{rooms.length}</span>
        </button>

        <button
          onClick={() => setActiveTab('cleaning')}
          className={cn(
            "px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2",
            activeTab === 'cleaning'
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"
          )}
        >
          <Sparkles size={14} />
          <span>Cleaning Queue</span>
          {metrics.cleaning > 0 && (
            <span className="text-[10px] font-mono px-1.5 rounded bg-purple-500 text-white font-bold">{metrics.cleaning}</span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('inspections')}
          className={cn(
            "px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2",
            activeTab === 'inspections'
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"
          )}
        >
          <Eye size={14} />
          <span>Inspections</span>
          {metrics.awaitingInspection > 0 && (
            <span className="text-[10px] font-mono px-1.5 rounded bg-amber-500 text-black font-bold animate-pulse">{metrics.awaitingInspection}</span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('assignments')}
          className={cn(
            "px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2",
            activeTab === 'assignments'
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"
          )}
        >
          <Users size={14} />
          <span>Daily Assignments</span>
        </button>

        <button
          onClick={() => setActiveTab('staff')}
          className={cn(
            "px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2",
            activeTab === 'staff'
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"
          )}
        >
          <UserIcon size={14} />
          <span>Staff & Team</span>
        </button>

        <button
          onClick={() => setActiveTab('inventory')}
          className={cn(
            "px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2",
            activeTab === 'inventory'
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"
          )}
        >
          <Package size={14} />
          <span>Stock & Inventory</span>
          {metrics.lowStockCount > 0 && (
            <span className="text-[10px] font-mono px-1.5 rounded bg-purple-500 text-white font-bold">{metrics.lowStockCount}</span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('linen')}
          className={cn(
            "px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2",
            activeTab === 'linen'
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"
          )}
        >
          <Shirt size={14} />
          <span>Linen Management</span>
        </button>

        <button
          onClick={() => setActiveTab('chemicals')}
          className={cn(
            "px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2",
            activeTab === 'chemicals'
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"
          )}
        >
          <FlaskConical size={14} />
          <span>Chemicals & Safety</span>
        </button>

        <button
          onClick={() => setActiveTab('lost_and_found')}
          className={cn(
            "px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2",
            activeTab === 'lost_and_found'
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"
          )}
        >
          <Briefcase size={14} />
          <span>Lost & Found</span>
        </button>

        <button
          onClick={() => setActiveTab('daily_log')}
          className={cn(
            "px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2",
            activeTab === 'daily_log'
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"
          )}
        >
          <FileText size={14} />
          <span>Daily Handover Log</span>
        </button>

        <button
          onClick={() => setActiveTab('requests')}
          className={cn(
            "px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2",
            activeTab === 'requests'
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"
          )}
        >
          <AlertTriangle size={14} />
          <span>Guest Requests</span>
          {guestRequests.filter(r => r.status === 'received').length > 0 && (
            <span className="text-[10px] font-mono px-1.5 rounded bg-red-500 text-white font-bold">
              {guestRequests.filter(r => r.status === 'received').length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('briefings')}
          className={cn(
            "px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2",
            activeTab === 'briefings'
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"
          )}
        >
          <Megaphone size={14} />
          <span>Briefings</span>
        </button>

        <button
          onClick={() => setActiveTab('reports')}
          className={cn(
            "px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2",
            activeTab === 'reports'
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"
          )}
        >
          <FileText size={14} />
          <span>Performance & Reports</span>
        </button>
      </div>

      {/* 4. TAB CONTENT: Overview (The Main Room Turnaround Board) */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
              {/* Quick Status Segmented Pills */}
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar w-full sm:w-auto">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'my_rooms', label: 'My Rooms' },
                  { id: 'dirty', label: 'Dirty', count: metrics.dirty },
                  { id: 'cleaning', label: 'Cleaning', count: metrics.cleaning },
                  { id: 'awaiting_inspection', label: 'Awaiting Insp.', count: metrics.awaitingInspection },
                  { id: 'clean', label: 'Ready / Clean', count: metrics.clean },
                  { id: 'failed', label: 'Failed', count: metrics.failed },
                  { id: 'maintenance', label: 'Maintenance' },
                  { id: 'occupied', label: 'Occupied' },
                ].map(item => (
                  <button
                    key={item.id}
                    onClick={() => setFilter(item.id as any)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap flex items-center gap-1",
                      filter === item.id
                        ? "bg-zinc-800 text-emerald-400 border border-emerald-500/30"
                        : "text-zinc-400 hover:text-white hover:bg-zinc-950/50"
                    )}
                  >
                    <span>{item.label}</span>
                    {item.count !== undefined && item.count > 0 && (
                      <span className={cn(
                        "text-[9px] px-1 rounded font-mono font-bold",
                        item.id === 'dirty' ? "bg-red-500/20 text-red-400" :
                        item.id === 'cleaning' ? "bg-purple-500/20 text-purple-400" :
                        item.id === 'awaiting_inspection' ? "bg-amber-500/20 text-amber-400" :
                        "bg-zinc-800 text-zinc-300"
                      )}>
                        {item.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Dropdown Filters and Search */}
            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
              <div className="relative flex-1 sm:w-56">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search room, cleaner, guest..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-zinc-50 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <select
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none"
                value={floorFilter}
                onChange={(e) => setFloorFilter(e.target.value)}
              >
                <option value="all">All Floors</option>
                {floors.map(f => (
                  <option key={f} value={f}>Floor {f}</option>
                ))}
              </select>

              <select
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none"
                value={staffFilter}
                onChange={(e) => setStaffFilter(e.target.value)}
              >
                <option value="all">All Housekeepers</option>
                <option value="unassigned">Unassigned Only</option>
                {staff.map(s => (
                  <option key={s.uid} value={s.uid}>{s.displayName || s.email}</option>
                ))}
              </select>

              <select
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
              >
                <option value="priority">Priority First</option>
                <option value="roomNumber">Room Number</option>
                <option value="status">Status</option>
                <option value="floor">Floor</option>
              </select>
            </div>
          </div>

          {/* Room Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <AnimatePresence mode="popLayout">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 h-64 animate-pulse space-y-4">
                    <div className="w-24 h-6 bg-zinc-800 rounded" />
                    <div className="w-full h-24 bg-zinc-800 rounded-xl" />
                  </div>
                ))
              ) : sortedRooms.length === 0 ? (
                <div className="col-span-full py-16 text-center text-zinc-500 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl space-y-2">
                  <ClipboardList size={32} className="mx-auto text-zinc-600 mb-2" />
                  <p className="font-bold text-zinc-300">No rooms found</p>
                  <p className="text-xs text-zinc-500">Try clearing filters or search query</p>
                </div>
              ) : (
                sortedRooms.map(room => {
                  const activeRes = reservations.find(res => res.roomId === room.id);
                  const isSelected = selectedRoomIds.includes(room.id);
                  const cleaner = staff.find(s => s.uid === room.assignedTo);
                  const isAwaitingInspection = room.status === 'inspected' || room.housekeepingStatus === 'awaiting_inspection';
                  const isCleaning = room.status === 'cleaning';
                  const isFailed = room.housekeepingStatus === 'failed';
                  const isReady = room.status === 'clean' || room.housekeepingStatus === 'ready';
                  const isDirty = room.status === 'dirty';

                  const priority = room.cleaningPriority || 'normal';

                  return (
                    <div
                      key={room.id}
                      className={cn(
                        "bg-zinc-900 border rounded-2xl p-4.5 space-y-3.5 flex flex-col transition-all relative group shadow-md shadow-black/20",
                        isSelected 
                          ? "border-emerald-500 ring-2 ring-emerald-500/20" 
                          : isFailed
                            ? "border-red-500/40 bg-red-950/5"
                            : isAwaitingInspection
                              ? "border-amber-500/40 bg-amber-950/5"
                              : isCleaning
                                ? "border-purple-500/40 bg-purple-950/5"
                                : "border-zinc-800/80 hover:border-zinc-700"
                      )}
                    >
                      {/* Checkbox for bulk selection */}
                      <button
                        type="button"
                        onClick={() => toggleRoomSelection(room.id)}
                        className="absolute top-3.5 right-3.5 text-zinc-600 hover:text-emerald-400 transition-colors"
                      >
                        {isSelected ? <CheckSquare size={18} className="text-emerald-500" /> : <Square size={18} />}
                      </button>

                      {/* Header Row: Room Number & Priority */}
                      <div className="flex items-start justify-between pr-8">
                        <div 
                          onClick={() => setActiveProfileRoom(room)}
                          className="cursor-pointer group/title"
                          title="Click to view complete Room Profile"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xl font-black text-zinc-50 group-hover/title:text-emerald-400 transition-colors tracking-tight">Room {room.roomNumber}</span>
                            {/* Priority Badge */}
                            {priority === 'urgent' && (
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-red-500 text-white animate-pulse">
                                URGENT
                              </span>
                            )}
                            {priority === 'high' && (
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-amber-500 text-black">
                                HIGH
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mt-0.5">
                            {room.type} • Floor {room.floor}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => setActiveProfileRoom(room)}
                          className="px-2 py-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white text-[10px] font-bold transition-all flex items-center gap-1"
                          title="View complete Room Profile"
                        >
                          <Info size={12} />
                          <span>Profile</span>
                        </button>
                      </div>

                      {/* Status Badges Row */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* Housekeeping Workflow Status */}
                        {isReady && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                            <CheckCircle2 size={11} />
                            Clean & Ready
                          </span>
                        )}
                        {isAwaitingInspection && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                            <Clock size={11} />
                            Awaiting Inspection
                          </span>
                        )}
                        {isCleaning && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-1">
                            <Sparkles size={11} className="animate-spin" />
                            Cleaning in Progress
                          </span>
                        )}
                        {isDirty && !isFailed && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1">
                            <AlertCircle size={11} />
                            Dirty
                          </span>
                        )}
                        {isFailed && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-red-500 text-white flex items-center gap-1">
                            <AlertTriangle size={11} />
                            Failed — Correction Needed
                          </span>
                        )}

                        {/* Occupancy Badge */}
                        {activeRes ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            Occupied ({activeRes.guestName.split(' ')[0]})
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-zinc-800 text-zinc-400">
                            Vacant
                          </span>
                        )}
                      </div>

                      {/* Housekeeper Assignment & Notes */}
                      <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-2.5 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-black uppercase tracking-wider text-zinc-500 flex items-center gap-1">
                            <UserIcon size={10} />
                            Assigned Housekeeper
                          </span>
                          <span className="font-bold text-zinc-200 truncate max-w-[140px]">
                            {cleaner?.displayName || cleaner?.email || 'Unassigned'}
                          </span>
                        </div>

                        {room.notes && (
                          <div className="text-[11px] text-zinc-400 border-t border-zinc-800/60 pt-1.5 flex items-start gap-1">
                            <span className="text-zinc-600 font-bold shrink-0">Note:</span>
                            <span className="line-clamp-2">{room.notes}</span>
                          </div>
                        )}
                      </div>

                      {/* Action Buttons for this Room */}
                      <div className="mt-auto pt-2 grid grid-cols-2 gap-2">
                        {isDirty && (
                          <button
                            type="button"
                            onClick={() => handleStartCleaning(room)}
                            className="col-span-2 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/10"
                          >
                            <Sparkles size={14} />
                            Start Cleaning
                          </button>
                        )}

                        {isCleaning && (
                          <button
                            type="button"
                            onClick={() => setActiveCleaningRoom(room)}
                            className="col-span-2 py-2 bg-purple-500 hover:bg-purple-400 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5"
                          >
                            <ClipboardList size={14} />
                            Cleaning Checklist
                          </button>
                        )}

                        {isAwaitingInspection && (
                          <button
                            type="button"
                            onClick={() => handleOpenInspection(room)}
                            className="col-span-2 py-2 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/10"
                          >
                            <Eye size={14} />
                            Conduct Inspection
                          </button>
                        )}

                        {isFailed && (
                          <button
                            type="button"
                            onClick={() => handleStartCleaning(room)}
                            className="col-span-2 py-2 bg-red-500 hover:bg-red-400 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5"
                          >
                            <RotateCcw size={14} />
                            Re-clean & Resubmit
                          </button>
                        )}

                        {isReady && (
                          <button
                            type="button"
                            onClick={() => updateRoomStatus(room.id, 'dirty')}
                            className="py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold rounded-xl transition-all"
                          >
                            Mark Dirty
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setMaintenanceForm(prev => ({ ...prev, roomNumber: room.roomNumber }));
                            setShowMaintenanceModal(true);
                          }}
                          className={cn(
                            "py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1",
                            !isReady && "col-span-1"
                          )}
                        >
                          <Wrench size={12} />
                          Report Issue
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const nextPriority = priority === 'normal' ? 'high' : (priority === 'high' ? 'urgent' : 'normal');
                            updateRoomStatus(room.id, room.status, { priority: nextPriority as any });
                          }}
                          className="py-1.5 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-white text-[11px] font-bold rounded-xl transition-all"
                          title="Cycle Cleaning Priority (Normal -> High -> Urgent)"
                        >
                          Set {priority === 'normal' ? 'High' : (priority === 'high' ? 'Urgent' : 'Normal')}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* 5. TAB CONTENT: Cleaning Queue */}
      {activeTab === 'cleaning' && (
        <div className="space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <h2 className="text-lg font-bold text-zinc-50 mb-1 flex items-center gap-2">
              <Sparkles size={18} className="text-purple-400" />
              Active Cleaning Queue
            </h2>
            <p className="text-xs text-zinc-400">Rooms currently being sanitized and prepped for inspection</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.filter(r => r.status === 'cleaning' || r.status === 'dirty').map(room => {
              const cleaner = staff.find(s => s.uid === room.assignedTo);
              return (
                <div key={room.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-bold text-white">Room {room.roomNumber}</h3>
                      <p className="text-xs text-zinc-400">{room.type} • Floor {room.floor}</p>
                    </div>
                    <span className={cn(
                      "px-2.5 py-1 rounded-lg text-xs font-bold uppercase",
                      room.status === 'cleaning' ? "bg-purple-500/20 text-purple-400" : "bg-red-500/20 text-red-400"
                    )}>
                      {room.status}
                    </span>
                  </div>

                  <div className="text-xs text-zinc-300">
                    <span className="text-zinc-500">Cleaner: </span>
                    <span className="font-bold">{cleaner?.displayName || 'Unassigned'}</span>
                  </div>

                  <button
                    onClick={() => handleStartCleaning(room)}
                    className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    <ClipboardList size={14} />
                    Open Cleaning Checklist
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 6. TAB CONTENT: Daily Assignments */}
      {activeTab === 'assignments' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Users size={18} className="text-emerald-400" />
                Daily Room Assignment Matrix
              </h2>
              <p className="text-xs text-zinc-400">Assign housekeepers to rooms and prioritize daily shift workloads</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setFilter(filter === 'my_rooms' ? 'all' : 'my_rooms')}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-xs font-bold transition-all",
                  filter === 'my_rooms' ? "bg-emerald-500 text-black" : "bg-zinc-800 text-zinc-300 hover:text-white"
                )}
              >
                {filter === 'my_rooms' ? 'Showing My Rooms' : 'Filter My Rooms Only'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950 text-zinc-400 uppercase font-black text-[10px] tracking-wider border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">Room</th>
                  <th className="py-3 px-4">Floor / Type</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Assigned Housekeeper</th>
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {rooms.map(room => {
                  const cleaner = staff.find(s => s.uid === room.assignedTo);
                  return (
                    <tr key={room.id} className="hover:bg-zinc-800/40 transition-colors">
                      <td className="py-3 px-4 font-bold text-zinc-50">Room {room.roomNumber}</td>
                      <td className="py-3 px-4 text-zinc-400">Floor {room.floor} • {room.type}</td>
                      <td className="py-3 px-4">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                          room.status === 'clean' ? "bg-emerald-500/10 text-emerald-400" :
                          room.status === 'dirty' ? "bg-red-500/10 text-red-400" :
                          room.status === 'cleaning' ? "bg-purple-500/10 text-purple-400" :
                          "bg-amber-500/10 text-amber-400"
                        )}>
                          {room.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          disabled={!canAssignTasks}
                          className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500 outline-none"
                          value={room.assignedTo || ''}
                          onChange={(e) => updateRoomStatus(room.id, room.status, { assignedTo: e.target.value })}
                        >
                          <option value="">Unassigned</option>
                          {staff.map(s => (
                            <option key={s.uid} value={s.uid}>{s.displayName || s.email}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500 outline-none"
                          value={room.cleaningPriority || 'normal'}
                          onChange={(e) => updateRoomStatus(room.id, room.status, { priority: e.target.value as any })}
                        >
                          <option value="low">Low</option>
                          <option value="normal">Normal</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => handleStartCleaning(room)}
                          className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-bold transition-all"
                        >
                          Clean
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 7. TAB CONTENT: Inspections Queue & Log */}
      {activeTab === 'inspections' && (
        <div className="space-y-6">
          {/* Rooms Awaiting Inspection Queue */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Clock size={18} className="text-amber-400" />
                  Rooms Awaiting Supervisor Inspection
                </h2>
                <p className="text-xs text-zinc-400">Cleaned rooms pending official supervisor sign-off</p>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold">
                {rooms.filter(r => r.status === 'inspected' || r.housekeepingStatus === 'awaiting_inspection').length} Pending
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {rooms.filter(r => r.status === 'inspected' || r.housekeepingStatus === 'awaiting_inspection').map(room => {
                const cleaner = staff.find(s => s.uid === room.assignedTo);
                return (
                  <div key={room.id} className="bg-zinc-950 border border-amber-500/30 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-bold text-white">Room {room.roomNumber}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500 text-black">
                        Ready for Insp.
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400">Housekeeper: {cleaner?.displayName || 'Unknown'}</p>
                    <button
                      onClick={() => handleOpenInspection(room)}
                      className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5"
                    >
                      <Eye size={14} />
                      Inspect & Certify
                    </button>
                  </div>
                );
              })}
              {rooms.filter(r => r.status === 'inspected' || r.housekeepingStatus === 'awaiting_inspection').length === 0 && (
                <div className="col-span-full py-8 text-center text-zinc-500 text-xs italic">
                  No rooms awaiting inspection right now.
                </div>
              )}
            </div>
          </div>

          {/* Inspection History Log */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <ClipboardList size={18} className="text-emerald-400" />
              Recent Inspection Audit Log
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950 text-zinc-400 uppercase font-black text-[10px] tracking-wider border-b border-zinc-800">
                  <tr>
                    <th className="py-3 px-4">Time</th>
                    <th className="py-3 px-4">Room</th>
                    <th className="py-3 px-4">Inspector</th>
                    <th className="py-3 px-4">Housekeeper</th>
                    <th className="py-3 px-4">Result</th>
                    <th className="py-3 px-4">Score</th>
                    <th className="py-3 px-4">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {inspections.slice(0, 15).map((ins, i) => (
                    <tr key={ins.id || i} className="hover:bg-zinc-800/40 transition-colors">
                      <td className="py-3 px-4 text-zinc-400">
                        {ins.timestamp ? format(parseISO(ins.timestamp), 'MMM d, HH:mm') : 'N/A'}
                      </td>
                      <td className="py-3 px-4 font-bold text-white">Room {ins.roomNumber}</td>
                      <td className="py-3 px-4 text-zinc-300">{ins.inspectorName}</td>
                      <td className="py-3 px-4 text-zinc-400">{ins.housekeeperName || 'N/A'}</td>
                      <td className="py-3 px-4">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                          ins.result === 'passed' ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                        )}>
                          {ins.result}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono font-bold">{ins.score}%</td>
                      <td className="py-3 px-4 text-zinc-400 max-w-xs truncate">{ins.remarks || '-'}</td>
                    </tr>
                  ))}
                  {inspections.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-zinc-500 italic">No inspection records logged yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 8. TAB CONTENT: Briefings & Workplace Logs */}
      {activeTab === 'briefings' && (
        <div className="space-y-6">
          {/* Briefings Section */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Megaphone size={18} className="text-emerald-400" />
                  Daily Stand-up Briefings
                </h2>
                <p className="text-xs text-zinc-400">Shift huddle logs, attendance tracking, and safety notices</p>
              </div>
              <button
                onClick={() => setShowBriefingModal(true)}
                className="px-3 py-1.5 bg-emerald-500 text-black text-xs font-bold rounded-xl hover:bg-emerald-400 transition-all"
              >
                + New Briefing
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {briefings.map((b, i) => (
                <div key={b.id || i} className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-emerald-400 uppercase tracking-wider">{b.shift} Shift</span>
                    <span className="text-zinc-500">{b.date}</span>
                  </div>
                  <h3 className="font-bold text-white text-sm">{b.topic}</h3>
                  <div className="text-xs text-zinc-400 space-y-1">
                    <p><span className="text-zinc-500">Supervisor:</span> {b.supervisorName}</p>
                    <p><span className="text-zinc-500">Attendance:</span> {b.attendance?.length || 0} team members</p>
                    {b.safetyReminders && (
                      <p className="text-amber-400/90 text-[11px] mt-2">
                        <strong>Safety:</strong> {b.safetyReminders}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {briefings.length === 0 && (
                <div className="col-span-full py-8 text-center text-zinc-500 text-xs italic">
                  No stand-up briefings recorded yet. Click "+ New Briefing" to create one.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 9. TAB CONTENT: Guest Requests */}
      {activeTab === 'requests' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-400" />
                Guest Housekeeping Requests
              </h2>
              <p className="text-xs text-zinc-400">Track and dispatch extra towels, toiletries, water, and cots</p>
            </div>
            <button
              onClick={() => setShowGuestRequestModal(true)}
              className="px-3.5 py-2 bg-emerald-500 text-black text-xs font-bold rounded-xl hover:bg-emerald-400 transition-all flex items-center gap-1.5"
            >
              <Plus size={14} />
              Log Request
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {guestRequests.map((req, i) => (
              <div key={req.id || i} className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-base">Room {req.roomNumber}</span>
                  <span className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                    req.status === 'completed' ? "bg-emerald-500/20 text-emerald-400" :
                    req.status === 'in_progress' ? "bg-purple-500/20 text-purple-400" : "bg-red-500/20 text-red-400"
                  )}>
                    {req.status}
                  </span>
                </div>
                <div>
                  <h4 className="font-bold text-zinc-200 text-sm">{req.item} (x{req.quantity || 1})</h4>
                  {req.notes && <p className="text-xs text-zinc-400 mt-1 italic">{req.notes}</p>}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-zinc-800 text-xs">
                  <span className="text-zinc-500">
                    {req.requestedAt ? format(parseISO(req.requestedAt), 'HH:mm') : ''}
                  </span>
                  {req.status !== 'completed' && req.id && (
                    <button
                      onClick={() => handleUpdateGuestRequestStatus(req.id!, 'completed')}
                      className="px-2.5 py-1 bg-emerald-500 text-black rounded-lg text-xs font-bold hover:bg-emerald-400 transition-all flex items-center gap-1"
                    >
                      <Check size={12} />
                      Mark Completed
                    </button>
                  )}
                </div>
              </div>
            ))}
            {guestRequests.length === 0 && (
              <div className="col-span-full py-8 text-center text-zinc-500 text-xs italic">
                No active guest requests.
              </div>
            )}
          </div>
        </div>
      )}

      {/* 10. TAB CONTENT: Performance & Reports */}
      {activeTab === 'reports' && (
        <div className="space-y-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Award size={18} className="text-emerald-400" />
              Housekeeper Performance Leaderboard
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-950 text-zinc-400 uppercase font-black text-[10px] tracking-wider border-b border-zinc-800">
                  <tr>
                    <th className="py-3 px-4">Housekeeper</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Rooms Assigned Today</th>
                    <th className="py-3 px-4">Inspections Conducted</th>
                    <th className="py-3 px-4">Pass Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {staff.map(s => {
                    const assignedCount = rooms.filter(r => r.assignedTo === s.uid).length;
                    const staffInspections = inspections.filter(ins => ins.housekeeperId === s.uid);
                    const passed = staffInspections.filter(ins => ins.result === 'passed').length;
                    const passRate = staffInspections.length > 0 ? Math.round((passed / staffInspections.length) * 100) : 100;

                    return (
                      <tr key={s.uid} className="hover:bg-zinc-800/40 transition-colors">
                        <td className="py-3 px-4 font-bold text-white flex items-center gap-2">
                          <UserIcon size={14} className="text-emerald-400" />
                          {s.displayName || 'Staff Member'}
                        </td>
                        <td className="py-3 px-4 text-zinc-400">{s.email}</td>
                        <td className="py-3 px-4 font-mono font-bold text-zinc-200">{assignedCount}</td>
                        <td className="py-3 px-4 font-mono">{staffInspections.length}</td>
                        <td className="py-3 px-4">
                          <span className={cn(
                            "font-bold font-mono px-2 py-0.5 rounded text-[11px]",
                            passRate >= 90 ? "bg-emerald-500/20 text-emerald-400" :
                            passRate >= 75 ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"
                          )}>
                            {passRate}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 11. TAB CONTENT: Staff & Team Management (Blueprint Section 5) */}
      {activeTab === 'staff' && (
        <HousekeepingStaffManagement
          staff={staff}
          rooms={rooms}
          onAssignRoom={async (roomId, staffId) => {
            const currentRoom = rooms.find(r => r.id === roomId);
            await updateRoomStatus(roomId, currentRoom?.status || 'dirty', { assignedTo: staffId });
          }}
        />
      )}

      {/* 12. TAB CONTENT: Housekeeping Inventory & Stock Management (Blueprint Sections 7, 8, 9, 10) */}
      {activeTab === 'inventory' && (
        <HousekeepingInventory staff={staff} />
      )}

      {/* 13. TAB CONTENT: Linen Management & Laundry Flow (Blueprint Section 14) */}
      {activeTab === 'linen' && (
        <HousekeepingLinen />
      )}

      {/* 14. TAB CONTENT: Chemical Safety & Stock Register (Blueprint Section 15) */}
      {activeTab === 'chemicals' && (
        <HousekeepingChemicals />
      )}

      {/* 15. TAB CONTENT: Hotel Lost & Found Register (Blueprint Section 13) */}
      {activeTab === 'lost_and_found' && (
        <HousekeepingLostAndFound rooms={rooms} staff={staff} />
      )}

      {/* 16. TAB CONTENT: Daily Housekeeping Log & Shift Handover (Blueprint Section 16) */}
      {activeTab === 'daily_log' && (
        <HousekeepingDailyLogView
          rooms={rooms}
          inspections={inspections}
          maintenanceRequests={maintenanceRequests}
          staff={staff}
        />
      )}

      {/* --- ROOM PROFILE MODAL (Blueprint Section 2) --- */}
      {activeProfileRoom && (
        <RoomProfileModal
          room={activeProfileRoom}
          staff={staff}
          reservations={reservations}
          maintenanceRequests={maintenanceRequests}
          onClose={() => setActiveProfileRoom(null)}
          onUpdateStatus={updateRoomStatus}
          onStartCleaning={handleStartCleaning}
          onStartInspection={handleOpenInspection}
          onReportMaintenance={(rn) => {
            setMaintenanceForm(prev => ({ ...prev, roomNumber: rn }));
            setShowMaintenanceModal(true);
          }}
        />
      )}

      {/* --- BULK ACTION BAR --- */}
      <AnimatePresence>
        {selectedRoomIds.length > 0 && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 border border-emerald-500/30 shadow-2xl px-5 py-3.5 rounded-2xl flex flex-wrap items-center gap-4 backdrop-blur-xl max-w-2xl w-[92%]"
          >
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-emerald-500 text-black flex items-center justify-center font-bold text-xs">
                {selectedRoomIds.length}
              </span>
              <span className="text-xs font-bold text-white">Selected</span>
              <button 
                onClick={() => setSelectedRoomIds([])}
                className="text-[10px] text-zinc-400 hover:text-white underline ml-1"
              >
                Clear
              </button>
            </div>

            <div className="h-5 w-px bg-zinc-800" />

            <div className="flex items-center gap-2 flex-1">
              <select
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none"
                value={assignStaffId}
                onChange={(e) => setAssignStaffId(e.target.value)}
              >
                <option value="">Assign cleaner...</option>
                {staff.map(s => (
                  <option key={s.uid} value={s.uid}>{s.displayName || s.email}</option>
                ))}
              </select>
              <button
                onClick={handleBulkAssign}
                disabled={!assignStaffId}
                className="px-3 py-1.5 bg-emerald-500 text-black rounded-xl text-xs font-bold hover:bg-emerald-400 disabled:opacity-40"
              >
                Assign
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleBulkUpdate('clean')}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-emerald-400 rounded-xl text-xs font-bold"
              >
                Mark Clean
              </button>
              <button
                onClick={() => handleBulkUpdate('dirty')}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-red-400 rounded-xl text-xs font-bold"
              >
                Mark Dirty
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- MODAL 1: ROOM CLEANING CHECKLIST --- */}
      {activeCleaningRoom && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-xl w-full p-5 sm:p-6 space-y-5 my-auto max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-xl font-black text-white">Room {activeCleaningRoom.roomNumber} Cleaning Checklist</h3>
                <p className="text-xs text-zinc-400">Complete items thoroughly before submitting for supervisor inspection</p>
              </div>
              <button
                onClick={() => setActiveCleaningRoom(null)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              <div className="flex items-center justify-between bg-zinc-950 p-2.5 rounded-xl border border-zinc-800/80">
                <span className="text-xs font-bold text-zinc-300">Quick Actions</span>
                <button
                  type="button"
                  onClick={handleCheckAllCleaning}
                  className="text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                >
                  <CheckCheck size={14} />
                  Check All Items
                </button>
              </div>

              {/* 1. Bedroom Section */}
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <Sparkles size={14} />
                  Bedroom Checklist
                </h4>
                <div className="space-y-1.5 bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80">
                  {BEDROOM_CHECKLIST_ITEMS.map(item => (
                    <label key={item.id} className="flex items-center gap-2.5 text-xs text-zinc-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!!bedroomChecklist[item.id]}
                        onChange={(e) => setBedroomChecklist(prev => ({ ...prev, [item.id]: e.target.checked }))}
                        className="rounded border-zinc-700 text-emerald-500 focus:ring-emerald-500 w-4 h-4 bg-zinc-900"
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 2. Bathroom Section */}
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                  <CheckCircle2 size={14} />
                  Bathroom Checklist
                </h4>
                <div className="space-y-1.5 bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80">
                  {BATHROOM_CHECKLIST_ITEMS.map(item => (
                    <label key={item.id} className="flex items-center gap-2.5 text-xs text-zinc-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!!bathroomChecklist[item.id]}
                        onChange={(e) => setBathroomChecklist(prev => ({ ...prev, [item.id]: e.target.checked }))}
                        className="rounded border-zinc-700 text-emerald-500 focus:ring-emerald-500 w-4 h-4 bg-zinc-900"
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 3. Guest Supplies Section */}
              <div className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                  <Package size={14} />
                  Guest Supplies Replenishment
                </h4>
                <div className="space-y-1.5 bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80">
                  {GUEST_SUPPLIES_ITEMS.map(item => (
                    <label key={item.id} className="flex items-center gap-2.5 text-xs text-zinc-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!!suppliesChecklist[item.id]}
                        onChange={(e) => setSuppliesChecklist(prev => ({ ...prev, [item.id]: e.target.checked }))}
                        className="rounded border-zinc-700 text-emerald-500 focus:ring-emerald-500 w-4 h-4 bg-zinc-900"
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                  Cleaner Observations / Notes
                </label>
                <textarea
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-emerald-500 resize-none h-16"
                  placeholder="Optional remarks about linen replacement or room condition..."
                  value={cleaningNotes}
                  onChange={(e) => setCleaningNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setActiveCleaningRoom(null)}
                className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleCompleteCleaning}
                className="flex-[2] py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
              >
                <Send size={14} />
                Cleaning Completed → Send for Inspection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 2: SUPERVISOR ROOM INSPECTION --- */}
      {activeInspectionRoom && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-xl w-full p-5 sm:p-6 space-y-5 my-auto max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-xl font-black text-white">Supervisor Inspection: Room {activeInspectionRoom.roomNumber}</h3>
                <p className="text-xs text-zinc-400">Certify room cleanliness, presentation & guest readiness</p>
              </div>
              <button
                onClick={() => setActiveInspectionRoom(null)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800/80 flex items-center justify-between">
                <div>
                  <span className="text-xs text-zinc-400">Housekeeper Assigned: </span>
                  <span className="text-xs font-bold text-white">
                    {staff.find(s => s.uid === activeInspectionRoom.assignedTo)?.displayName || 'Unassigned'}
                  </span>
                </div>
                <div className="text-xs font-mono font-bold text-amber-400">
                  {Object.values(inspectionChecklist).filter(Boolean).length} / {INSPECTION_CHECKLIST_ITEMS.length} Points
                </div>
              </div>

              <div className="space-y-1.5 bg-zinc-950/60 p-3.5 rounded-xl border border-zinc-800/80">
                <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 block mb-1">
                  11-Point Quality Standards Checklist
                </span>
                {INSPECTION_CHECKLIST_ITEMS.map(item => (
                  <label key={item.id} className="flex items-center justify-between py-1 text-xs text-zinc-200 cursor-pointer border-b border-zinc-800/40 last:border-0 select-none">
                    <span>{item.label}</span>
                    <input
                      type="checkbox"
                      checked={!!inspectionChecklist[item.id]}
                      onChange={(e) => setInspectionChecklist(prev => ({ ...prev, [item.id]: e.target.checked }))}
                      className="rounded border-zinc-700 text-emerald-500 focus:ring-emerald-500 w-4 h-4 bg-zinc-900"
                    />
                  </label>
                ))}
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                  Supervisor Remarks / Correction Notes (if Failed)
                </label>
                <textarea
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-emerald-500 resize-none h-20"
                  placeholder="Note specific items requiring correction before re-inspection, or general remarks..."
                  value={inspectionRemarks}
                  onChange={(e) => setInspectionRemarks(e.target.value)}
                />
              </div>
            </div>

            <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleInspectionDecision('failed')}
                className="flex-1 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-xl text-xs font-bold transition-all"
              >
                🔴 FAIL — Correction Required
              </button>
              <button
                type="button"
                onClick={() => handleInspectionDecision('passed')}
                className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-black transition-all shadow-lg shadow-emerald-500/20"
              >
                🟢 PASS — Ready for Guest
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 3: REPORT MAINTENANCE DEFECT --- */}
      {showMaintenanceModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleReportMaintenance} className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 my-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-amber-400">
                <Wrench size={18} />
                <h3 className="text-lg font-bold text-white">Report Maintenance Issue</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowMaintenanceModal(false)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Room Number</label>
              <input
                required
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                placeholder="e.g. 201"
                value={maintenanceForm.roomNumber}
                onChange={(e) => setMaintenanceForm(prev => ({ ...prev, roomNumber: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Issue Category</label>
              <select
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                value={maintenanceForm.category}
                onChange={(e) => setMaintenanceForm(prev => ({ ...prev, category: e.target.value }))}
              >
                {['Plumbing', 'Electrical', 'AC', 'TV', 'Furniture', 'Bathroom', 'Lighting', 'Door/lock', 'Water', 'Other'].map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Defect Description</label>
              <textarea
                required
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-white placeholder-zinc-500 outline-none focus:border-emerald-500 resize-none h-20"
                placeholder="Describe the problem (e.g. AC not cooling, shower leak)..."
                value={maintenanceForm.issue}
                onChange={(e) => setMaintenanceForm(prev => ({ ...prev, issue: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Priority</label>
              <select
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                value={maintenanceForm.priority}
                onChange={(e) => setMaintenanceForm(prev => ({ ...prev, priority: e.target.value as any }))}
              >
                <option value="low">Low</option>
                <option value="medium">Normal / Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={maintenanceForm.blockRoom}
                onChange={(e) => setMaintenanceForm(prev => ({ ...prev, blockRoom: e.target.checked }))}
                className="rounded border-zinc-700 text-amber-500 focus:ring-amber-500 w-4 h-4 bg-zinc-900"
              />
              <span>Set Room Status to 'Maintenance' (Blocks guest booking)</span>
            </label>

            <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowMaintenanceModal(false)}
                className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-black rounded-xl text-xs font-bold"
              >
                Submit Ticket
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- MODAL 4: STAND-UP BRIEFING --- */}
      {showBriefingModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleSaveBriefing} className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 my-auto max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <Megaphone size={18} />
                <h3 className="text-lg font-bold text-white">Daily Stand-up Briefing</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowBriefingModal(false)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3.5 pr-1">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Shift</label>
                <select
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  value={briefingForm.shift}
                  onChange={(e) => setBriefingForm(prev => ({ ...prev, shift: e.target.value as any }))}
                >
                  <option value="morning">Morning Shift</option>
                  <option value="afternoon">Afternoon Shift</option>
                  <option value="evening">Evening Shift</option>
                  <option value="night">Night Shift</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Today's Topic</label>
                <input
                  required
                  type="text"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  value={briefingForm.topic}
                  onChange={(e) => setBriefingForm(prev => ({ ...prev, topic: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Staff Attendance</label>
                <div className="max-h-32 overflow-y-auto bg-zinc-950 p-2.5 rounded-xl border border-zinc-800 space-y-1.5">
                  {staff.map(s => {
                    const isAttended = briefingForm.attendance.includes(s.uid);
                    return (
                      <label key={s.uid} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isAttended}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setBriefingForm(prev => ({ ...prev, attendance: [...prev.attendance, s.uid] }));
                            } else {
                              setBriefingForm(prev => ({ ...prev, attendance: prev.attendance.filter(id => id !== s.uid) }));
                            }
                          }}
                          className="rounded border-zinc-700 text-emerald-500 focus:ring-emerald-500 w-3.5 h-3.5 bg-zinc-900"
                        />
                        <span>{s.displayName || s.email}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Announcements</label>
                <textarea
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-emerald-500 resize-none h-16"
                  placeholder="VIP guest arrivals, events, or general announcements..."
                  value={briefingForm.announcements}
                  onChange={(e) => setBriefingForm(prev => ({ ...prev, announcements: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Safety Reminders</label>
                <input
                  type="text"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  value={briefingForm.safetyReminders}
                  onChange={(e) => setBriefingForm(prev => ({ ...prev, safetyReminders: e.target.value }))}
                />
              </div>
            </div>

            <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowBriefingModal(false)}
                className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-bold"
              >
                Save Briefing
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- MODAL 5: LOG GUEST REQUEST --- */}
      {showGuestRequestModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleSaveGuestRequest} className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 my-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <Plus size={18} />
                <h3 className="text-lg font-bold text-white">Log Guest Request</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuestRequestModal(false)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Room Number</label>
              <input
                required
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                placeholder="e.g. 104"
                value={guestRequestForm.roomNumber}
                onChange={(e) => setGuestRequestForm(prev => ({ ...prev, roomNumber: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Requested Item</label>
              <select
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                value={guestRequestForm.item}
                onChange={(e) => setGuestRequestForm(prev => ({ ...prev, item: e.target.value }))}
              >
                {['Extra Towels', 'Extra Pillow', 'Drinking Water', 'Dental & Shaving Kit', 'Iron & Ironing Board', 'Room Refresh / Cleaning', 'Baby Cot', 'Other'].map(item => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Quantity</label>
              <input
                type="number"
                min="1"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                value={guestRequestForm.quantity}
                onChange={(e) => setGuestRequestForm(prev => ({ ...prev, quantity: parseInt(e.target.value, 10) || 1 }))}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Assign Housekeeper (Optional)</label>
              <select
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                value={guestRequestForm.assignedTo}
                onChange={(e) => setGuestRequestForm(prev => ({ ...prev, assignedTo: e.target.value }))}
              >
                <option value="">Dispatch to any available</option>
                {staff.map(s => (
                  <option key={s.uid} value={s.uid}>{s.displayName || s.email}</option>
                ))}
              </select>
            </div>

            <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowGuestRequestModal(false)}
                className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-bold"
              >
                Save Request
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
