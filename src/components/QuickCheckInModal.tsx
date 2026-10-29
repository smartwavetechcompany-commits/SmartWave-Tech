import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, 
  LogIn, 
  CheckCircle2, 
  Clock, 
  Search, 
  User, 
  Phone, 
  Mail, 
  BedDouble, 
  Calendar, 
  CreditCard, 
  DollarSign, 
  AlertCircle, 
  ShieldCheck, 
  Sparkles,
  ChevronRight,
  ArrowRight
} from 'lucide-react';
import { Reservation, Room, RoomBlocking, Hotel, RoomType } from '../types';
import { isRoomAvailable, doDateRangesOverlap } from '../utils/roomUtils';
import { canCheckIn } from '../utils/policyUtils';
import { hasPermission } from '../utils/permissions';
import { formatCurrency, cn } from '../utils';
import { format, addDays, parseISO, differenceInDays } from 'date-fns';
import { doc, collection, addDoc, updateDoc, setDoc, getDoc, getDocs, query, where, limit, increment, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { database } from '../utils/database';
import { logActivity } from '../utils/activityLogger';
import { postToLedger, settleLedger } from '../services/ledgerService';
import { toast } from 'sonner';

export function isRoomDirtyOrUnprepared(room: Room | undefined | null): boolean {
  if (!room) return false;
  // If actively in cleaning progress, room is not ready for guest arrival
  if (room.status === 'cleaning' || room.housekeepingStatus === 'cleaning') {
    return true;
  }
  // If explicitly failed housekeeping inspection, room needs correction
  if (room.housekeepingStatus === 'failed') {
    return true;
  }
  // If explicitly clean or ready in either status or housekeepingStatus, room is clean & prepared
  if (
    room.status === 'clean' || 
    room.housekeepingStatus === 'ready' || 
    (room.housekeepingStatus as string) === 'clean'
  ) {
    return false;
  }
  // If explicitly flagged dirty in either status or housekeepingStatus, room is dirty
  if (room.status === 'dirty' || room.housekeepingStatus === 'dirty') {
    return true;
  }
  // Standard vacant rooms without dirty flags are clean & prepared
  return false;
}

interface QuickCheckInModalProps {
  isOpen: boolean;
  onClose: () => void;
  reservations: Reservation[];
  rooms: Room[];
  roomBlockings?: RoomBlocking[];
  roomTypes?: RoomType[];
  hotel: Hotel | null;
  profile: any;
  currency: 'NGN' | 'USD' | string;
  exchangeRate: number;
  initialSelectedReservation?: Reservation | null;
}

export function QuickCheckInModal({
  isOpen,
  onClose,
  reservations,
  rooms,
  roomBlockings = [],
  roomTypes = [],
  hotel,
  profile,
  currency,
  exchangeRate,
  initialSelectedReservation = null
}: QuickCheckInModalProps) {
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const tomorrowStr = format(addDays(new Date(), 1), 'yyyy-MM-dd');
  const safeCurrency: 'NGN' | 'USD' = currency === 'USD' ? 'USD' : 'NGN';

  // Live real-time Firestore synchronization for instantaneous reactive updates
  const [liveRooms, setLiveRooms] = useState<Room[]>(rooms);
  const [liveReservations, setLiveReservations] = useState<Reservation[]>(reservations);
  const [liveBlockings, setLiveBlockings] = useState<RoomBlocking[]>(roomBlockings);

  useEffect(() => {
    setLiveRooms(rooms);
  }, [rooms]);

  useEffect(() => {
    setLiveReservations(reservations);
  }, [reservations]);

  useEffect(() => {
    setLiveBlockings(roomBlockings);
  }, [roomBlockings]);

  useEffect(() => {
    if (!isOpen || !hotel?.id) return;

    const unsubRooms = onSnapshot(
      collection(db, 'hotels', hotel.id, 'rooms'), 
      (snap) => {
        setLiveRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
      },
      (err) => {
        console.warn('Live rooms snapshot in QuickCheckInModal:', err);
      }
    );

    const unsubRes = onSnapshot(
      collection(db, 'hotels', hotel.id, 'reservations'), 
      (snap) => {
        setLiveReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
      },
      (err) => {
        console.warn('Live reservations snapshot in QuickCheckInModal:', err);
      }
    );

    const unsubBlockings = onSnapshot(
      collection(db, 'hotels', hotel.id, 'room_blockings'), 
      (snap) => {
        setLiveBlockings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as RoomBlocking)));
      },
      (err) => {
        console.warn('Live blockings snapshot in QuickCheckInModal:', err);
      }
    );

    return () => {
      unsubRooms();
      unsubRes();
      unsubBlockings();
    };
  }, [isOpen, hotel?.id]);

  // Expected arrivals scheduled for today that haven't checked in yet
  const todayArrivals = useMemo(() => {
    return liveReservations.filter(r => 
      r.checkIn === todayStr && 
      (r.status === 'pending' || r.status === 'confirmed')
    );
  }, [liveReservations, todayStr]);

  // Mode: 'arrivals' (select existing arrival) or 'walkin' (express walk-in arrival)
  const [activeMode, setActiveMode] = useState<'arrivals' | 'walkin'>(() => {
    if (initialSelectedReservation) return 'arrivals';
    return todayArrivals.length > 0 ? 'arrivals' : 'walkin';
  });

  const [arrivalSearch, setArrivalSearch] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Walk-in form state
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [checkInDate, setCheckInDate] = useState<string>(todayStr);
  const [checkOutDate, setCheckOutDate] = useState<string>(tomorrowStr);
  const [customRate, setCustomRate] = useState<number | ''>('');
  const [paymentOption, setPaymentOption] = useState<'unpaid' | 'cash' | 'card' | 'transfer'>('unpaid');
  const [paymentAmount, setPaymentAmount] = useState<number | ''>('');
  const [isSubmittingWalkIn, setIsSubmittingWalkIn] = useState(false);

  // Filtered expected arrivals based on search
  const filteredArrivals = useMemo(() => {
    if (!arrivalSearch.trim()) return todayArrivals;
    const term = arrivalSearch.toLowerCase().trim();
    return todayArrivals.filter(r => 
      r.guestName.toLowerCase().includes(term) ||
      r.roomNumber.toLowerCase().includes(term) ||
      (r.guestPhone && r.guestPhone.includes(term)) ||
      (r.id && r.id.toLowerCase().includes(term))
    );
  }, [todayArrivals, arrivalSearch]);

  // Filter available rooms for walk-in check-in dates
  const availableRoomsForWalkIn = useMemo(() => {
    if (!checkInDate || !checkOutDate) return [];
    return liveRooms.filter(room => {
      // Physical status check: cannot be occupied or maintenance/out_of_service
      if (room.status === 'occupied' || room.status === 'maintenance' || room.status === 'out_of_service' || room.status === 'out_of_order') {
        return false;
      }
      // Cleanliness check: A dirty/unprepared room must NEVER be assigned for immediate walk-in check-in
      if (isRoomDirtyOrUnprepared(room)) {
        return false;
      }
      // Check availability against all reservations and blockings
      return isRoomAvailable(room.id, checkInDate, checkOutDate, liveReservations, liveBlockings, hotel);
    });
  }, [liveRooms, checkInDate, checkOutDate, liveReservations, liveBlockings, hotel]);

  // Selected room details
  const selectedRoom = useMemo(() => {
    return liveRooms.find(r => r.id === selectedRoomId);
  }, [liveRooms, selectedRoomId]);

  // Calculate stay nights
  const walkInNights = useMemo(() => {
    try {
      const diff = differenceInDays(parseISO(checkOutDate), parseISO(checkInDate));
      return Math.max(1, diff);
    } catch {
      return 1;
    }
  }, [checkInDate, checkOutDate]);

  // Effective nightly rate
  const effectiveNightlyRate = useMemo(() => {
    if (customRate !== '') return Number(customRate);
    if (selectedRoom) return selectedRoom.price || 0;
    return 0;
  }, [customRate, selectedRoom]);

  // Calculated total amount
  const walkInTotalAmount = useMemo(() => {
    return effectiveNightlyRate * walkInNights;
  }, [effectiveNightlyRate, walkInNights]);

  // Auto-fill payment amount when total changes and payment option is not unpaid
  const handlePaymentOptionChange = (option: 'unpaid' | 'cash' | 'card' | 'transfer') => {
    setPaymentOption(option);
    if (option === 'unpaid') {
      setPaymentAmount('');
    } else {
      setPaymentAmount(walkInTotalAmount);
    }
  };

  // Quick duration selection
  const setQuickDuration = (nights: number) => {
    try {
      const newOut = format(addDays(parseISO(checkInDate), nights), 'yyyy-MM-dd');
      setCheckOutDate(newOut);
    } catch {
      // fallback
    }
  };

  // Check in an expected arrival
  const handleCheckInArrival = async (res: Reservation) => {
    if (!hotel?.id || !profile) {
      toast.error('System error: missing hotel or user session.');
      return;
    }

    // Permission check
    const canDoCheckIn = hasPermission(profile, 'check_in_guests') || profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin';
    if (!canDoCheckIn) {
      toast.error('Access denied: You do not have permission to check in guests.');
      return;
    }

    // Check if room is currently occupied by someone else
    const activeStay = liveReservations.find(r => 
      r.roomId === res.roomId && 
      r.status === 'checked_in' && 
      r.id !== res.id
    );
    if (activeStay) {
      toast.error(`Check-in Blocked: Room ${res.roomNumber} is currently occupied by in-house guest "${activeStay.guestName}". They must check out first.`);
      return;
    }

    const room = liveRooms.find(r => r.id === res.roomId);
    if (isRoomDirtyOrUnprepared(room)) {
      toast.error(`Check-in Blocked: Room ${res.roomNumber} is currently dirty. Housekeeping must service and inspect the room before check-in.`);
      return;
    }

    const policy = canCheckIn(hotel, profile, res, room, undefined, liveReservations);
    if (!policy.allowed) {
      toast.error(policy.message || 'Check-in denied by hotel policy');
      return;
    }

    try {
      setProcessingId(res.id);
      const now = new Date();
      const staffName = profile.displayName || profile.name || profile.email || 'Front Desk Staff';
      const resRef = doc(db, 'hotels', hotel.id, 'reservations', res.id);

      // 1. Update reservation status
      await database.safeUpdate(resRef, {
        status: 'checked_in',
        operationalStatus: 'checked_in',
        checkInDateTime: now.toISOString(),
        actualCheckIn: now.toISOString(),
        checkInTime: format(now, 'HH:mm'),
        checkedInBy: profile.email || profile.uid || 'System',
        checkedInByName: staffName
      }, {
        hotelId: hotel.id,
        module: 'Front Desk',
        action: 'QUICK_CHECK_IN',
        details: `Guest ${res.guestName} checked in to Room ${res.roomNumber} via Quick Check-in`
      });

      // 2. Mark room occupied
      const roomRef = doc(db, 'hotels', hotel.id, 'rooms', res.roomId);
      await database.safeUpdate(roomRef, { status: 'occupied' }, {
        hotelId: hotel.id,
        module: 'Rooms',
        action: 'ROOM_CHECKIN',
        details: `Room ${res.roomNumber} occupied during quick check-in`
      });

      // 2b. Synchronize with Guest Module (hotels/{hotel.id}/guests)
      let resolvedGuestId = res.guestId || '';
      try {
        const guestsCol = collection(db, 'hotels', hotel.id, 'guests');
        if (resolvedGuestId) {
          const guestRef = doc(db, 'hotels', hotel.id, 'guests', resolvedGuestId);
          const guestSnap = await getDoc(guestRef);
          if (guestSnap.exists()) {
            await database.safeUpdate(guestRef, {
              totalStays: increment(1),
              lastStay: res.checkIn || todayStr,
              updatedAt: now.toISOString()
            }, {
              hotelId: hotel.id,
              module: 'Guests',
              action: 'STAY_COUNT_INCREMENT',
              details: `Incremented stay count for guest ${resolvedGuestId} upon arrival quick check-in`
            });
          } else {
            // Re-create guest document if ID existed on res but doc was missing
            await setDoc(guestRef, {
              name: res.guestName,
              email: res.guestEmail || '',
              phone: res.guestPhone || '',
              status: 'active',
              hotelId: hotel.id,
              totalStays: 1,
              totalNights: res.nights || 1,
              totalSpent: res.paidAmount || 0,
              lastStay: res.checkIn || todayStr,
              ledgerBalance: 0,
              preferredBookingSource: res.bookingSource || 'Direct',
              createdAt: now.toISOString(),
              updatedAt: now.toISOString()
            }, { merge: true });
          }
        } else {
          // If reservation had no guestId, lookup or create active guest
          const trimmedPhone = (res.guestPhone || '').trim();
          const trimmedEmail = (res.guestEmail || '').trim();
          const trimmedName = (res.guestName || '').trim();
          let existingSnap = null;
          if (trimmedPhone) {
            const snap = await getDocs(query(guestsCol, where('phone', '==', trimmedPhone), limit(1)));
            if (!snap.empty) existingSnap = snap.docs[0];
          }
          if (!existingSnap && trimmedEmail) {
            const snap = await getDocs(query(guestsCol, where('email', '==', trimmedEmail), limit(1)));
            if (!snap.empty) existingSnap = snap.docs[0];
          }
          if (!existingSnap && trimmedName) {
            const snap = await getDocs(query(guestsCol, where('name', '==', trimmedName), limit(1)));
            if (!snap.empty) existingSnap = snap.docs[0];
          }

          if (existingSnap) {
            resolvedGuestId = existingSnap.id;
            await database.safeUpdate(doc(db, 'hotels', hotel.id, 'guests', resolvedGuestId), {
              totalStays: increment(1),
              lastStay: res.checkIn || todayStr,
              updatedAt: now.toISOString()
            }, {
              hotelId: hotel.id,
              module: 'Guests',
              action: 'STAY_COUNT_INCREMENT',
              details: `Incremented stay count for existing guest ${resolvedGuestId} upon quick check-in`
            });
          } else {
            const newGuestRef = await addDoc(guestsCol, {
              name: trimmedName,
              email: trimmedEmail,
              phone: trimmedPhone,
              status: 'active',
              hotelId: hotel.id,
              totalStays: 1,
              totalNights: res.nights || 1,
              totalSpent: res.paidAmount || 0,
              lastStay: res.checkIn || todayStr,
              ledgerBalance: 0,
              preferredBookingSource: res.bookingSource || 'Direct',
              createdAt: now.toISOString(),
              updatedAt: now.toISOString()
            });
            resolvedGuestId = newGuestRef.id;
          }

          await database.safeUpdate(resRef, { guestId: resolvedGuestId }, {
            hotelId: hotel.id,
            module: 'Front Desk',
            action: 'ATTACH_GUEST_ID',
            details: `Attached guestId ${resolvedGuestId} to reservation ${res.id}`
          });
        }
      } catch (guestErr) {
        console.warn('Could not sync guest module for arrival quick check-in:', guestErr);
      }

      // 3. Write checkin_history
      const checkInHistoryRef = doc(db, 'hotels', hotel.id, 'checkin_history', res.id);
      await setDoc(checkInHistoryRef, {
        ...res,
        id: res.id,
        reservationId: res.id,
        guestId: resolvedGuestId || res.guestId || 'guest_walkin',
        guestName: res.guestName,
        guestEmail: res.guestEmail || '',
        guestPhone: res.guestPhone || '',
        roomNumber: res.roomNumber,
        roomId: res.roomId,
        checkIn: res.checkIn || todayStr,
        checkInTime: format(now, 'HH:mm'),
        checkInDateTime: now.toISOString(),
        actualCheckIn: now.toISOString(),
        checkOut: res.checkOut,
        checkInTimestamp: now.toISOString(),
        checkedInBy: profile.email || profile.uid || 'System',
        checkedInByName: staffName,
        status: 'checked_in',
        totalAmount: res.totalAmount || 0,
        paidAmount: res.paidAmount || 0,
        paymentStatus: res.paymentStatus || 'unpaid'
      }, { merge: true });

      // 4. Log audit activity
      await logActivity(
        hotel.id,
        profile,
        'CHECK_IN',
        'Operations Dashboard',
        `Guest ${res.guestName} rapid checked in to Room ${res.roomNumber}`,
        res.id,
        { status: res.status },
        { status: 'checked_in', roomNumber: res.roomNumber },
        { reservationId: res.id, roomNumber: res.roomNumber, guestName: res.guestName }
      );

      toast.success(`Check-In Complete! ${res.guestName} checked in to Room ${res.roomNumber}.`);
      onClose();
    } catch (err: any) {
      console.error('Quick check-in error:', err);
      toast.error(`Check-in failed: ${err.message || 'Unknown error'}`);
    } finally {
      setProcessingId(null);
    }
  };

  // Handle express walk-in check-in
  const handleSubmitWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!hotel?.id || !profile) {
      toast.error('System error: missing hotel or user session.');
      return;
    }

    if (!guestName.trim()) {
      toast.error('Please enter the guest full name.');
      return;
    }

    if (!selectedRoomId || !selectedRoom) {
      toast.error('Please select an available room.');
      return;
    }

    if (effectiveNightlyRate < 0) {
      toast.error('Nightly rate cannot be negative.');
      return;
    }

    // Availability re-check
    const isAvail = isRoomAvailable(selectedRoom.id, checkInDate, checkOutDate, liveReservations, liveBlockings, hotel);
    if (!isAvail) {
      toast.error(`Room ${selectedRoom.roomNumber} is no longer available for these dates.`);
      return;
    }

    // Check if room currently has active checked in guest
    const activeStay = liveReservations.find(r => 
      r.roomId === selectedRoom.id && 
      r.status === 'checked_in'
    );
    if (activeStay) {
      toast.error(`Room ${selectedRoom.roomNumber} is currently occupied by "${activeStay.guestName}". Cannot check in.`);
      return;
    }

    // Cleanliness check: cannot check in to a dirty room
    if (isRoomDirtyOrUnprepared(selectedRoom)) {
      toast.error(`Check-in Blocked: Room ${selectedRoom.roomNumber} is currently dirty. Housekeeping must service and inspect the room before check-in.`);
      return;
    }

    try {
      setIsSubmittingWalkIn(true);
      const now = new Date();
      const staffName = profile.displayName || profile.name || profile.email || 'Front Desk Staff';
      const parsedPayAmount = paymentOption !== 'unpaid' && paymentAmount !== '' ? Number(paymentAmount) : 0;
      const initialPaid = Math.max(0, parsedPayAmount);
      const paymentStatus = initialPaid >= walkInTotalAmount && walkInTotalAmount > 0 
        ? 'paid' 
        : initialPaid > 0 
          ? 'partial' 
          : 'unpaid';

      // 1. Resolve or create guest in hotel's guests collection
      let linkedGuestId = '';
      const trimmedPhone = guestPhone.trim();
      const trimmedEmail = guestEmail.trim();
      const trimmedName = guestName.trim();

      try {
        const guestsCol = collection(db, 'hotels', hotel.id, 'guests');
        let existingGuestSnap = null;
        if (trimmedPhone) {
          const snap = await getDocs(query(guestsCol, where('phone', '==', trimmedPhone), limit(1)));
          if (!snap.empty) existingGuestSnap = snap.docs[0];
        }
        if (!existingGuestSnap && trimmedEmail) {
          const snap = await getDocs(query(guestsCol, where('email', '==', trimmedEmail), limit(1)));
          if (!snap.empty) existingGuestSnap = snap.docs[0];
        }
        if (!existingGuestSnap && trimmedName) {
          const snap = await getDocs(query(guestsCol, where('name', '==', trimmedName), limit(1)));
          if (!snap.empty) existingGuestSnap = snap.docs[0];
        }

        if (existingGuestSnap) {
          linkedGuestId = existingGuestSnap.id;
          const guestRef = doc(db, 'hotels', hotel.id, 'guests', linkedGuestId);
          await database.safeUpdate(guestRef, {
            totalStays: increment(1),
            totalNights: increment(walkInNights),
            totalSpent: increment(initialPaid),
            lastStay: checkInDate,
            phone: trimmedPhone || existingGuestSnap.data().phone || '',
            email: trimmedEmail || existingGuestSnap.data().email || '',
            updatedAt: now.toISOString()
          }, {
            hotelId: hotel.id,
            module: 'Guests',
            action: 'GUEST_UPDATED',
            details: `Updated stay count and details for guest ${trimmedName} on Express Walk-in Check-in`
          });
        } else {
          const guestDocRef = await addDoc(guestsCol, {
            name: trimmedName,
            email: trimmedEmail,
            phone: trimmedPhone,
            status: 'active',
            hotelId: hotel.id,
            totalStays: 1,
            totalNights: walkInNights,
            totalSpent: initialPaid,
            lastStay: checkInDate,
            ledgerBalance: 0,
            preferredBookingSource: 'Walk-in',
            createdAt: now.toISOString(),
            updatedAt: now.toISOString()
          });
          linkedGuestId = guestDocRef.id;
        }
      } catch (guestErr) {
        console.error('Failed to link/create guest record during quick check-in:', guestErr);
        linkedGuestId = `guest_${Date.now()}`;
      }

      // 2. Create reservation document with linked guestId
      const reservationsCol = collection(db, 'hotels', hotel.id, 'reservations');
      const newResData: any = {
        guestName: trimmedName,
        guestPhone: trimmedPhone,
        guestEmail: trimmedEmail,
        guestId: linkedGuestId,
        roomId: selectedRoom.id,
        roomNumber: selectedRoom.roomNumber,
        checkIn: checkInDate,
        checkInTime: format(now, 'HH:mm'),
        checkInDateTime: now.toISOString(),
        actualCheckIn: now.toISOString(),
        checkOut: checkOutDate,
        checkOutTime: hotel.defaultCheckOutTime || '12:00',
        nights: walkInNights,
        nightlyRate: effectiveNightlyRate,
        totalAmount: walkInTotalAmount,
        paidAmount: initialPaid,
        paymentStatus,
        status: 'checked_in',
        operationalStatus: 'checked_in',
        bookingSource: 'Walk-in',
        source: 'Walk-in',
        mealPlan: 'Bed & Breakfast',
        breakfastEntitlement: 'Standard Breakfast Included',
        autoNightDeduction: true,
        ledgerBalance: Math.max(0, walkInTotalAmount - initialPaid),
        bookedBy: profile.uid || 'system',
        bookedByName: staffName,
        checkedInBy: profile.email || profile.uid || 'System',
        checkedInByName: staffName,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      };

      const resDocRef = await addDoc(reservationsCol, newResData);
      const reservationId = resDocRef.id;

      // 3. Mark room occupied
      const roomRef = doc(db, 'hotels', hotel.id, 'rooms', selectedRoom.id);
      await database.safeUpdate(roomRef, { status: 'occupied' }, {
        hotelId: hotel.id,
        module: 'Rooms',
        action: 'ROOM_CHECKIN',
        details: `Room ${selectedRoom.roomNumber} occupied by walk-in guest ${trimmedName}`
      });

      // 4. Write checkin_history
      const checkInHistoryRef = doc(db, 'hotels', hotel.id, 'checkin_history', reservationId);
      await setDoc(checkInHistoryRef, {
        ...newResData,
        id: reservationId,
        reservationId,
        guestId: linkedGuestId,
        checkInTimestamp: now.toISOString()
      }, { merge: true });

      // 5. Post initial payment to ledger if collected
      if (initialPaid > 0 && paymentOption !== 'unpaid') {
        try {
          await settleLedger(
            hotel.id,
            linkedGuestId,
            reservationId,
            initialPaid,
            paymentOption === 'card' ? 'card' : paymentOption === 'transfer' ? 'transfer' : 'cash',
            profile.uid || 'system',
            undefined,
            undefined,
            undefined,
            { uid: profile.uid, email: profile.email, displayName: staffName }
          );
        } catch (payErr) {
          console.error('Failed to post initial walk-in payment to ledger:', payErr);
        }
      }

      // 5. Log audit activity
      await logActivity(
        hotel.id,
        profile,
        'EXPRESS_WALKIN_CHECKIN',
        'Operations Dashboard',
        `Express Walk-in check-in created for ${trimmedName} in Room ${selectedRoom.roomNumber} (${walkInNights} night${walkInNights > 1 ? 's' : ''})`,
        reservationId,
        null,
        { status: 'checked_in', roomNumber: selectedRoom.roomNumber, totalAmount: walkInTotalAmount, guestId: linkedGuestId },
        { reservationId, roomNumber: selectedRoom.roomNumber, guestName: trimmedName, guestId: linkedGuestId }
      );

      toast.success(`Express Check-In Successful! ${trimmedName} checked in to Room ${selectedRoom.roomNumber}.`);
      onClose();
    } catch (err: any) {
      console.error('Express walk-in check-in error:', err);
      toast.error(`Check-in failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSubmittingWalkIn(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-0 sm:p-4 overscroll-contain animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-zinc-900 border-0 sm:border border-zinc-800 rounded-none sm:rounded-2xl w-full max-w-2xl flex flex-col h-[100dvh] sm:h-auto sm:max-h-[88vh] shadow-2xl overflow-hidden min-h-0 relative my-auto">
        {/* Modal Header */}
        <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-zinc-800 shrink-0 bg-zinc-900/95 sticky top-0 z-10 flex items-center justify-between pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-2 sm:p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
              <LogIn size={18} className="sm:w-5 sm:h-5 stroke-[2.5]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h3 className="text-base sm:text-lg font-bold text-zinc-50 tracking-tight truncate">Quick Check-in</h3>
                <span className="px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-black uppercase tracking-wider rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                  Rapid Arrival
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-zinc-400 mt-0.5 line-clamp-1 sm:line-clamp-none">
                Fast guest arrival processing for expected bookings and express walk-ins
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            className="min-w-[44px] min-h-[44px] flex items-center justify-center -mr-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-xl transition-colors shrink-0 cursor-pointer"
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="px-3 sm:px-6 pt-2 pb-0 bg-zinc-900 shrink-0 border-b border-zinc-800/80">
          <div className="flex gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setActiveMode('arrivals')}
              className={cn(
                "flex-1 min-h-[44px] pb-2.5 pt-2 text-[11px] sm:text-xs font-bold border-b-2 flex items-center justify-center gap-1.5 sm:gap-2 transition-all cursor-pointer",
                activeMode === 'arrivals'
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              )}
            >
              <Clock size={14} className="shrink-0" />
              <span className="truncate">Expected Arrivals</span>
              <span className={cn(
                "px-1.5 sm:px-2 py-0.5 text-[10px] font-black rounded-full shrink-0",
                todayArrivals.length > 0 
                  ? "bg-emerald-500 text-zinc-950" 
                  : "bg-zinc-800 text-zinc-400"
              )}>
                {todayArrivals.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveMode('walkin')}
              className={cn(
                "flex-1 min-h-[44px] pb-2.5 pt-2 text-[11px] sm:text-xs font-bold border-b-2 flex items-center justify-center gap-1.5 sm:gap-2 transition-all cursor-pointer",
                activeMode === 'walkin'
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              )}
            >
              <Sparkles size={14} className="shrink-0" />
              <span className="truncate">Express Walk-In</span>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-6 custom-scrollbar space-y-4 overscroll-contain">
          {/* TAB 1: EXPECTED ARRIVALS */}
          {activeMode === 'arrivals' && (
            <div className="space-y-4">
              {/* Search bar */}
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Quick search by guest name, room # or phone..."
                  value={arrivalSearch}
                  onChange={(e) => setArrivalSearch(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-4 py-2.5 text-base sm:text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 min-h-[44px]"
                  autoFocus
                />
              </div>

              {filteredArrivals.length === 0 ? (
                <div className="p-6 sm:p-8 text-center bg-zinc-950/40 border border-zinc-800/80 rounded-xl space-y-3">
                  <div className="w-12 h-12 rounded-full bg-zinc-800/60 text-zinc-500 flex items-center justify-center mx-auto">
                    <CheckCircle2 size={24} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-200">No Pending Arrivals for Today</h4>
                    <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto">
                      All scheduled guests for today have already checked in or none were booked.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveMode('walkin')}
                    className="mt-2 inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold transition-colors cursor-pointer"
                  >
                    <span>Switch to Express Walk-In</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredArrivals.map((res) => {
                    const room = liveRooms.find(r => r.id === res.roomId);
                    const activeOccupant = liveReservations.find(r => 
                      r.roomId === res.roomId && 
                      r.status === 'checked_in' && 
                      r.id !== res.id
                    );
                    const isDirty = isRoomDirtyOrUnprepared(room);
                    const isProcessing = processingId === res.id;

                    return (
                      <div
                        key={res.id}
                        className={cn(
                          "p-3.5 sm:p-4 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3",
                          activeOccupant 
                            ? "bg-red-500/5 border-red-500/20" 
                            : isDirty
                              ? "bg-amber-500/5 border-amber-500/20"
                              : "bg-zinc-950/60 border-zinc-800 hover:border-zinc-700"
                        )}
                      >
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-zinc-100 truncate">
                              {res.guestName}
                            </span>
                            <span className="px-2 py-0.5 text-[11px] font-mono font-bold rounded bg-zinc-800 text-zinc-200 border border-zinc-700">
                              Room {res.roomNumber}
                            </span>
                            {room?.type && (
                              <span className="text-[10px] text-zinc-400 uppercase tracking-wider">
                                • {room.type}
                              </span>
                            )}
                            {isDirty && (
                              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                Dirty / Needs Cleaning
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-xs text-zinc-400 flex-wrap">
                            <span className="flex items-center gap-1">
                              <Calendar size={13} className="text-zinc-500" />
                              {res.checkIn} to {res.checkOut} ({res.nights || 1}n)
                            </span>
                            <span className="text-zinc-500">•</span>
                            <span className="font-mono text-zinc-300">
                              Total: {formatCurrency(res.totalAmount || 0, safeCurrency, exchangeRate)}
                            </span>
                            {res.paidAmount !== undefined && (
                              <span className={cn(
                                "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider",
                                (res.paidAmount || 0) >= (res.totalAmount || 0)
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                  : (res.paidAmount || 0) > 0
                                    ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                                    : "bg-zinc-800 text-zinc-400"
                              )}>
                                {(res.paidAmount || 0) >= (res.totalAmount || 0) ? 'Fully Paid' : (res.paidAmount || 0) > 0 ? 'Partial' : 'Unpaid'}
                              </span>
                            )}
                          </div>

                          {activeOccupant && (
                            <div className="flex items-center gap-1.5 text-xs text-red-400 font-medium">
                              <AlertCircle size={13} />
                              <span>Occupied by in-house guest "{activeOccupant.guestName}". Requires checkout first.</span>
                            </div>
                          )}

                          {!activeOccupant && isDirty && (
                            <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
                              <AlertCircle size={13} />
                              <span>Room {res.roomNumber} is dirty. Housekeeping must service and inspect before check-in.</span>
                            </div>
                          )}
                        </div>

                        <div className="w-full sm:w-auto sm:self-center shrink-0 pt-1 sm:pt-0">
                          <button
                            type="button"
                            disabled={isProcessing || !!activeOccupant || isDirty}
                            onClick={() => handleCheckInArrival(res)}
                            className={cn(
                              "w-full sm:w-auto min-h-[44px] px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm cursor-pointer",
                              activeOccupant || isDirty
                                ? "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700"
                                : "bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-black shadow-emerald-950/40"
                            )}
                          >
                            {isProcessing ? (
                              <>
                                <span className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                                <span>Checking In...</span>
                              </>
                            ) : isDirty ? (
                              <>
                                <AlertCircle size={15} className="text-amber-400" />
                                <span>Room Dirty</span>
                              </>
                            ) : activeOccupant ? (
                              <>
                                <AlertCircle size={15} className="text-red-400" />
                                <span>Occupied</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 size={16} className="stroke-[2.5]" />
                                <span>Check In Now</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: EXPRESS WALK-IN ARRIVAL */}
          {activeMode === 'walkin' && (
            <form onSubmit={handleSubmitWalkIn} className="space-y-4">
              {/* Guest Details */}
              <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-3.5 sm:p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  <User size={14} className="text-emerald-400" />
                  <span>Guest Information</span>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Guest Full Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Adebayo Adeleke"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 min-h-[44px]"
                    autoFocus
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1">
                      Phone Number (Optional)
                    </label>
                    <input
                      type="tel"
                      placeholder="+234..."
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1">
                      Email Address (Optional)
                    </label>
                    <input
                      type="email"
                      placeholder="guest@example.com"
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 min-h-[44px]"
                    />
                  </div>
                </div>
              </div>

              {/* Stay Period & Available Room */}
              <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-3.5 sm:p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-zinc-400 uppercase tracking-wider">
                    <BedDouble size={14} className="text-emerald-400" />
                    <span>Stay & Room Selection</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setQuickDuration(n)}
                        className={cn(
                          "px-2.5 py-1 min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0 rounded-lg text-xs font-bold border transition-colors cursor-pointer flex items-center justify-center",
                          walkInNights === n
                            ? "bg-emerald-500 text-zinc-950 border-emerald-400 shadow-sm"
                            : "bg-zinc-800/80 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                        )}
                      >
                        {n}n
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1">Check-In</label>
                    <input
                      type="date"
                      value={checkInDate}
                      onChange={(e) => setCheckInDate(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-base sm:text-xs text-zinc-100 focus:outline-none focus:border-emerald-500 min-h-[44px] [color-scheme:dark]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1">Check-Out</label>
                    <input
                      type="date"
                      value={checkOutDate}
                      min={checkInDate}
                      onChange={(e) => setCheckOutDate(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-base sm:text-xs text-zinc-100 focus:outline-none focus:border-emerald-500 min-h-[44px] [color-scheme:dark]"
                    />
                  </div>
                </div>

                {/* Available Rooms Dropdown */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-zinc-300">
                      Select Available Room <span className="text-red-400">*</span>
                    </label>
                    <span className="text-[11px] text-zinc-400">
                      {availableRoomsForWalkIn.length} room{availableRoomsForWalkIn.length === 1 ? '' : 's'} ready
                    </span>
                  </div>

                  {availableRoomsForWalkIn.length === 0 ? (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 flex items-center gap-2">
                      <AlertCircle size={15} className="shrink-0" />
                      <span>
                        No clean and available rooms found for the selected stay dates.
                        {liveRooms.some(isRoomDirtyOrUnprepared) && (
                          <span className="block mt-0.5 text-zinc-400">
                            (Some rooms are pending housekeeping clearance)
                          </span>
                        )}
                      </span>
                    </div>
                  ) : (
                    <select
                      required
                      value={selectedRoomId}
                      onChange={(e) => {
                        const newId = e.target.value;
                        setSelectedRoomId(newId);
                        const r = liveRooms.find(rm => rm.id === newId);
                        if (r && customRate === '') {
                          // Keep room default
                        }
                      }}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-base sm:text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 min-h-[46px] cursor-pointer"
                    >
                      <option value="">-- Choose an available clean room --</option>
                      {availableRoomsForWalkIn.map((r) => (
                        <option key={r.id} value={r.id}>
                          Room {r.roomNumber} • {r.type} • {formatCurrency(r.price || 0, safeCurrency, exchangeRate)}/night (CLEAN / READY)
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* Rate & Payment Section */}
              <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-3.5 sm:p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  <CreditCard size={14} className="text-emerald-400" />
                  <span>Rate & Initial Settlement</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1">
                      Nightly Rate ({safeCurrency})
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={customRate !== '' ? customRate : (selectedRoom?.price || 0)}
                      onChange={(e) => setCustomRate(e.target.value ? Number(e.target.value) : '')}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-base sm:text-xs text-zinc-100 focus:outline-none focus:border-emerald-500 font-mono min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1">
                      Calculated Total ({walkInNights} night{walkInNights > 1 ? 's' : ''})
                    </label>
                    <div className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs sm:text-sm font-mono font-bold text-emerald-400 flex items-center justify-between min-h-[44px]">
                      <span>{formatCurrency(walkInTotalAmount, safeCurrency, exchangeRate)}</span>
                      <span className="text-[10px] text-zinc-500 font-sans font-normal">Auto-computed</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">
                    Initial Payment at Check-In
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                    {[
                      { id: 'unpaid', label: 'Unpaid / At Checkout' },
                      { id: 'cash', label: 'Cash' },
                      { id: 'card', label: 'POS / Card' },
                      { id: 'transfer', label: 'Bank Transfer' }
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handlePaymentOptionChange(opt.id as any)}
                        className={cn(
                          "min-h-[44px] py-2 px-2.5 rounded-lg text-xs font-bold border transition-colors text-center flex items-center justify-center cursor-pointer",
                          paymentOption === opt.id
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/40 shadow-sm"
                            : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {paymentOption !== 'unpaid' && (
                    <div className="mt-2">
                      <label className="block text-xs font-semibold text-zinc-400 mb-1">
                        Amount Paid Now ({safeCurrency})
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={walkInTotalAmount || undefined}
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value ? Number(e.target.value) : '')}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-base sm:text-xs text-zinc-100 focus:outline-none focus:border-emerald-500 font-mono min-h-[44px]"
                        placeholder="Amount"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Submit Buttons (Sticky footer on phone for effortless one-handed thumb completion) */}
              <div className="pt-3 border-t border-zinc-800/80 flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end gap-2.5 sm:gap-3 sticky bottom-0 bg-zinc-900/95 -mx-3.5 -mb-3.5 p-3.5 sm:mx-0 sm:mb-0 sm:p-0 sm:bg-transparent sm:static sm:border-t-0 backdrop-blur-sm pb-[max(0.875rem,env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-bold transition-colors text-center cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingWalkIn || !guestName.trim() || !selectedRoomId}
                  className="min-h-[48px] px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 transition-all active:scale-95 cursor-pointer"
                >
                  {isSubmittingWalkIn ? (
                    <>
                      <span className="w-4 h-4 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                      <span>Checking In...</span>
                    </>
                  ) : (
                    <>
                      <LogIn size={16} className="stroke-[2.5]" />
                      <span>Complete Walk-In Check-In</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
