import { useTranslation } from 'react-i18next';

const LanguageSwitcher = () => {
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'hi' : 'en';
    i18n.changeLanguage(newLang);
    localStorage.setItem('preferred_language', newLang);
  };

  return (
    <button
      onClick={toggleLanguage}
      className="px-3 py-1 rounded-lg bg-gray-200 hover:bg-gray-300 text-sm font-semibold transition"
      title="Switch Language"
    >
      {i18n.language === 'en' ? '🇮🇳 हिं' : '🇬🇧 EN'}
    </button>
  );
};

export default LanguageSwitcher;
