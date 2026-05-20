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

  const stack = new Map();
  
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

    // Check circular references
    if (stack.has(val)) {
      return '[Circular Reference]';
    }

    // Add to stack before recursion
    try {
      stack.set(val, true);
    } catch (e) {
      return '[Unserializable]';
    }

    // Check if it's a non-plain, non-array object
    const isArray = Array.isArray(val);
    const proto = Object.getPrototypeOf(val);
    const isPlain = proto === Object.prototype || proto === null;

    let constructorName = '';
    try {
      if (val.constructor && typeof val.constructor === 'function') {
        constructorName = val.constructor.name || '';
      }
    } catch (e) {
      // Ignore errors when accessing constructor
    }

    // If it has a custom constructor name that is NOT Object or Array
    const isCustomClass = constructorName && constructorName !== 'Object' && constructorName !== 'Array';

    if (isCustomClass || (!isPlain && !isArray)) {
      // Try to handle special types
      try {
        if ('seconds' in val && 'nanoseconds' in val) {
          return (val as any).toDate?.()?.toISOString() || String(val);
        }
        
        if ('path' in val && typeof (val as any).path === 'string') {
          return `[Firestore Reference: ${val.path}]`;
        }

        if (constructorName) {
          if (constructorName === 'FieldValue' || constructorName === 'rt' || constructorName === 'Y2' || constructorName === 'Ka') {
            return '[Firestore FieldValue]';
          }
          return `[Object ${constructorName}]`;
        }
      } catch (e) {
        // Fallback
      }
      return '[Special Object]';
    }

    // Handle Errors
    if (val instanceof Error || (val.message && val.stack)) {
      stack.delete(val);
      return {
        name: val.name || 'Error',
        message: val.message,
        code: (val as any).code,
        stack: val.stack
      };
    }

    let result: any;

    try {
      // Handle Arrays
      if (isArray) {
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
      stack.delete(val);
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
