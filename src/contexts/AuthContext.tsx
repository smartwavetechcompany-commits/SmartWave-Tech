import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError } from '../firebase';
import { UserProfile, Hotel, SystemSettings, OperationType } from '../types';

const SUPER_ADMIN_EMAIL = 'smartwavetechcompany@gmail.com';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  hotel: Hotel | null;
  loading: boolean;
  isSubscriptionActive: boolean;
  currency: 'NGN' | 'USD';
  setCurrency: (currency: 'NGN' | 'USD') => void;
  exchangeRate: number;
  systemSettings: SystemSettings | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasProfileError, setHasProfileError] = useState(false);
  const [hasHotelError, setHasHotelError] = useState(false);
  const [currency, setCurrencyState] = useState<'NGN' | 'USD'>(() => {
    return (localStorage.getItem('pms_currency') as 'NGN' | 'USD') || 'NGN';
  });
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);

  const setCurrency = (newCurrency: 'NGN' | 'USD') => {
    setCurrencyState(newCurrency);
    localStorage.setItem('pms_currency', newCurrency);
  };

  // 1. Auth State Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        // Reset state for new user session
        setHasProfileError(false);
        setHasHotelError(false);
        setLoading(true);
      }
      
      setUser(firebaseUser);
      
      if (!firebaseUser) {
        setProfile(null);
        setHotel(null);
        setLoading(false);
        setHasProfileError(false);
        setHasHotelError(false);
      }
    });
    
    return () => unsubscribe();
  }, []);

  // 2. Profile Fetcher
  useEffect(() => {
    if (!user || hasProfileError) return;

    const fetchProfile = async () => {
      const profileRef = doc(db, 'users', user.uid);
      try {
        const snap = await getDoc(profileRef);
        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          setProfile(data);
          setLoading(false);
        } else if (user.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
          // Auto-bootstrap Super Admin profile if it doesn't exist
          const bootstrapProfile: UserProfile = {
            email: user.email,
            hotelId: 'system',
            role: 'superAdmin',
            displayName: user.displayName || 'System Owner',
            createdAt: new Date().toISOString(),
            status: 'active',
            uid: user.uid
          };
          await setDoc(profileRef, bootstrapProfile);
          setProfile(bootstrapProfile);
          setLoading(false);
        } else {
          setProfile(null);
          setLoading(false);
        }
      } catch (err: any) {
        handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
        if (err.code === 'permission-denied') {
          console.warn("Profile access restricted.");
          setHasProfileError(true);
        } else {
          console.error("Profile fetch error:", err);
        }
        setLoading(false);
      }
    };

    fetchProfile();
  }, [user?.uid, hasProfileError]);

  // 3. Hotel Fetcher (Real-time)
  useEffect(() => {
    const hotelId = profile?.hotelId;
    const role = profile?.role;

    if (!hotelId || hotelId === 'system' || hasHotelError) {
      setHotel(null);
      return;
    }

    // Only hotelAdmin, staff and superAdmin can read hotel docs
    if (role !== 'hotelAdmin' && role !== 'superAdmin' && role !== 'staff') {
      setHotel(null);
      return;
    }

    const hotelRef = doc(db, 'hotels', hotelId);
    const unsub = onSnapshot(hotelRef, (snap) => {
      if (snap.exists()) {
        setHotel({ id: snap.id, ...snap.data() } as Hotel);
      } else {
        setHotel(null);
      }
    }, (err: any) => {
      if (err.code === 'permission-denied') {
        console.warn("Hotel access restricted.");
        setHasHotelError(true);
      } else {
        console.error("Hotel fetch error:", err);
      }
    });

    return () => unsub();
  }, [profile?.hotelId, profile?.role, hasHotelError]);

  // 4. System Settings Fetcher
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const snap = await getDoc(doc(db, 'system', 'settings'));
        if (snap.exists()) {
          setSystemSettings(snap.data() as SystemSettings);
        }
      } catch (err: any) {
        handleFirestoreError(err, OperationType.GET, 'system/settings');
        console.error("System settings fetch error:", err);
      }
    };

    fetchSettings();
  }, []);

  const isSubscriptionActive = profile?.role === 'superAdmin' 
    ? true 
    : (hotel ? (hotel.subscriptionStatus === 'active' && new Date(hotel.subscriptionExpiry).getTime() > Date.now()) : false);

  const exchangeRate = systemSettings?.exchangeRate || 1500;

  return (
    <AuthContext.Provider value={{ 
      user, 
      profile, 
      hotel, 
      loading, 
      isSubscriptionActive,
      currency,
      setCurrency,
      exchangeRate,
      systemSettings
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
