import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function safeStringify(obj: any): string {
  try {
    const cache = new Set();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (cache.has(value)) {
          return '[Circular]';
        }
        cache.add(value);
      }
      return value;
    });
  } catch (e) {
    return "Error stringifying object: " + String(obj);
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
