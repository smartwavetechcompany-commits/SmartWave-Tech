import { useState, useEffect } from 'react';
import { HotelSettings, Tax, BookingSource } from '../types';
import { settingsManager } from '../services/settingsManager';
import { DEFAULT_BOOKING_SOURCES } from '../constants';

export function useSettings() {
  const [settings, setSettingsState] = useState<HotelSettings>(() => {
    return settingsManager.getSettings();
  });

  useEffect(() => {
    // Subscribe to central settingsManager updates which are fed by the Firestore event bus
    const unsubManager = settingsManager.subscribe((newSettings) => {
      setSettingsState(newSettings);
    });

    return () => {
      unsubManager();
    };
  }, []);

  return {
    settings,
    setSettings: (newSettings: HotelSettings) => {
      settingsManager.setSettings(newSettings);
    }
  };
}

export function useBookingSources() {
  const [bookingSources, setBookingSourcesState] = useState<BookingSource[]>(() => {
    return settingsManager.getBookingSources();
  });

  useEffect(() => {
    const unsub = settingsManager.subscribeToKey('booking_sources', (sources) => {
      if (Array.isArray(sources) && sources.length > 0) {
        setBookingSourcesState(sources);
      }
    });
    return unsub;
  }, []);

  const activeBookingSources = (bookingSources && bookingSources.length > 0 ? bookingSources : DEFAULT_BOOKING_SOURCES)
    .filter(s => s.isActive !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const defaultBookingSource = activeBookingSources.find(s => s.isDefault) || activeBookingSources[0] || DEFAULT_BOOKING_SOURCES[0];

  return {
    bookingSources: bookingSources && bookingSources.length > 0 ? bookingSources : DEFAULT_BOOKING_SOURCES,
    activeBookingSources: activeBookingSources.length > 0 ? activeBookingSources : [DEFAULT_BOOKING_SOURCES[0]],
    defaultBookingSource,
    setBookingSources: (newSources: BookingSource[]) => {
      settingsManager.setBookingSources(newSources);
    }
  };
}

export function useTaxes() {
  const [taxes, setTaxesState] = useState<Tax[]>(() => {
    return settingsManager.getTaxes();
  });

  useEffect(() => {
    const unsub = settingsManager.subscribeToKey('taxes', (newTaxes) => {
      setTaxesState(newTaxes || []);
    });
    return unsub;
  }, []);

  return taxes;
}

export function useServiceCharge() {
  const [serviceCharge, setServiceChargeState] = useState(() => {
    return settingsManager.getServiceChargeSettings();
  });

  useEffect(() => {
    const unsub = settingsManager.subscribeToKey('service_charge', (newVal) => {
      setServiceChargeState(newVal);
    });
    return unsub;
  }, []);

  return serviceCharge;
}

export function useRateConfigurations() {
  const [rateConfigs, setRateConfigsState] = useState<any[]>(() => {
    return settingsManager.getRateConfigurations();
  });

  useEffect(() => {
    const unsub = settingsManager.subscribeToKey('rate_configurations', (newConfigs) => {
      setRateConfigsState(newConfigs || []);
    });
    return unsub;
  }, []);

  return rateConfigs;
}
