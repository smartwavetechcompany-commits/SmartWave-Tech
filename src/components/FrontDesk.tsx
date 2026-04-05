import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, addDoc, query, orderBy, doc, setDoc, getDocs, where, updateDoc, deleteDoc, writeBatch, increment } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Reservation, Room, Guest, CorporateAccount, CorporateRate, OperationType, RoomType } from '../types';
import { postToLedger, settleLedger } from '../services/ledgerService';
import { ConfirmModal } from './ConfirmModal';
import { ReceiptGenerator } from './ReceiptGenerator';
import { GuestFolio } from './GuestFolio';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Search, 
  Calendar,
  User,
  CreditCard,
  CheckCircle2,
  XCircle,
  Clock,
  LogOut,
  RefreshCw,
  Receipt,
  Building2,
  Tag,
  AlertCircle,
  Trash2,
  UserX,
  Download,
  Edit2
} from 'lucide-react';
import { cn, formatCurrency, exportToCSV } from '../utils';
import { fuzzySearch } from '../utils/searchUtils';
import { format, addDays } from 'date-fns';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';

export function FrontDesk() {
  const { hotel, profile, currency, exchangeRate } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [corporateAccounts, setCorporateAccounts] = useState<CorporateAccount[]>([]);
  const [activeCorporateRates, setActiveCorporateRates] = useState<CorporateRate[]>([]);
  const [isBooking, setIsBooking] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [showNightAuditModal, setShowNightAuditModal] = useState(false);
  const [showReceipt, setShowReceipt] = useState<{ res: Reservation; type: 'restaurant' | 'comprehensive' } | null>(null);
  const [showTransferModal, setShowTransferModal] = useState<Reservation | null>(null);
  const [showChargeModal, setShowChargeModal] = useState<Reservation | null>(null);
  const [showFolioModal, setShowFolioModal] = useState<Reservation | null>(null);
  const [showConfirmAction, setShowConfirmAction] = useState<{ res: Reservation; action: 'no_show' | 'cancelled' | 'delete' } | null>(null);
  const [showPostponeModal, setShowPostponeModal] = useState<Reservation | null>(null);
  const [showDiscountModal, setShowDiscountModal] = useState<Reservation | null>(null);
  const [discountData, setDiscountData] = useState({ 
    amount: 0, 
    type: 'fixed' as 'fixed' | 'percentage',
    reason: '' 
  });
  const [newCheckOutDate, setNewCheckOutDate] = useState('');
  const [chargeDetails, setChargeDetails] = useState({
    amount: 0,
    category: 'restaurant' as const,
    description: '',
  });
  const [newBooking, setNewBooking] = useState({
    guestType: 'individual' as 'individual' | 'corporate',
    guestId: '',
    corporateId: '',
    guestName: '',
    guestEmail: '',
    guestPhone: '',
    roomId: '',
    checkIn: format(new Date(), 'yyyy-MM-dd'),
    checkOut: format(new Date(Date.now() + 86400000), 'yyyy-MM-dd'),
    totalAmount: 0,
    paidAmount: 0,
    paymentStatus: 'unpaid' as const,
    notes: '',
    corporateReference: '',
    discountAmount: 0,
    discountType: 'fixed' as 'fixed' | 'percentage',
    discountReason: '',
    additionalStays: [] as {
      id: string;
      guestName: string;
      guestEmail: string;
      guestPhone: string;
      roomId: string;
      checkIn: string;
      checkOut: string;
      totalAmount: number;
      guestId?: string;
    }[]
  });

  const [loading, setLoading] = useState(false);
  const [hasPermissionError, setHasPermissionError] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
  const [editForm, setEditForm] = useState({
    checkIn: '',
    checkOut: '',
    totalAmount: 0,
    notes: ''
  });
  const [isNegotiatedRate, setIsNegotiatedRate] = useState(false);

  useEffect(() => {
    const action = searchParams.get('action');
    const corporateId = searchParams.get('corporateId');

    if (action === 'book' && corporateId) {
      setNewBooking(prev => ({
        ...prev,
        guestType: 'corporate',
        corporateId: corporateId
      }));
      setIsBooking(true);
      // Clear params after handling
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  const filteredReservations = reservations.filter(res => 
    fuzzySearch(res.guestName || '', searchTerm) ||
    fuzzySearch(res.roomNumber || '', searchTerm)
  );

  const roomStats = {
    total: rooms.length,
    available: rooms.filter(r => r.status === 'clean').length,
    occupied: rooms.filter(r => r.status === 'occupied').length,
    dirty: rooms.filter(r => r.status === 'dirty').length,
    status: rooms.filter(r => r.status === 'maintenance').length,
    maintenance: rooms.filter(r => r.status === 'maintenance').length,
  };

  useEffect(() => {
    if (!hotel?.id || !profile) return;

    setLoading(true);
    const resRef = collection(db, 'hotels', hotel.id, 'reservations');
    const roomsRef = collection(db, 'hotels', hotel.id, 'rooms');
    const typesRef = collection(db, 'hotels', hotel.id, 'room_types');
    const guestsRef = collection(db, 'hotels', hotel.id, 'guests');
    const corpRef = collection(db, 'hotels', hotel.id, 'corporate_accounts');

    const unsubRes = onSnapshot(resRef, (snap) => {
      const allRes = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation));
      // Client-side sorting
      const sortedRes = allRes.sort((a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime());
      setReservations(sortedRes);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/reservations`);
    });

    const unsubRooms = onSnapshot(roomsRef, (snap) => {
      setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
    });

    const unsubTypes = onSnapshot(typesRef, (snap) => {
      setRoomTypes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as RoomType)));
    });

    const unsubGuests = onSnapshot(guestsRef, (snap) => {
      setGuests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Guest)));
    });

    const unsubCorp = onSnapshot(corpRef, (snap) => {
      setCorporateAccounts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CorporateAccount)));
    });

    return () => {
      unsubRes();
      unsubRooms();
      unsubTypes();
      unsubGuests();
      unsubCorp();
    };
  }, [hotel?.id, profile?.uid]);

  // Fetch rates when corporate account is selected
  useEffect(() => {
    if (!hotel?.id || !newBooking.corporateId) {
      setActiveCorporateRates([]);
      return;
    }

    const ratesRef = collection(db, 'hotels', hotel.id, 'corporate_accounts', newBooking.corporateId, 'rates');
    const q = query(ratesRef, where('status', '==', 'active'));

    const unsubRates = onSnapshot(q, (snap) => {
      setActiveCorporateRates(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CorporateRate)));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/corporate_accounts/${newBooking.corporateId}/rates`);
    });

    return () => unsubRates();
  }, [hotel?.id, newBooking.corporateId]);

  // Recalculate price when room, dates or corporate account changes
  useEffect(() => {
    const selectedRoom = rooms.find(r => r.id === newBooking.roomId);
    if (!selectedRoom) return;

    let pricePerNight = selectedRoom.price;
    let negotiated = false;

    if (newBooking.guestType === 'corporate' && newBooking.corporateId) {
      const activeRate = activeCorporateRates.find(r => 
        (r.roomTypeId === selectedRoom.roomTypeId || r.roomType === selectedRoom.type) &&
        new Date(newBooking.checkIn) >= new Date(r.startDate) &&
        new Date(newBooking.checkIn) <= new Date(r.endDate)
      );

      if (activeRate) {
        pricePerNight = activeRate.rate;
        negotiated = true;
      }
    }

    const checkIn = new Date(newBooking.checkIn);
    const checkOut = new Date(newBooking.checkOut);
    const nights = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
    
    setIsNegotiatedRate(negotiated);
    
    const primaryTotal = pricePerNight * nights;

    // Recalculate additional stays prices
    let additionalStaysChanged = false;
    const updatedAdditionalStays = newBooking.additionalStays.map(stay => {
      const room = rooms.find(r => r.id === stay.roomId);
      if (!room) return stay;
      
      let stayPrice = room.price;
      if (newBooking.guestType === 'corporate' && newBooking.corporateId) {
        const rate = activeCorporateRates.find(r => 
          (r.roomTypeId === room.roomTypeId || r.roomType === room.type) &&
          new Date(stay.checkIn) >= new Date(r.startDate) &&
          new Date(stay.checkIn) <= new Date(r.endDate)
        );
        if (rate) stayPrice = rate.rate;
      }
      
      const sCheckIn = new Date(stay.checkIn);
      const sCheckOut = new Date(stay.checkOut);
      const sNights = Math.max(1, Math.ceil((sCheckOut.getTime() - sCheckIn.getTime()) / (1000 * 60 * 60 * 24)));
      const newTotal = stayPrice * sNights;
      
      if (newTotal !== stay.totalAmount) {
        additionalStaysChanged = true;
        return { ...stay, totalAmount: newTotal };
      }
      return stay;
    });

    const additionalTotal = updatedAdditionalStays.reduce((acc, stay) => acc + (stay.totalAmount || 0), 0);
    const totalAmount = primaryTotal + additionalTotal;

    if (newBooking.totalAmount !== totalAmount || additionalStaysChanged) {
      setNewBooking(prev => ({
        ...prev,
        totalAmount,
        additionalStays: updatedAdditionalStays
      }));
    }
  }, [newBooking.roomId, newBooking.checkIn, newBooking.checkOut, newBooking.corporateId, newBooking.guestType, activeCorporateRates, rooms, newBooking.additionalStays]);

  useEffect(() => {
    setHasPermissionError(false);
  }, [profile?.uid, hotel?.id]);

  const runNightlyAudit = async () => {
    if (!hotel?.id || !profile) return;
    
    setIsAuditing(true);
    try {
      const checkedInReservations = reservations.filter(res => res.status === 'checked_in');
      const today = format(new Date(), 'yyyy-MM-dd');

      for (const res of checkedInReservations) {
        const room = rooms.find(r => r.id === res.roomId);
        if (!room) continue;

        // Calculate nightly rate (could be corporate rate)
        let nightlyRate = room.price;
        if (res.corporateId) {
          const ratesRef = collection(db, 'hotels', hotel.id, 'corporate_accounts', res.corporateId, 'rates');
          const snap = await getDocs(ratesRef);
          const activeRate = snap.docs.find(doc => {
            const data = doc.data();
            return data.status === 'active' &&
              (data.roomTypeId === room.roomTypeId || data.roomType === room.type) &&
              new Date(today) >= new Date(data.startDate) && new Date(today) <= new Date(data.endDate);
          });
          if (activeRate) nightlyRate = activeRate.data().rate;
        }

        // Post to ledger
        await postToLedger(hotel.id, res.guestId || 'unknown', res.id, {
          amount: nightlyRate,
          type: 'debit',
          category: 'room',
          description: `Nightly room charge - Room ${res.roomNumber} (${res.guestName})`,
          referenceId: res.id,
          postedBy: profile.uid
        }, profile.uid, res.corporateId);
      }

      // Log audit
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'NIGHTLY_AUDIT_RUN',
        resource: `Audit for ${today}`,
        hotelId: hotel.id,
        module: 'Front Desk'
      });

      toast.success(`Nightly audit completed for ${checkedInReservations.length} guests.`);
      setShowNightAuditModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/audit`);
      toast.error('Failed to run nightly audit');
    } finally {
      setIsAuditing(false);
    }
  };

  const handleBooking = async () => {
    if (!hotel?.id) return;
    
    const allStays = [
      {
        guestName: newBooking.guestName,
        guestEmail: newBooking.guestEmail,
        guestPhone: newBooking.guestPhone,
        roomId: newBooking.roomId,
        checkIn: newBooking.checkIn,
        checkOut: newBooking.checkOut,
        totalAmount: 0, // Will be recalculated
        guestId: newBooking.guestId
      },
      ...newBooking.additionalStays
    ];

    if (allStays.some(s => !s.guestName || !s.roomId)) {
      toast.error("Please fill in all guest names and select rooms.");
      return;
    }

    setLoading(true);
    try {
      const batch = writeBatch(db);
      const createdStays: { 
        resId: string; 
        guestId: string; 
        totalAmount: number; 
        roomNumber: string; 
        corporateId?: string;
        discountAmount?: number;
        discountType?: 'fixed' | 'percentage';
        discountReason?: string;
      }[] = [];
      
      for (const stay of allStays) {
        const selectedRoom = rooms.find(r => r.id === stay.roomId);
        if (!selectedRoom) continue;

        // Calculate individual stay price
        let pricePerNight = selectedRoom.price;
        if (newBooking.guestType === 'corporate' && newBooking.corporateId) {
          const activeRate = activeCorporateRates.find(r => 
            (r.roomTypeId === selectedRoom.roomTypeId || r.roomType === selectedRoom.type) &&
            new Date(stay.checkIn) >= new Date(r.startDate) &&
            new Date(stay.checkIn) <= new Date(r.endDate)
          );
          if (activeRate) pricePerNight = activeRate.rate;
        }

        const nights = Math.max(1, Math.ceil((new Date(stay.checkOut).getTime() - new Date(stay.checkIn).getTime()) / (1000 * 60 * 60 * 24)));
        const totalAmount = pricePerNight * nights;

        let guestId = stay.guestId;
        if (!guestId) {
          const guestRef = doc(collection(db, 'hotels', hotel.id, 'guests'));
          batch.set(guestRef, {
            name: stay.guestName,
            email: stay.guestEmail,
            phone: stay.guestPhone,
            corporateId: newBooking.corporateId,
            ledgerBalance: 0,
            totalStays: 0,
            totalSpent: 0,
            createdAt: new Date().toISOString()
          });
          guestId = guestRef.id;
        }

        const resRef = doc(collection(db, 'hotels', hotel.id, 'reservations'));
        const resData: any = {
          guestName: stay.guestName,
          guestEmail: stay.guestEmail,
          guestPhone: stay.guestPhone,
          guestId,
          corporateId: newBooking.corporateId,
          roomId: stay.roomId,
          roomNumber: selectedRoom.roomNumber,
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          status: 'pending',
          totalAmount,
          paidAmount: 0,
          paymentStatus: 'unpaid',
          notes: newBooking.notes,
          corporateReference: newBooking.corporateReference,
          ledgerEntries: [],
          createdAt: new Date().toISOString(),
        };

        // Apply discount to the first reservation in the batch
        if (createdStays.length === 0 && newBooking.discountAmount > 0) {
          resData.discountAmount = newBooking.discountAmount;
          resData.discountType = newBooking.discountType;
          resData.discountReason = newBooking.discountReason;
        }

        batch.set(resRef, resData);
        createdStays.push({ 
          resId: resRef.id, 
          guestId, 
          totalAmount, 
          roomNumber: selectedRoom.roomNumber,
          corporateId: newBooking.corporateId,
          discountAmount: createdStays.length === 0 ? newBooking.discountAmount : 0,
          discountType: createdStays.length === 0 ? newBooking.discountType : undefined,
          discountReason: createdStays.length === 0 ? newBooking.discountReason : undefined
        });

        // Activity log for each booking
        const logRef = doc(collection(db, 'hotels', hotel.id, 'activityLogs'));
        batch.set(logRef, {
          timestamp: new Date().toISOString(),
          userId: profile?.uid || 'system',
          userEmail: profile?.email || 'system',
          userRole: profile?.role || 'staff',
          action: 'CREATE_BOOKING',
          resource: `Booking for ${stay.guestName} (Room ${selectedRoom.roomNumber})`,
          hotelId: hotel.id,
          module: 'Front Desk'
        });
      }

      await batch.commit();
      
      // Post discounts to ledger if any
      for (const stay of createdStays) {
        if (stay.discountAmount && stay.discountAmount > 0) {
          let finalDiscount = stay.discountAmount;
          if (stay.discountType === 'percentage') {
            finalDiscount = (stay.totalAmount * stay.discountAmount) / 100;
          }

          await postToLedger(hotel.id, stay.guestId, stay.resId, {
            amount: finalDiscount,
            type: 'credit',
            category: 'service',
            description: `Booking Discount (${stay.discountType === 'percentage' ? stay.discountAmount + '%' : formatCurrency(stay.discountAmount, currency, exchangeRate)}): ${stay.discountReason || 'New Booking Discount'}`,
            referenceId: stay.resId,
            postedBy: profile.uid
          }, profile.uid, stay.corporateId);
        }
      }

      setIsBooking(false);
      setNewBooking({
        guestType: 'individual',
        guestId: '',
        corporateId: '',
        guestName: '',
        guestEmail: '',
        guestPhone: '',
        roomId: '',
        checkIn: format(new Date(), 'yyyy-MM-dd'),
        checkOut: format(new Date(Date.now() + 86400000), 'yyyy-MM-dd'),
        totalAmount: 0,
        paidAmount: 0,
        paymentStatus: 'unpaid',
        notes: '',
        corporateReference: '',
        discountAmount: 0,
        discountType: 'fixed',
        discountReason: '',
        additionalStays: []
      });
    } catch (err) {
      console.error("Booking error:", err);
      toast.error('Failed to create bookings');
    } finally {
      setLoading(false);
    }
  };

  const deleteReservation = async (res: Reservation) => {
    if (!hotel?.id || !profile) return;
    if (profile.role !== 'hotelAdmin' && profile.role !== 'superAdmin') {
      toast.error('Only administrators can delete reservations');
      return;
    }

    try {
      setLoading(true);
      const batch = writeBatch(db);
      
      // 1. Delete reservation
      batch.delete(doc(db, 'hotels', hotel.id, 'reservations', res.id));
      
      // 2. If checked in, mark room as clean
      if (res.status === 'checked_in') {
        batch.update(doc(db, 'hotels', hotel.id, 'rooms', res.roomId), { status: 'clean' });
      }
      
      // 3. Log action
      batch.set(doc(collection(db, 'hotels', hotel.id, 'activityLogs')), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'DELETE_RESERVATION',
        resource: `Reservation for ${res.guestName} (Room ${res.roomNumber})`,
        hotelId: hotel.id,
        module: 'Front Desk'
      });
      
      await batch.commit();
      toast.success('Reservation deleted successfully');
    } catch (err) {
      console.error("Delete reservation error:", err);
      toast.error('Failed to delete reservation');
    } finally {
      setLoading(false);
    }
  };

  const handleEditReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !editingReservation || !profile) return;

    try {
      setLoading(true);
      const resRef = doc(db, 'hotels', hotel.id, 'reservations', editingReservation.id);
      
      await updateDoc(resRef, {
        checkIn: editForm.checkIn,
        checkOut: editForm.checkOut,
        totalAmount: editForm.totalAmount,
        notes: editForm.notes
      });

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'EDIT_RESERVATION',
        resource: `Reservation ${editingReservation.id} updated (Dates: ${editForm.checkIn} to ${editForm.checkOut}, Total: ${editForm.totalAmount})`,
        hotelId: hotel.id,
        module: 'Front Desk'
      });

      toast.success('Reservation updated successfully');
      setEditingReservation(null);
    } catch (err) {
      console.error("Edit reservation error:", err);
      toast.error('Failed to update reservation');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!showConfirmAction || !hotel?.id) return;
    const { res, action } = showConfirmAction;
    
    try {
      setLoading(true);
      if (action === 'delete') {
        await deleteReservation(res);
      } else {
        await updateReservationStatus(res, action);
      }
      setShowConfirmAction(null);
    } catch (err) {
      console.error("Confirm action error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePostponeStay = async () => {
    if (!showPostponeModal || !hotel?.id || !newCheckOutDate) return;
    
    try {
      setLoading(true);
      const res = showPostponeModal;
      
      const oldCheckOut = new Date(res.checkOut);
      const newCheckOut = new Date(newCheckOutDate);
      const extraNights = Math.ceil((newCheckOut.getTime() - oldCheckOut.getTime()) / (1000 * 60 * 60 * 24));
      
      if (extraNights <= 0) {
        toast.error('New check-out date must be after current check-out date');
        return;
      }

      const room = rooms.find(r => r.id === res.roomId);
      const nightlyRate = room?.price || 0;
      const extraAmount = extraNights * nightlyRate;
      const newTotalAmount = res.totalAmount + extraAmount;

      await updateDoc(doc(db, 'hotels', hotel.id, 'reservations', res.id), { 
        checkOut: newCheckOutDate,
        totalAmount: newTotalAmount
      });

      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid,
        userEmail: profile?.email,
        userRole: profile?.role,
        action: 'RESERVATION_POSTPONED',
        resource: `Res #${res.id.slice(-6)} - Extended to ${newCheckOutDate}`,
        hotelId: hotel.id,
        module: 'Front Desk',
        details: `Extended by ${extraNights} nights. Added ${formatCurrency(extraAmount, currency, exchangeRate)} to total.`
      });

      toast.success('Stay postponed successfully');
      setShowPostponeModal(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/reservations`);
      toast.error('Failed to postpone stay');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyDiscount = async () => {
    if (!showDiscountModal || !hotel?.id || !discountData.amount || !profile) return;
    
    try {
      setLoading(true);
      const res = showDiscountModal;
      
      let finalAmount = discountData.amount;
      if (discountData.type === 'percentage') {
        finalAmount = (res.totalAmount * discountData.amount) / 100;
      }
      
      await postToLedger(hotel.id, res.guestId || 'unknown', res.id, {
        amount: finalAmount,
        type: 'credit',
        category: 'service',
        description: `Discount (${discountData.type === 'percentage' ? discountData.amount + '%' : formatCurrency(discountData.amount, currency, exchangeRate)}): ${discountData.reason || 'Management Discount'}`,
        referenceId: res.id,
        postedBy: profile.uid
      }, profile.uid);

      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'DISCOUNT_APPLIED',
        resource: `Res #${res.id.slice(-6)} - ${formatCurrency(finalAmount, currency, exchangeRate)}`,
        hotelId: hotel.id,
        module: 'Front Desk',
        details: `${discountData.type === 'percentage' ? discountData.amount + '%' : 'Fixed'} - ${discountData.reason}`
      });

      toast.success('Discount applied successfully');
      setShowDiscountModal(null);
      setDiscountData({ amount: 0, type: 'fixed', reason: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/ledger`);
      toast.error('Failed to apply discount');
    } finally {
      setLoading(false);
    }
  };

  const updateReservationStatus = async (res: Reservation, status: Reservation['status']) => {
    if (!hotel?.id || !profile) return;
    try {
      setLoading(true);
      const batch = writeBatch(db);
      const resRef = doc(db, 'hotels', hotel.id, 'reservations', res.id);
      
      // 1. Update reservation status
      batch.update(resRef, { status });
      
      // 2. Handle specific status transitions
      if (status === 'checked_in') {
        // Mark room as occupied
        batch.update(doc(db, 'hotels', hotel.id, 'rooms', res.roomId), { status: 'occupied' });
        
        if (res.guestId) {
          // REMOVED: Redundant with manual posting or nightly audit
          /*
          await postToLedger(hotel.id, res.guestId, res.id, {
            amount: res.totalAmount,
            type: 'debit',
            category: 'room',
            description: `Room Charge: ${res.roomNumber} (${res.checkIn} to ${res.checkOut})`,
            referenceId: res.id,
            postedBy: profile.uid
          }, profile.uid, res.corporateId);
          */

          // AUTO DEDUCTION: If guest has credit balance, apply it
          const guest = guests.find(g => g.id === res.guestId);
          if (guest && guest.ledgerBalance > 0) {
            const creditToApply = Math.min(guest.ledgerBalance, res.totalAmount - (res.paidAmount || 0));
            if (creditToApply > 0) {
              await settleLedger(hotel.id, res.guestId, res.id, creditToApply, 'Credit Balance', profile.uid);
              // Update reservation paidAmount in batch
              batch.update(resRef, { 
                paidAmount: increment(creditToApply),
                paymentStatus: (res.paidAmount || 0) + creditToApply >= res.totalAmount ? 'paid' : 'partial'
              });
              toast.info(`Applied ${formatCurrency(creditToApply, currency, exchangeRate)} from guest's credit balance.`);
            }
          }
        }
      } else if (status === 'checked_out') {
        const balance = (res.totalAmount || 0) - (res.paidAmount || 0);
        if (balance > 0) {
          toast.warning(`Guest checked out with an outstanding balance of ${formatCurrency(balance, currency, exchangeRate)}. This debt remains on their account.`);
          // Log debt movement
          await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
            timestamp: new Date().toISOString(),
            userId: profile.uid,
            userEmail: profile.email,
            userRole: profile.role,
            action: 'DEBT_RETAINED',
            resource: `Guest ${res.guestName} checked out with ${formatCurrency(balance, currency, exchangeRate)} debt.`,
            hotelId: hotel.id,
            module: 'Front Desk'
          });
        }
        batch.update(doc(db, 'hotels', hotel.id, 'rooms', res.roomId), { status: 'dirty' });
      } else if (status === 'cancelled' || status === 'no_show') {
        // Mark room as clean/vacant
        batch.update(doc(db, 'hotels', hotel.id, 'rooms', res.roomId), { status: 'clean' });
      }

      // 3. Log action
      const logRef = doc(collection(db, 'hotels', hotel.id, 'activityLogs'));
      batch.set(logRef, {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'UPDATE_BOOKING_STATUS',
        resource: `Booking ${res.id}: ${status}`,
        hotelId: hotel.id,
        module: 'Front Desk'
      });

      await batch.commit();
      toast.success(`Reservation status updated to ${status.replace('_', ' ')}`);
    } catch (err) {
      console.error("Update status error:", err);
      toast.error('Failed to update status');
    } finally {
      setLoading(false);
    }
  };

  const updatePayment = async (res: Reservation, amount: number) => {
    if (!hotel?.id || !profile) return;
    const newPaidAmount = (res.paidAmount || 0) + amount;
    const paymentStatus = newPaidAmount >= res.totalAmount ? 'paid' : (newPaidAmount > 0 ? 'partial' : 'unpaid');
    
    try {
      setLoading(true);
      await setDoc(doc(db, 'hotels', hotel.id, 'reservations', res.id), { 
        paidAmount: newPaidAmount,
        paymentStatus 
      }, { merge: true });

      // Use settleLedger to record payment and update guest balance
      if (res.guestId) {
        await settleLedger(
          hotel.id, 
          res.guestId, 
          res.id, 
          amount, 
          'Cash', // Default to cash
          profile.uid
        );
      }

      // Add to finance records
      await addDoc(collection(db, 'hotels', hotel.id, 'finance'), {
        type: 'income',
        amount: amount,
        category: 'Room Revenue',
        description: `Payment for booking ${res.id} (${res.guestName})`,
        timestamp: new Date().toISOString(),
        paymentMethod: 'cash'
      });

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'UPDATE_PAYMENT',
        resource: `Payment for ${res.guestName}: ${formatCurrency(amount, currency, exchangeRate)}`,
        hotelId: hotel.id,
        module: 'Finance'
      });
      toast.success('Payment recorded successfully');
    } catch (err) {
      console.error("Payment update error:", err);
      toast.error('Failed to record payment');
    } finally {
      setLoading(false);
    }
  };

  const transferRoom = async (res: Reservation, newRoomId: string) => {
    if (!hotel?.id || !profile) return;
    const newRoom = rooms.find(r => r.id === newRoomId);
    if (!newRoom) return;

    try {
      setLoading(true);
      
      // Calculate price difference if any
      const oldRoom = rooms.find(r => r.id === res.roomId);
      const oldRoomTypeId = oldRoom?.roomTypeId || roomTypes.find(t => t.name === oldRoom?.type)?.id;
      const newRoomTypeId = newRoom.roomTypeId || roomTypes.find(t => t.name === newRoom.type)?.id;
      
      const oldRoomType = roomTypes.find(t => t.id === oldRoomTypeId);
      const newRoomType = roomTypes.find(t => t.id === newRoomTypeId);
      
      let priceDifference = 0;
      if (oldRoomType && newRoomType && oldRoomType.id !== newRoomType.id) {
        // Calculate remaining nights
        const checkOutDate = new Date(res.checkOut);
        const today = new Date();
        const remainingNights = Math.max(1, Math.ceil((checkOutDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
        
        // Use negotiated rate if applicable, otherwise base price
        let newPrice = newRoomType.basePrice;
        if (res.corporateId) {
          const rate = activeCorporateRates.find(r => r.roomTypeId === newRoomType.id || r.roomType === newRoomType.name);
          if (rate) newPrice = rate.rate;
        }
        
        let oldPrice = oldRoomType.basePrice;
        if (res.corporateId) {
          const rate = activeCorporateRates.find(r => r.roomTypeId === oldRoomType.id || r.roomType === oldRoomType.name);
          if (rate) oldPrice = rate.rate;
        }

        priceDifference = (newPrice - oldPrice) * remainingNights;
      }

      // 1. Mark old room as dirty
      await updateDoc(doc(db, 'hotels', hotel.id, 'rooms', res.roomId), { status: 'dirty' });
      
      // 2. Mark new room as occupied
      await updateDoc(doc(db, 'hotels', hotel.id, 'rooms', newRoomId), { status: 'occupied' });

      // 3. Update reservation
      const newTotalAmount = (res.totalAmount || 0) + priceDifference;
      await updateDoc(doc(db, 'hotels', hotel.id, 'reservations', res.id), {
        roomId: newRoomId,
        roomNumber: newRoom.roomNumber,
        totalAmount: newTotalAmount
      });

      // 4. Post transfer note to ledger
      await postToLedger(hotel.id, res.guestId || 'unknown', res.id, {
        amount: Math.abs(priceDifference),
        type: priceDifference >= 0 ? 'debit' : 'credit',
        category: 'service',
        description: `Room Transfer: From ${res.roomNumber} to ${newRoom.roomNumber}${priceDifference !== 0 ? ` (Price Adj: ${formatCurrency(priceDifference, currency, exchangeRate)})` : ''}`,
        referenceId: res.id,
        postedBy: profile.uid
      }, profile.uid, res.corporateId);

      // 5. Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'ROOM_TRANSFER',
        resource: `Transferred ${res.guestName} to Room ${newRoom.roomNumber}. Balance adjusted by ${formatCurrency(priceDifference, currency, exchangeRate)}`,
        hotelId: hotel.id,
        module: 'Front Desk'
      });

      setShowTransferModal(null);
      toast.success(`Successfully transferred to Room ${newRoom.roomNumber}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/reservations/${res.id}`);
      toast.error('Failed to transfer room');
    } finally {
      setLoading(false);
    }
  };

  const postCharge = async () => {
    if (!hotel?.id || !profile || !showChargeModal) return;
    const res = showChargeModal;

    try {
      setLoading(true);
      await postToLedger(hotel.id, res.guestId || 'unknown', res.id, {
        amount: chargeDetails.amount,
        type: 'debit',
        category: chargeDetails.category,
        description: chargeDetails.description,
        referenceId: res.id,
        postedBy: profile.uid
      }, profile.uid, res.corporateId);

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'POST_CHARGE',
        resource: `Posted ${chargeDetails.category} charge of ${formatCurrency(chargeDetails.amount, currency, exchangeRate)} to ${res.guestName}`,
        hotelId: hotel.id,
        module: 'Front Desk'
      });

      setShowChargeModal(null);
      setChargeDetails({ amount: 0, category: 'restaurant', description: '' });
      toast.success('Charge posted successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/ledger`);
      toast.error('Failed to post charge');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = (type: 'rooms' | 'arrivals' | 'checkins' | 'checkouts' | 'inhouse') => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    let dataToExport: any[] = [];
    let filename = '';

    switch (type) {
      case 'rooms':
        dataToExport = rooms.map(r => ({
          Room: r.roomNumber,
          Type: r.type,
          Status: r.status,
          Floor: r.floor,
          Amenities: (r.amenities || []).join(', ')
        }));
        filename = `room_status_${todayStr}.csv`;
        break;
      case 'arrivals':
        dataToExport = reservations
          .filter(r => r.status === 'pending' && r.checkIn === todayStr)
          .map(r => ({
            Guest: r.guestName,
            Room: r.roomNumber,
            CheckIn: r.checkIn,
            CheckOut: r.checkOut,
            Amount: r.totalAmount,
            Status: r.status
          }));
        filename = `arrivals_${todayStr}.csv`;
        break;
      case 'checkins':
        dataToExport = reservations
          .filter(r => r.status === 'checked_in' && r.checkIn === todayStr)
          .map(r => ({
            Guest: r.guestName,
            Room: r.roomNumber,
            CheckIn: r.checkIn,
            CheckOut: r.checkOut,
            Amount: r.totalAmount,
            Status: r.status
          }));
        filename = `checkins_${todayStr}.csv`;
        break;
      case 'checkouts':
        dataToExport = reservations
          .filter(r => r.status === 'checked_out' && r.checkOut === todayStr)
          .map(r => ({
            Guest: r.guestName,
            Room: r.roomNumber,
            CheckIn: r.checkIn,
            CheckOut: r.checkOut,
            Amount: r.totalAmount,
            Status: r.status
          }));
        filename = `checkouts_${todayStr}.csv`;
        break;
      case 'inhouse':
        dataToExport = reservations
          .filter(r => r.status === 'checked_in')
          .map(r => ({
            Guest: r.guestName,
            Room: r.roomNumber,
            CheckIn: r.checkIn,
            CheckOut: r.checkOut,
            Amount: r.totalAmount,
            Status: r.status
          }));
        filename = `inhouse_${todayStr}.csv`;
        break;
    }

    if (dataToExport.length === 0) {
      toast.error('No data to export for this category');
      return;
    }

    exportToCSV(dataToExport, filename);
    toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} exported successfully`);
  };

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Front Desk</h1>
          <p className="text-zinc-400">Manage bookings and guest check-ins</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative group">
            <button className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl font-medium transition-all active:scale-95">
              <Download size={18} />
              Export
            </button>
            <div className="absolute right-0 mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 overflow-hidden">
              <button onClick={() => handleExport('rooms')} className="w-full text-left px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors">Room Status</button>
              <button onClick={() => handleExport('arrivals')} className="w-full text-left px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors">Today's Arrivals</button>
              <button onClick={() => handleExport('checkins')} className="w-full text-left px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors">Today's Check-ins</button>
              <button onClick={() => handleExport('checkouts')} className="w-full text-left px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors">Today's Check-outs</button>
              <button onClick={() => handleExport('inhouse')} className="w-full text-left px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors">In-House Guests</button>
            </div>
          </div>
          <button 
            onClick={() => setShowNightAuditModal(true)}
            disabled={isAuditing}
            className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all disabled:opacity-50"
            title="Run Nightly Audit"
          >
            <RefreshCw size={18} className={cn(isAuditing && "animate-spin")} />
          </button>
          <button 
            onClick={() => {
              setNewBooking({
                guestName: '',
                guestEmail: '',
                guestPhone: '',
                roomId: '',
                checkIn: format(new Date(), 'yyyy-MM-dd'),
                checkOut: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
                guestType: 'corporate',
                corporateId: '',
                guestId: '',
                totalAmount: 0,
                paidAmount: 0,
                paymentStatus: 'unpaid' as const,
                notes: '',
                corporateReference: '',
                discountAmount: 0,
                discountType: 'fixed',
                discountReason: '',
                additionalStays: [],
              });
              setIsBooking(true);
            }}
            className="hidden sm:flex bg-zinc-900 border border-zinc-800 text-white px-4 py-2 rounded-lg font-bold items-center justify-center gap-2 hover:bg-zinc-800 transition-all active:scale-95"
          >
            <Building2 size={18} className="text-emerald-500" />
            Corporate Booking
          </button>
          <button 
            onClick={() => {
              setNewBooking({
                guestName: '',
                guestEmail: '',
                guestPhone: '',
                roomId: '',
                checkIn: format(new Date(), 'yyyy-MM-dd'),
                checkOut: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
                guestType: 'individual',
                corporateId: '',
                guestId: '',
                totalAmount: 0,
                paidAmount: 0,
                paymentStatus: 'unpaid' as const,
                notes: '',
                corporateReference: '',
                discountAmount: 0,
                discountType: 'fixed',
                discountReason: '',
                additionalStays: [],
              });
              setIsBooking(true);
            }}
            className="w-full sm:w-auto bg-emerald-500 text-black px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all active:scale-95"
          >
            <Plus size={18} />
            New Booking
          </button>
        </div>
      </header>

      {/* Room Status Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Total Rooms</div>
          <div className="text-xl font-bold text-white">{roomStats.total}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
          <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider mb-1">Available</div>
          <div className="text-xl font-bold text-white">{roomStats.available}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
          <div className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-1">Occupied</div>
          <div className="text-xl font-bold text-white">{roomStats.occupied}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
          <div className="text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-1">Dirty</div>
          <div className="text-xl font-bold text-white">{roomStats.dirty}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
          <div className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-1">Maintenance</div>
          <div className="text-xl font-bold text-white">{roomStats.maintenance}</div>
        </div>
      </div>

      {/* Night Audit Modal */}
      {showNightAuditModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md text-center"
          >
            <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <RefreshCw size={32} className={cn("text-emerald-500", isAuditing && "animate-spin")} />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Run Nightly Audit</h3>
            <p className="text-zinc-400 text-sm mb-8">
              This will post nightly room charges for all {reservations.filter(r => r.status === 'checked_in').length} checked-in guests for the current date.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowNightAuditModal(false)}
                disabled={isAuditing}
                className="flex-1 py-3 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={runNightlyAudit}
                disabled={isAuditing}
                className="flex-1 py-3 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isAuditing ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Run Audit'
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {isBooking && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-6">New Reservation</h3>
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Booking Type</label>
                  <div className="flex bg-zinc-950 border border-zinc-800 rounded-lg p-1">
                    <button 
                      onClick={() => setNewBooking({ ...newBooking, guestType: 'individual', corporateId: '' })}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-xs font-bold transition-all",
                        newBooking.guestType === 'individual' ? "bg-emerald-500 text-black" : "text-zinc-500 hover:text-zinc-300"
                      )}
                    >
                      <User size={14} /> Individual
                    </button>
                    <button 
                      onClick={() => setNewBooking({ ...newBooking, guestType: 'corporate' })}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-xs font-bold transition-all",
                        newBooking.guestType === 'corporate' ? "bg-emerald-500 text-black" : "text-zinc-500 hover:text-zinc-300"
                      )}
                    >
                      <Building2 size={14} /> Corporate
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">
                    {newBooking.guestType === 'corporate' ? 'Corporate Account (Required)' : 'Corporate Account (Optional)'}
                  </label>
                  {corporateAccounts.length > 0 ? (
                    <select 
                      className={cn(
                        "w-full bg-zinc-950 border rounded-lg px-4 py-2 text-white outline-none transition-all",
                        newBooking.guestType === 'corporate' && !newBooking.corporateId ? "border-amber-500/50" : "border-zinc-800 focus:border-emerald-500"
                      )}
                      value={newBooking.corporateId}
                      onChange={(e) => setNewBooking({ ...newBooking, corporateId: e.target.value })}
                    >
                      <option value="">{newBooking.guestType === 'corporate' ? 'Select Account' : 'None / Individual'}</option>
                      {corporateAccounts.map(acc => (
                        <option key={acc.id} value={acc.id}>{acc.name}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-[10px] text-amber-500 bg-amber-500/10 p-2 rounded border border-amber-500/20 flex items-center gap-2">
                      <AlertCircle size={12} />
                      No corporate accounts found
                    </div>
                  )}
                </div>
              </div>

              {newBooking.guestType === 'corporate' && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl space-y-4"
                >
                  <div className="flex items-center gap-2 text-emerald-500 font-bold text-xs uppercase tracking-wider">
                    <Building2 size={14} />
                    Corporate Details
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Corporate Reference / PO Number</label>
                    <input 
                      type="text" 
                      placeholder="e.g. PO-12345 or Project Name"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                      value={newBooking.corporateReference}
                      onChange={(e) => setNewBooking({ ...newBooking, corporateReference: e.target.value })}
                    />
                  </div>
                </motion.div>
              )}

              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Select Existing Guest</label>
                <select 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={newBooking.guestId}
                  onChange={(e) => {
                    const guest = guests.find(g => g.id === e.target.value);
                    if (guest) {
                      setNewBooking({
                        ...newBooking,
                        guestId: guest.id,
                        guestName: guest.name,
                        guestEmail: guest.email,
                        guestPhone: guest.phone,
                        corporateId: guest.corporateId || newBooking.corporateId,
                        guestType: guest.corporateId ? 'corporate' : newBooking.guestType
                      });
                    } else {
                      setNewBooking({ ...newBooking, guestId: '', guestName: '', guestEmail: '', guestPhone: '' });
                    }
                  }}
                >
                  <option value="">New Guest</option>
                  {guests.map(g => (
                    <option key={g.id} value={g.id}>{g.name} ({g.phone}) - Bal: {formatCurrency(g.ledgerBalance || 0, currency, exchangeRate)}</option>
                  ))}
                </select>
                {newBooking.guestId && guests.find(g => g.id === newBooking.guestId)?.ledgerBalance !== 0 && (
                  <div className={cn(
                    "mt-2 p-2 rounded border flex items-center gap-2 text-[10px]",
                    (guests.find(g => g.id === newBooking.guestId)?.ledgerBalance || 0) < 0 ? "bg-red-500/10 border-red-500/20 text-red-500" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                  )}>
                    <AlertCircle size={12} />
                    Guest has an {(guests.find(g => g.id === newBooking.guestId)?.ledgerBalance || 0) < 0 ? 'outstanding balance' : 'overpayment credit'} of {formatCurrency(Math.abs(guests.find(g => g.id === newBooking.guestId)?.ledgerBalance || 0), currency, exchangeRate)}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Guest Name</label>
                  <input 
                    type="text" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                    value={newBooking.guestName}
                    onChange={(e) => setNewBooking({ ...newBooking, guestName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Phone Number</label>
                  <input 
                    type="tel" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                    value={newBooking.guestPhone}
                    onChange={(e) => setNewBooking({ ...newBooking, guestPhone: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Email Address</label>
                <input 
                  type="email" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={newBooking.guestEmail}
                  onChange={(e) => setNewBooking({ ...newBooking, guestEmail: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Room</label>
                <select 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={newBooking.roomId}
                  onChange={(e) => {
                    setNewBooking({ ...newBooking, roomId: e.target.value });
                  }}
                >
                  <option value="">Select a room</option>
                  {rooms.filter(r => r.status === 'clean').map(room => {
                    const selectedRoom = rooms.find(r => r.id === room.id);
                    let displayPrice = room.price;
                    let isNegotiated = false;

                    if (newBooking.corporateId) {
                      const activeRate = activeCorporateRates.find(r => 
                        (r.roomTypeId === room.roomTypeId || r.roomType === room.type) &&
                        new Date(newBooking.checkIn) >= new Date(r.startDate) &&
                        new Date(newBooking.checkIn) <= new Date(r.endDate)
                      );
                      if (activeRate) {
                        displayPrice = activeRate.rate;
                        isNegotiated = true;
                      }
                    }

                    return (
                      <option key={room.id} value={room.id}>
                        Room {room.roomNumber} ({room.type} - {formatCurrency(displayPrice, currency, exchangeRate)}{isNegotiated ? ' [Negotiated]' : ''})
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Check In</label>
                  <input 
                    type="date" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                    value={newBooking.checkIn}
                    min={profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin' ? undefined : format(new Date(), 'yyyy-MM-dd')}
                    onChange={(e) => setNewBooking({ ...newBooking, checkIn: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Check Out</label>
                  <input 
                    type="date" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                    value={newBooking.checkOut}
                    onChange={(e) => setNewBooking({ ...newBooking, checkOut: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Notes</label>
                <textarea 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none resize-none h-20"
                  value={newBooking.notes}
                  onChange={(e) => setNewBooking({ ...newBooking, notes: e.target.value })}
                />
              </div>

              <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 space-y-4">
                <div className="flex items-center gap-2 text-emerald-500 font-bold text-xs uppercase tracking-wider">
                  <Tag size={14} />
                  Discount (Optional)
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 uppercase mb-1">Amount</label>
                    <input 
                      type="number" 
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-white focus:border-emerald-500 outline-none"
                      value={newBooking.discountAmount || ''}
                      onChange={(e) => setNewBooking({ ...newBooking, discountAmount: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 uppercase mb-1">Type</label>
                    <select 
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-white focus:border-emerald-500 outline-none"
                      value={newBooking.discountType}
                      onChange={(e) => setNewBooking({ ...newBooking, discountType: e.target.value as 'fixed' | 'percentage' })}
                    >
                      <option value="fixed">Fixed ({currency})</option>
                      <option value="percentage">Percentage (%)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-zinc-500 uppercase mb-1">Reason</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Management Approval"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-white focus:border-emerald-500 outline-none"
                    value={newBooking.discountReason}
                    onChange={(e) => setNewBooking({ ...newBooking, discountReason: e.target.value })}
                  />
                </div>
              </div>

              <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 space-y-2">
                <div className="flex justify-between text-xs text-zinc-500 uppercase font-bold">
                  <span>Summary</span>
                  <span>Amount</span>
                </div>
                {newBooking.guestType === 'corporate' && newBooking.additionalStays.length > 0 && (
                  <div className="text-[10px] text-zinc-500 border-b border-zinc-800 pb-2 mb-2">
                    {newBooking.additionalStays.length + 1} Guests Total
                  </div>
                )}
                {isNegotiatedRate && (
                  <div className="flex justify-between text-[10px] text-emerald-500 font-bold uppercase">
                    <span>Rate Type</span>
                    <span className="flex items-center gap-1"><Tag size={10} /> Negotiated</span>
                  </div>
                )}
                <div className="flex justify-between text-[10px] text-zinc-400">
                  <span>Subtotal</span>
                  <span>{formatCurrency(newBooking.totalAmount, currency, exchangeRate)}</span>
                </div>
                {newBooking.discountAmount > 0 && (
                  <div className="flex justify-between text-[10px] text-red-500">
                    <span>Discount ({newBooking.discountType === 'percentage' ? newBooking.discountAmount + '%' : 'Fixed'})</span>
                    <span>-{formatCurrency(newBooking.discountType === 'percentage' ? (newBooking.totalAmount * newBooking.discountAmount) / 100 : newBooking.discountAmount, currency, exchangeRate)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm text-white border-t border-zinc-800 pt-2 mt-2">
                  <span>Net Total</span>
                  <span className="font-bold text-emerald-500">
                    {formatCurrency(
                      newBooking.totalAmount - (newBooking.discountType === 'percentage' ? (newBooking.totalAmount * newBooking.discountAmount) / 100 : newBooking.discountAmount), 
                      currency, 
                      exchangeRate
                    )}
                  </span>
                </div>
              </div>

              {newBooking.guestType === 'corporate' && (
                <div className="space-y-4 pt-4 border-t border-zinc-800">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-white">Additional Guests</h4>
                    <button 
                      onClick={() => {
                        const id = Math.random().toString(36).substr(2, 9);
                        setNewBooking({
                          ...newBooking,
                          additionalStays: [
                            ...newBooking.additionalStays,
                            {
                              id,
                              guestName: '',
                              guestEmail: '',
                              guestPhone: '',
                              roomId: '',
                              checkIn: newBooking.checkIn,
                              checkOut: newBooking.checkOut,
                              totalAmount: 0
                            }
                          ]
                        });
                      }}
                      className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider flex items-center gap-1 hover:text-emerald-400"
                    >
                      <Plus size={12} /> Add Guest
                    </button>
                  </div>

                  {newBooking.additionalStays.map((stay, index) => (
                    <div key={stay.id} className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-4 relative">
                      <button 
                        onClick={() => {
                          setNewBooking({
                            ...newBooking,
                            additionalStays: newBooking.additionalStays.filter(s => s.id !== stay.id)
                          });
                        }}
                        className="absolute top-2 right-2 text-zinc-500 hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1">Guest Name</label>
                          <input 
                            type="text" 
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white focus:border-emerald-500 outline-none"
                            value={stay.guestName}
                            onChange={(e) => {
                              const updated = [...newBooking.additionalStays];
                              updated[index].guestName = e.target.value;
                              setNewBooking({ ...newBooking, additionalStays: updated });
                            }}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1">Room</label>
                          <select 
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white focus:border-emerald-500 outline-none"
                            value={stay.roomId}
                            onChange={(e) => {
                              const updated = [...newBooking.additionalStays];
                              updated[index].roomId = e.target.value;
                              setNewBooking({ ...newBooking, additionalStays: updated });
                            }}
                          >
                            <option value="">Select Room</option>
                            {rooms.filter(r => r.status === 'clean' || r.id === stay.roomId).map(room => {
                              let displayPrice = room.price;
                              let isNegotiated = false;

                              if (newBooking.guestType === 'corporate' && newBooking.corporateId) {
                                const rate = activeCorporateRates.find(r => 
                                  (r.roomTypeId === room.roomTypeId || r.roomType === room.type) &&
                                  new Date(stay.checkIn) >= new Date(r.startDate) &&
                                  new Date(stay.checkIn) <= new Date(r.endDate)
                                );
                                if (rate) {
                                  displayPrice = rate.rate;
                                  isNegotiated = true;
                                }
                              }

                              return (
                                <option key={room.id} value={room.id}>
                                  Room {room.roomNumber} ({room.type} - {formatCurrency(displayPrice, currency, exchangeRate)}{isNegotiated ? ' [Negotiated]' : ''})
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1">Check In</label>
                          <input 
                            type="date" 
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white focus:border-emerald-500 outline-none"
                            value={stay.checkIn}
                            onChange={(e) => {
                              const updated = [...newBooking.additionalStays];
                              updated[index].checkIn = e.target.value;
                              setNewBooking({ ...newBooking, additionalStays: updated });
                            }}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1">Check Out</label>
                          <input 
                            type="date" 
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white focus:border-emerald-500 outline-none"
                            value={stay.checkOut}
                            onChange={(e) => {
                              const updated = [...newBooking.additionalStays];
                              updated[index].checkOut = e.target.value;
                              setNewBooking({ ...newBooking, additionalStays: updated });
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-4 mt-8">
              <button 
                onClick={() => setIsBooking(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white transition-all active:scale-95"
              >
                Cancel
              </button>
              <button 
                onClick={handleBooking}
                className="flex-1 bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95"
              >
                Confirm Booking
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="font-bold text-white">Active Reservations</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
            <input 
              type="text" 
              placeholder="Search guests or rooms..."
              className="bg-zinc-950 border border-zinc-800 rounded-lg pl-10 pr-4 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800">
                <th className="px-6 py-4">Guest</th>
                <th className="px-6 py-4">Room</th>
                <th className="px-6 py-4">Dates</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filteredReservations.map(res => (
                <tr key={res.id} className="hover:bg-zinc-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-500">
                        {res.corporateId ? <Building2 size={14} /> : <User size={14} />}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">{res.guestName}</div>
                        {res.corporateId && (
                          <div className="text-[10px] text-emerald-500 font-bold flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              <Building2 size={10} />
                              {corporateAccounts.find(a => a.id === res.corporateId)?.name || 'Corporate'}
                            </div>
                            {res.corporateReference && (
                              <div className="text-zinc-400 font-normal">Ref: {res.corporateReference}</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-400">Room {res.roomNumber}</td>
                  <td className="px-6 py-4 text-xs text-zinc-400">
                    <div className="flex items-center gap-1"><Clock size={12} /> {res.checkIn}</div>
                    <div className="flex items-center gap-1 opacity-50"><Clock size={12} /> {res.checkOut}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-400">
                    <div>{formatCurrency(res.totalAmount, currency, exchangeRate)}</div>
                    <div className={cn(
                      "text-[10px] font-bold uppercase",
                      res.paymentStatus === 'paid' ? "text-emerald-500" :
                      res.paymentStatus === 'partial' ? "text-amber-500" : "text-red-500"
                    )}>
                      {res.paymentStatus} ({formatCurrency(res.paidAmount || 0, currency, exchangeRate)})
                    </div>
                    {res.guestId && (
                      <div className="text-[10px] text-zinc-500 mt-1">
                        Ledger: {formatCurrency((res.ledgerEntries || []).reduce((acc, e) => acc + (e.type === 'debit' ? e.amount : -e.amount), 0), currency, exchangeRate)}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <span className={cn(
                        "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider w-fit",
                        res.status === 'checked_in' ? "bg-emerald-500/10 text-emerald-500" :
                        res.status === 'pending' ? "bg-blue-500/10 text-blue-500" :
                        res.status === 'no_show' ? "bg-amber-500/10 text-amber-500" :
                        res.status === 'checked_out' ? "bg-zinc-800 text-zinc-400" : "bg-red-500/10 text-red-500"
                      )}>
                        {res.status.replace('_', ' ')}
                      </span>
                      {res.status === 'checked_in' && new Date() > new Date(res.checkOut) && (
                        <span className="px-2 py-0.5 bg-red-500/10 text-red-500 text-[8px] font-bold uppercase rounded w-fit animate-pulse">
                          Overstay
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      {res.status === 'checked_in' && (
                        <>
                          <button 
                            onClick={() => setShowTransferModal(res)}
                            className="p-2 text-zinc-400 hover:bg-zinc-800 rounded-lg transition-all active:scale-90"
                            title="Transfer Room"
                          >
                            <RefreshCw size={18} />
                          </button>
                          <button 
                            onClick={() => {
                              setNewCheckOutDate(res.checkOut);
                              setShowPostponeModal(res);
                            }}
                            className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-all active:scale-90"
                            title="Postpone Stay / Extend"
                          >
                            <Calendar size={18} />
                          </button>
                          <button 
                            onClick={() => setShowDiscountModal(res)}
                            className="p-2 text-amber-500 hover:bg-amber-500/10 rounded-lg transition-all active:scale-90"
                            title="Apply Discount"
                          >
                            <Tag size={18} />
                          </button>
                          <button 
                            onClick={() => setShowChargeModal(res)}
                            className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all active:scale-90"
                            title="Post Charge to Room"
                          >
                            <Plus size={18} />
                          </button>
                          <button 
                            onClick={() => updateReservationStatus(res, 'checked_out')}
                            className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-lg transition-all active:scale-90"
                            title="Check Out"
                          >
                            <LogOut size={18} />
                          </button>
                        </>
                      )}
                      
                      {res.status === 'pending' && (
                        <>
                          <button 
                            onClick={() => updateReservationStatus(res, 'checked_in')}
                            className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all active:scale-90"
                            title="Check In"
                          >
                            <CheckCircle2 size={18} />
                          </button>
                          <button 
                            onClick={() => setShowConfirmAction({ res, action: 'no_show' })}
                            className="p-2 text-amber-500 hover:bg-amber-500/10 rounded-lg transition-all active:scale-90"
                            title="Mark No-Show"
                          >
                            <UserX size={18} />
                          </button>
                          <button 
                            onClick={() => setShowConfirmAction({ res, action: 'cancelled' })}
                            className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-all active:scale-90"
                            title="Cancel"
                          >
                            <XCircle size={18} />
                          </button>
                        </>
                      )}

                      <button 
                        onClick={() => {
                          setEditingReservation(res);
                          setEditForm({
                            checkIn: res.checkIn,
                            checkOut: res.checkOut,
                            totalAmount: res.totalAmount,
                            notes: res.notes || ''
                          });
                        }}
                        className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-all active:scale-90"
                        title="Edit Reservation"
                      >
                        <Edit2 size={18} />
                      </button>

                      <button 
                        onClick={() => setShowFolioModal(res)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 rounded-lg transition-all active:scale-95 font-bold text-[10px] uppercase tracking-wider"
                        title="View Guest Folio"
                      >
                        <Receipt size={14} />
                        View Folio
                      </button>

                      {(profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') && (
                        <button 
                          onClick={() => setShowConfirmAction({ res, action: 'delete' })}
                          className="p-2 text-zinc-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all active:scale-90"
                          title="Delete Reservation"
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

      {/* Edit Reservation Modal */}
      {editingReservation && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md"
          >
            <h3 className="text-xl font-bold text-white mb-6">Edit Reservation</h3>
            <form onSubmit={handleEditReservation} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Check In</label>
                  <input 
                    type="date" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                    value={editForm.checkIn}
                    min={profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin' ? undefined : format(new Date(), 'yyyy-MM-dd')}
                    onChange={(e) => setEditForm({ ...editForm, checkIn: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Check Out</label>
                  <input 
                    type="date" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                    value={editForm.checkOut}
                    onChange={(e) => setEditForm({ ...editForm, checkOut: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Total Amount (Discounted/Adjusted)</label>
                <input 
                  type="number" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={editForm.totalAmount}
                  onChange={(e) => setEditForm({ ...editForm, totalAmount: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Notes</label>
                <textarea 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none resize-none h-20"
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingReservation(null)}
                  className="flex-1 py-2 bg-zinc-800 text-zinc-400 rounded-lg font-bold hover:bg-zinc-700 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-emerald-500 text-black rounded-lg font-bold hover:bg-emerald-400 transition-all active:scale-95"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {showTransferModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-6">Transfer Room</h3>
            <p className="text-zinc-400 text-sm mb-4">
              Transferring <strong>{showTransferModal.guestName}</strong> from Room <strong>{showTransferModal.roomNumber}</strong>
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Select New Room</label>
                <select 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  onChange={(e) => {
                    if (e.target.value) {
                      transferRoom(showTransferModal, e.target.value);
                    }
                  }}
                >
                  <option value="">Select a clean room</option>
                  {rooms.filter(r => r.status === 'clean').map(room => (
                    <option key={room.id} value={room.id}>
                      Room {room.roomNumber} ({room.type})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button 
                onClick={() => setShowTransferModal(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showChargeModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-6">Post Charge to Room</h3>
            <p className="text-zinc-400 text-sm mb-4">
              Posting charge for <strong>{showChargeModal.guestName}</strong> (Room {showChargeModal.roomNumber})
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Category</label>
                <select 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={chargeDetails.category}
                  onChange={(e) => setChargeDetails({ ...chargeDetails, category: e.target.value as any })}
                >
                  <option value="restaurant">Restaurant / Bar</option>
                  <option value="service">Laundry / Service</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Amount ({currency})</label>
                <input 
                  type="number" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={chargeDetails.amount}
                  onChange={(e) => setChargeDetails({ ...chargeDetails, amount: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Description</label>
                <input 
                  type="text" 
                  placeholder="e.g. Dinner, Laundry, etc."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={chargeDetails.description}
                  onChange={(e) => setChargeDetails({ ...chargeDetails, description: e.target.value })}
                />
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button 
                onClick={() => setShowChargeModal(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={postCharge}
                disabled={!chargeDetails.amount || !chargeDetails.description}
                className="flex-1 bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50"
              >
                Post Charge
              </button>
            </div>
          </div>
        </div>
      )}

      {showReceipt && hotel && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[60] flex items-center justify-center p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg my-8">
            <div className="absolute -top-12 right-0 flex gap-4 print:hidden">
              <button 
                onClick={() => window.print()}
                className="text-white hover:text-emerald-400 font-bold flex items-center gap-2"
              >
                <Receipt size={20} />
                Print
              </button>
              <button 
                onClick={() => setShowReceipt(null)}
                className="text-white hover:text-zinc-400 font-bold flex items-center gap-2"
              >
                <XCircle size={20} />
                Close
              </button>
            </div>
            <div className="bg-white rounded-2xl overflow-hidden">
              <ReceiptGenerator 
                hotel={hotel} 
                reservation={showReceipt.res} 
                type={showReceipt.type} 
                ledgerEntries={showReceipt.res.ledgerEntries || []}
              />
            </div>
          </div>
        </div>
      )}

      {showFolioModal && (
        <GuestFolio 
          reservation={showFolioModal} 
          onClose={() => setShowFolioModal(null)}
          onPostCharge={() => {
            setShowFolioModal(null);
            setShowChargeModal(showFolioModal);
          }}
        />
      )}

      {showPostponeModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md"
          >
            <h3 className="text-xl font-bold text-white mb-2">Postpone Stay</h3>
            <p className="text-zinc-400 text-sm mb-6">Extend the stay for {showPostponeModal.guestName} in Room {showPostponeModal.roomNumber}.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Current Check-out</label>
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-400">
                  {showPostponeModal.checkOut}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">New Check-out Date</label>
                <input 
                  type="date"
                  min={addDays(new Date(showPostponeModal.checkOut), 1).toISOString().split('T')[0]}
                  value={newCheckOutDate}
                  onChange={(e) => setNewCheckOutDate(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:border-emerald-500 outline-none"
                />
              </div>
              
              {newCheckOutDate && (
                <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
                  <div className="flex justify-between text-xs font-bold text-blue-500 uppercase mb-1">
                    <span>Extra Nights</span>
                    <span>{Math.ceil((new Date(newCheckOutDate).getTime() - new Date(showPostponeModal.checkOut).getTime()) / (1000 * 60 * 60 * 24))}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-white">
                    <span>Estimated Extra Charge</span>
                    <span>{formatCurrency(Math.ceil((new Date(newCheckOutDate).getTime() - new Date(showPostponeModal.checkOut).getTime()) / (1000 * 60 * 60 * 24)) * (rooms.find(r => r.id === showPostponeModal.roomId)?.price || 0), currency, exchangeRate)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => setShowPostponeModal(null)}
                className="flex-1 py-3 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handlePostponeStay}
                disabled={loading || !newCheckOutDate}
                className="flex-1 py-3 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50"
              >
                {loading ? 'Processing...' : 'Confirm Extension'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {showDiscountModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md"
          >
            <h3 className="text-xl font-bold text-white mb-2">Apply Discount</h3>
            <p className="text-zinc-400 text-sm mb-6">Give a discount to {showDiscountModal.guestName}. This will be posted as a credit to their folio.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Discount Type</label>
                <div className="flex gap-2 p-1 bg-zinc-950 border border-zinc-800 rounded-xl">
                  <button
                    onClick={() => setDiscountData({ ...discountData, type: 'fixed' })}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-xs font-bold transition-all",
                      discountData.type === 'fixed' ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-400"
                    )}
                  >
                    Fixed Amount
                  </button>
                  <button
                    onClick={() => setDiscountData({ ...discountData, type: 'percentage' })}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-xs font-bold transition-all",
                      discountData.type === 'percentage' ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-400"
                    )}
                  >
                    Percentage (%)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">
                  {discountData.type === 'fixed' ? `Discount Amount (${currency})` : 'Discount Percentage (%)'}
                </label>
                <input 
                  type="number"
                  value={discountData.amount}
                  onChange={(e) => setDiscountData({ ...discountData, amount: parseFloat(e.target.value) })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  placeholder="0.00"
                />
                {discountData.type === 'percentage' && discountData.amount > 0 && (
                  <p className="text-[10px] text-emerald-500 mt-1 font-bold">
                    Calculated Discount: {formatCurrency((showDiscountModal.totalAmount * discountData.amount) / 100, currency, exchangeRate)}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Reason / Notes</label>
                <textarea 
                  value={discountData.reason}
                  onChange={(e) => setDiscountData({ ...discountData, reason: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:border-emerald-500 outline-none h-24 resize-none"
                  placeholder="e.g. Compensation for noise, Management approval..."
                />
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => setShowDiscountModal(null)}
                className="flex-1 py-3 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyDiscount}
                disabled={loading || !discountData.amount || !discountData.reason}
                className="flex-1 py-3 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50"
              >
                {loading ? 'Applying...' : 'Apply Discount'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!showConfirmAction}
        title={showConfirmAction?.action === 'delete' ? 'Delete Reservation' : showConfirmAction?.action === 'no_show' ? 'Mark No-Show' : 'Cancel Reservation'}
        message={showConfirmAction?.action === 'delete'
          ? `Are you sure you want to permanently delete the reservation for ${showConfirmAction?.res.guestName}? This action cannot be undone.`
          : showConfirmAction?.action === 'no_show' 
            ? `Are you sure you want to mark ${showConfirmAction?.res.guestName} as No-Show?`
            : `Are you sure you want to cancel the reservation for ${showConfirmAction?.res.guestName}?`
        }
        onConfirm={handleConfirmAction}
        onCancel={() => setShowConfirmAction(null)}
        type={showConfirmAction?.action === 'delete' ? 'danger' : showConfirmAction?.action === 'no_show' ? 'warning' : 'danger'}
        confirmText={showConfirmAction?.action === 'delete' ? 'Delete' : showConfirmAction?.action === 'no_show' ? 'Confirm No-Show' : 'Cancel Reservation'}
        isLoading={loading}
      />
    </div>
  );
}
