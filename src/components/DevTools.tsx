import React, { useState } from 'react';
import { setDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { TrackingCode, UserProfile } from '../types';
import { Terminal, Shield, Key, AlertTriangle, Copy, Check } from 'lucide-react';

export function DevTools() {
  const [loading, setLoading] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [copied, setCopied] = useState(false);

  const practicalRules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAuthenticated() { return request.auth != null; }
    
    // Practical check: look at the user document instead of custom claims
    function getUserData() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }
    
    function isSuperAdmin() {
      return isAuthenticated() && getUserData().role == "superAdmin";
    }

    function isHotelAdmin() {
      return isAuthenticated() && getUserData().role == "hotelAdmin";
    }

    function isStaff() {
      return isAuthenticated() && getUserData().role == "staff";
    }

    function isSubscriptionActive(hotelId) {
      let hotel = get(/databases/$(database)/documents/hotels/$(hotelId)).data;
      return hotel.status == "active" && hotel.expiryDate > request.time;
    }

    match /users/{userId} {
      // Avoid recursion: check UID first, then check superAdmin role only if not self
      allow read, write: if isAuthenticated() && (request.auth.uid == userId || isSuperAdmin());
    }

    match /hotels/{hotelId} {
      allow read, write: if isSuperAdmin();
      allow read: if isHotelAdmin() && request.auth.uid in resource.data.adminUIDs;
      allow read: if isStaff() && getUserData().hotelId == hotelId;

      match /{subCollection}/{docId} {
        allow read, write: if (isHotelAdmin() || isStaff()) && isSubscriptionActive(hotelId);
      }
    }

    match /trackingCodes/{codeId} {
      allow read: if isAuthenticated();
      allow write: if isSuperAdmin();
    }

    match /trackingCodeRequests/{requestId} {
      allow create: if true; // Allow anyone to request a code
      allow read, write: if isSuperAdmin();
    }

    match /system/settings {
      allow read: if true; // Allow anyone to see payment instructions
      allow write: if isSuperAdmin();
    }

    match /activityLogs/{logId} {
      allow read, write: if isSuperAdmin();
      allow create: if isAuthenticated();
    }

    match /{document=**} {
      allow read, write: if isSuperAdmin();
    }
  }
}`;

  const copyRules = () => {
    navigator.clipboard.writeText(practicalRules);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const seedTrackingCode = async () => {
    setLoading(true);
    try {
      const code: TrackingCode = {
        id: 'dev-code-1',
        code: 'SW-PRO-2026',
        expiryDate: '2027-01-01T00:00:00.000Z',
        duration: '1 year',
        type: 'Premium',
        status: 'active',
      };
      await setDoc(doc(db, 'trackingCodes', code.id), code);
      alert('Tracking code SW-PRO-2026 created!');
    } catch (e) {
      alert('Permission Denied. Please apply the rules in DevTools first.');
    } finally {
      setLoading(false);
    }
  };

  const seedSuperAdmin = async () => {
    const email = prompt('Enter email for Super Admin:');
    const uid = prompt('Enter UID for Super Admin (from Firebase Auth):');
    if (!email || !uid) return;

    setLoading(true);
    try {
      const profile: UserProfile = {
        uid,
        email,
        hotelId: 'system',
        role: 'superAdmin',
        permissions: ['all'],
        status: 'active',
        displayName: 'System Owner',
      };
      await setDoc(doc(db, 'users', uid), profile);
      alert('Super Admin profile created!');
    } catch (e) {
      alert('Permission Denied. Please apply the rules in DevTools first.');
    } finally {
      setLoading(false);
    }
  };

  const seedStaff = async () => {
    const email = prompt('Enter email for Staff:');
    const uid = prompt('Enter UID for Staff (from Firebase Auth):');
    const hotelId = prompt('Enter Hotel ID:');
    if (!email || !uid || !hotelId) return;

    setLoading(true);
    try {
      const profile: UserProfile = {
        uid,
        email,
        hotelId,
        role: 'staff',
        permissions: ['frontDesk'],
        status: 'active',
        displayName: 'Hotel Staff',
      };
      await setDoc(doc(db, 'users', uid), profile);
      alert('Staff profile created!');
    } catch (e) {
      alert('Permission Denied. Please apply the rules in DevTools first.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2">
      {showRules && (
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl w-96 shadow-2xl mb-2 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center gap-2 text-emerald-500 mb-4">
            <Shield size={20} />
            <h3 className="font-bold">Setup Guide</h3>
          </div>
          
          <div className="space-y-4">
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800">
              <p className="text-[10px] text-zinc-500 uppercase font-bold mb-2">Step 1: Apply Rules</p>
              <p className="text-xs text-zinc-400 mb-3">Copy these rules to your Firebase Console &rarr; Firestore &rarr; Rules.</p>
              <button 
                onClick={copyRules}
                className="w-full bg-emerald-500/10 text-emerald-500 text-xs py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-emerald-500/20 transition-colors"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied!' : 'Copy Practical Rules'}
              </button>
            </div>

            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800">
              <p className="text-[10px] text-zinc-500 uppercase font-bold mb-2">Step 2: Seed Data</p>
              <div className="grid grid-cols-1 gap-2">
                <button 
                  onClick={seedTrackingCode}
                  disabled={loading}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-white text-xs py-2 rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  <Key size={14} /> Seed Tracking Code
                </button>
                <button 
                  onClick={seedSuperAdmin}
                  disabled={loading}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-white text-xs py-2 rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  <Shield size={14} /> Seed Super Admin
                </button>
                <button 
                  onClick={seedStaff}
                  disabled={loading}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-white text-xs py-2 rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  <Shield size={14} /> Seed Staff
                </button>
              </div>
            </div>
          </div>

          <button 
            onClick={() => setShowRules(false)}
            className="w-full mt-4 text-zinc-500 text-[10px] hover:text-white"
          >
            Close
          </button>
        </div>
      )}
      <button 
        onClick={() => setShowRules(!showRules)}
        className="bg-zinc-900 border border-zinc-800 text-zinc-400 p-2 rounded-full hover:text-white transition-colors shadow-lg"
      >
        <Terminal size={20} />
      </button>
    </div>
  );
}
