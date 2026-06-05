import { doc, onSnapshot, collection } from 'firebase/firestore';
import { db } from '../firebase';
import { HotelSettings, Tax } from '../types';
import { DEFAULT_SETTINGS } from '../constants';

type SettingsSubscriber = (settings: HotelSettings) => void;
type EventCallback = (data: any) => void;

class CentralSettingsManager {
  private currentSettings: HotelSettings = { ...DEFAULT_SETTINGS };
  private currentTaxes: Tax[] = [];
  private currentRateConfigs: any[] = [];
  private currentHotelDetails: any = null;
  private currentHotelId: string | null = null;
  
  private unsubscribeHotel: (() => void) | null = null;
  private unsubscribeRates: (() => void) | null = null;

  private subscribers: Set<SettingsSubscriber> = new Set();
  private eventListeners: Map<string, Set<EventCallback>> = new Map();

  /**
   * Starts listening to Firestore for real-time hotel configuration, taxes, and pricing adjustments.
   */
  initialize(hotelId: string) {
    if (this.currentHotelId === hotelId) return;

    this.currentHotelId = hotelId;
    this.cleanupListeners();

    // 1. Subscribe to Hotel Document (General, Settings, Taxes)
    const hotelRef = doc(db, 'hotels', hotelId);
    this.unsubscribeHotel = onSnapshot(hotelRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        this.currentHotelDetails = data;
        
        // Assemble and merge settings safely with defaults to prevent broken / old properties
        const settings = { ...DEFAULT_SETTINGS };
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
