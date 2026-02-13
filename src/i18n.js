import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      // Common
      "welcome": "Welcome",
      "logout": "Logout",
      "save": "Save",
      "cancel": "Cancel",
      "delete": "Delete",
      "edit": "Edit",
      "add": "Add",
      "search": "Search",
      "loading": "Loading...",
      
      // Navigation
      "dashboard": "Dashboard",
      "tenants": "Tenants",
      "rooms": "Rooms",
      "electricity": "Electricity",
      "payments": "Payments",
      "maintenance": "Maintenance",
      "import": "Import CSV",
      "bankAccounts": "Bank Accounts",
      "settings": "Settings",
      
      // Dashboard
      "totalRooms": "Total Rooms",
      "activeTenants": "Active Tenants",
      "pendingPayments": "Pending Payments",
      "thisMonth": "This Month",
      
      // Tenants
      "addNewTenant": "Add New Tenant",
      "tenantName": "Tenant Name",
      "phoneNumber": "Phone Number",
      "roomNumber": "Room Number",
      "checkInDate": "Check-in Date",
      "currentRent": "Current Rent",
      
      // Electricity
      "electricityRate": "Electricity Rate",
      "meterReading": "Meter Reading",
      "unitsConsumed": "Units Consumed",
      "totalCharge": "Total Charge"
    }
  },
  hi: {
    translation: {
      // Common
      "welcome": "स्वागत है",
      "logout": "लॉग आउट",
      "save": "सहेजें",
      "cancel": "रद्द करें",
      "delete": "हटाएं",
      "edit": "संपादित करें",
      "add": "जोड़ें",
      "search": "खोजें",
      "loading": "लोड हो रहा है...",
      
      // Navigation
      "dashboard": "डैशबोर्ड",
      "tenants": "किरायेदार",
      "rooms": "कमरे",
      "electricity": "बिजली",
      "payments": "भुगतान",
      "maintenance": "रखरखाव",
      "import": "CSV आयात",
      "bankAccounts": "बैंक खाते",
      "settings": "सेटिंग्स",
      
      // Dashboard
      "totalRooms": "कुल कमरे",
      "activeTenants": "सक्रिय किरायेदार",
      "pendingPayments": "लंबित भुगतान",
      "thisMonth": "इस महीने",
      
      // Tenants
      "addNewTenant": "नया किरायेदार जोड़ें",
      "tenantName": "किरायेदार का नाम",
      "phoneNumber": "फ़ोन नंबर",
      "roomNumber": "कमरा नंबर",
      "checkInDate": "चेक-इन तिथि",
      "currentRent": "वर्तमान किराया",
      
      // Electricity
      "electricityRate": "बिजली की दर",
      "meterReading": "मीटर रीडिंग",
      "unitsConsumed": "खपत यूनिट",
      "totalCharge": "कुल शुल्क"
    }
  }
};

const savedLanguage = localStorage.getItem('preferred_language') || 'en';

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: savedLanguage,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
