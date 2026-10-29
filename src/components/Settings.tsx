import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { doc, setDoc, addDoc, collection, getDocs, query, writeBatch, where } from 'firebase/firestore';
import { sendPasswordResetEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { db, auth } from '../firebase';
import { database } from '../utils/database';
import { Tax, Reservation, HotelBankAccount, HotelCustomInfoField } from '../types';
import { ConfirmModal } from './ConfirmModal';
import { 
  User, 
  Building2, 
  Shield, 
  Key, 
  Bell, 
  Smartphone,
  Save,
  Lock,
  Mail,
  Calendar,
  CreditCard,
  Eye,
  EyeOff,
  Info,
  Percent,
  Receipt,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Moon,
  Sun,
  Coins,
  Globe,
  RefreshCw,
  Clock,
  Upload,
  Image as ImageIcon,
  MapPin,
  Phone,
  Landmark,
  Hash,
  Sliders,
  FileText
} from 'lucide-react';
import { cn, safeStringify } from '../utils';
import { toast } from 'sonner';
import { format, isValid } from 'date-fns';
import { safeFormatDate, parseTimestampToDate } from '../utils/dateUtils';

import { useTranslation } from 'react-i18next';

export function Settings() {
  const { t, i18n } = useTranslation();
  const { profile, hotel, isSubscriptionActive, systemSettings, theme, setTheme } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'hotel' | 'branding' | 'security' | 'support' | 'taxes' | 'preferences' | 'shortcuts' | 'danger'>('profile');
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [showConfirmSystemReset, setShowConfirmSystemReset] = useState(false);
  const [showConfirmPurgeTransactions, setShowConfirmPurgeTransactions] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  
  const [formData, setFormData] = useState({
    displayName: profile?.displayName || '',
    hotelName: hotel?.name || '',
    defaultCurrency: hotel?.defaultCurrency || 'NGN',
    exchangeRate: hotel?.exchangeRate || 1500,
    defaultCheckInTime: hotel?.defaultCheckInTime || '14:00',
    defaultCheckOutTime: hotel?.defaultCheckOutTime || '12:00',
    overstayChargeTime: hotel?.overstayChargeTime || '14:00',
    autoChargeOverstays: hotel?.autoChargeOverstays ?? true,
    overstayPolicy: hotel?.overstayPolicy || 'grace',
    overstayGraceHours: hotel?.overstayGraceHours ?? 2,
    overstayPartialHours: hotel?.overstayPartialHours ?? 3,
    overstayPartialPercentage: hotel?.overstayPartialPercentage ?? 50,
    overstayFullHours: hotel?.overstayFullHours ?? 6,
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    branding: {
      logoUrl: hotel?.branding?.logoUrl || '',
      primaryColor: hotel?.branding?.primaryColor || '#10b981',
      secondaryColor: hotel?.branding?.secondaryColor || '#18181b',
      address: hotel?.branding?.address || '',
      phone: hotel?.branding?.phone || '',
      email: hotel?.branding?.email || '',
      website: hotel?.branding?.website || '',
      footerNotes: hotel?.branding?.footerNotes || '',
      organizationName: hotel?.branding?.organizationName || hotel?.name || '',
      accountNumber: hotel?.branding?.accountNumber || '',
      bankName: hotel?.branding?.bankName || '',
      bankAccounts: (hotel?.branding?.bankAccounts && hotel.branding.bankAccounts.length > 0)
        ? hotel.branding.bankAccounts
        : (hotel?.branding?.bankName || hotel?.branding?.accountNumber)
          ? [{
              id: 'bank_initial',
              bankName: hotel.branding.bankName || '',
              accountNumber: hotel.branding.accountNumber || '',
              accountName: hotel.branding.organizationName || hotel.name || '',
              sortCode: '',
              isEnabled: true
            }]
          : [],
      tin: hotel?.branding?.tin || '',
      cac: hotel?.branding?.cac || '',
      customInfo: hotel?.branding?.customInfo || [],
      greeting: hotel?.branding?.greeting || 'Thank you for staying with us!',
      showLogoOnReceipt: hotel?.branding?.showLogoOnReceipt ?? true,
      showAddressOnReceipt: hotel?.branding?.showAddressOnReceipt ?? true,
      showPhoneOnReceipt: hotel?.branding?.showPhoneOnReceipt ?? true,
      showEmailOnReceipt: hotel?.branding?.showEmailOnReceipt ?? true,
      showWebsiteOnReceipt: hotel?.branding?.showWebsiteOnReceipt ?? true,
      showTinOnReceipt: hotel?.branding?.showTinOnReceipt ?? true,
      showCacOnReceipt: hotel?.branding?.showCacOnReceipt ?? true,
      showBankDetailsOnReceipt: hotel?.branding?.showBankDetailsOnReceipt ?? true,
      showGreetingOnReceipt: hotel?.branding?.showGreetingOnReceipt ?? true,
      showFooterNotesOnReceipt: hotel?.branding?.showFooterNotesOnReceipt ?? true,
      customReceiptTitle: hotel?.branding?.customReceiptTitle || '',
      statusColors: hotel?.branding?.statusColors || {
        clean: '#10b981',
        dirty: '#ef4444',
        occupied: '#3b82f6',
        maintenance: '#f59e0b',
        vacant: '#71717a',
        out_of_service: '#18181b'
      }
    }
  });

  useEffect(() => {
    if (hotel) {
      setFormData(prev => ({
        ...prev,
        hotelName: hotel.name || prev.hotelName,
        defaultCurrency: hotel.defaultCurrency || prev.defaultCurrency,
        exchangeRate: hotel.exchangeRate || prev.exchangeRate,
        defaultCheckInTime: hotel.defaultCheckInTime || prev.defaultCheckInTime,
        defaultCheckOutTime: hotel.defaultCheckOutTime || prev.defaultCheckOutTime,
        overstayChargeTime: hotel.overstayChargeTime || prev.overstayChargeTime,
        autoChargeOverstays: hotel.autoChargeOverstays ?? prev.autoChargeOverstays,
        overstayPolicy: hotel.overstayPolicy || prev.overstayPolicy,
        overstayGraceHours: hotel.overstayGraceHours ?? prev.overstayGraceHours,
        overstayPartialHours: hotel.overstayPartialHours ?? prev.overstayPartialHours,
        overstayPartialPercentage: hotel.overstayPartialPercentage ?? prev.overstayPartialPercentage,
        overstayFullHours: hotel.overstayFullHours ?? prev.overstayFullHours,
        branding: {
          ...prev.branding,
          logoUrl: hotel.branding?.logoUrl || prev.branding.logoUrl,
          primaryColor: hotel.branding?.primaryColor || prev.branding.primaryColor,
          secondaryColor: hotel.branding?.secondaryColor || prev.branding.secondaryColor,
          address: hotel.branding?.address || prev.branding.address,
          phone: hotel.branding?.phone || prev.branding.phone,
          email: hotel.branding?.email || prev.branding.email,
          website: hotel.branding?.website || prev.branding.website,
          footerNotes: hotel.branding?.footerNotes || prev.branding.footerNotes,
          organizationName: hotel.branding?.organizationName || hotel.name || prev.branding.organizationName,
          accountNumber: hotel.branding?.accountNumber || prev.branding.accountNumber,
          bankName: hotel.branding?.bankName || prev.branding.bankName,
          bankAccounts: (hotel.branding?.bankAccounts && hotel.branding.bankAccounts.length > 0)
            ? hotel.branding.bankAccounts
            : (prev.branding.bankAccounts && prev.branding.bankAccounts.length > 0)
              ? prev.branding.bankAccounts
              : (hotel.branding?.bankName || hotel.branding?.accountNumber)
                ? [{
                    id: 'bank_initial',
                    bankName: hotel.branding.bankName || '',
                    accountNumber: hotel.branding.accountNumber || '',
                    accountName: hotel.branding.organizationName || hotel.name || '',
                    sortCode: '',
                    isEnabled: true
                  }]
                : [],
          tin: hotel.branding?.tin || prev.branding.tin,
          cac: hotel.branding?.cac || prev.branding.cac,
          customInfo: hotel.branding?.customInfo || prev.branding.customInfo,
          greeting: hotel.branding?.greeting || prev.branding.greeting,
          showLogoOnReceipt: hotel.branding?.showLogoOnReceipt ?? prev.branding.showLogoOnReceipt,
          showAddressOnReceipt: hotel.branding?.showAddressOnReceipt ?? prev.branding.showAddressOnReceipt,
          showPhoneOnReceipt: hotel.branding?.showPhoneOnReceipt ?? prev.branding.showPhoneOnReceipt,
          showEmailOnReceipt: hotel.branding?.showEmailOnReceipt ?? prev.branding.showEmailOnReceipt,
          showWebsiteOnReceipt: hotel.branding?.showWebsiteOnReceipt ?? prev.branding.showWebsiteOnReceipt,
          showTinOnReceipt: hotel.branding?.showTinOnReceipt ?? prev.branding.showTinOnReceipt,
          showCacOnReceipt: hotel.branding?.showCacOnReceipt ?? prev.branding.showCacOnReceipt,
          showBankDetailsOnReceipt: hotel.branding?.showBankDetailsOnReceipt ?? prev.branding.showBankDetailsOnReceipt,
          showGreetingOnReceipt: hotel.branding?.showGreetingOnReceipt ?? prev.branding.showGreetingOnReceipt,
          showFooterNotesOnReceipt: hotel.branding?.showFooterNotesOnReceipt ?? prev.branding.showFooterNotesOnReceipt,
          customReceiptTitle: hotel.branding?.customReceiptTitle || prev.branding.customReceiptTitle,
          statusColors: hotel.branding?.statusColors || prev.branding.statusColors
        }
      }));
    }
  }, [hotel]);

  const [localTaxes, setLocalTaxes] = useState<Tax[]>(hotel?.taxes || []);

  useEffect(() => {
    if (hotel?.taxes) {
      setLocalTaxes(hotel?.taxes);
    }
  }, [hotel?.taxes]);

  const handleUpdateLocalTax = (index: number, updates: Partial<Tax>) => {
    const updated = [...localTaxes];
    updated[index] = { ...updated[index], ...updates };
    setLocalTaxes(updated);
  };

  const handleSaveTaxes = async () => {
    if (!hotel?.id) return;
    setIsSaving(true);
    try {
      const oldTaxes = hotel.taxes || [];
      const newTaxes = localTaxes;

      await database.safeSet(doc(db, 'hotels', hotel.id), {
        taxes: localTaxes
      }, {
        hotelId: hotel.id,
        module: 'Settings',
        action: 'UPDATE_TAX_SETTINGS',
        details: 'Updated global tax configuration',
        metadata: {
          changes: {
            taxes: {
              from: oldTaxes.map(t => ({ name: t.name, percentage: t.percentage })),
              to: newTaxes.map(t => ({ name: t.name, percentage: t.percentage }))
            }
          }
        }
      });

      // After saving taxes, update existing active reservations to reflect new tax policy
      const activeTaxes = localTaxes.filter(t => t.status === 'active' && t.category !== 'restaurant');
      const q = query(
        collection(db, 'hotels', hotel.id, 'reservations'),
        where('status', 'in', ['pending', 'confirmed', 'checked_in'])
      );
      
      const snap = await getDocs(q);
      if (!snap.empty) {
        const batch = writeBatch(db);
        let updateCount = 0;

        for (const resDoc of snap.docs) {
          const res = { id: resDoc.id, ...resDoc.data() } as Reservation;
          // Calculate the existing base amount by removing any exclusive taxes already in totalAmount
          const existingExclusiveTax = (res.taxDetails || [])
            .filter(t => !t.isInclusive)
            .reduce((acc, t) => acc + t.amount, 0);
          
          const nights = res.nights || 1;
          // The true base amount for the stay (excl taxes)
          const stayBaseAmount = res.nightlyRate 
            ? res.nightlyRate * nights 
            : (res.totalAmount - existingExclusiveTax);

          let stayTaxTotal = 0;
          let stayExclusiveTaxTotal = 0;
          const stayTaxDetails = activeTaxes.map(tax => {
            const amount = tax.isInclusive 
              ? stayBaseAmount - (stayBaseAmount / (1 + (tax.percentage / 100)))
              : stayBaseAmount * (tax.percentage / 100);
            
            stayTaxTotal += amount;
            if (!tax.isInclusive) {
              stayExclusiveTaxTotal += amount;
            }
            return { name: tax.name, percentage: tax.percentage, amount, isInclusive: tax.isInclusive };
          });

          const newTotalAmount = stayBaseAmount + stayExclusiveTaxTotal;
          
          // Avoid JSON.stringify for comparison
          const taxDetailsMatch = res.taxDetails && stayTaxDetails.length === res.taxDetails.length && 
            stayTaxDetails.every((t, i) => t.amount === res.taxDetails[i].amount);
          
          if (newTotalAmount !== res.totalAmount || !taxDetailsMatch) {
            batch.update(doc(db, 'hotels', hotel.id, 'reservations', res.id), {
              totalAmount: newTotalAmount,
              taxAmount: stayTaxTotal,
              taxDetails: stayTaxDetails
            });
            updateCount++;
          }
        }

        if (updateCount > 0) {
          await database.commitBatch(hotel.id, batch, {
            module: 'Settings',
            action: 'RECALCULATE_RESERVATION_TAXES',
            details: `Recalculated taxes for ${updateCount} active reservations`
          });
          toast.success(`Taxes updated and ${updateCount} active reservations recalculated.`);
        } else {
          toast.success('Taxes updated successfully');
        }
      } else {
        toast.success('Taxes updated successfully');
      }
    } catch (err: any) {
      console.error("Save taxes error:", err.message || safeStringify(err));
      toast.error('Failed to update taxes');
    } finally {
      setIsSaving(false);
    }
  };
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !profile) return;
    if (formData.newPassword !== formData.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    setIsSaving(true);
    try {
      // Re-authenticate user first
      const credential = EmailAuthProvider.credential(auth.currentUser.email!, formData.currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      
      // Update password
      await updatePassword(auth.currentUser, formData.newPassword);
      
      // Log action
      if (profile.hotelId) {
        await database.safeAdd(collection(db, 'hotels', profile.hotelId, 'activityLogs'), {
          timestamp: new Date().toISOString(),
          userId: profile.uid,
          userEmail: profile.email,
          userRole: profile.role,
          action: 'CHANGE_PASSWORD',
          resource: 'User Security',
          hotelId: profile.hotelId,
          module: 'Security'
        }, {
          hotelId: profile.hotelId,
          module: 'Security',
          action: 'ACTIVITY_LOG_CREATE',
          details: 'Password change activity'
        });
      }

      toast.success('Password changed successfully!');

      // Synchronize credential to server for authentication lifecycle
      fetch('/api/auth/sync-user-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: profile.uid,
          email: profile.email,
          password: formData.newPassword,
          previousPassword: formData.currentPassword
        })
      }).catch((syncErr) => console.warn("Password sync notice:", syncErr));

      setFormData({ ...formData, currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      console.error("Change password error:", err.message || safeStringify(err));
      if (err.code === 'auth/wrong-password') {
        toast.error('Current password is incorrect');
      } else {
        toast.error('Failed to change password. ' + err.message);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.uid) return;

    setIsSaving(true);
    try {
      await database.safeSet(doc(db, 'users', profile.uid), {
        displayName: formData.displayName,
      }, {
        hotelId: profile.hotelId || 'unknown',
        module: 'Security',
        action: 'UPDATE_PROFILE',
        details: 'Updated user display name'
      });

      // Log action
      if (profile.hotelId) {
        await database.safeAdd(collection(db, 'hotels', profile.hotelId, 'activityLogs'), {
          timestamp: new Date().toISOString(),
          userId: profile.uid,
          userEmail: profile.email,
          userRole: profile.role,
          action: 'UPDATE_PROFILE',
          resource: 'User Profile',
          hotelId: profile.hotelId,
          module: 'Security'
        }, {
          hotelId: profile.hotelId,
          module: 'Security',
          action: 'ACTIVITY_LOG_CREATE',
          details: 'Profile update activity'
        });
      }

      toast.success('Profile updated successfully!');
    } catch (err: any) {
      console.error("Save profile error:", err.message || safeStringify(err));
      toast.error('Failed to update profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const fetchExchangeRate = () => {
    // Mock fetching real-time exchange rate
    const mockRate = 1500 + Math.floor(Math.random() * 200);
    setFormData(prev => ({ ...prev, exchangeRate: mockRate }));
    toast.success(`Exchange rate updated to ${mockRate} NGN/USD`);
  };

  const handleSaveHotel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || profile?.role !== 'hotelAdmin') return;

    setIsSaving(true);
    try {
      const updates = {
        name: formData.hotelName,
        defaultCurrency: formData.defaultCurrency,
        exchangeRate: formData.exchangeRate,
        defaultCheckInTime: formData.defaultCheckInTime,
        defaultCheckOutTime: formData.defaultCheckOutTime,
        overstayChargeTime: formData.overstayChargeTime,
        autoChargeOverstays: formData.autoChargeOverstays,
        overstayPolicy: formData.overstayPolicy,
        overstayGraceHours: Number(formData.overstayGraceHours),
        overstayPartialHours: Number(formData.overstayPartialHours),
        overstayPartialPercentage: Number(formData.overstayPartialPercentage),
        overstayFullHours: Number(formData.overstayFullHours),
        branding: formData.branding,
      };

      // Calculate changed fields for better logging
      const changes: Record<string, { from: any, to: any }> = {};
      Object.entries(updates).forEach(([key, value]) => {
        if (key === 'branding') return; // handle branding changes separately or ignore for log simplicity
        const oldValue = (hotel as any)[key];
        if (oldValue !== value) {
          changes[key] = { from: oldValue, to: value };
        }
      });

      await database.safeSet(doc(db, 'hotels', hotel.id), updates, {
        hotelId: hotel.id,
        module: 'Settings',
        action: 'UPDATE_HOTEL_SETTINGS',
        details: `Hotel settings updated: ${formData.hotelName}`,
        metadata: { changes }
      });

      toast.success('Hotel settings updated!');
    } catch (err: any) {
      console.error("Save hotel error:", err.message || safeStringify(err));
      toast.error('Failed to update hotel settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please choose a valid image file (PNG, JPG, SVG, WebP)');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image is too large. Please select an image under 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const rawDataUrl = event.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const maxDimension = 600;
        let width = img.width;
        let height = img.height;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88);
          setFormData(prev => ({
            ...prev,
            branding: { ...prev.branding, logoUrl: compressed }
          }));
          toast.success('Logo uploaded and optimized for receipts!');
        } else {
          setFormData(prev => ({
            ...prev,
            branding: { ...prev.branding, logoUrl: rawDataUrl }
          }));
          toast.success('Logo uploaded!');
        }
      };
      img.onerror = () => {
        setFormData(prev => ({
          ...prev,
          branding: { ...prev.branding, logoUrl: rawDataUrl }
        }));
        toast.success('Logo uploaded!');
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
    if (e.target) e.target.value = '';
  };

  const handleRemoveLogo = () => {
    setFormData(prev => ({
      ...prev,
      branding: { ...prev.branding, logoUrl: '' }
    }));
    toast.info('Logo removed');
  };

  const handleAddBankAccount = () => {
    const newBank: HotelBankAccount = {
      id: `bank_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      bankName: '',
      accountNumber: '',
      accountName: formData.branding.organizationName || formData.hotelName || '',
      sortCode: '',
      isEnabled: true
    };
    setFormData(prev => ({
      ...prev,
      branding: {
        ...prev.branding,
        bankAccounts: [...(prev.branding.bankAccounts || []), newBank]
      }
    }));
  };

  const handleUpdateBankAccount = (id: string, field: keyof HotelBankAccount, value: any) => {
    setFormData(prev => ({
      ...prev,
      branding: {
        ...prev.branding,
        bankAccounts: (prev.branding.bankAccounts || []).map(b => 
          b.id === id ? { ...b, [field]: value } : b
        )
      }
    }));
  };

  const handleToggleBankAccount = (id: string) => {
    setFormData(prev => ({
      ...prev,
      branding: {
        ...prev.branding,
        bankAccounts: (prev.branding.bankAccounts || []).map(b => 
          b.id === id ? { ...b, isEnabled: !b.isEnabled } : b
        )
      }
    }));
  };

  const handleRemoveBankAccount = (id: string) => {
    setFormData(prev => ({
      ...prev,
      branding: {
        ...prev.branding,
        bankAccounts: (prev.branding.bankAccounts || []).filter(b => b.id !== id)
      }
    }));
  };

  const handleAddCustomInfo = () => {
    const newField: HotelCustomInfoField = {
      id: `info_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label: '',
      value: '',
      isEnabled: true
    };
    setFormData(prev => ({
      ...prev,
      branding: {
        ...prev.branding,
        customInfo: [...(prev.branding.customInfo || []), newField]
      }
    }));
  };

  const handleUpdateCustomInfo = (id: string, field: keyof HotelCustomInfoField, value: any) => {
    setFormData(prev => ({
      ...prev,
      branding: {
        ...prev.branding,
        customInfo: (prev.branding.customInfo || []).map(c => 
          c.id === id ? { ...c, [field]: value } : c
        )
      }
    }));
  };

  const handleToggleCustomInfo = (id: string) => {
    setFormData(prev => ({
      ...prev,
      branding: {
        ...prev.branding,
        customInfo: (prev.branding.customInfo || []).map(c => 
          c.id === id ? { ...c, isEnabled: !c.isEnabled } : c
        )
      }
    }));
  };

  const handleRemoveCustomInfo = (id: string) => {
    setFormData(prev => ({
      ...prev,
      branding: {
        ...prev.branding,
        customInfo: (prev.branding.customInfo || []).filter(c => c.id !== id)
      }
    }));
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || profile?.role !== 'hotelAdmin') return;

    setIsSaving(true);
    try {
      // Sync legacy primary bank account fields for backwards compatibility
      const activeBank = (formData.branding.bankAccounts || []).find(b => b.isEnabled) || formData.branding.bankAccounts?.[0];
      const brandingToSave = {
        ...formData.branding,
        bankName: activeBank?.bankName || formData.branding.bankName || '',
        accountNumber: activeBank?.accountNumber || formData.branding.accountNumber || '',
      };

      const updates = {
        branding: brandingToSave,
      };

      // Calculate changed fields
      const changes: Record<string, { from: any, to: any }> = {};
      const oldBranding = hotel.branding || {};
      const newBranding = brandingToSave;

      Object.keys(newBranding).forEach(key => {
        const newVal = (newBranding as any)[key];
        const oldVal = (oldBranding as any)[key];
        // Use safeStringify for comparison to handle circular structures
        if (safeStringify(newVal) !== safeStringify(oldVal)) {
          changes[`branding.${key}`] = { from: oldVal, to: newVal };
        }
      });

      await database.safeSet(doc(db, 'hotels', hotel.id), updates, {
        hotelId: hotel.id,
        module: 'Settings',
        action: 'UPDATE_HOTEL_BRANDING',
        details: 'Updated hotel branding, receipt customization, and payment accounts',
        metadata: { changes }
      });

      toast.success('Hotel branding and receipt customization saved!');
    } catch (err: any) {
      console.error("Save branding error:", err.message || safeStringify(err));
      toast.error('Failed to update hotel branding.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!profile?.email) return;
    try {
      await sendPasswordResetEmail(auth, profile.email);
      toast.success('Password reset link sent to: ' + profile.email);
    } catch (err: any) {
      console.error("Reset password error:", err.message || safeStringify(err));
      toast.error('Failed to send reset email. Please try again later.');
    } finally {
      setShowConfirmReset(false);
    }
  };

  const handlePurgeTransactionsAndDebt = async () => {
    if (!hotel?.id || profile?.role !== 'hotelAdmin') return;
    
    setIsSaving(true);
    try {
      const transactionCollectionsToClear = [
        'outstanding_debt_ledger',
        'debt_ledger',
        'debts',
        'debtors',
        'ledger',
        'finance',
        'transactions',
        'inventory_transactions',
        'housekeeping_stock_transactions',
        'commissions'
      ];

      for (const collName of transactionCollectionsToClear) {
        const q = query(collection(db, 'hotels', hotel.id, collName));
        const snap = await getDocs(q);
        
        // Delete in batches of 500 (Firestore limit)
        const batches = [];
        let currentBatch = writeBatch(db);
        let count = 0;

        for (const docSnap of snap.docs) {
          currentBatch.delete(docSnap.ref);
          count++;
          if (count === 500) {
            batches.push(currentBatch.commit());
            currentBatch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) {
          batches.push(currentBatch.commit());
        }
        await Promise.all(batches);
      }

      // Reset financial balances, payments, charges, and debt balances on all reservations
      const resSnap = await getDocs(collection(db, 'hotels', hotel.id, 'reservations'));
      const resBatches = [];
      let resBatch = writeBatch(db);
      let resCount = 0;
      for (const rDoc of resSnap.docs) {
        resBatch.update(rDoc.ref, {
          paidAmount: 0,
          charges: [],
          payments: [],
          ledgerBalance: 0,
          financialStatus: 'unpaid',
          paymentStatus: 'unpaid',
          advanceDeposit: 0,
          discountAmount: 0,
          totalDiscount: 0,
          overstayNights: 0
        });
        resCount++;
        if (resCount === 500) {
          resBatches.push(resBatch.commit());
          resBatch = writeBatch(db);
          resCount = 0;
        }
      }
      if (resCount > 0) {
        resBatches.push(resBatch.commit());
      }
      await Promise.all(resBatches);

      // Reset balances on corporate accounts
      const corpSnap = await getDocs(collection(db, 'hotels', hotel.id, 'corporate_accounts'));
      const corpBatches = [];
      let corpBatch = writeBatch(db);
      let corpCount = 0;
      for (const cDoc of corpSnap.docs) {
        corpBatch.update(cDoc.ref, {
          balance: 0,
          outstandingBalance: 0
        });
        corpCount++;
        if (corpCount === 500) {
          corpBatches.push(corpBatch.commit());
          corpBatch = writeBatch(db);
          corpCount = 0;
        }
      }
      if (corpCount > 0) {
        corpBatches.push(corpBatch.commit());
      }
      await Promise.all(corpBatches);

      // Reset balances on guests
      const guestsSnap = await getDocs(collection(db, 'hotels', hotel.id, 'guests'));
      const guestBatches = [];
      let guestBatch = writeBatch(db);
      let guestCount = 0;
      for (const gDoc of guestsSnap.docs) {
        guestBatch.update(gDoc.ref, {
          balance: 0,
          totalSpend: 0
        });
        guestCount++;
        if (guestCount === 500) {
          guestBatches.push(guestBatch.commit());
          guestBatch = writeBatch(db);
          guestCount = 0;
        }
      }
      if (guestCount > 0) {
        guestBatches.push(guestBatch.commit());
      }
      await Promise.all(guestBatches);

      // Log transaction & debt ledger purge in activity logs
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        userName: profile.displayName || profile.name || 'Hotel Admin',
        action: 'PURGE_TRANSACTIONS_AND_DEBT_LEDGER',
        module: 'Finance',
        details: 'Purged all transactions, folio ledger entries, and outstanding debt ledger records'
      }, {
        hotelId: hotel.id,
        module: 'Settings',
        action: 'PURGE_TRANSACTIONS_LOG',
        details: 'Purged all transactions and outstanding debt ledger records'
      });

      toast.success('All transactions and debt ledger records cleared successfully!');
      setShowConfirmPurgeTransactions(false);
      window.location.reload();
    } catch (err: any) {
      console.error("Purge transactions error:", err.message || safeStringify(err));
      toast.error('Failed to clear transactions and debt ledger.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSystemReset = async () => {
    if (!hotel?.id || profile?.role !== 'hotelAdmin') return;
    
    setIsSaving(true);
    try {
      const collectionsToClear = [
        'reservations',
        'guests',
        'ledger',
        'finance',
        'outstanding_debt_ledger',
        'debt_ledger',
        'debts',
        'debtors',
        'activityLogs',
        'auditLogs',
        'AuditLogs',
        'maintenance',
        'housekeeping',
        'inventory',
        'purchaseOrders',
        'purchase_orders',
        'suppliers',
        'accounts',
        'commissions',
        'corporate_accounts',
        'surveys',
        'room_blockings',
        'checkin_history',
        'checkout_history',
        'rate_configurations',
        'inventory_consumption_rules',
        'inventory_transactions',
        'inventory_audits',
        'housekeeping_stock_transactions',
        'transactions',
        'notifications'
      ];

      for (const collName of collectionsToClear) {
        const q = query(collection(db, 'hotels', hotel.id, collName));
        const snap = await getDocs(q);
        
        // Delete in batches of 500 (Firestore limit)
        const batches = [];
        let currentBatch = writeBatch(db);
        let count = 0;

        for (const docSnap of snap.docs) {
          currentBatch.delete(docSnap.ref);
          count++;
          if (count === 500) {
            batches.push(currentBatch.commit());
            currentBatch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) {
          batches.push(currentBatch.commit());
        }
        await Promise.all(batches);
      }

      // Reset room statuses to vacant/clean
      const roomsSnap = await getDocs(collection(db, 'hotels', hotel.id, 'rooms'));
      const roomBatches = [];
      let roomBatch = writeBatch(db);
      let rCount = 0;
      for (const rSnap of roomsSnap.docs) {
        roomBatch.update(rSnap.ref, {
          status: 'dirty',
          housekeepingStatus: 'dirty',
          currentGuestId: null,
          currentReservationId: null,
          assignedTo: null
        });
        rCount++;
        if (rCount === 500) {
          roomBatches.push(roomBatch.commit());
          roomBatch = writeBatch(db);
          rCount = 0;
        }
      }
      if (rCount > 0) {
        roomBatches.push(roomBatch.commit());
      }
      await Promise.all(roomBatches);

      // Log the reset
      await database.safeAdd(collection(db, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'SYSTEM_RESET',
        resource: 'All System Data',
        hotelId: hotel.id
      }, {
        hotelId: hotel.id,
        module: 'Settings',
        action: 'SYSTEM_RESET_LOG',
        details: 'Full system data reset execution'
      });

      toast.success('System data cleared successfully!');
      setShowConfirmSystemReset(false);
      // Refresh page to clear local state
      window.location.reload();
    } catch (err: any) {
      console.error("System reset error:", err.message || safeStringify(err));
      toast.error('Failed to reset system data.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={cn("p-4 sm:p-8 mx-auto space-y-8 transition-all", activeTab === 'branding' ? "max-w-7xl" : "max-w-4xl")}>
      <header>
        <h1 className="text-3xl font-bold text-zinc-50 tracking-tight">{t('settings.title')}</h1>
        <p className="text-zinc-400">Manage your account and system preferences</p>
      </header>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar Tabs */}
        <aside className="w-full lg:w-64 space-y-2 shrink-0">
          <button 
            onClick={() => setActiveTab('profile')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
              activeTab === 'profile' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
            )}
          >
            <User size={18} />
            {t('settings.profile')}
          </button>
          
          {profile?.role === 'hotelAdmin' && (
            <button 
              onClick={() => setActiveTab('hotel')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
                activeTab === 'hotel' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
              )}
            >
              <Building2 size={18} />
              {t('settings.hotelSettings')}
            </button>
          )}

          {profile?.role === 'hotelAdmin' && (
            <button 
              onClick={() => setActiveTab('branding')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
                activeTab === 'branding' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
              )}
            >
              <Receipt size={18} />
              <span>Branding & Receipts</span>
            </button>
          )}

          {profile?.role === 'hotelAdmin' && (
            <button 
              onClick={() => setActiveTab('taxes')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
                activeTab === 'taxes' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
              )}
            >
              <Percent size={18} />
              {t('settings.taxes')}
            </button>
          )}

          <button 
            onClick={() => setActiveTab('preferences')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
              activeTab === 'preferences' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
            )}
          >
            <Moon size={18} />
            {t('settings.preferences')}
          </button>

          <button 
            onClick={() => setActiveTab('security')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
              activeTab === 'security' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
            )}
          >
            <Shield size={18} />
            {t('settings.security')}
          </button>

          <button 
            onClick={() => setActiveTab('support')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
              activeTab === 'support' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
            )}
          >
            <Mail size={18} />
            {t('settings.support')}
          </button>

          <button 
            onClick={() => setActiveTab('shortcuts')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
              activeTab === 'shortcuts' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
            )}
          >
            <Key size={18} />
            Keyboard Shortcuts
          </button>

          {profile?.role === 'hotelAdmin' && (
            <button 
              onClick={() => setActiveTab('danger')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
                activeTab === 'danger' ? "bg-red-500 text-white" : "text-red-500/60 hover:bg-red-500/10 hover:text-red-500"
              )}
            >
              <Shield size={18} />
              {t('settings.dangerZone')}
            </button>
          )}
        </aside>

        {/* Main Content */}
        <main className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
          {activeTab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-6">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-20 h-20 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-500 border-2 border-zinc-700">
                  <User size={40} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-zinc-50">{profile?.displayName || 'User'}</h3>
                  <p className="text-sm text-zinc-500 capitalize">{profile?.role.replace('hotelAdmin', 'Hotel Administrator')}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Display Name</label>
                  <input 
                    type="text" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={formData.displayName}
                    onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Email Address</label>
                  <div className="flex items-center gap-3 w-full bg-zinc-800/50 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-500 cursor-not-allowed">
                    <Mail size={16} />
                    {profile?.email}
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-1 italic">Email cannot be changed directly for security reasons.</p>
                </div>
              </div>

              <div className="pt-6 border-t border-zinc-800 flex justify-end">
                <button 
                  disabled={isSaving}
                  className="bg-emerald-500 text-black px-6 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50 disabled:scale-100"
                >
                  <Save size={18} />
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'hotel' && profile?.role === 'hotelAdmin' && (
            <form onSubmit={handleSaveHotel} className="space-y-6">
              <div className="mb-8">
                <h3 className="text-lg font-bold text-zinc-50 mb-1">Hotel Configuration</h3>
                <p className="text-sm text-zinc-500">Manage your property details, general information, and currency settings</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Hotel Name</label>
                  <input 
                    type="text" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={formData.hotelName}
                    onChange={(e) => setFormData({ ...formData, hotelName: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Phone Number</label>
                  <input 
                    type="tel" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={formData.branding.phone}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      branding: { ...formData.branding, phone: e.target.value } 
                    })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Email Address</label>
                  <input 
                    type="email" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={formData.branding.email}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      branding: { ...formData.branding, email: e.target.value } 
                    })}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Address</label>
                  <textarea 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none resize-none h-20"
                    value={formData.branding.address}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      branding: { ...formData.branding, address: e.target.value } 
                    })}
                  />
                </div>

                <div className="pt-6 border-t border-zinc-800 md:col-span-2">
                  <h4 className="text-sm font-bold text-zinc-50 mb-4 flex items-center gap-2">
                    <Coins size={18} className="text-emerald-500" />
                    Currency & Exchange Rate
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Default Currency (Base)</label>
                      <select
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                        value={formData.defaultCurrency}
                        onChange={(e) => setFormData({ ...formData, defaultCurrency: e.target.value as 'NGN' | 'USD' })}
                      >
                        <option value="NGN">NGN (Nigerian Naira)</option>
                        <option value="USD">USD (US Dollar)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Exchange Rate (1 USD = ? NGN)</label>
                      <div className="flex gap-2">
                        <input 
                          type="number" 
                          className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                          value={formData.exchangeRate}
                          onChange={(e) => setFormData({ ...formData, exchangeRate: parseFloat(e.target.value) })}
                        />
                        <button 
                          type="button"
                          onClick={fetchExchangeRate}
                          className="px-3 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-xs font-bold hover:bg-zinc-700 transition-all flex items-center gap-2 whitespace-nowrap"
                        >
                          <RefreshCw size={14} />
                          Fetch Rate
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-zinc-800 md:col-span-2">
                  <h4 className="text-sm font-bold text-zinc-50 mb-4 flex items-center gap-2">
                    <Clock size={18} className="text-blue-500" />
                    Default Stay Times
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Default Check-In Time</label>
                      <input 
                        type="time" 
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                        value={formData.defaultCheckInTime}
                        onChange={(e) => setFormData({ ...formData, defaultCheckInTime: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Default Check-Out Time</label>
                      <input 
                        type="time" 
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                        value={formData.defaultCheckOutTime}
                        onChange={(e) => setFormData({ ...formData, defaultCheckOutTime: e.target.value })}
                      />
                    </div>
                    <div className="md:col-span-2 p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-semibold text-zinc-50">Overstay Policy Configuration</label>
                        <div className="flex items-center gap-3">
                          <input 
                            type="checkbox"
                            id="autoChargeOverstays"
                            className="w-4 h-4 rounded border-zinc-800 bg-zinc-950 text-emerald-500 focus:ring-emerald-500"
                            checked={formData.autoChargeOverstays}
                            onChange={(e) => setFormData({ ...formData, autoChargeOverstays: e.target.checked })}
                          />
                          <label htmlFor="autoChargeOverstays" className="text-sm text-zinc-400 font-medium cursor-pointer">
                            Enable Automated Overstay Billing
                          </label>
                        </div>
                      </div>

                      {formData.autoChargeOverstays && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-zinc-800/60">
                          <div>
                            <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Select Active Overstay Policy</label>
                            <select
                              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                              value={formData.overstayPolicy}
                              onChange={(e) => setFormData({ ...formData, overstayPolicy: e.target.value })}
                            >
                              <option value="grace">Policy A: Grace Period (No charge within limit)</option>
                              <option value="partial">Policy B: 50% Rate / Dynamic thresholds</option>
                              <option value="full">Policy C: Full Room Rate after limit</option>
                              <option value="immediate_full">Policy D: Full Additional Night after Checkout</option>
                            </select>
                          </div>

                          {formData.overstayPolicy === 'grace' && (
                            <div>
                              <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Grace Period (Hours)</label>
                              <input 
                                type="number" 
                                min="0"
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                                value={formData.overstayGraceHours}
                                onChange={(e) => setFormData({ ...formData, overstayGraceHours: Number(e.target.value) })}
                              />
                              <p className="text-[10px] text-zinc-500 mt-1">Guests can stay up to {formData.overstayGraceHours} hours past check-out without additional charge. After that, a full additional night is charged.</p>
                            </div>
                          )}

                          {formData.overstayPolicy === 'partial' && (
                            <>
                              <div>
                                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Partial Charge Threshold (Hours)</label>
                                <input 
                                  type="number" 
                                  min="0"
                                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                                  value={formData.overstayPartialHours}
                                  onChange={(e) => setFormData({ ...formData, overstayPartialHours: Number(e.target.value) })}
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Partial Charge Rate (%)</label>
                                <input 
                                  type="number" 
                                  min="0"
                                  max="100"
                                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                                  value={formData.overstayPartialPercentage}
                                  onChange={(e) => setFormData({ ...formData, overstayPartialPercentage: Number(e.target.value) })}
                                />
                              </div>
                              <div className="md:col-span-2">
                                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Full Charge Threshold (Hours)</label>
                                <input 
                                  type="number" 
                                  min="0"
                                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                                  value={formData.overstayFullHours}
                                  onChange={(e) => setFormData({ ...formData, overstayFullHours: Number(e.target.value) })}
                                />
                                <p className="text-[10px] text-zinc-500 mt-1">No charge up to {formData.overstayPartialHours} hours. {formData.overstayPartialPercentage}% charge between {formData.overstayPartialHours} and {formData.overstayFullHours} hours. Full charge after {formData.overstayFullHours} hours.</p>
                              </div>
                            </>
                          )}

                          {formData.overstayPolicy === 'full' && (
                            <div>
                              <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Full Charge Threshold (Hours)</label>
                              <input 
                                type="number" 
                                min="0"
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                                value={formData.overstayFullHours}
                                onChange={(e) => setFormData({ ...formData, overstayFullHours: Number(e.target.value) })}
                              />
                              <p className="text-[10px] text-zinc-500 mt-1">Guests can stay up to {formData.overstayFullHours} hours past check-out for free. After {formData.overstayFullHours} hours, a full additional night is charged.</p>
                            </div>
                          )}

                          {formData.overstayPolicy === 'immediate_full' && (
                            <div className="md:col-span-2">
                              <p className="text-xs text-zinc-400">Policy D: A full additional night's rate will be charged automatically immediately past the scheduled checkout time.</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-4 md:col-span-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CreditCard size={18} className="text-emerald-500" />
                      <div>
                        <p className="text-sm font-medium text-zinc-50">Subscription Status</p>
                        <p className="text-xs text-zinc-500">{hotel?.plan} Plan</p>
                      </div>
                    </div>
                    <span className={cn(
                      "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                      isSubscriptionActive ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                    )}>
                      {hotel?.subscriptionStatus}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-3 text-xs text-zinc-400">
                    <Calendar size={14} />
                    <span>Expires on {hotel?.subscriptionExpiry ? (() => {
                      const d = parseTimestampToDate(hotel.subscriptionExpiry);
                      if (!d || isNaN(d.getTime()) || d.getTime() === 0) return 'N/A';
                      const daysLeft = Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
                      return `${safeFormatDate(d, 'MMMM d, yyyy')} (${daysLeft > 0 ? `${daysLeft} days remaining` : 'Expired'})`;
                    })() : 'N/A'}</span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-zinc-400">
                    <Key size={14} />
                    Tracking Code: <span className="font-mono text-zinc-300">{hotel?.trackingCode}</span>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-zinc-800 flex justify-end">
                <button 
                  disabled={isSaving}
                  className="bg-emerald-500 text-black px-6 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50 disabled:scale-100"
                >
                  <Save size={18} />
                  {isSaving ? 'Saving...' : 'Update Hotel'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'branding' && profile?.role === 'hotelAdmin' && (
            <div className="space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
                <div>
                  <h3 className="text-xl font-bold text-zinc-50 flex items-center gap-2">
                    <Receipt className="text-emerald-400" size={22} />
                    Hotel Branding & Receipt Customization
                  </h3>
                  <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                    Upload your logo, configure official business identifiers (TIN & CAC), manage bank accounts, and toggle visible receipt fields.
                  </p>
                </div>

                <button 
                  type="button"
                  onClick={handleSaveBranding}
                  disabled={isSaving}
                  className="bg-emerald-500 text-black px-6 py-2.5 rounded-xl font-black flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-emerald-950/40 cursor-pointer text-xs uppercase tracking-wider shrink-0"
                >
                  <Save size={16} />
                  {isSaving ? 'Saving...' : 'Save All Changes'}
                </button>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
                {/* Form Controls Column */}
                <form onSubmit={handleSaveBranding} className="xl:col-span-7 space-y-6">
                  {/* Card 1: Logo & Visual Identity */}
                  <div className="bg-zinc-950/70 border border-zinc-800 rounded-2xl p-5 space-y-5">
                    <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                      <div className="flex items-center gap-2">
                        <ImageIcon size={18} className="text-emerald-400" />
                        <h4 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">Hotel Logo & Identity</h4>
                      </div>
                      <label className="flex items-center gap-2 text-xs font-semibold text-zinc-300 cursor-pointer select-none">
                        <input 
                          type="checkbox"
                          checked={formData.branding.showLogoOnReceipt}
                          onChange={(e) => setFormData({
                            ...formData,
                            branding: { ...formData.branding, showLogoOnReceipt: e.target.checked }
                          })}
                          className="w-4 h-4 rounded border-zinc-800 bg-zinc-900 text-emerald-500 focus:ring-emerald-500 accent-emerald-500 cursor-pointer"
                        />
                        <span>Show Logo on Receipt</span>
                      </label>
                    </div>

                    <div className="space-y-4">
                      {/* Hidden File Input */}
                      <input 
                        type="file"
                        ref={logoInputRef}
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={handleLogoFileUpload}
                        className="hidden"
                      />

                      <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/50">
                        {formData.branding.logoUrl ? (
                          <div className="relative group shrink-0">
                            <div className="w-24 h-24 rounded-xl border-2 border-zinc-700 bg-white p-2 flex items-center justify-center overflow-hidden shadow-md">
                              <img 
                                src={formData.branding.logoUrl} 
                                alt="Hotel Logo" 
                                className="max-w-full max-h-full object-contain"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={handleRemoveLogo}
                              className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white p-1 rounded-full shadow-lg transition-transform hover:scale-110 cursor-pointer"
                              title="Remove logo"
                            >
                              <XCircle size={16} />
                            </button>
                          </div>
                        ) : (
                          <div className="w-24 h-24 rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-950 flex flex-col items-center justify-center text-zinc-500 text-center p-2 shrink-0">
                            <ImageIcon size={24} className="mb-1 text-zinc-600" />
                            <span className="text-[10px] font-semibold">No Logo</span>
                          </div>
                        )}

                        <div className="flex-1 space-y-2 text-center sm:text-left">
                          <h5 className="text-xs font-bold text-zinc-200">Official Hotel Logo</h5>
                          <p className="text-[11px] text-zinc-400 leading-relaxed">
                            Upload your PNG, JPG, WebP, or SVG logo. It will be printed at the top of receipts and customer folios.
                          </p>
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => logoInputRef.current?.click()}
                              className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                            >
                              <Upload size={14} />
                              <span>{formData.branding.logoUrl ? 'Replace Logo' : 'Upload Logo File'}</span>
                            </button>
                            {formData.branding.logoUrl && (
                              <button
                                type="button"
                                onClick={handleRemoveLogo}
                                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-red-400 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                              >
                                <Trash2 size={13} />
                                <span>Remove</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                          Or Provide Logo Direct URL
                        </label>
                        <input 
                          type="url" 
                          placeholder="https://example.com/logo.png"
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-50 focus:border-emerald-500 outline-none"
                          value={formData.branding.logoUrl}
                          onChange={(e) => setFormData({ 
                            ...formData, 
                            branding: { ...formData.branding, logoUrl: e.target.value } 
                          })}
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                        <div>
                          <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                            Organization / Hotel Name
                          </label>
                          <input 
                            type="text" 
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-50 focus:border-emerald-500 outline-none"
                            value={formData.branding.organizationName}
                            onChange={(e) => setFormData({ 
                              ...formData, 
                              branding: { ...formData.branding, organizationName: e.target.value } 
                            })}
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                            Custom Receipt Header Title
                          </label>
                          <input 
                            type="text" 
                            placeholder="OFFICIAL GUEST RECEIPT (Default)"
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-50 focus:border-emerald-500 outline-none"
                            value={formData.branding.customReceiptTitle}
                            onChange={(e) => setFormData({ 
                              ...formData, 
                              branding: { ...formData.branding, customReceiptTitle: e.target.value } 
                            })}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Official Business Identifiers (TIN & CAC) */}
                  <div className="bg-zinc-950/70 border border-zinc-800 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center gap-2 border-b border-zinc-900 pb-3">
                      <Hash size={18} className="text-blue-400" />
                      <div>
                        <h4 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">Official Registration & Tax Information</h4>
                        <p className="text-[11px] text-zinc-500">Add mandatory business registration identifiers to receipts for corporate compliance</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* TIN Field */}
                      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="block text-[11px] font-bold text-zinc-300 uppercase tracking-wider">
                            Tax ID Number (TIN)
                          </label>
                          <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 cursor-pointer">
                            <input 
                              type="checkbox"
                              checked={formData.branding.showTinOnReceipt}
                              onChange={(e) => setFormData({
                                ...formData,
                                branding: { ...formData.branding, showTinOnReceipt: e.target.checked }
                              })}
                              className="w-3.5 h-3.5 rounded border-zinc-800 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 accent-emerald-500 cursor-pointer"
                            />
                            <span>Print on Receipt</span>
                          </label>
                        </div>
                        <input 
                          type="text" 
                          placeholder="e.g. 12345678-0001"
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-50 focus:border-emerald-500 outline-none"
                          value={formData.branding.tin}
                          onChange={(e) => setFormData({ 
                            ...formData, 
                            branding: { ...formData.branding, tin: e.target.value } 
                          })}
                        />
                      </div>

                      {/* CAC / RC Field */}
                      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="block text-[11px] font-bold text-zinc-300 uppercase tracking-wider">
                            CAC / RC Registration No.
                          </label>
                          <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 cursor-pointer">
                            <input 
                              type="checkbox"
                              checked={formData.branding.showCacOnReceipt}
                              onChange={(e) => setFormData({
                                ...formData,
                                branding: { ...formData.branding, showCacOnReceipt: e.target.checked }
                              })}
                              className="w-3.5 h-3.5 rounded border-zinc-800 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 accent-emerald-500 cursor-pointer"
                            />
                            <span>Print on Receipt</span>
                          </label>
                        </div>
                        <input 
                          type="text" 
                          placeholder="e.g. RC 1234567 or BN 9876543"
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-50 focus:border-emerald-500 outline-none"
                          value={formData.branding.cac}
                          onChange={(e) => setFormData({ 
                            ...formData, 
                            branding: { ...formData.branding, cac: e.target.value } 
                          })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Contact & Address Information */}
                  <div className="bg-zinc-950/70 border border-zinc-800 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center gap-2 border-b border-zinc-900 pb-3">
                      <MapPin size={18} className="text-amber-400" />
                      <h4 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">Address & Contact Information</h4>
                    </div>

                    <div className="space-y-4">
                      {/* Address */}
                      <div className="bg-zinc-900/50 border border-zinc-850 rounded-xl p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="block text-[11px] font-bold text-zinc-300 uppercase tracking-wider">
                            Physical Hotel Address
                          </label>
                          <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 cursor-pointer">
                            <input 
                              type="checkbox"
                              checked={formData.branding.showAddressOnReceipt}
                              onChange={(e) => setFormData({
                                ...formData,
                                branding: { ...formData.branding, showAddressOnReceipt: e.target.checked }
                              })}
                              className="w-3.5 h-3.5 rounded border-zinc-800 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 accent-emerald-500 cursor-pointer"
                            />
                            <span>Print Address</span>
                          </label>
                        </div>
                        <textarea 
                          rows={2}
                          placeholder="e.g. 14 Victoria Island Boulevard, Lagos, Nigeria"
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-50 focus:border-emerald-500 outline-none resize-none"
                          value={formData.branding.address}
                          onChange={(e) => setFormData({ 
                            ...formData, 
                            branding: { ...formData.branding, address: e.target.value } 
                          })}
                        />
                      </div>

                      {/* Phone, Email, Website Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {/* Phone */}
                        <div className="bg-zinc-900/50 border border-zinc-850 rounded-xl p-3 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-zinc-300 uppercase">Phone</span>
                            <input 
                              type="checkbox"
                              checked={formData.branding.showPhoneOnReceipt}
                              onChange={(e) => setFormData({
                                ...formData,
                                branding: { ...formData.branding, showPhoneOnReceipt: e.target.checked }
                              })}
                              className="w-3.5 h-3.5 rounded border-zinc-800 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 accent-emerald-500 cursor-pointer"
                              title="Toggle phone visibility on receipt"
                            />
                          </div>
                          <input 
                            type="tel" 
                            placeholder="+234 800 000 0000"
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-50 focus:border-emerald-500 outline-none"
                            value={formData.branding.phone}
                            onChange={(e) => setFormData({ 
                              ...formData, 
                              branding: { ...formData.branding, phone: e.target.value } 
                            })}
                          />
                        </div>

                        {/* Email */}
                        <div className="bg-zinc-900/50 border border-zinc-850 rounded-xl p-3 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-zinc-300 uppercase">Email</span>
                            <input 
                              type="checkbox"
                              checked={formData.branding.showEmailOnReceipt}
                              onChange={(e) => setFormData({
                                ...formData,
                                branding: { ...formData.branding, showEmailOnReceipt: e.target.checked }
                              })}
                              className="w-3.5 h-3.5 rounded border-zinc-800 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 accent-emerald-500 cursor-pointer"
                              title="Toggle email visibility on receipt"
                            />
                          </div>
                          <input 
                            type="email" 
                            placeholder="info@hotel.com"
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-50 focus:border-emerald-500 outline-none"
                            value={formData.branding.email}
                            onChange={(e) => setFormData({ 
                              ...formData, 
                              branding: { ...formData.branding, email: e.target.value } 
                            })}
                          />
                        </div>

                        {/* Website */}
                        <div className="bg-zinc-900/50 border border-zinc-850 rounded-xl p-3 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-zinc-300 uppercase">Website</span>
                            <input 
                              type="checkbox"
                              checked={formData.branding.showWebsiteOnReceipt}
                              onChange={(e) => setFormData({
                                ...formData,
                                branding: { ...formData.branding, showWebsiteOnReceipt: e.target.checked }
                              })}
                              className="w-3.5 h-3.5 rounded border-zinc-800 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 accent-emerald-500 cursor-pointer"
                              title="Toggle website visibility on receipt"
                            />
                          </div>
                          <input 
                            type="url" 
                            placeholder="https://hotel.com"
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-50 focus:border-emerald-500 outline-none"
                            value={formData.branding.website}
                            onChange={(e) => setFormData({ 
                              ...formData, 
                              branding: { ...formData.branding, website: e.target.value } 
                            })}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card 4: Official Bank Accounts (Multi-Account Management with On/Off switches) */}
                  <div className="bg-zinc-950/70 border border-zinc-800 rounded-2xl p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-900 pb-3">
                      <div className="flex items-center gap-2">
                        <Landmark size={18} className="text-emerald-400" />
                        <div>
                          <h4 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">Bank Payment Accounts</h4>
                          <p className="text-[11px] text-zinc-500">Add multiple bank accounts for customer direct transfers. Turn off ones you don't need printed.</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-xs font-semibold text-zinc-300 cursor-pointer select-none">
                          <input 
                            type="checkbox"
                            checked={formData.branding.showBankDetailsOnReceipt}
                            onChange={(e) => setFormData({
                              ...formData,
                              branding: { ...formData.branding, showBankDetailsOnReceipt: e.target.checked }
                            })}
                            className="w-4 h-4 rounded border-zinc-800 bg-zinc-900 text-emerald-500 focus:ring-emerald-500 accent-emerald-500 cursor-pointer"
                          />
                          <span>Show Bank Section</span>
                        </label>

                        <button
                          type="button"
                          onClick={handleAddBankAccount}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                        >
                          <Plus size={14} />
                          <span>Add Bank</span>
                        </button>
                      </div>
                    </div>

                    {(!formData.branding.bankAccounts || formData.branding.bankAccounts.length === 0) ? (
                      <div className="p-6 text-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 space-y-3">
                        <Landmark size={28} className="mx-auto text-zinc-600" />
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-zinc-300">No Bank Accounts Configured</p>
                          <p className="text-[11px] text-zinc-500 max-w-sm mx-auto">
                            Add your hotel's settlement bank accounts. You can add as many as you need and turn on/off individual accounts anytime.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleAddBankAccount}
                          className="px-4 py-2 rounded-lg bg-emerald-500 text-zinc-950 font-bold text-xs inline-flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
                        >
                          <Plus size={14} />
                          <span>Add First Bank Account</span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {formData.branding.bankAccounts.map((bank, index) => (
                          <div 
                            key={bank.id || index}
                            className={cn(
                              "p-4 rounded-xl border transition-all space-y-3",
                              bank.isEnabled 
                                ? "bg-zinc-900/60 border-zinc-800" 
                                : "bg-zinc-950/40 border-zinc-850 opacity-60"
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-400 text-[10px] font-black flex items-center justify-center">
                                  {index + 1}
                                </span>
                                <span className="text-xs font-bold text-zinc-200">
                                  {bank.bankName || 'New Bank Account'}
                                </span>
                                {bank.isEnabled ? (
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-bold">
                                    Active on Receipt
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500 text-[9px] font-bold">
                                    Hidden / Disabled
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleToggleBankAccount(bank.id)}
                                  className={cn(
                                    "px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer border",
                                    bank.isEnabled 
                                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25"
                                      : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                                  )}
                                >
                                  {bank.isEnabled ? 'Turn Off' : 'Turn On'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveBankAccount(bank.id)}
                                  className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors cursor-pointer"
                                  title="Remove this bank account"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                              <div>
                                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Bank Name</label>
                                <input 
                                  type="text" 
                                  placeholder="e.g. Zenith Bank"
                                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-50 focus:border-emerald-500 outline-none"
                                  value={bank.bankName}
                                  onChange={(e) => handleUpdateBankAccount(bank.id, 'bankName', e.target.value)}
                                />
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Account Number</label>
                                <input 
                                  type="text" 
                                  placeholder="e.g. 1012345678"
                                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-zinc-50 focus:border-emerald-500 outline-none"
                                  value={bank.accountNumber}
                                  onChange={(e) => handleUpdateBankAccount(bank.id, 'accountNumber', e.target.value)}
                                />
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Account Name (Optional)</label>
                                <input 
                                  type="text" 
                                  placeholder="e.g. Hotel Main Operations"
                                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-50 focus:border-emerald-500 outline-none"
                                  value={bank.accountName || ''}
                                  onChange={(e) => handleUpdateBankAccount(bank.id, 'accountName', e.target.value)}
                                />
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Sort Code (Optional)</label>
                                <input 
                                  type="text" 
                                  placeholder="e.g. 057150013"
                                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-50 focus:border-emerald-500 outline-none"
                                  value={bank.sortCode || ''}
                                  onChange={(e) => handleUpdateBankAccount(bank.id, 'sortCode', e.target.value)}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Card 5: Additional Custom Information Fields */}
                  <div className="bg-zinc-950/70 border border-zinc-800 rounded-2xl p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-900 pb-3">
                      <div className="flex items-center gap-2">
                        <Sliders size={18} className="text-purple-400" />
                        <div>
                          <h4 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">Additional Custom Fields</h4>
                          <p className="text-[11px] text-zinc-500">Add custom key-value details to print on receipts (e.g. VAT Reg, WhatsApp line, Wi-Fi info)</p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleAddCustomInfo}
                        className="px-3 py-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
                      >
                        <Plus size={14} />
                        <span>Add Information Field</span>
                      </button>
                    </div>

                    {(!formData.branding.customInfo || formData.branding.customInfo.length === 0) ? (
                      <div className="p-4 text-center rounded-xl border border-zinc-850 bg-zinc-900/30 text-zinc-500 text-xs">
                        No extra custom information fields. Click <strong className="text-purple-400 font-semibold cursor-pointer" onClick={handleAddCustomInfo}>Add Information Field</strong> to display additional details on receipts.
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {formData.branding.customInfo.map((info, idx) => (
                          <div 
                            key={info.id || idx}
                            className={cn(
                              "flex flex-col sm:flex-row items-center gap-2.5 p-3 rounded-xl border transition-all",
                              info.isEnabled ? "bg-zinc-900/60 border-zinc-800" : "bg-zinc-950/40 border-zinc-850 opacity-60"
                            )}
                          >
                            <div className="w-full sm:w-1/3">
                              <input 
                                type="text"
                                placeholder="Field Label (e.g. VAT No)"
                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 font-semibold focus:border-purple-500 outline-none"
                                value={info.label}
                                onChange={(e) => handleUpdateCustomInfo(info.id, 'label', e.target.value)}
                              />
                            </div>
                            <div className="w-full sm:flex-1">
                              <input 
                                type="text"
                                placeholder="Value (e.g. 10023456-001)"
                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 focus:border-purple-500 outline-none"
                                value={info.value}
                                onChange={(e) => handleUpdateCustomInfo(info.id, 'value', e.target.value)}
                              />
                            </div>
                            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                              <button
                                type="button"
                                onClick={() => handleToggleCustomInfo(info.id)}
                                className={cn(
                                  "px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-all cursor-pointer border",
                                  info.isEnabled 
                                    ? "bg-purple-500/15 text-purple-300 border-purple-500/30" 
                                    : "bg-zinc-800 text-zinc-500 border-zinc-700"
                                )}
                              >
                                {info.isEnabled ? 'Active' : 'Off'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveCustomInfo(info.id)}
                                className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-850 transition-colors cursor-pointer"
                                title="Remove this field"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Card 6: Receipt Greeting & Footer Notes */}
                  <div className="bg-zinc-950/70 border border-zinc-800 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center gap-2 border-b border-zinc-900 pb-3">
                      <FileText size={18} className="text-zinc-400" />
                      <h4 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">Receipt Greeting & Footer Terms</h4>
                    </div>

                    <div className="space-y-4">
                      <div className="bg-zinc-900/50 border border-zinc-850 rounded-xl p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="block text-[11px] font-bold text-zinc-300 uppercase tracking-wider">
                            Receipt Greeting Message
                          </label>
                          <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 cursor-pointer">
                            <input 
                              type="checkbox"
                              checked={formData.branding.showGreetingOnReceipt}
                              onChange={(e) => setFormData({
                                ...formData,
                                branding: { ...formData.branding, showGreetingOnReceipt: e.target.checked }
                              })}
                              className="w-3.5 h-3.5 rounded border-zinc-800 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 accent-emerald-500 cursor-pointer"
                            />
                            <span>Print Greeting</span>
                          </label>
                        </div>
                        <input 
                          type="text" 
                          placeholder="e.g. Thank you for staying with us! We appreciate your patronage."
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-50 focus:border-emerald-500 outline-none"
                          value={formData.branding.greeting}
                          onChange={(e) => setFormData({ 
                            ...formData, 
                            branding: { ...formData.branding, greeting: e.target.value } 
                          })}
                        />
                      </div>

                      <div className="bg-zinc-900/50 border border-zinc-850 rounded-xl p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="block text-[11px] font-bold text-zinc-300 uppercase tracking-wider">
                            Receipt Footer Notes / Policies
                          </label>
                          <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 cursor-pointer">
                            <input 
                              type="checkbox"
                              checked={formData.branding.showFooterNotesOnReceipt}
                              onChange={(e) => setFormData({
                                ...formData,
                                branding: { ...formData.branding, showFooterNotesOnReceipt: e.target.checked }
                              })}
                              className="w-3.5 h-3.5 rounded border-zinc-800 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 accent-emerald-500 cursor-pointer"
                            />
                            <span>Print Footer Notes</span>
                          </label>
                        </div>
                        <textarea 
                          rows={2}
                          placeholder="e.g. Please retain this receipt for warranty and tax purposes. Valuables must be kept in the safe."
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-50 focus:border-emerald-500 outline-none resize-none"
                          value={formData.branding.footerNotes}
                          onChange={(e) => setFormData({ 
                            ...formData, 
                            branding: { ...formData.branding, footerNotes: e.target.value } 
                          })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card 7: Theme & Room Status Colors */}
                  <div className="bg-zinc-950/70 border border-zinc-800 rounded-2xl p-5 space-y-5">
                    <div className="flex items-center gap-2 border-b border-zinc-900 pb-3">
                      <Sliders size={18} className="text-emerald-400" />
                      <h4 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">Brand & Room Status Colors</h4>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5">Primary Brand Color</label>
                        <div className="flex gap-2">
                          <input 
                            type="color" 
                            className="w-10 h-10 bg-zinc-950 border border-zinc-800 rounded-lg p-1 outline-none cursor-pointer"
                            value={formData.branding.primaryColor}
                            onChange={(e) => setFormData({ 
                              ...formData, 
                              branding: { ...formData.branding, primaryColor: e.target.value } 
                            })}
                          />
                          <input 
                            type="text" 
                            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-50 focus:border-emerald-500 outline-none font-mono text-xs"
                            value={formData.branding.primaryColor}
                            onChange={(e) => setFormData({ 
                              ...formData, 
                              branding: { ...formData.branding, primaryColor: e.target.value } 
                            })}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5">Secondary Brand Color</label>
                        <div className="flex gap-2">
                          <input 
                            type="color" 
                            className="w-10 h-10 bg-zinc-950 border border-zinc-800 rounded-lg p-1 outline-none cursor-pointer"
                            value={formData.branding.secondaryColor}
                            onChange={(e) => setFormData({ 
                              ...formData, 
                              branding: { ...formData.branding, secondaryColor: e.target.value } 
                            })}
                          />
                          <input 
                            type="text" 
                            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-50 focus:border-emerald-500 outline-none font-mono text-xs"
                            value={formData.branding.secondaryColor}
                            onChange={(e) => setFormData({ 
                              ...formData, 
                              branding: { ...formData.branding, secondaryColor: e.target.value } 
                            })}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="pt-2">
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-3">Room Status Colors on Grid</label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {(['clean', 'dirty', 'occupied', 'maintenance', 'vacant', 'out_of_service'] as const).map((status) => (
                          <div key={status} className="bg-zinc-900/60 p-2.5 rounded-xl border border-zinc-850">
                            <span className="block text-[10px] font-semibold text-zinc-400 uppercase mb-1.5 truncate">
                              {status.replace(/_/g, ' ')}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <input 
                                type="color" 
                                className="w-7 h-7 bg-transparent border border-zinc-700 rounded-md p-0.5 outline-none cursor-pointer"
                                value={formData.branding.statusColors?.[status] || '#71717a'}
                                onChange={(e) => setFormData({ 
                                  ...formData, 
                                  branding: { 
                                    ...formData.branding, 
                                    statusColors: { 
                                      ...formData.branding.statusColors, 
                                      [status]: e.target.value 
                                    } 
                                  } 
                                })}
                              />
                              <span className="text-[10px] font-mono text-zinc-400 uppercase">
                                {formData.branding.statusColors?.[status] || '#71717a'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 flex justify-end">
                    <button 
                      type="submit"
                      disabled={isSaving}
                      className="bg-emerald-500 text-black px-8 py-3 rounded-xl font-black flex items-center gap-2 hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50 shadow-xl shadow-emerald-950/50 cursor-pointer text-xs uppercase tracking-wider"
                    >
                      <Save size={16} />
                      {isSaving ? 'Saving Changes...' : 'Save Branding & Receipt Settings'}
                    </button>
                  </div>
                </form>

                {/* Right Column: Live Interactive Receipt Preview */}
                <div className="xl:col-span-5 sticky top-6 space-y-4">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">Live Receipt Preview</span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500">Real-time rendered</span>
                  </div>

                  {/* Miniature Receipt Canvas */}
                  <div className="bg-white text-zinc-900 rounded-2xl p-6 shadow-2xl border border-zinc-200 font-sans text-[11px] leading-relaxed max-w-md mx-auto">
                    {/* Header */}
                    <div className="text-center border-b-2 border-zinc-900 pb-4 mb-4">
                      {formData.branding.showLogoOnReceipt && (
                        formData.branding.logoUrl ? (
                          <img 
                            src={formData.branding.logoUrl} 
                            alt="Preview Logo" 
                            className="h-14 mx-auto mb-2 object-contain"
                          />
                        ) : (
                          <div className="w-12 h-12 bg-zinc-100 text-zinc-900 rounded-full flex items-center justify-center mx-auto mb-2 font-black text-xl border-2 border-zinc-900">
                            {(formData.branding.organizationName || formData.hotelName || 'H').charAt(0)}
                          </div>
                        )
                      )}

                      <h2 className="text-base font-black uppercase tracking-tight text-zinc-950">
                        {formData.branding.organizationName || formData.hotelName || 'Grand Hotel'}
                      </h2>

                      <div className="text-[9px] text-zinc-500 space-y-0.5 mt-1">
                        {formData.branding.showAddressOnReceipt && formData.branding.address && (
                          <p className="flex items-center justify-center gap-1">
                            <MapPin size={9} /> {formData.branding.address}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center justify-center gap-2 text-[9px]">
                          {formData.branding.showPhoneOnReceipt && formData.branding.phone && (
                            <span className="flex items-center gap-0.5"><Phone size={8} /> {formData.branding.phone}</span>
                          )}
                          {formData.branding.showEmailOnReceipt && formData.branding.email && (
                            <span className="flex items-center gap-0.5"><Mail size={8} /> {formData.branding.email}</span>
                          )}
                          {formData.branding.showWebsiteOnReceipt && formData.branding.website && (
                            <span className="text-emerald-700 font-bold">{formData.branding.website}</span>
                          )}
                        </div>

                        {/* TIN & CAC Preview Badges */}
                        {((formData.branding.showTinOnReceipt && formData.branding.tin) || (formData.branding.showCacOnReceipt && formData.branding.cac)) && (
                          <div className="flex flex-wrap items-center justify-center gap-2 pt-1 font-mono text-[8px] text-zinc-700">
                            {formData.branding.showTinOnReceipt && formData.branding.tin && (
                              <span className="bg-zinc-100 px-1.5 py-0.5 rounded border border-zinc-200">
                                <strong className="font-sans font-bold">TIN:</strong> {formData.branding.tin}
                              </span>
                            )}
                            {formData.branding.showCacOnReceipt && formData.branding.cac && (
                              <span className="bg-zinc-100 px-1.5 py-0.5 rounded border border-zinc-200">
                                <strong className="font-sans font-bold">CAC / RC:</strong> {formData.branding.cac}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Custom Fields in Header */}
                        {formData.branding.customInfo && formData.branding.customInfo.filter(c => c.isEnabled && c.label && c.value).length > 0 && (
                          <div className="flex flex-wrap items-center justify-center gap-1.5 pt-0.5 text-[8px] text-zinc-600">
                            {formData.branding.customInfo.filter(c => c.isEnabled && c.label && c.value).map(info => (
                              <span key={info.id} className="bg-zinc-50 px-1.5 py-0.2 rounded border border-zinc-200">
                                <strong>{info.label}:</strong> {info.value}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Receipt Title & Meta */}
                    <div className="flex justify-between items-center text-[10px] mb-3 pb-2 border-b border-zinc-100">
                      <div>
                        <span className="text-zinc-400 font-bold uppercase text-[8px]">Document</span>
                        <p className="font-black text-zinc-900 text-xs">
                          {formData.branding.customReceiptTitle || 'OFFICIAL GUEST RECEIPT'}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-zinc-400 font-bold uppercase text-[8px]">Receipt No.</span>
                        <p className="font-mono font-bold text-zinc-800">#REC-884920</p>
                      </div>
                    </div>

                    {/* Sample Guest & Stay */}
                    <div className="grid grid-cols-2 gap-2 text-[9px] mb-3 p-2 rounded-lg bg-zinc-50 border border-zinc-100">
                      <div>
                        <span className="text-zinc-400 uppercase font-bold text-[8px] block">Guest Name</span>
                        <span className="font-bold text-zinc-900">Dr. Olumide Adeleke</span>
                      </div>
                      <div className="text-right">
                        <span className="text-zinc-400 uppercase font-bold text-[8px] block">Room & Dates</span>
                        <span className="font-semibold text-zinc-800">Room 204 • 2 Nights</span>
                      </div>
                    </div>

                    {/* Sample Charges Table */}
                    <div className="space-y-1.5 text-[9px] mb-3">
                      <div className="flex justify-between text-zinc-400 font-bold uppercase border-b border-zinc-200 pb-1 text-[8px]">
                        <span>Description</span>
                        <span>Amount</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Deluxe Suite (2 Nights @ ₦45,000)</span>
                        <span className="font-bold">₦90,000.00</span>
                      </div>
                      <div className="flex justify-between text-zinc-500">
                        <span>Complimentary Breakfast</span>
                        <span className="font-bold">₦0.00</span>
                      </div>
                      <div className="border-t border-zinc-100 pt-1 flex justify-between font-bold">
                        <span>Subtotal</span>
                        <span>₦90,000.00</span>
                      </div>
                      <div className="flex justify-between text-zinc-600 text-[8px]">
                        <span>VAT (7.5%)</span>
                        <span>₦6,750.00</span>
                      </div>
                      <div className="border-t border-zinc-900 pt-1 flex justify-between text-xs font-black">
                        <span>Grand Total</span>
                        <span className="text-emerald-700">₦96,750.00</span>
                      </div>
                    </div>

                    {/* Bank Details in Preview */}
                    {formData.branding.showBankDetailsOnReceipt && (() => {
                      const enabledBanks = (formData.branding.bankAccounts || []).filter(b => b.isEnabled && (b.bankName || b.accountNumber));
                      if (enabledBanks.length === 0) return null;

                      return (
                        <div className="mt-3 p-2.5 rounded-lg border border-zinc-200 bg-zinc-50/80 space-y-1.5 text-[9px]">
                          <div className="flex justify-between items-center text-[8px] font-bold text-zinc-500 uppercase border-b border-zinc-200 pb-1">
                            <span>Official Bank Accounts</span>
                            <span>{enabledBanks.length} Active</span>
                          </div>
                          <div className="space-y-1.5">
                            {enabledBanks.map((b, idx) => (
                              <div key={b.id || idx} className="p-1.5 rounded bg-white border border-zinc-200/80 space-y-0.5">
                                <div className="flex justify-between">
                                  <span className="text-zinc-500 font-medium">Bank:</span>
                                  <strong className="text-zinc-900">{b.bankName || 'N/A'}</strong>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-zinc-500 font-medium">Account:</span>
                                  <strong className="font-mono text-emerald-800">{b.accountNumber || 'N/A'}</strong>
                                </div>
                                {b.accountName && (
                                  <div className="flex justify-between text-[8px] text-zinc-600">
                                    <span>Name:</span>
                                    <span>{b.accountName}</span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Footer in Preview */}
                    <div className="mt-4 text-center border-t border-zinc-100 pt-3 space-y-1">
                      {formData.branding.showGreetingOnReceipt && (
                        <p className="text-[10px] font-bold italic text-zinc-800">
                          {formData.branding.greeting || 'Thank you for staying with us!'}
                        </p>
                      )}
                      {formData.branding.showFooterNotesOnReceipt && (
                        <p className="text-[8px] text-zinc-400 leading-tight">
                          {formData.branding.footerNotes || 'Please retain this receipt for your records.'}
                        </p>
                      )}
                      <div className="pt-2 flex items-center justify-center gap-1.5 opacity-40">
                        <div className="w-2.5 h-2.5 bg-zinc-900 rounded-xs" />
                        <span className="text-[7px] font-black uppercase tracking-widest text-zinc-600">PMS Certified</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'preferences' && (
            <div className="space-y-8">
              <div className="mb-8">
                <h3 className="text-lg font-bold text-zinc-50 mb-1">System Preferences</h3>
                <p className="text-sm text-zinc-500">Customize your personal experience and interface settings</p>
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-2xl">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center transition-colors",
                      theme === 'dark' ? "bg-zinc-800 text-zinc-50" : "bg-zinc-200 text-zinc-900"
                    )}>
                      {theme === 'dark' ? <Moon size={24} /> : <Sun size={24} />}
                    </div>
                    <div>
                      <p className="font-bold text-zinc-50">{t('settings.darkMode')}</p>
                      <p className="text-xs text-zinc-500">Switch between light and dark visual themes</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    className={cn(
                      "w-14 h-8 rounded-full p-1 transition-all duration-300",
                      theme === 'dark' ? "bg-emerald-500" : "bg-zinc-700"
                    )}
                  >
                    <div className={cn(
                      "w-6 h-6 rounded-full bg-zinc-50 shadow-lg transition-all duration-300 transform",
                      theme === 'dark' ? "translate-x-6" : "translate-x-0"
                    )} />
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-2xl">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-zinc-800 text-zinc-50 flex items-center justify-center">
                      <Globe size={24} />
                    </div>
                    <div>
                      <p className="font-bold text-zinc-50">{t('settings.language')}</p>
                      <p className="text-xs text-zinc-500">Select your preferred display language</p>
                    </div>
                  </div>
                  <select 
                    className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1 text-sm text-zinc-50 focus:border-emerald-500 outline-none"
                    value={i18n.language}
                    onChange={(e) => {
                      i18n.changeLanguage(e.target.value);
                      toast.success(`Language changed to ${e.target.value === 'en' ? 'English' : e.target.value === 'fr' ? 'French' : 'Spanish'}`);
                    }}
                  >
                    <option value="en">English</option>
                    <option value="fr">French</option>
                    <option value="es">Spanish</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-8">
              <div>
                <h3 className="text-lg font-bold text-zinc-50 mb-4 flex items-center gap-2">
                  <Lock size={20} className="text-emerald-500" />
                  Change Password
                </h3>
                <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Current Password</label>
                    <div className="relative">
                      <input 
                        required
                        type={showPasswords ? "text" : "password"}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none pr-10"
                        value={formData.currentPassword}
                        onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                      />
                      <button 
                        type="button"
                        onClick={() => setShowPasswords(!showPasswords)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-50"
                      >
                        {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">New Password</label>
                    <input 
                      required
                      type={showPasswords ? "text" : "password"}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                      value={formData.newPassword}
                      onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Confirm New Password</label>
                    <input 
                      required
                      type={showPasswords ? "text" : "password"}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    />
                  </div>
                  <button 
                    disabled={isSaving}
                    type="submit"
                    className="bg-emerald-500 text-black px-6 py-2 rounded-lg font-bold hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isSaving ? 'Updating...' : 'Update Password'}
                  </button>
                </form>
              </div>

              <div className="pt-8 border-t border-zinc-800">
                <h3 className="text-lg font-bold text-zinc-50 mb-4 flex items-center gap-2">
                  <Mail size={20} className="text-emerald-500" />
                  Email Password Reset
                </h3>
                <p className="text-sm text-zinc-400 mb-6">
                  Alternatively, we can send a reset link to your registered email address.
                </p>
                <button 
                  className="px-6 py-2 rounded-lg border border-zinc-800 text-zinc-50 hover:bg-zinc-800 transition-all active:scale-95 font-medium disabled:opacity-50"
                  onClick={() => setShowConfirmReset(true)}
                >
                  Request Password Reset Link
                </button>
              </div>

              <ConfirmModal
                isOpen={showConfirmReset}
                title="Reset Password"
                message={`Are you sure you want to request a password reset link? It will be sent to ${profile?.email}.`}
                onConfirm={handleResetPassword}
                onCancel={() => setShowConfirmReset(false)}
                type="warning"
                confirmText="Send Reset Link"
              />

              <div className="pt-8 border-t border-zinc-800">
                <h3 className="text-lg font-bold text-zinc-50 mb-4 flex items-center gap-2">
                  <Smartphone size={20} className="text-emerald-500" />
                  Two-Factor Authentication
                </h3>
                <p className="text-sm text-zinc-400 mb-6">
                  Add an extra layer of security to your account by enabling 2FA.
                </p>
                <button className="px-6 py-2 rounded-lg bg-zinc-800 text-zinc-500 cursor-not-allowed font-medium">
                  Enable 2FA (Coming Soon)
                </button>
              </div>
            </div>
          )}
          {activeTab === 'taxes' && (
            <div className="space-y-8">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-lg font-bold text-zinc-50 mb-1">Tax Management</h3>
                  <p className="text-sm text-zinc-500">Configure taxes that apply to reservations and services.</p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => {
                      const newTax: Tax = {
                        id: Math.random().toString(36).substr(2, 9),
                        name: '',
                        percentage: 0,
                        isInclusive: false,
                        showOnReceipt: true,
                        showOnFolio: true,
                        status: 'active',
                        category: 'all'
                      };
                      setLocalTaxes([...localTaxes, newTax]);
                    }}
                    className="bg-zinc-800 text-zinc-50 px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-zinc-700 transition-all active:scale-95"
                  >
                    <Plus size={18} />
                    Add Tax
                  </button>
                  <button 
                    onClick={handleSaveTaxes}
                    disabled={isSaving}
                    className="bg-emerald-500 text-black px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <Save size={18} />
                    {isSaving ? 'Saving...' : 'Save All Taxes'}
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {localTaxes.length === 0 ? (
                  <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-12 text-center">
                    <Percent size={40} className="text-zinc-700 mx-auto mb-4" />
                    <p className="text-zinc-500">No taxes configured yet.</p>
                  </div>
                ) : (
                  localTaxes.map((tax, index) => (
                    <div key={tax.id} className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <div>
                          <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Tax Name</label>
                          <input 
                            type="text" 
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                            value={tax.name}
                            placeholder="e.g. VAT, Service Charge"
                            onChange={(e) => handleUpdateLocalTax(index, { name: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Percentage (%)</label>
                          <input 
                            type="number" 
                            step="0.01"
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                            value={tax.percentage}
                            onChange={(e) => handleUpdateLocalTax(index, { percentage: Number(e.target.value) })}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Category</label>
                          <select 
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                            value={tax.category}
                            onChange={(e) => handleUpdateLocalTax(index, { category: e.target.value as any })}
                          >
                            <option value="all">All Services</option>
                            <option value="room">Rooms Only</option>
                            <option value="restaurant">Restaurant Only</option>
                            <option value="service">Services Only</option>
                          </select>
                        </div>
                        <div className="flex items-center justify-end pt-6">
                          <button 
                            onClick={() => {
                              const updated = localTaxes.filter(t => t.id !== tax.id);
                              setLocalTaxes(updated);
                            }}
                            className="p-2 text-zinc-500 hover:text-red-500 transition-all"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-4 pt-2">
                        <button 
                          onClick={() => handleUpdateLocalTax(index, { isInclusive: !tax.isInclusive })}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                            tax.isInclusive ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-800 text-zinc-500"
                          )}
                        >
                          {tax.isInclusive ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                          Inclusive Tax
                        </button>
                        <button 
                          onClick={() => handleUpdateLocalTax(index, { showOnReceipt: !tax.showOnReceipt })}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                            tax.showOnReceipt ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-800 text-zinc-500"
                          )}
                        >
                          {tax.showOnReceipt ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                          Show on Receipt
                        </button>
                        <button 
                          onClick={() => handleUpdateLocalTax(index, { showOnFolio: !tax.showOnFolio })}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                            tax.showOnFolio ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-800 text-zinc-500"
                          )}
                        >
                          {tax.showOnFolio ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                          Show on Folio
                        </button>
                        <button 
                          onClick={() => handleUpdateLocalTax(index, { status: tax.status === 'active' ? 'inactive' : 'active' })}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ml-auto",
                            tax.status === 'active' ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                          )}
                        >
                          {tax.status === 'active' ? 'Active' : 'Inactive'}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'support' && (
            <div className="space-y-8">
              <div className="mb-8">
                <h3 className="text-lg font-bold text-zinc-50 mb-1">Help & Support</h3>
                <p className="text-sm text-zinc-500">Need assistance? Our team is here to help you.</p>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-emerald-500/10 text-emerald-500 rounded-xl flex items-center justify-center">
                    <Mail size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-zinc-50">Email Support</h4>
                    <p className="text-sm text-zinc-500">Send us an email and we'll get back to you within 24 hours.</p>
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-800">
                  <a 
                    href={`mailto:${systemSettings?.supportEmail || 'support@tyyltech.com'}`}
                    className="flex items-center justify-center gap-2 w-full bg-emerald-500 text-black font-bold py-3 rounded-lg hover:bg-emerald-400 transition-all active:scale-95"
                  >
                    <Mail size={18} />
                    {systemSettings?.supportEmail || 'support@tyyltech.com'}
                  </a>
                </div>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-500/10 text-blue-500 rounded-xl flex items-center justify-center">
                    <Info size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-zinc-50">System Information</h4>
                    <p className="text-sm text-zinc-500">Details about your current hotel and plan.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-zinc-800">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase">Hotel ID</span>
                    <p className="text-sm text-zinc-50 font-mono">{hotel?.id}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase">Current Plan</span>
                    <p className="text-sm text-zinc-50 capitalize">{hotel?.plan}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase">Subscription Expiry</span>
                    <p className="text-sm text-zinc-50 flex items-center gap-2 flex-wrap">
                      <span>{hotel?.subscriptionExpiry ? safeFormatDate(hotel.subscriptionExpiry, 'MMM d, yyyy') : 'N/A'}</span>
                      {hotel?.subscriptionExpiry && (() => {
                        const daysLeft = Math.ceil((new Date(hotel.subscriptionExpiry).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
                        return daysLeft > 0 ? (
                          <span className="text-[9px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-1.5 py-0.5 rounded font-black tracking-wider uppercase">
                            {daysLeft} days remaining
                          </span>
                        ) : (
                          <span className="text-[9px] bg-red-500/10 text-red-500 border border-red-500/20 px-1.5 py-0.5 rounded font-black tracking-wider uppercase">
                            Expired
                          </span>
                        );
                      })()}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'shortcuts' && (
            <div className="space-y-6 animate-fade-in">
              <div>
                <h3 className="text-xl font-bold font-sans tracking-tight text-zinc-50 mb-1">PMS Navigation Shortcuts</h3>
                <p className="text-sm text-zinc-400">Use these rapid-access system keys to jump between departments instantaneously.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-800/80 space-y-3">
                  <div className="flex items-center gap-2 mb-2 text-rose-400 font-bold text-xs uppercase tracking-wider">
                    <Key size={14} />
                    Core Navigation (Alt / Option Key)
                  </div>
                  
                  <div className="space-y-2.5">
                    <div className="flex justify-between items-center py-1.5 border-b border-zinc-900">
                      <span className="text-xs text-zinc-300">Dashboard Overview</span>
                      <kbd className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-[10px] font-mono text-zinc-200">Alt + D</kbd>
                    </div>

                    <div className="flex justify-between items-center py-1.5 border-b border-zinc-900">
                      <span className="text-xs text-zinc-300">Operations Window</span>
                      <kbd className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-[10px] font-mono text-zinc-200">Alt + O</kbd>
                    </div>

                    <div className="flex justify-between items-center py-1.5 border-b border-zinc-900">
                      <span className="text-[12px] text-zinc-300">Room Calendar (reception)</span>
                      <kbd className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-[10px] font-mono text-zinc-200">Alt + C</kbd>
                    </div>

                    <div className="flex justify-between items-center py-1.5 border-b border-zinc-900">
                      <span className="text-xs text-zinc-300">Rooms & Bed Types</span>
                      <kbd className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-[10px] font-mono text-zinc-200">Alt + R</kbd>
                    </div>

                    <div className="flex justify-between items-center py-1.5">
                      <span className="text-xs text-zinc-300">Housekeeping Rules</span>
                      <kbd className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-[10px] font-mono text-zinc-200">Alt + H</kbd>
                    </div>
                  </div>
                </div>

                <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-800/80 space-y-3">
                  <div className="flex items-center gap-2 mb-2 text-emerald-400 font-bold text-xs uppercase tracking-wider">
                    <Key size={14} />
                    Utility & Ledger (Alt / Option Key)
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex justify-between items-center py-1.5 border-b border-zinc-900">
                      <span className="text-xs text-zinc-300">Financial Ledger</span>
                      <kbd className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-[10px] font-mono text-zinc-200">Alt + F</kbd>
                    </div>

                    <div className="flex justify-between items-center py-1.5 border-b border-zinc-900">
                      <span className="text-xs text-zinc-300">Guest Profiles</span>
                      <kbd className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-[10px] font-mono text-zinc-200">Alt + G</kbd>
                    </div>

                    <div className="flex justify-between items-center py-1.5 border-b border-zinc-900">
                      <span className="text-xs text-zinc-300">Supplies & Stock</span>
                      <kbd className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-[10px] font-mono text-zinc-200">Alt + I</kbd>
                    </div>

                    <div className="flex justify-between items-center py-1.5 border-b border-zinc-900">
                      <span className="text-xs text-zinc-300">Maintenance & Tickets</span>
                      <kbd className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-[10px] font-mono text-zinc-200">Alt + M</kbd>
                    </div>

                    <div className="flex justify-between items-center py-1.5">
                      <span className="text-xs text-zinc-300">Property Settings</span>
                      <kbd className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-[10px] font-mono text-zinc-200">Alt + S</kbd>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-800/80 flex items-start gap-4">
                <div className="w-10 h-10 bg-zinc-900 border border-zinc-800 text-purple-400 rounded-xl flex items-center justify-center shrink-0">
                  <Key size={18} />
                </div>
                <div>
                  <h4 className="font-bold text-zinc-200 text-sm">Universal Search & Commands</h4>
                  <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                    Press <kbd className="px-1.5 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-300 font-mono text-[10px]">Ctrl + K</kbd> (or <kbd className="px-1.5 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-300 font-mono text-[10px]">⌘ + K</kbd> on macOS) at any time to spin up the Smart Command Search. Use arrows to browse and Enter to trigger any action instantly.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'danger' && profile?.role === 'hotelAdmin' && (
            <div className="space-y-8">
              <div className="mb-8">
                <h3 className="text-lg font-bold text-zinc-50 mb-1">Danger Zone</h3>
                <p className="text-sm text-zinc-500">Highly sensitive actions that can permanently affect your financial and operational data.</p>
              </div>

              {/* Action 1: Delete All Transactions & Debt Ledger */}
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-6 space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-amber-500/10 text-amber-500 rounded-xl flex items-center justify-center shrink-0">
                    <Receipt size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-amber-500 text-base">Purge Financial Transactions & Debt Ledger</h4>
                    <p className="text-sm text-zinc-400 mt-1 leading-relaxed">
                      Permanently delete all financial transactions, folio debits and credits, receipts, invoices, and every record under the debt ledger (including all outstanding guest and corporate debt). Resets all reservation balances, guest spend history, and corporate debts to ₦0.
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t border-amber-500/10 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                  <span className="text-xs text-zinc-500">
                    Irreversible action. Requires explicit text confirmation before execution.
                  </span>
                  <button 
                    onClick={() => setShowConfirmPurgeTransactions(true)}
                    className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-6 py-2.5 rounded-lg transition-all active:scale-95 cursor-pointer text-sm shadow-md"
                  >
                    <Trash2 size={16} />
                    Delete All Transactions & Debt Ledger
                  </button>
                </div>
              </div>

              {/* Action 2: Complete System Reset */}
              <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-6 space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-red-500/10 text-red-500 rounded-xl flex items-center justify-center shrink-0">
                    <Trash2 size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-red-500 text-base">Complete System Reset</h4>
                    <p className="text-sm text-zinc-500 mt-1 leading-relaxed">
                      Permanently wipe all operational data including reservations, guest directories, all transactions even under the debt ledger, inventory logs, and reset all rooms. This action cannot be undone.
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t border-red-500/10 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                  <span className="text-xs text-zinc-500">
                    Wipes the entire property operational history. Requires CONFIRM PURGE confirmation.
                  </span>
                  <button 
                    onClick={() => setShowConfirmSystemReset(true)}
                    className="flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white font-bold px-6 py-2.5 rounded-lg transition-all active:scale-95 cursor-pointer text-sm shadow-md"
                  >
                    <RefreshCw size={16} />
                    Reset All System Data
                  </button>
                </div>
              </div>

              <ConfirmModal
                isOpen={showConfirmPurgeTransactions}
                title="CRITICAL: Delete All Transactions & Debt Ledger"
                message="Are you sure you want to permanently delete ALL financial transactions, folio ledger entries, invoices, payments, and every record under the debt ledger? All guest and corporate debt records will be wiped clean to ₦0. This action is PERMANENT and cannot be undone."
                onConfirm={handlePurgeTransactionsAndDebt}
                onCancel={() => setShowConfirmPurgeTransactions(false)}
                type="danger"
                confirmText="Yes, Delete All Transactions & Debt Ledger"
                requireConfirmationText="CONFIRM PURGE"
                confirmationPlaceholder="Type CONFIRM PURGE to clear transactions"
              />

              <ConfirmModal
                isOpen={showConfirmSystemReset}
                title="CRITICAL: Complete System Reset"
                message="Are you sure you want to clear ALL system data? This will delete all reservations, guest history, financial records, all debt ledger transactions, and reset all rooms. This action is PERMANENT and cannot be undone."
                onConfirm={handleSystemReset}
                onCancel={() => setShowConfirmSystemReset(false)}
                type="danger"
                confirmText="Yes, Reset Everything"
                requireConfirmationText="CONFIRM PURGE"
                confirmationPlaceholder="Type CONFIRM PURGE to clear all data"
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
