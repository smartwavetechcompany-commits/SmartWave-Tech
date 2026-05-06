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

  const cache = new WeakSet();
  
  function getSafeValue(val: any, depth: number = 0): any {
    // Prevent deep recursion
    if (depth > 8) return '[Max Depth Reached]';
    
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

    if (cache.has(val)) {
      return '[Circular]';
    }
    
    // Only add objects/arrays to cache
    try {
      cache.add(val);
    } catch (e) {
      return '[Unserializable]';
    }

    // Handle Arrays
    if (Array.isArray(val)) {
      if (val.length > 100) {
        return val.slice(0, 100).map(item => getSafeValue(item, depth + 1)).concat([`... and ${val.length - 100} more items`]);
      }
      return val.map(item => getSafeValue(item, depth + 1));
    }

    // Handle Plain Objects
    const safeObj: any = {};
    let count = 0;
    const MAX_KEYS = 100;
    
    const keys = Object.keys(val);
    
    for (const key of keys) {
      if (count++ > MAX_KEYS) {
        safeObj['...'] = `Truncated (${keys.length} total keys)`;
        break;
      }
      
      if (key.startsWith('_') || key.startsWith('$')) continue;
      
      try {
        const value = val[key];
        safeObj[key] = getSafeValue(value, depth + 1);
      } catch (e) {
        safeObj[key] = '[Unserializable Property]';
      }
    }
    
    return safeObj;
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
      // Fallback: iterate top level at least
      const fallback: any = {};
      for (const key in obj) {
        if (typeof obj[key] !== 'function' && !key.startsWith('_')) {
          fallback[key] = String(obj[key]);
        }
      }
      return JSON.stringify(fallback, null, 2);
    } catch (finalError) {
      return `[Unstringifiable Object: ${e instanceof Error ? e.message : 'Unknown Error'}]`;
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
