import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { onAuthStateChanged, User, signOut as fbSignOut } from 'firebase/auth';
import { doc, onSnapshot, getDoc, collection, query, where, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError } from '../firebase';
import { database } from '../utils/database';
import { UserProfile, Hotel, SystemSettings, OperationType, HotelSettings, CustomRole, ActiveSession } from '../types';
import { DEFAULT_SETTINGS } from '../constants';
import { settingsManager } from '../services/settingsManager';
import { Permission, hasPermission as checkUserPermission } from '../utils/permissions';
import { toast } from 'sonner';

const SUPER_ADMIN_EMAILS = ['admin@tyyltech.com', 'smartwavetechcompany@gmail.com'];

export function getClientDeviceInfo() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let browser = 'Unknown Browser';
  if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Edg')) browser = 'Edge';
  else if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Safari')) browser = 'Safari';

  let os = 'Unknown OS';
  if (ua.includes('Win')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  const isMobile = /Mobi|Android/i.test(ua);
  const device = isMobile ? 'Mobile' : 'Desktop';

  return {
    browser,
    os,
    device,
    screen: typeof window !== 'undefined' ? `${window.screen.width}x${window.screen.height}` : 'N/A',
    userAgent: ua,
    language: typeof navigator !== 'undefined' ? navigator.language : 'en'
  };
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  hotel: Hotel | null;
  customRoles: CustomRole[];
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
  currentSessionId: string | null;
  hasPermission: (permission: Permission) => boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasProfileError, setHasProfileError] = useState(false);
  const [hasHotelError, setHasHotelError] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
    return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pms_session_id') : null;
  });
  const [currency, setCurrencyState] = useState<'NGN' | 'USD'>(() => {
    return (typeof localStorage !== 'undefined' ? localStorage.getItem('pms_currency') as 'NGN' | 'USD' : null) || 'NGN';
  });
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    return (typeof localStorage !== 'undefined' ? localStorage.getItem('pms_theme') as 'light' | 'dark' : null) || 'dark';
  });
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [selectedHotelId, setSelectedHotelIdState] = useState<string | null>(() => {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('pms_selected_hotel_id') : null;
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

  // Sign out helper
  const signOut = useCallback(async () => {
    try {
      if (currentSessionId && profile?.hotelId && profile.hotelId !== 'system') {
        const sessionRef = doc(db, 'hotels', profile.hotelId, 'sessions', currentSessionId);
        await updateDoc(sessionRef, {
          status: 'revoked',
          lastActivityAt: new Date().toISOString()
        }).catch(() => {});
      }
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('pms_session_id');
      }
      await fbSignOut(auth);
    } catch (err) {
      console.error('Sign out error:', err);
    }
  }, [currentSessionId, profile?.hotelId]);

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
      setLoading(true);
      
      if (firebaseUser) {
        setProfile(null);
        setHotel(null);
        setHasProfileError(false);
        setHasHotelError(false);
        
        firebaseUser.reload()
          .then(() => {
            const freshUser = auth.currentUser;
            setUser(freshUser);
          })
          .catch((err) => {
            console.error("Session re-validation error:", err);
            setUser(firebaseUser);
          });
      } else {
        setUser(null);
        setProfile(null);
        setHotel(null);
        setCustomRoles([]);
        setHasProfileError(false);
        setHasHotelError(false);
        setLoading(false);
      }
    });
    
    return () => unsubscribe();
  }, []);

  // 2. Profile Fetcher (Real-time Live Sync)
  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    if (hasProfileError) return;

    const currentUid = user.uid;
    const profileRef = doc(db, 'users', currentUid);
    const unsubscribe = onSnapshot(profileRef, async (snap) => {
      if (auth.currentUser?.uid !== currentUid) return;

      if (snap.exists()) {
        const data = snap.data() as UserProfile;
        
        // Check for Force Logout trigger
        if (data.forceLogout) {
          toast.error("Your session was terminated by an administrator.");
          // Clear flag in background so they can log back in later if unlocked
          await updateDoc(profileRef, { forceLogout: false }).catch(() => {});
          await fbSignOut(auth);
          return;
        }

        // Enforce account activation & status checks
        if (data.status === 'pending_activation') {
          toast.error("Your account is pending activation. Please use the activation link sent to your email to set your password.");
          await fbSignOut(auth);
          return;
        }

        if (data.status === 'suspended') {
          toast.error("Your account has been suspended. Please contact your Hotel Administrator.");
          await fbSignOut(auth);
          return;
        }

        setProfile(data);
        setLoading(false);
      } else if (user.email && SUPER_ADMIN_EMAILS.some(email => email.toLowerCase() === user.email?.toLowerCase())) {
        const bootstrapProfile: UserProfile = {
          email: user.email,
          hotelId: 'system',
          role: 'superAdmin',
          displayName: user.displayName || 'System Owner',
          createdAt: new Date().toISOString(),
          status: 'active',
          uid: currentUid
        };
        await database.safeSet(profileRef, bootstrapProfile, {
          hotelId: 'system',
          module: 'Auth',
          action: 'BOOTSTRAP_PROFILE',
          details: `Bootstrapped superAdmin profile for ${user.email}`
        });
        if (auth.currentUser?.uid === currentUid) {
          setProfile(bootstrapProfile);
          setLoading(false);
        }
      } else {
        if (user.email) {
          try {
            const userQuery = query(collection(db, 'users'), where('email', '==', user.email.toLowerCase()));
            const querySnap = await getDocs(userQuery);
            if (!querySnap.empty && auth.currentUser?.uid === currentUid) {
              const tempDoc = querySnap.docs[0];
              const tempData = tempDoc.data() as UserProfile;
              
              if (tempDoc.id !== currentUid) {
                const migratedProfile: UserProfile = {
                  ...tempData,
                  uid: currentUid,
                  initialPassword: null,
                  status: tempData.status || 'active',
                  updatedAt: new Date().toISOString()
                };
                
                await database.safeSet(profileRef, migratedProfile, {
                  hotelId: tempData.hotelId || 'system',
                  module: 'Auth',
                  action: 'MIGRATE_RECREATED_PROFILE',
                  details: `Migrated recreated staff profile for ${user.email} from temp ID ${tempDoc.id} to permanent UID ${currentUid}`
                });
                
                await database.safeDelete(doc(db, 'users', tempDoc.id), {
                  hotelId: tempData.hotelId || 'system',
                  module: 'Auth',
                  action: 'DELETE_TEMP_RECREATED_PROFILE',
                  details: `Deleted old temporary recreated profile ID ${tempDoc.id} for ${user.email}`
                });
                
                if (auth.currentUser?.uid === currentUid) {
                  setProfile(migratedProfile);
                  setLoading(false);
                }
                return;
              }
            }
          } catch (migrateErr) {
            console.error("Error auto-healing/migrating profile:", migrateErr);
          }
        }
        if (auth.currentUser?.uid === currentUid) {
          setProfile(null);
          setLoading(false);
        }
      }
    }, (err: any) => {
      if (auth.currentUser?.uid !== currentUid) return;
      if (err.message?.includes('offline') || err.code === 'unavailable' || err.code === 'network-request-failed') {
        setIsOffline(true);
      }
      handleFirestoreError(err, OperationType.GET, `users/${currentUid}`);
      if (err.code === 'permission-denied') {
        setHasProfileError(true);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user?.uid, hasProfileError]);

  // 3. Hotel Fetcher (Real-time Live Sync)
  useEffect(() => {
    let hotelId = profile?.hotelId;
    const role = profile?.role;
    const currentProfileUid = profile?.uid;

    if (role === 'superAdmin' && selectedHotelId) {
      hotelId = selectedHotelId;
    }

    if (!hotelId || (hotelId === 'system' && role !== 'superAdmin') || hasHotelError) {
      setHotel(null);
      return;
    }

    if (hotelId === 'system' && role === 'superAdmin' && !selectedHotelId) {
      setHotel(null);
      return;
    }

    if (hotel?.id !== hotelId) {
      setHotel(null);
    }

    settingsManager.initialize(hotelId);

    const hotelRef = doc(db, 'hotels', hotelId);
    const unsub = onSnapshot(hotelRef, (snap) => {
      if (profile?.uid !== currentProfileUid) return;

      if (snap.exists()) {
        const data = snap.data() as Hotel;
        const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as HotelSettings;
        if (data.settings) {
          Object.keys(data.settings).forEach(group => {
            const groupKey = group as keyof HotelSettings;
            if (settings[groupKey]) {
              settings[groupKey] = {
                ...(settings[groupKey] as any),
                ...(data.settings![groupKey] as any)
              };
            }
          });
        }
        
        settingsManager.setSettings(settings);
        setHotel({ id: snap.id, ...data, settings } as Hotel);
      } else {
        setHotel(null);
      }
    }, (err: any) => {
      if (profile?.uid !== currentProfileUid) return;
      if (err.code === 'permission-denied') {
        setHasHotelError(true);
      }
    });

    return () => unsub();
  }, [profile?.hotelId, profile?.role, selectedHotelId, hasHotelError]);

  // 4. Custom Roles Listener (Real-time Live RBAC Synchronization)
  useEffect(() => {
    const hotelId = profile?.hotelId;
    if (!hotelId || hotelId === 'system') {
      setCustomRoles([]);
      return;
    }

    const rolesRef = collection(db, 'hotels', hotelId, 'customRoles');
    const unsubRoles = onSnapshot(rolesRef, (snap) => {
      const roles: CustomRole[] = snap.docs.map(d => ({
        id: d.id,
        hotelId,
        name: d.data().name || 'Custom Role',
        description: d.data().description || '',
        permissions: d.data().permissions || [],
        inheritsFrom: d.data().inheritsFrom,
        isSystem: d.data().isSystem || false,
        status: d.data().status || 'active',
        createdAt: d.data().createdAt || '',
        updatedAt: d.data().updatedAt || '',
        createdBy: d.data().createdBy || ''
      }));
      setCustomRoles(roles);
    }, (err) => {
      console.warn("Custom roles real-time sync notice:", err);
    });

    return () => unsubRoles();
  }, [profile?.hotelId]);

  // 5. Active Session Management & Heartbeat
  useEffect(() => {
    const hotelId = profile?.hotelId;
    const userId = user?.uid;
    if (!hotelId || hotelId === 'system' || !userId || !profile) return;

    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      sessionStorage.setItem('pms_session_id', sessionId);
      setCurrentSessionId(sessionId);
    }

    const sessionDocRef = doc(db, 'hotels', hotelId, 'sessions', sessionId);
    const info = getClientDeviceInfo();

    // Register/update session
    setDoc(sessionDocRef, {
      id: sessionId,
      userId,
      userEmail: profile.email,
      userName: profile.displayName || profile.email.split('@')[0],
      userRole: profile.staffRole || profile.role,
      hotelId,
      device: info.device,
      browser: info.browser,
      os: info.os,
      loginAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      status: 'active'
    }, { merge: true }).catch((err) => {
      console.warn("Session doc registration notice:", err);
    });

    // Listen to session document - if admin revokes it, logout immediately
    const unsubSession = onSnapshot(sessionDocRef, (snap) => {
      if (snap.exists()) {
        const sessData = snap.data() as ActiveSession;
        if (sessData.status === 'revoked') {
          toast.error("Your session has been revoked by an administrator.");
          fbSignOut(auth);
        }
      }
    }, () => {});

    // Periodic heartbeat to refresh lastActivityAt
    const heartbeat = setInterval(() => {
      updateDoc(sessionDocRef, {
        lastActivityAt: new Date().toISOString()
      }).catch(() => {});
    }, 60000); // every 60 seconds

    return () => {
      clearInterval(heartbeat);
      unsubSession();
    };
  }, [profile?.hotelId, user?.uid, currentSessionId]);

  // 6. System Settings Fetcher
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

  // 7. Branding Color Application
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

  const isSubscriptionActive = (profile?.role === 'superAdmin' || (auth.currentUser?.email && SUPER_ADMIN_EMAILS.some(email => email.toLowerCase() === auth.currentUser?.email?.toLowerCase())))
    ? true 
    : (hotel ? (
        hotel.subscriptionStatus === 'active' && 
        (() => {
          const expiryStr = hotel.subscriptionExpiry || '';
          const expiryDate = new Date(expiryStr);
          return !isNaN(expiryDate.getTime()) && expiryDate.getTime() > (Date.now() - 3600000);
        })()
      ) : false);

  const exchangeRate = hotel?.exchangeRate || systemSettings?.exchangeRate || 1500;

  const hasPermission = useCallback((permission: Permission): boolean => {
    return checkUserPermission(profile, permission, customRoles);
  }, [profile, customRoles]);

  return (
    <AuthContext.Provider value={{ 
      user, 
      profile, 
      hotel, 
      customRoles,
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
      setSelectedHotelId,
      currentSessionId,
      hasPermission,
      signOut
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
