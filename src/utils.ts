import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function safeStringify(obj: any): string {
  if (obj === undefined) return 'undefined';
  if (obj === null) return 'null';
  if (typeof obj !== 'object') return String(obj);

  const cache = new Set();
  
  function getSafeValue(val: any, depth: number = 0): any {
    // Prevent deep recursion
    if (depth > 5) return '[Max Depth Reached]';
    
    if (val === null || typeof val !== 'object') {
      return val;
    }

    if (cache.has(val)) {
      return '[Circular]';
    }
    cache.add(val);

    // Handle Errors specifically
    if (val instanceof Error || (val.message && val.stack)) {
      return {
        name: val.name || 'Error',
        message: val.message,
        code: val.code,
        stack: val.stack,
        details: val.details ? getSafeValue(val.details, depth + 1) : undefined
      };
    }

    // Handle Arrays
    if (Array.isArray(val)) {
      // Limit array size in logs
      if (val.length > 50) {
        return val.slice(0, 50).map(item => getSafeValue(item, depth + 1)).concat(['... and ' + (val.length - 50) + ' more items']);
      }
      return val.map(item => getSafeValue(item, depth + 1));
    }

    // Handle Plain Objects
    const safeObj: any = {};
    let count = 0;
    const MAX_KEYS = 50; // Limit keys to prevent hanging on massive objects
    
    for (const key in val) {
      if (Object.prototype.hasOwnProperty.call(val, key)) {
        if (count++ > MAX_KEYS) {
          safeObj['...'] = 'Truncated (' + Object.keys(val).length + ' total keys)';
          break;
        }
        
        // Skip potentially problematic internal properties (starting with _)
        if (key.startsWith('_')) continue;
        
        try {
          safeObj[key] = getSafeValue(val[key], depth + 1);
        } catch (e) {
          safeObj[key] = '[Unserializable Property]';
        }
      }
    }
    return safeObj;
  }

  try {
    const safeTarget = getSafeValue(obj);
    return JSON.stringify(safeTarget, null, 2);
  } catch (e) {
    try {
      if (obj.message) return `Error: ${obj.message}`;
      return String(obj);
    } catch (finalError) {
      return '[Unstringifiable Object]';
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

export function safeToDate(timestamp: any): Date {
  if (!timestamp) return new Date();
  if (timestamp instanceof Date) return timestamp;
  if (typeof timestamp.toDate === 'function') return timestamp.toDate();
  if (typeof timestamp === 'string' || typeof timestamp === 'number') {
    const d = new Date(timestamp);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  // Handle Firestore FieldValue or simple objects with seconds/nanoseconds
  if (timestamp.seconds !== undefined) {
    return new Date(timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1000000);
  }
  return new Date();
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
