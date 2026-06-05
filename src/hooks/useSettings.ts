import { useState, useEffect } from 'react';
import { HotelSettings } from '../types';
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
