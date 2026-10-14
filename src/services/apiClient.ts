/**
 * Resolves the backend API base URL for client requests.
 * 
 * In production when the frontend and backend are hosted separately,
 * VITE_API_BASE_URL points to the user-controlled Cloud Run backend.
 * In local development or same-origin mode, it falls back to relative paths ('').
 */
export const getApiBaseUrl = (): string => {
  if (typeof window !== 'undefined') {
    const customUrl = (window as any).__VITE_API_BASE_URL__ || (window as any)?.__ENV__?.VITE_API_BASE_URL;
    if (customUrl && typeof customUrl === 'string' && customUrl.trim().length > 0) {
      return customUrl.trim().replace(/\/+$/, '');
    }
  }
  if (typeof process !== 'undefined' && process.env) {
    const customUrl = process.env.VITE_API_BASE_URL;
    if (customUrl && typeof customUrl === 'string' && customUrl.trim().length > 0) {
      return customUrl.trim().replace(/\/+$/, '');
    }
  }
  return '';
};

/**
 * Builds the full API URL for a given endpoint.
 */
export const apiUrl = (endpoint: string): string => {
  const base = getApiBaseUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${cleanEndpoint}`;
};
