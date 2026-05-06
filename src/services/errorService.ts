
import { toast } from 'sonner';
import { db, auth } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
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
    const message = error.message || 'An unexpected error occurred';
    
    const appError: AppError = {
      message,
      code: error.code || 'UNKNOWN_ERROR',
      severity,
      module: context.module,
      details: error.stack || (typeof error === 'object' ? safeStringify(error) : error),
      timestamp: new Date().toISOString(),
      userId: auth.currentUser?.uid,
      userEmail: auth.currentUser?.email || undefined
    };

    // 1. Log to console for dev
    console.error(`[${context.module}] Error:`, error);

    // 2. Log to Firestore if authenticated (background task)
    if (auth.currentUser) {
      this.logToFirestore(appError).catch(console.error);
    }

    // 3. Notify user if not silent
    if (!context.silent) {
      this.notifyUser(appError);
    }

    return appError;
  }

  private async logToFirestore(error: AppError) {
    try {
      await addDoc(collection(db, 'systemLogs', 'errors', 'entries'), {
        ...error,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      // If logging itself fails, don't recurse infinitely
      console.error('Failed to log error to Firestore:', e);
    }
  }

  private notifyUser(error: AppError) {
    const toastId = `error-${error.code}-${error.module}`;
    
    if (error.severity === ErrorSeverity.CRITICAL) {
      toast.error('Critical System Error', {
        description: error.message,
        duration: Infinity,
        id: toastId,
        action: {
          label: 'Reload',
          onClick: () => window.location.reload()
        }
      });
    } else {
      toast.error(error.message, {
        id: toastId,
        description: `Source: ${error.module}`
      });
    }
  }
}

export const errorService = ErrorService.getInstance();
