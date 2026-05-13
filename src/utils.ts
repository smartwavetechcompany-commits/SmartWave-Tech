import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Performs a deep clone that is safe from circular references.
 * Useful for preparing data for Firestore or other serialization-heavy operations.
 */
export function deepCloneSafe(obj: any): any {
  if (obj === undefined) return undefined;
  if (obj === null) return null;
  if (typeof obj !== 'object') return obj;

  const stack = new WeakMap();
  
  function getSafeValue(val: any, depth: number = 0): any {
    // Prevent deep recursion
    if (depth > 12) return '[Max Depth Reached]';
    
    if (val === null || typeof val !== 'object') {
      return val;
    }

    // Handle Dates
    if (val instanceof Date) {
      return val.toISOString();
    }

    // Handle Errors
    if (val instanceof Error || (val.message && val.stack)) {
      return {
        name: val.name || 'Error',
        message: val.message,
        code: (val as any).code,
        stack: val.stack
      };
    }

    // Check circular references
    if (stack.has(val)) {
      return '[Circular Reference]';
    }
    
    // Add to stack before recursion
    try {
      stack.set(val, true);
    } catch (e) {
      // Some objects (like frozen ones) might fail WeakMap.set in older environments
      // but usually this is rare for the objects we handle.
      return '[Unserializable]';
    }

    let result: any;

    try {
      // Handle Arrays
      if (Array.isArray(val)) {
        if (val.length > 500) {
          result = val.slice(0, 500).map(item => getSafeValue(item, depth + 1)).concat([`... and ${val.length - 500} more items`]);
        } else {
          result = val.map(item => getSafeValue(item, depth + 1));
        }
      } else {
        // Handle Plain Objects
        const safeObj: any = {};
        let count = 0;
        const MAX_KEYS = 200;
        
        // Use Reflect.ownKeys or Object.getOwnPropertyNames to be more thorough
        // but Object.keys is usually safer for generic structures
        const keys = Object.keys(val);
        
        for (const key of keys) {
          if (count++ > MAX_KEYS) {
            safeObj['...'] = `Truncated (${keys.length} total keys)`;
            break;
          }
          
          if (key.startsWith('_') || key.startsWith('$')) continue;
          
          try {
            const value = val[key];
            if (typeof value === 'function') continue;
            safeObj[key] = getSafeValue(value, depth + 1);
          } catch (e) {
            safeObj[key] = '[Property Access Error]';
          }
        }
        result = safeObj;
      }
    } finally {
      // Remove from stack after recursion to allow same object appearing in DIFFERENT branches
      // but this is actually what causes circular structure errors in JSON.stringify if it's the SAME object
      // wait, actually, if it's the same object twice but NOT circular, JSON.stringify IS fine.
      // BUT if it's the same object identity multiple times, it's safer to keep it as [Circular] 
      // if we want to BE ABSOLUTELY SURE.
      // So we DON'T remove it from the stack if we want to avoid multiple refs to same identity.
      // Actually, JSON.stringify doesn't care about multiple refs to same object UNLESS it's circular.
      // But keeping it in stack is safer for performance and avoids re-processing.
    }
    
    return result;
  }

  return getSafeValue(obj);
}

export function safeStringify(obj: any): string {
  if (obj === undefined) return 'undefined';
  if (obj === null) return 'null';
  if (typeof obj !== 'object') return String(obj);

  try {
    const safeTarget = deepCloneSafe(obj);
    return JSON.stringify(safeTarget, null, 2);
  } catch (e) {
    try {
      // Final desperation fallback: serialize top level properties as strings
      const fallback: any = {};
      const keys = Object.keys(obj).slice(0, 50);
      for (const key of keys) {
        try {
          const val = obj[key];
          if (typeof val === 'function') continue;
          fallback[key] = String(val).slice(0, 100);
        } catch (inner) {
          fallback[key] = '[Error]';
        }
      }
      return JSON.stringify(fallback, null, 2);
    } catch (finalError) {
      return `[Circular or Unstringifiable Object: ${e instanceof Error ? e.message : 'Unknown'}]`;
    }
  }
}

export function formatCurrency(amount: number, currency: 'NGN' | 'USD' = 'NGN', exchangeRate: number = 1500) {
  const value = currency === 'USD' ? amount / exchangeRate : amount;
  
  if (currency === 'NGN') {
    return '₦' + new Intl.NumberFormat('en-NG', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function convertCurrency(amount: number, to: 'NGN' | 'USD', exchangeRate: number) {
  if (to === 'USD') return amount / exchangeRate;
  return amount;
}

export function exportToCSV(data: any[], filename: string) {
  if (data.length === 0) return;
  
  const headers = Object.keys(data[0]).join(',');
  const rows = data.map(obj => {
    return Object.values(obj).map(val => {
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    }).join(',');
  });
  
  const csvContent = [headers, ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.setAttribute('target', '_self');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
