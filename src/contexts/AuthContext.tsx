import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError } from '../firebase';
import { UserProfile, Hotel, SystemSettings, OperationType } from '../types';
import { safeStringify } from '../utils';

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
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  isOffline: boolean;
  retryConnection: () => void;
  setSelectedHotelId: (id: string | null) => void;
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
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('pms_theme') as 'light' | 'dark') || 'dark';
  });
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [selectedHotelId, setSelectedHotelIdState] = useState<string | null>(() => {
    return localStorage.getItem('pms_selected_hotel_id');
  });

  const setSelectedHotelId = (id: string | null) => {
    setSelectedHotelIdState(id);
    if (id) {
      localStorage.setItem('pms_selected_hotel_id', id);
    } else {
      localStorage.removeItem('pms_selected_hotel_id');
    }
  };

  const retryConnection = () => {
    setIsOffline(false);
    setLoading(true);
    window.location.reload();
  };

  const setCurrency = (newCurrency: 'NGN' | 'USD') => {
    setCurrencyState(newCurrency);
    localStorage.setItem('pms_currency', newCurrency);
  };

  const setTheme = (newTheme: 'light' | 'dark') => {
    setThemeState(newTheme);
    localStorage.setItem('pms_theme', newTheme);
  };

  // Apply theme class
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

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

  // 2. Profile Fetcher (Real-time)
  useEffect(() => {
    if (!user || hasProfileError) return;

    const profileRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(profileRef, async (snap) => {
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
    }, (err: any) => {
      if (err.message?.includes('offline') || err.code === 'unavailable' || err.code === 'network-request-failed') {
        setIsOffline(true);
      }
      handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
      if (err.code === 'permission-denied') {
        console.warn("Profile access restricted.");
        setHasProfileError(true);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user?.uid, hasProfileError]);

  // 3. Hotel Fetcher (Real-time)
  useEffect(() => {
    let hotelId = profile?.hotelId;
    const role = profile?.role;

    // Super Admin can override hotelId with selectedHotelId
    if (role === 'superAdmin' && selectedHotelId) {
      hotelId = selectedHotelId;
    }

    if (!hotelId || (hotelId === 'system' && role !== 'superAdmin') || hasHotelError) {
      setHotel(null);
      return;
    }

    // Special case: Super Admin with 'system' hotelId and no selection
    if (hotelId === 'system' && role === 'superAdmin' && !selectedHotelId) {
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
      }
    });

    return () => unsub();
  }, [profile?.hotelId, profile?.role, hasHotelError]);

  // 4. System Settings Fetcher (with retry)
  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 3;

    const fetchSettings = async () => {
      try {
        const snap = await getDoc(doc(db, 'system', 'settings'));
        if (snap.exists()) {
          setSystemSettings(snap.data() as SystemSettings);
          setIsOffline(false);
        }
      } catch (err: any) {
        if (err.message?.includes('offline') || err.code === 'unavailable' || err.code === 'network-request-failed') {
          setIsOffline(true);
          if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(fetchSettings, 2000 * retryCount);
            return;
          }
        }
        handleFirestoreError(err, OperationType.GET, 'system/settings');
      }
    };

    fetchSettings();
  }, []);

  // 5. Branding Color Application
  useEffect(() => {
    if (hotel?.branding) {
      const { primaryColor, secondaryColor, statusColors } = hotel.branding;
      const root = document.documentElement;
      
      if (primaryColor) root.style.setProperty('--primary-color', primaryColor);
      if (secondaryColor) root.style.setProperty('--secondary-color', secondaryColor);
      
      if (statusColors) {
        Object.entries(statusColors).forEach(([status, color]) => {
          if (color) root.style.setProperty(`--status-${status}-color`, color);
        });
      }
    }
  }, [hotel?.branding]);

  const isSubscriptionActive = profile?.role === 'superAdmin' 
    ? true 
    : (hotel ? (hotel.subscriptionStatus === 'active' && new Date(hotel.subscriptionExpiry + 'T23:59:59').getTime() > Date.now()) : false);

  const exchangeRate = hotel?.exchangeRate || systemSettings?.exchangeRate || 1500;
  const baseCurrency = hotel?.defaultCurrency || 'NGN';

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
      systemSettings,
      theme,
      setTheme,
      isOffline,
      retryConnection,
      setSelectedHotelId
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
