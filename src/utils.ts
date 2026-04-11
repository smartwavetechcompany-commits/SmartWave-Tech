import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function safeStringify(obj: any): string {
  if (obj === undefined) return 'undefined';
  if (obj === null) return 'null';
  if (typeof obj !== 'object') return String(obj);

  // Extract safe properties if it's an error-like object to avoid circularity in internal state
  let target = obj;
  if (obj instanceof Error || (obj && typeof obj === 'object' && 'message' in obj && 'stack' in obj)) {
    target = {
      name: obj.name || 'Error',
      message: obj.message,
      stack: obj.stack,
      code: obj.code,
      details: obj.details,
      ...(typeof obj.toJSON === 'function' ? {} : obj) // Only spread if no toJSON to avoid triggering it
    };
  }

  try {
    const cache = new Set();
    return JSON.stringify(target, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (cache.has(value)) {
          return '[Circular]';
        }
        cache.add(value);

        // Handle nested errors
        if (value instanceof Error || (value && typeof value === 'object' && 'message' in value && 'stack' in value)) {
          return {
            name: value.name || 'Error',
            message: value.message,
            stack: value.stack,
            code: value.code,
            details: value.details
          };
        }
      }
      return value;
    }, 2);
  } catch (e) {
    try {
      // Final fallback: just get the message if it's an error, or a basic string representation
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
