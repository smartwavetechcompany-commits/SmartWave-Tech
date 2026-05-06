
import { safeStringify } from '../utils';
import { errorService, ErrorSeverity } from './errorService';

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
  module?: string;
}

/**
 * PRODUCTION-GRADE API CLIENT
 * Centralizes HTTP communication and error handling.
 */
class ApiClient {
  private baseUrl: string = '';
  private defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  constructor() {
    // In a real app, this would come from env
    this.baseUrl = (import.meta as any).env?.VITE_API_URL || '';
  }

  public setBaseUrl(url: string) {
    this.baseUrl = url;
  }

  public setHeader(key: string, value: string) {
    this.defaultHeaders[key] = value;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { params, module = 'API', ...fetchOptions } = options;
    
    // 1. Build URL with query params
    let url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    // 2. Merge headers
    const headers = {
      ...this.defaultHeaders,
      ...fetchOptions.headers
    };

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers
      });

      // 3. Handle non-OK responses
      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          errorData = { message: response.statusText };
        }
        
        const error = new Error(errorData.message || `HTTP Error ${response.status}`);
        (error as any).code = `HTTP_${response.status}`;
        (error as any).status = response.status;
        (error as any).data = errorData;
        throw error;
      }

      // 4. Parse JSON response
      if (response.status === 204) return {} as T;
      return await response.json();

    } catch (error: any) {
      // 5. Global error handling
      await errorService.handleError(error, {
        module,
        severity: error.status >= 500 ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM
      });
      throw error;
    }
  }

  public get<T>(path: string, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  public post<T>(path: string, body?: any, options?: RequestOptions) {
    return this.request<T>(path, { 
      ...options, 
      method: 'POST', 
      body: body ? (typeof body === 'string' ? body : safeStringify(body)) : undefined 
    });
  }

  public put<T>(path: string, body?: any, options?: RequestOptions) {
    return this.request<T>(path, { 
      ...options, 
      method: 'PUT', 
      body: body ? (typeof body === 'string' ? body : safeStringify(body)) : undefined 
    });
  }

  public patch<T>(path: string, body?: any, options?: RequestOptions) {
    return this.request<T>(path, { 
      ...options, 
      method: 'PATCH', 
      body: body ? (typeof body === 'string' ? body : safeStringify(body)) : undefined 
    });
  }

  public delete<T>(path: string, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
