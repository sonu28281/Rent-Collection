import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const DialogContext = createContext(null);

const DialogProvider = ({ children }) => {
  const queueRef = useRef([]);
  const [activeDialog, setActiveDialog] = useState(null);
  const [promptValue, setPromptValue] = useState('');

  const openNextDialog = useCallback(() => {
    setActiveDialog((prev) => {
      if (prev || queueRef.current.length === 0) {
        return prev;
      }
      return queueRef.current.shift();
    });
  }, []);

  const enqueueDialog = useCallback((dialogConfig) => new Promise((resolve) => {
    queueRef.current.push({ ...dialogConfig, resolve });
    openNextDialog();
  }), [openNextDialog]);

  const closeDialog = useCallback((result) => {
    if (!activeDialog) return;

    activeDialog.resolve(result);
    setActiveDialog(null);
    setPromptValue('');

    setTimeout(() => {
      openNextDialog();
    }, 0);
  }, [activeDialog, openNextDialog]);

  const showAlert = useCallback((message, options = {}) => (
    enqueueDialog({
      type: 'alert',
      title: options.title || 'Information',
      message: String(message ?? ''),
      confirmLabel: options.confirmLabel || 'OK',
      intent: options.intent || 'info'
    })
  ), [enqueueDialog]);

  const showConfirm = useCallback((message, options = {}) => (
    enqueueDialog({
      type: 'confirm',
      title: options.title || 'Please Confirm',
      message: String(message ?? ''),
      confirmLabel: options.confirmLabel || 'Confirm',
      cancelLabel: options.cancelLabel || 'Cancel',
      intent: options.intent || 'warning'
    })
  ), [enqueueDialog]);

  const showPrompt = useCallback((message, options = {}) => (
    enqueueDialog({
      type: 'prompt',
      title: options.title || 'Input Required',
      message: String(message ?? ''),
      defaultValue: String(options.defaultValue ?? ''),
      placeholder: options.placeholder || '',
      confirmLabel: options.confirmLabel || 'Submit',
      cancelLabel: options.cancelLabel || 'Cancel',
      required: options.required ?? false,
      intent: options.intent || 'warning'
    })
  ), [enqueueDialog]);

  useEffect(() => {
    if (activeDialog?.type === 'prompt') {
      setPromptValue(activeDialog.defaultValue || '');
    }
  }, [activeDialog]);

  useEffect(() => {
    const originalAlert = window.alert;
    window.alert = (message) => {
      showAlert(message);
    };

    return () => {
      window.alert = originalAlert;
    };
  }, [showAlert]);

  const getIntentClasses = (intent) => {
    if (intent === 'error') {
      return 'bg-red-50 border-red-200 text-red-900';
    }
    if (intent === 'success') {
      return 'bg-green-50 border-green-200 text-green-900';
    }
    if (intent === 'warning') {
      return 'bg-amber-50 border-amber-200 text-amber-900';
    }
    return 'bg-blue-50 border-blue-200 text-blue-900';
  };

  const contextValue = {
    showAlert,
    showConfirm,
    showPrompt
  };

  return (
    <DialogContext.Provider value={contextValue}>
      {children}

      {activeDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
            <div className={`px-4 py-3 border-b ${getIntentClasses(activeDialog.intent)}`}>
              <h3 className="text-base font-bold">{activeDialog.title}</h3>
            </div>

            <div className="px-4 py-4">
              <p className="text-sm text-gray-800 whitespace-pre-line">{activeDialog.message}</p>

              {activeDialog.type === 'prompt' && (
                <input
                  autoFocus
                  type="text"
                  value={promptValue}
                  onChange={(event) => setPromptValue(event.target.value)}
                  placeholder={activeDialog.placeholder}
                  className="mt-3 w-full rounded-lg border-2 border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>

            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
              {activeDialog.type !== 'alert' && (
                <button
                  onClick={() => closeDialog(activeDialog.type === 'confirm' ? false : null)}
                  className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-100"
                >
                  {activeDialog.cancelLabel || 'Cancel'}
                </button>
              )}

              <button
                onClick={() => {
                  if (activeDialog.type === 'alert') {
                    closeDialog(true);
                    return;
                  }
                  if (activeDialog.type === 'confirm') {
                    closeDialog(true);
                    return;
                  }
                  closeDialog(promptValue);
                }}
                disabled={Boolean(activeDialog.type === 'prompt' && activeDialog.required && !promptValue.trim())}
                className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {activeDialog.confirmLabel || 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
};

export const useDialog = () => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within DialogProvider');
  }
  return context;
};

export default DialogProvider;
