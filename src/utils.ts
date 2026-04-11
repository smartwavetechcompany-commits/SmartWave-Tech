import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function safeStringify(obj: any): string {
  if (obj === undefined) return 'undefined';
  if (obj === null) return 'null';
  if (typeof obj !== 'object') return String(obj);

  // Create a safe version of the object to stringify
  const cache = new Set();
  
  function getSafeValue(val: any): any {
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
        details: val.details ? getSafeValue(val.details) : undefined
      };
    }

    // Handle Arrays
    if (Array.isArray(val)) {
      return val.map(item => getSafeValue(item));
    }

    // Handle Plain Objects
    const safeObj: any = {};
    for (const key in val) {
      if (Object.prototype.hasOwnProperty.call(val, key)) {
        // Skip potentially problematic internal properties (starting with _)
        if (key.startsWith('_')) continue;
        
        try {
          safeObj[key] = getSafeValue(val[key]);
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
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
