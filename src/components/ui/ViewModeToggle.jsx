const ViewModeToggle = ({ viewMode, onChange, className = '' }) => {
  return (
    <div className={`inline-flex rounded-lg bg-gray-100 p-1 ${className}`}>
      <button
        type="button"
        onClick={() => onChange('card')}
        className={`px-3 py-1.5 rounded-md text-sm font-semibold transition ${
          viewMode === 'card'
            ? 'bg-white text-primary shadow-sm'
            : 'text-gray-700 hover:text-gray-900'
        }`}
      >
        Cards
      </button>
      <button
        type="button"
        onClick={() => onChange('table')}
        className={`px-3 py-1.5 rounded-md text-sm font-semibold transition ${
          viewMode === 'table'
            ? 'bg-white text-primary shadow-sm'
            : 'text-gray-700 hover:text-gray-900'
        }`}
      >
        Table
      </button>
    </div>
  );
};

export default ViewModeToggle;
