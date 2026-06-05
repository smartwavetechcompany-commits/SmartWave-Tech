import { useState, useEffect } from 'react';
import { HotelSettings, Tax } from '../types';
import { settingsManager } from '../services/settingsManager';

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
