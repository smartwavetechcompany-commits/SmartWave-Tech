import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface RequestOptions {
  loadingMessage?: string;
  preventDuplicates?: boolean;
  showOverlay?: boolean;
}

interface RequestManagerContextType {
  executeRequest: <T>(key: string, fn: () => Promise<T>, options?: RequestOptions) => Promise<T | undefined>;
  isPending: (key?: string) => boolean;
  activeRequests: Set<string>;
  activeMessage: string | null;
  cancelRequest: (key: string) => void;
}

const RequestManagerContext = createContext<RequestManagerContextType | undefined>(undefined);

export const RequestManagerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeRequests, setActiveRequests] = useState<Set<string>>(new Set());
  const [messagesMap, setMessagesMap] = useState<Map<string, string>>(new Map());
  const [overlaysSet, setOverlaysSet] = useState<Set<string>>(new Set());
  const activeKeysRef = useRef<Set<string>>(new Set());

  const executeRequest = useCallback(async <T,>(
    key: string,
    fn: () => Promise<T>,
    options?: RequestOptions
  ): Promise<T | undefined> => {
    const preventDuplicates = options?.preventDuplicates ?? true;
    const loadingMessage = options?.loadingMessage;
    const showOverlay = options?.showOverlay ?? false;

    // Prevent race conditions and redundant clicks
    if (preventDuplicates && activeKeysRef.current.has(key)) {
      console.warn(`[RequestManager] Prevented duplicate execution for request key: "${key}"`);
      return undefined;
    }

    // Register active request
    activeKeysRef.current.add(key);
    setActiveRequests(prev => new Set(prev).add(key));

    if (loadingMessage) {
      setMessagesMap(prev => {
        const next = new Map(prev);
        next.set(key, loadingMessage);
        return next;
      });
    }

    if (showOverlay) {
      setOverlaysSet(prev => new Set(prev).add(key));
    }

    try {
      const result = await fn();
      return result;
    } catch (error) {
      console.error(`[RequestManager] Error executing request "${key}":`, error);
      throw error;
    } finally {
      // Unregister active request
      activeKeysRef.current.delete(key);
      setActiveRequests(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setMessagesMap(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      setOverlaysSet(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const isPending = useCallback((key?: string): boolean => {
    if (!key) {
      return activeKeysRef.current.size > 0;
    }
    return activeKeysRef.current.has(key);
  }, []);

  const cancelRequest = useCallback((key: string) => {
    activeKeysRef.current.delete(key);
    setActiveRequests(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setMessagesMap(prev => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setOverlaysSet(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  // Compute latest loading message if any
  const currentMessages = Array.from(messagesMap.values());
  const activeMessage = currentMessages.length > 0 ? currentMessages[currentMessages.length - 1] : null;
  const isAnyOverlayActive = overlaysSet.size > 0;

  return (
    <RequestManagerContext.Provider
      value={{
        executeRequest,
        isPending,
        activeRequests,
        activeMessage,
        cancelRequest
      }}
    >
      {children}

      {/* Global Visual Feedback Header / Progress Bar */}
      <AnimatePresence>
        {activeRequests.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className="fixed top-2 right-4 z-[9999] pointer-events-none flex items-center gap-2.5 px-3.5 py-2 bg-zinc-900/95 border border-emerald-500/40 text-emerald-400 rounded-xl shadow-2xl backdrop-blur-md text-xs font-semibold"
          >
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400 shrink-0" />
            <span>{activeMessage || `Processing request (${activeRequests.size} active)...`}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Heavy Operation Modal Overlay */}
      <AnimatePresence>
        {isAnyOverlayActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl space-y-4"
            >
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-zinc-100">Operation in Progress</h3>
                <p className="text-xs text-zinc-400">
                  {activeMessage || 'Please wait while the transaction is securely recorded...'}
                </p>
              </div>
              <div className="pt-2 text-[10px] text-zinc-500 font-mono">
                Global Request Manager • Locking redundant inputs
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </RequestManagerContext.Provider>
  );
};

export const useRequestManager = () => {
  const context = useContext(RequestManagerContext);
  if (!context) {
    throw new Error('useRequestManager must be used within a RequestManagerProvider');
  }
  return context;
};
