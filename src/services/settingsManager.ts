import { doc, onSnapshot, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { HotelSettings, Tax } from '../types';
import { DEFAULT_SETTINGS } from '../constants';
import { safeStringify } from '../utils';

type SettingsSubscriber = (settings: HotelSettings) => void;
type EventCallback = (data: any) => void;

class CentralSettingsManager {
  private currentSettings: HotelSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  private currentTaxes: Tax[] = [];
  private currentRateConfigs: any[] = [];
  private currentHotelDetails: any = null;
  private currentHotelId: string | null = null;
  
  private unsubscribeHotel: (() => void) | null = null;
  private unsubscribeRates: (() => void) | null = null;

  private subscribers: Set<SettingsSubscriber> = new Set();
  private eventListeners: Map<string, Set<EventCallback>> = new Map();

  // Cache for detecting changed delta states
  private lastSettings: HotelSettings | null = null;
  private lastTaxes: Tax[] | null = null;
  private lastHotelDetails: any = null;
  private lastRateConfigs: any[] | null = null;
  private clientInitiatedUpdate: boolean = false;

  /**
   * Directly marks that an update was triggered by the current user's interaction in this tab.
   */
  markClientInitiatedUpdate() {
    this.clientInitiatedUpdate = true;
  }

  /**
   * Compares and logs any configuration changes to the Firestore 'AuditLogs' and 'activityLogs' collections.
   */
  private async writeAuditLogEntry(hotelId: string, differences: any[], previousState: any, newState: any) {
    if (differences.length === 0) return;

    const user = auth.currentUser;
    const auditRecord = {
      userId: user?.uid || 'system',
      userEmail: user?.email || 'system',
      userName: user?.displayName || user?.email || 'System',
      timestamp: serverTimestamp(),
      timestampIso: new Date().toISOString(),
      hotelId,
      module: 'Configuration Engine',
      action: 'CONFIGURATION_CHANGE',
      differences,
      details: differences.map(d => d.description).join('\n'),
      previousValues: previousState,
      newValues: newState,
      status: 'success'
    };

    try {
      // 1. Log to the requested 'AuditLogs' subcollection
      await addDoc(collection(db, 'hotels', hotelId, 'AuditLogs'), auditRecord);
      
      // 2. Also log to the general 'activityLogs' subcollection so the UI's existing AuditLogs viewer picks it up!
      await addDoc(collection(db, 'hotels', hotelId, 'activityLogs'), {
        ...auditRecord,
        action: 'UPDATE_ADMIN_SETTINGS',
        details: `Configuration updated: ${differences.map(d => d.path).join(', ')}`,
        actor: auditRecord.userName,
        user: auditRecord.userName,
        target: 'Configuration Engine',
        userRole: 'admin',
        metadata: {
          differences: differences
        }
      });
    } catch (err) {
      console.error("Failed to write to AuditLogs collection:", err);
    }
  }

  /**
   * Starts listening to Firestore for real-time hotel configuration, taxes, and pricing adjustments.
   */
  initialize(hotelId: string) {
    if (this.currentHotelId === hotelId) return;

    this.currentHotelId = hotelId;
    this.cleanupListeners();

    // Reset caches for the new hotel
    this.lastSettings = null;
    this.lastTaxes = null;
    this.lastHotelDetails = null;
    this.lastRateConfigs = null;
    this.clientInitiatedUpdate = false;

    // 1. Subscribe to Hotel Document (General, Settings, Taxes)
    const hotelRef = doc(db, 'hotels', hotelId);
    this.unsubscribeHotel = onSnapshot(hotelRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        this.currentHotelDetails = data;
        
        // Assemble and merge settings safely with defaults to prevent broken / old properties
        const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as HotelSettings;
        if (data && data.settings) {
          Object.keys(data.settings).forEach(group => {
            const groupKey = group as keyof HotelSettings;
            if (settings[groupKey]) {
              settings[groupKey] = {
                ...(settings[groupKey] as any),
                ...(data.settings[groupKey] as any)
              };
            }
          });
        }
        
        this.currentSettings = settings;

        // Parse taxes
        const taxes = (data && data.taxes) || [];
        this.currentTaxes = taxes;

        const hotelDetails = {
          name: data.name,
          defaultCurrency: data.defaultCurrency,
          exchangeRate: data.exchangeRate,
          defaultCheckInTime: data.defaultCheckInTime,
          defaultCheckOutTime: data.defaultCheckOutTime,
          overstayChargeTime: data.overstayChargeTime,
          autoChargeOverstays: data.autoChargeOverstays,
        };

        // Determine if change is local to this client session
        const isLocalChange = snap.metadata.hasPendingWrites || this.clientInitiatedUpdate;

        if (this.lastSettings && isLocalChange) {
          const differences: any[] = [];

          // Compare Operational settings
          Object.keys(settings).forEach(group => {
            const groupKey = group as keyof HotelSettings;
            const prevGroup = (this.lastSettings as any)[groupKey] || {};
            const nextGroup = (settings as any)[groupKey] || {};
            
            Object.keys(nextGroup).forEach(key => {
              const prevVal = prevGroup[key];
              const newVal = nextGroup[key];
              if (safeStringify(prevVal) !== safeStringify(newVal)) {
                differences.push({
                  path: `settings.${groupKey}.${key}`,
                  from: prevVal === undefined ? null : prevVal,
                  to: newVal === undefined ? null : newVal,
                  description: `Operational setting '${groupKey}.${key}' changed from ${safeStringify(prevVal)} to ${safeStringify(newVal)}`
                });
              }
            });
          });

          // Compare Taxes list
          if (this.lastTaxes && safeStringify(this.lastTaxes) !== safeStringify(taxes)) {
            differences.push({
              path: 'taxes',
              from: this.lastTaxes,
              to: taxes,
              description: `Taxes list updated`
            });
          }

          // Compare generic hotel details
          if (this.lastHotelDetails) {
            Object.keys(hotelDetails).forEach(key => {
              const prevVal = this.lastHotelDetails[key];
              const newVal = (hotelDetails as any)[key];
              if (safeStringify(prevVal) !== safeStringify(newVal)) {
                differences.push({
                  path: `hotel.${key}`,
                  from: prevVal === undefined ? null : prevVal,
                  to: newVal === undefined ? null : newVal,
                  description: `Hotel ${key} changed from ${safeStringify(prevVal)} to ${safeStringify(newVal)}`
                });
              }
            });
          }

          if (differences.length > 0) {
            this.writeAuditLogEntry(hotelId, differences, {
              settings: this.lastSettings,
              taxes: this.lastTaxes,
              hotelDetails: this.lastHotelDetails
            }, {
              settings,
              taxes,
              hotelDetails
            });
          }
        }

        // Cache for subsequent delta checks
        this.lastSettings = settings;
        this.lastTaxes = taxes;
        this.lastHotelDetails = hotelDetails;
        this.clientInitiatedUpdate = false;

        // Broadcast to main subscribers
        this.broadcast();

        // Broadcast specific key updates to event bus
        Object.keys(settings).forEach(group => {
          const groupKey = group as keyof HotelSettings;
          const subgroup = settings[groupKey];
          if (subgroup && typeof subgroup === 'object') {
            Object.keys(subgroup).forEach(key => {
              const value = (subgroup as any)[key];
              this.publish(`${groupKey}.${key}`, value);
            });
          }
        });

        // Broadcast specialized topics
        this.publish('taxes', taxes);
        this.publish('service_charge', this.getServiceChargeSettings());
      }
    }, (error) => {
      console.error("CentralSettingsManager Hotel document listener error:", error);
    });

    // 2. Subscribe to Rate Configurations Collection (Room Pricing)
    const ratesRef = collection(db, 'hotels', hotelId, 'rate_configurations');
    this.unsubscribeRates = onSnapshot(ratesRef, (ratesSnap) => {
      const rates = ratesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      this.currentRateConfigs = rates;

      const isLocalRatesChange = ratesSnap.metadata.hasPendingWrites || this.clientInitiatedUpdate;

      if (this.lastRateConfigs && isLocalRatesChange) {
        const differences: any[] = [];
        const oldIds = this.lastRateConfigs.map((r: any) => r.id);
        const newIds = rates.map((r: any) => r.id);

        // Added rules
        rates.forEach((newRate: any) => {
          if (!oldIds.includes(newRate.id)) {
            differences.push({
              path: `rate_configurations.${newRate.id}`,
              from: null,
              to: newRate,
              description: `Added rate rule: '${newRate.name || 'unnamed'}' for roomType: ${newRate.roomTypeId || 'unknown'}`
            });
          }
        });

        // Deleted rules
        this.lastRateConfigs.forEach((oldRate: any) => {
          if (!newIds.includes(oldRate.id)) {
            differences.push({
              path: `rate_configurations.${oldRate.id}`,
              from: oldRate,
              to: null,
              description: `Deleted rate rule: '${oldRate.name || oldRate.id}'`
            });
          }
        });

        // Updated rules
        rates.forEach((newRate: any) => {
          const oldRate = this.lastRateConfigs?.find((r: any) => r.id === newRate.id);
          if (oldRate && safeStringify(oldRate) !== safeStringify(newRate)) {
            differences.push({
              path: `rate_configurations.${newRate.id}`,
              from: oldRate,
              to: newRate,
              description: `Updated rate rule: '${newRate.name || newRate.id}' (roomType: ${newRate.roomTypeId})`
            });
          }
        });

        if (differences.length > 0) {
          this.writeAuditLogEntry(hotelId, differences, this.lastRateConfigs, rates);
        }
      }

      this.lastRateConfigs = rates;
      this.clientInitiatedUpdate = false;

      this.publish('room_pricing', rates);
      this.publish('rate_configurations', rates);
    }, (error) => {
      console.error("CentralSettingsManager Rate configurations listener error:", error);
    });
  }

  private cleanupListeners() {
    if (this.unsubscribeHotel) {
      this.unsubscribeHotel();
      this.unsubscribeHotel = null;
    }
    if (this.unsubscribeRates) {
      this.unsubscribeRates();
      this.unsubscribeRates = null;
    }
  }

  destroy() {
    this.cleanupListeners();
    this.currentHotelId = null;
    this.currentHotelDetails = null;
    this.subscribers.clear();
    this.eventListeners.clear();
  }

  setSettings(settings: HotelSettings) {
    this.clientInitiatedUpdate = true;
    this.currentSettings = { ...settings };
    this.broadcast();
    
    // Broadcast specific key updates to event bus
    Object.keys(settings).forEach(group => {
      const groupKey = group as keyof HotelSettings;
      const subgroup = settings[groupKey];
      if (subgroup && typeof subgroup === 'object') {
        Object.keys(subgroup).forEach(key => {
          const value = (subgroup as any)[key];
          this.publish(`${groupKey}.${key}`, value);
        });
      }
    });
  }

  getSettings(): HotelSettings {
    return this.currentSettings;
  }

  getTaxes(): Tax[] {
    return this.currentTaxes;
  }

  setTaxes(taxes: Tax[]) {
    this.clientInitiatedUpdate = true;
    this.currentTaxes = [...taxes];
    this.publish('taxes', taxes);
  }

  getRateConfigurations(): any[] {
    return this.currentRateConfigs;
  }

  getServiceChargeSettings() {
    return {
      overstayChargeTime: this.currentHotelDetails?.overstayChargeTime || '14:00',
      autoChargeOverstays: this.currentHotelDetails?.autoChargeOverstays ?? false,
      defaultCheckInTime: this.currentHotelDetails?.defaultCheckInTime || '14:00',
      defaultCheckOutTime: this.currentHotelDetails?.defaultCheckOutTime || '12:00'
    };
  }

  // Event bus methods to subscribe to specific key updates (e.g. tax-toggle, base-rate, etc.)
  subscribeToKey(topic: string, callback: EventCallback): () => void {
    if (!this.eventListeners.has(topic)) {
      this.eventListeners.set(topic, new Set());
    }
    this.eventListeners.get(topic)!.add(callback);

    // Immediately trigger with current value if available
    const value = this.getCurrentValueForTopic(topic);
    if (value !== undefined) {
      try {
        callback(value);
      } catch (err) {
        console.error(`Error invoking immediate subscriber for ${topic}:`, err);
      }
    }

    return () => {
      const listeners = this.eventListeners.get(topic);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.eventListeners.delete(topic);
        }
      }
    };
  }

  publish(topic: string, data: any) {
    const listeners = this.eventListeners.get(topic);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (err) {
          console.error(`Error executing event bus callback for topic [${topic}]:`, err);
        }
      });
    }
  }

  private getCurrentValueForTopic(topic: string): any {
    if (topic === 'taxes') return this.currentTaxes;
    if (topic === 'room_pricing' || topic === 'rate_configurations') return this.currentRateConfigs;
    if (topic === 'service_charge') return this.getServiceChargeSettings();
    
    const parts = topic.split('.');
    if (parts.length === 2) {
      const [group, key] = parts;
      const groupSettings = (this.currentSettings as any)[group];
      if (groupSettings && typeof groupSettings === 'object') {
        return groupSettings[key];
      }
    }
    return undefined;
  }

  // State selectors
  getCheckoutSettings() { return this.currentSettings.checkout; }
  getReservationSettings() { return this.currentSettings.reservations; }
  getRoomBlockingSettings() { return this.currentSettings.roomBlocking; }
  getCheckInSettings() { return this.currentSettings.checkIn; }
  getFinancialSettings() { return this.currentSettings.financial; }
  getPaymentsSettings() { return this.currentSettings.payments; }
  getGuestsSettings() { return this.currentSettings.guests; }
  getHousekeepingSettings() { return this.currentSettings.housekeeping; }
  getStaffSettings() { return this.currentSettings.staff; }
  getAuditLogsSettings() { return this.currentSettings.auditLogs; }
  getReportingSettings() { return this.currentSettings.reporting; }
  getNotificationsSettings() { return this.currentSettings.notifications; }
  getSecuritySettings() { return this.currentSettings.security; }

  subscribe(callback: SettingsSubscriber): () => void {
    this.subscribers.add(callback);
    callback(this.currentSettings);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private broadcast() {
    this.subscribers.forEach(callback => {
      try {
        callback(this.currentSettings);
      } catch (err) {
        console.error("Error invoking SettingsManager subscriber:", err);
      }
    });
  }
}

export const settingsManager = new CentralSettingsManager();
