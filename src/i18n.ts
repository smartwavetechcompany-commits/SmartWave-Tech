import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  en: {
    translation: {
      settings: {
        title: 'Settings',
        profile: 'Profile',
        hotelSettings: 'Hotel Settings',
        branding: 'Branding',
        taxes: 'Taxes',
        preferences: 'Preferences',
        security: 'Security',
        support: 'Help & Support',
        dangerZone: 'Danger Zone',
        language: 'Language',
        darkMode: 'Dark Mode',
        saveChanges: 'Save Changes',
        updateHotel: 'Update Hotel',
        saveBranding: 'Save Branding',
        saveAllTaxes: 'Save All Taxes',
      },
      sidebar: {
        dashboard: 'Dashboard',
        calendar: 'Calendar',
        reservations: 'Reservations',
        rooms: 'Rooms',
        housekeeping: 'Housekeeping',
        guests: 'Guests',
        finance: 'Finance',
        inventory: 'Inventory',
        maintenance: 'Maintenance',
        staff: 'Staff',
        reports: 'Reports',
        settings: 'Settings',
        logout: 'Logout',
      }
    }
  },
  fr: {
    translation: {
      settings: {
        title: 'Paramètres',
        profile: 'Profil',
        hotelSettings: 'Paramètres de l\'hôtel',
        branding: 'Image de marque',
        taxes: 'Taxes',
        preferences: 'Préférences',
        security: 'Sécurité',
        support: 'Aide et support',
        dangerZone: 'Zone de danger',
        language: 'Langue',
        darkMode: 'Mode sombre',
        saveChanges: 'Enregistrer les modifications',
        updateHotel: 'Mettre à jour l\'hôtel',
        saveBranding: 'Enregistrer l\'image de marque',
        saveAllTaxes: 'Enregistrer toutes les taxes',
      },
      sidebar: {
        dashboard: 'Tableau de bord',
        calendar: 'Calendrier',
        reservations: 'Réservations',
        rooms: 'Chambres',
        housekeeping: 'Ménage',
        guests: 'Clients',
        finance: 'Finance',
        inventory: 'Inventaire',
        maintenance: 'Maintenance',
        staff: 'Personnel',
        reports: 'Rapports',
        settings: 'Paramètres',
        logout: 'Déconnexion',
      }
    }
  },
  es: {
    translation: {
      settings: {
        title: 'Ajustes',
        profile: 'Perfil',
        hotelSettings: 'Ajustes del hotel',
        branding: 'Imagen de marca',
        taxes: 'Impuestos',
        preferences: 'Preferencias',
        security: 'Seguridad',
        support: 'Ayuda y soporte',
        dangerZone: 'Zona de peligro',
        language: 'Idioma',
        darkMode: 'Modo oscuro',
        saveChanges: 'Guardar cambios',
        updateHotel: 'Actualizar hotel',
        saveBranding: 'Guardar imagen de marca',
        saveAllTaxes: 'Guardar todos los impuestos',
      },
      sidebar: {
        dashboard: 'Tablero',
        calendar: 'Calendario',
        reservations: 'Reservas',
        rooms: 'Habitaciones',
        housekeeping: 'Limpieza',
        guests: 'Huéspedes',
        finance: 'Finanzas',
        inventory: 'Inventario',
        maintenance: 'Mantenimiento',
        staff: 'Personal',
        reports: 'Informes',
        settings: 'Ajustes',
        logout: 'Cerrar sesión',
      }
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
