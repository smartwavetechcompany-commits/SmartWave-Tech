
import { toast } from 'sonner';
import { db, auth } from '../firebase';
import { collection, serverTimestamp, addDoc } from 'firebase/firestore';
import { safeStringify } from '../utils';



export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface AppError {
  message: string;
  code?: string;
  severity: ErrorSeverity;
  module: string;
  details?: any;
  timestamp: string;
  userId?: string;
  userEmail?: string;
}

/**
 * PRODUCTION-GRADE ERROR HANDLER
 * Centralizes logging and user notification.
 */
class ErrorService {
  private static instance: ErrorService;
  
  private constructor() {}

  public static getInstance(): ErrorService {
    if (!ErrorService.instance) {
      ErrorService.instance = new ErrorService();
    }
    return ErrorService.instance;
  }

  /**
   * Main entry point for handling errors throughout the app
   */
  public async handleError(error: any, context: { module: string; severity?: ErrorSeverity; silent?: boolean }) {
    const severity = context.severity || ErrorSeverity.MEDIUM;
    const message = error?.message || (typeof error === 'string' ? error : 'An unexpected error occurred');
    const code = error?.code || 'UNKNOWN_ERROR';
    
    const isQuotaOrBenign = 
      code === 'resource-exhausted' ||
      message.toLowerCase().includes('quota') ||
      message.toLowerCase().includes('resource-exhausted') ||
      message.toLowerCase().includes('backoff delay') ||
      message.toLowerCase().includes('websocket') ||
      message.toLowerCase().includes('offline') ||
      code === 'unavailable' ||
      code === 'network-request-failed';

    const appError: AppError = {
      message,
      code,
      severity,
      module: context.module,
      details: error?.stack || (typeof error === 'object' ? safeStringify(error) : error),
      timestamp: new Date().toISOString(),
      userId: auth.currentUser?.uid,
      userEmail: auth.currentUser?.email || undefined
    };

    if (isQuotaOrBenign) {
      // Suppress logging to console/firestore to prevent loop & quota exhaustion
      return appError;
    }

    // 1. Log to console for dev
    console.error(`[${context.module}] Error:`, error?.message || String(error));

    // 2. Log to Firestore if authenticated (background task)
    if (auth.currentUser) {
      this.logToFirestore(appError).catch(() => {});
    }

    // 3. Notify user if not silent
    if (!context.silent) {
      this.notifyUser(appError);
    }

    return appError;
  }

  private async logToFirestore(error: AppError) {
    try {
      // Use direct addDoc to avoid circular dependency with 'database' utility
      await addDoc(collection(db, 'systemLogs', 'errors', 'entries'), {
        ...error,
        createdAt: serverTimestamp()
      });
    } catch {
      // Silent catch to avoid recursive logging failures
    }
  }

  private notifyUser(error: AppError) {
    const toastId = `error-${error.code}-${error.module}`;
    
    toast.error(error.message, {
      id: toastId,
      description: `Source: ${error.module}`,
      duration: 5000
    });
  }
}

export const errorService = ErrorService.getInstance();
