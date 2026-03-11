import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { UserProfile, Hotel } from '../types';

const SUPER_ADMIN_EMAIL = 'smartwavetechcompany@gmail.com';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  hotel: Hotel | null;
  loading: boolean;
  isSubscriptionActive: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasProfileError, setHasProfileError] = useState(false);
  const [hasHotelError, setHasHotelError] = useState(false);

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

  // 2. Profile Listener
  useEffect(() => {
    if (!user || hasProfileError) return;

    const profileRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(profileRef, 
      async (snap) => {
        if (snap.exists()) {
          setProfile(snap.data() as UserProfile);
        } else if (user.email === SUPER_ADMIN_EMAIL && user.emailVerified) {
          // Auto-bootstrap Super Admin profile if it doesn't exist
          const bootstrapProfile: UserProfile = {
            uid: user.uid,
            email: user.email,
            hotelId: 'system',
            role: 'superAdmin',
            permissions: ['all'],
            status: 'active',
            displayName: user.displayName || 'System Owner',
          };
          try {
            await setDoc(profileRef, bootstrapProfile);
            setProfile(bootstrapProfile);
          } catch (e) {
            console.error("Failed to bootstrap Super Admin profile:", e);
            setProfile(null);
          }
        } else {
          setProfile(null);
        }
        setLoading(false);
      },
      (err) => {
        if (err.code === 'permission-denied') {
          console.warn("Profile access restricted.");
          setHasProfileError(true);
        } else {
          console.error("Profile listener error:", err);
        }
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid, hasProfileError]);

  // 3. Hotel Listener
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
    const unsubscribe = onSnapshot(hotelRef, 
      (snap) => {
        if (snap.exists()) {
          setHotel({ id: snap.id, ...snap.data() } as Hotel);
        } else {
          setHotel(null);
        }
      },
      (err) => {
        if (err.code === 'permission-denied') {
          console.warn("Hotel access restricted.");
          setHasHotelError(true);
        } else {
          console.error("Hotel listener error:", err);
        }
      }
    );

    return () => unsubscribe();
  }, [profile?.hotelId, profile?.role, hasHotelError]);

  const isSubscriptionActive = hotel 
    ? (hotel.status === 'active' && new Date(hotel.expiryDate) > new Date())
    : profile?.role === 'superAdmin';

  return (
    <AuthContext.Provider value={{ user, profile, hotel, loading, isSubscriptionActive }}>
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
