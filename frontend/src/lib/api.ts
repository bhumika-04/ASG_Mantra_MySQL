/**
 * Centralized API Client
 * Handles all API requests with authentication
 */

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface ApiOptions extends RequestInit {
  requireAuth?: boolean;
  timeout?: number; // Timeout in milliseconds
}

/**
 * Fetch wrapper with authentication and timeout support
 */
async function apiFetch<T>(
  endpoint: string,
  options: ApiOptions = {}
): Promise<T> {
  const { requireAuth = true, timeout = 120000, ...fetchOptions } = options; // Default 2 minutes (120 seconds)

  // Check if body is FormData (file upload) - don't set Content-Type, let browser handle it
  const isFormData = fetchOptions.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(fetchOptions.headers as Record<string, string>),
  };

  // Add auth token if required
  if (requireAuth) {
    const token = localStorage.getItem('token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }));

      // Token expired or invalid — clear session and redirect to login
      if (response.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/';
        throw new Error('Session expired. Please log in again.');
      }

      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout / 1000} seconds. The file may be too large or the server is processing slowly.`);
    }

    throw error;
  }
}

/**
 * API Client
 */
export const api = {
  // Auth endpoints
  auth: {
    login: (email: string, password: string) =>
      apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
        requireAuth: false,
      }),
    logout: () => apiFetch('/api/auth/logout', { method: 'POST' }),
    me: () => apiFetch('/api/auth/me'),
  },

  // Dashboard endpoints
  auditLogs: {
    getAll: (params?: { action?: string; table_name?: string; user_id?: string; start_date?: string; end_date?: string; page?: number; page_size?: number }) => {
      const query = new URLSearchParams(
        Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v != null)) as Record<string, string>
      ).toString();
      return apiFetch(`/api/audit-logs${query ? `?${query}` : ''}`);
    },
    getStats: (params?: { days?: number }) => {
      const query = new URLSearchParams(params as any).toString();
      return apiFetch(`/api/audit-logs/stats${query ? `?${query}` : ''}`);
    },
  },

  dashboard: {
    getStats: () => apiFetch('/api/dashboard/stats'),
    getInventoryStats: () => apiFetch('/api/dashboard/inventory-stats'),
    getCharts: (params?: { start_date?: string; end_date?: string }) => {
      const q = params ? Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('&') : '';
      return apiFetch(`/api/dashboard/charts${q ? `?${q}` : ''}`);
    },
    getProductOverview: (params?: { search?: string; page?: number; page_size?: number }) => {
      const query = new URLSearchParams(params as any).toString();
      return apiFetch(`/api/dashboard/product-overview${query ? `?${query}` : ''}`);
    },
  },

  // Inventory endpoints
  inventory: {
    getAll: (params?: { search?: string; channel?: string; inventory_date?: string; page?: number; page_size?: number; low_stock_only?: boolean }) => {
      const query = new URLSearchParams(params as any).toString();
      return apiFetch(`/api/inventory${query ? `?${query}` : ''}`);
    },
    getDispatchOverview: (params?: { search?: string; inventory_date?: string; page?: number; page_size?: number }) => {
      const query = new URLSearchParams(params as any).toString();
      return apiFetch(`/api/inventory/dispatch-overview${query ? `?${query}` : ''}`);
    },
    getById: (id: number) => apiFetch(`/api/inventory/${id}`),
    getLowStock: (params?: { limit?: number; channel?: string }) => {
      const query = new URLSearchParams(params as any).toString();
      return apiFetch(`/api/inventory/low-stock${query ? `?${query}` : ''}`);
    },
    update: (id: number, data: any) =>
      apiFetch(`/api/inventory/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },

  // Amazon Sales Data analytics (queries AmazonSales table — VendorCSV / RK Excel uploads)
  amazonSalesData: {
    getAnalytics: (params?: { days?: number; start_date?: string; end_date?: string }) => {
      const p = Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== ''));
      const query = new URLSearchParams(p as any).toString();
      return apiFetch(`/api/upload/amazon-data/analytics${query ? `?${query}` : ''}`);
    },
    getProducts: (params?: { search?: string; page?: number; page_size?: number; start_date?: string; end_date?: string }) => {
      const p = Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== ''));
      const query = new URLSearchParams(p as any).toString();
      return apiFetch(`/api/upload/amazon-data/products${query ? `?${query}` : ''}`);
    },
  },

  // Blinkit Sales Data analytics (queries BlinkitSales table — daily CSV uploads)
  blinkitSalesData: {
    getAnalytics: (params?: { days?: number; start_date?: string; end_date?: string }) => {
      const p = Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== ''));
      const query = new URLSearchParams(p as any).toString();
      return apiFetch(`/api/upload/blinkit-data/analytics${query ? `?${query}` : ''}`);
    },
    getProducts: (params?: { search?: string; page?: number; page_size?: number; start_date?: string; end_date?: string }) => {
      const p = Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== ''));
      const query = new URLSearchParams(p as any).toString();
      return apiFetch(`/api/upload/blinkit-data/products${query ? `?${query}` : ''}`);
    },
  },

  // Purchase Order endpoints
  purchaseOrders: {
    getAll: (params?: any) => {
      const query = new URLSearchParams(params).toString();
      return apiFetch(`/api/purchase-orders${query ? `?${query}` : ''}`);
    },
    getById: (id: number) => apiFetch(`/api/purchase-orders/${id}`),
    create: (data: any) =>
      apiFetch('/api/purchase-orders', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateStatus: (id: number, data: any) =>
      apiFetch(`/api/purchase-orders/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    updateAmazonItemStatus: (itemId: number, data: any) =>
      apiFetch(`/api/purchase-orders/amazon-item/${itemId}/status`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    updateBlinkitItemStatus: (itemId: number, data: any) =>
      apiFetch(`/api/purchase-orders/blinkit-item/${itemId}/status`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    updateAmazonItemAcceptedQty: (itemId: number, accepted_qty: number) =>
      apiFetch(`/api/purchase-orders/amazon-item/${itemId}/accepted-qty`, {
        method: 'PUT',
        body: JSON.stringify({ accepted_qty }),
      }),
    updateAmazonItemReceivedQty: (itemId: number, received_qty: number) =>
      apiFetch(`/api/purchase-orders/amazon-item/${itemId}/received-qty`, {
        method: 'PUT',
        body: JSON.stringify({ received_qty }),
      }),
    updateBlinkitItemAcceptedQty: (itemId: number, accepted_qty: number) =>
      apiFetch(`/api/purchase-orders/blinkit-item/${itemId}/accepted-qty`, {
        method: 'PUT',
        body: JSON.stringify({ accepted_qty }),
      }),
    updateAmazonPOStatus: (poId: number, data: any) =>
      apiFetch(`/api/purchase-orders/amazon-po/${poId}/po-status`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    updateBlinkitPOStatus: (poId: number, data: any) =>
      apiFetch(`/api/purchase-orders/blinkit-po/${poId}/po-status`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    getAmazon: (params?: any) => {
      const query = new URLSearchParams(params).toString();
      return apiFetch(`/api/purchase-orders/amazon${query ? `?${query}` : ''}`);
    },
    getAmazonStats: () => apiFetch('/api/purchase-orders/amazon/stats'),
    getBlinkit: (params?: any) => {
      const query = new URLSearchParams(params).toString();
      return apiFetch(`/api/purchase-orders/blinkit${query ? `?${query}` : ''}`);
    },
    getBlinkitStats: () => apiFetch('/api/purchase-orders/blinkit/stats'),
  },

  // Blinkit facility-level inventory
  blinkitInventory: {
    getAll: (params?: { search?: string; facility?: string; report_date?: string; page?: number; page_size?: number }) => {
      const query = new URLSearchParams(params as any).toString();
      return apiFetch(`/api/upload/blinkit-data/inventory${query ? `?${query}` : ''}`);
    },
  },

  // Product endpoints
  products: {
    getAll: (params?: any) => {
      const query = new URLSearchParams(params).toString();
      return apiFetch(`/api/products${query ? `?${query}` : ''}`);
    },
    getById: (id: number) => apiFetch(`/api/products/${id}`),
    create: (data: any) =>
      apiFetch('/api/products', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: number, data: any) =>
      apiFetch(`/api/products/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: number) =>
      apiFetch(`/api/products/${id}`, { method: 'DELETE' }),
    linkBlinkit: (blinkitId: string, targetProductId: number) =>
      apiFetch('/api/products/link-blinkit', {
        method: 'POST',
        body: JSON.stringify({ blinkit_id: blinkitId, target_product_id: targetProductId }),
      }),
    linkAmazon: (asin: string, targetProductId: number) =>
      apiFetch('/api/products/link-amazon', {
        method: 'POST',
        body: JSON.stringify({ asin, target_product_id: targetProductId }),
      }),
  },

  // Warehouse endpoints
  warehouses: {
    getAmazon: () => apiFetch('/api/warehouses/amazon'),
    getBlinkit: () => apiFetch('/api/warehouses/blinkit'),
    create: (_channel: string, data: any) =>
      apiFetch('/api/warehouses', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    uploadAmazon: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch('/api/warehouses/amazon/upload', {
        method: 'POST',
        body: formData,
        headers: {},
        timeout: 300000, // 5 minutes
      });
    },
    uploadBlinkit: (file: File, warehouseType: 'Frontend' | 'Backend') => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch(`/api/warehouses/blinkit/upload/${warehouseType}`, {
        method: 'POST',
        body: formData,
        headers: {},
        timeout: 300000, // 5 minutes
      });
    },
  },

  // Alerts endpoints
  alerts: {
    getAll: (params?: { severity?: string; is_resolved?: boolean; page?: number; page_size?: number }) => {
      const query = new URLSearchParams(params as any).toString();
      return apiFetch(`/api/alerts${query ? `?${query}` : ''}`);
    },
    resolve: (id: number, remarks?: string) =>
      apiFetch(`/api/alerts/${id}/resolve`, {
        method: 'PUT',
        body: JSON.stringify({ remarks }),
      }),
    sync: () =>
      apiFetch('/api/alerts/sync', { method: 'POST' }),
  },

  // User endpoints
  users: {
    getAll: () => apiFetch('/api/users'),
    getById: (id: string) => apiFetch(`/api/users/${id}`),
    create: (data: any) =>
      apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: any) =>
      apiFetch(`/api/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      apiFetch(`/api/users/${id}`, { method: 'DELETE' }),
  },

  // Role endpoints
  roles: {
    getAll: () => apiFetch('/api/roles'),
    getById: (id: string) => apiFetch(`/api/roles/${id}`),
    create: (data: any) =>
      apiFetch('/api/roles', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: any) =>
      apiFetch(`/api/roles/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      apiFetch(`/api/roles/${id}`, { method: 'DELETE' }),
  },

  // Upload endpoints (with extended timeout for large files)
  upload: {
    amazonSales: (file: File, reportDateOverride?: string) => {
      const formData = new FormData();
      formData.append('file', file);
      if (reportDateOverride) formData.append('report_date_override', reportDateOverride);
      return apiFetch('/api/upload/amazon-data/sales', {
        method: 'POST',
        body: formData,
        headers: {}, // Let browser set Content-Type for FormData
        timeout: 300000, // 5 minutes for large file uploads
      });
    },
    amazonPurchaseOrders: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch('/api/upload/amazon-data/purchase-orders', {
        method: 'POST',
        body: formData,
        headers: {},
        timeout: 300000, // 5 minutes
      });
    },
    amazonSalesPreview: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch('/api/upload/amazon-data/sales/preview', { method: 'POST', body: formData, headers: {}, timeout: 60000 });
    },
    amazonInventoryPreview: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch('/api/upload/amazon-data/inventory/preview', { method: 'POST', body: formData, headers: {}, timeout: 60000 });
    },
    amazonPurchaseOrdersPreview: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch('/api/upload/amazon-data/purchase-orders/preview', { method: 'POST', body: formData, headers: {}, timeout: 60000 });
    },
    blinkitSales: (file: File, reportDateOverride?: string) => {
      const formData = new FormData();
      formData.append('file', file);
      if (reportDateOverride) formData.append('report_date_override', reportDateOverride);
      return apiFetch('/api/upload/blinkit-data/sales', {
        method: 'POST',
        body: formData,
        headers: {},
        timeout: 300000, // 5 minutes
      });
    },
    blinkitPurchaseOrders: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch('/api/upload/blinkit-data/purchase-orders', {
        method: 'POST',
        body: formData,
        headers: {},
        timeout: 300000, // 5 minutes
      });
    },
    blinkitSalesPreview: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch('/api/upload/blinkit-data/sales/preview', { method: 'POST', body: formData, headers: {}, timeout: 60000 });
    },
    blinkitInventoryPreview: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch('/api/upload/blinkit-data/inventory/preview', { method: 'POST', body: formData, headers: {}, timeout: 60000 });
    },
    blinkitPurchaseOrdersPreview: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch('/api/upload/blinkit-data/purchase-orders/preview', { method: 'POST', body: formData, headers: {}, timeout: 60000 });
    },
    blinkitPOExtractPdf: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch('/api/upload/blinkit-data/purchase-orders/extract-pdf', {
        method: 'POST',
        body: formData,
        headers: {},
        timeout: 300000, // 5 minutes for PDF parsing
      });
    },
    blinkitPOConfirmPdf: (data: { header: Record<string, unknown>; items: Record<string, unknown>[]; status?: string }) =>
      apiFetch('/api/upload/blinkit-data/purchase-orders/confirm-pdf', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    amazonPOExtractPdf: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch('/api/upload/amazon-data/purchase-orders/extract-pdf', {
        method: 'POST',
        body: formData,
        headers: {},
        timeout: 300000, // 5 minutes for PDF parsing
      });
    },
    amazonPOConfirmPdf: (data: { header: Record<string, unknown>; items: Record<string, unknown>[]; status?: string }) =>
      apiFetch('/api/upload/amazon-data/purchase-orders/confirm-pdf', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    amazonInventory: (file: File, reportDateOverride?: string) => {
      const formData = new FormData();
      formData.append('file', file);
      if (reportDateOverride) formData.append('report_date_override', reportDateOverride);
      return apiFetch('/api/upload/amazon-data/inventory', {
        method: 'POST',
        body: formData,
        headers: {},
        timeout: 300000, // 5 minutes
      });
    },
    blinkitInventory: (file: File, reportDateOverride?: string) => {
      const formData = new FormData();
      formData.append('file', file);
      if (reportDateOverride) formData.append('report_date_override', reportDateOverride);
      return apiFetch('/api/upload/blinkit-data/inventory', {
        method: 'POST',
        body: formData,
        headers: {},
        timeout: 300000, // 5 minutes
      });
    },
    inventory: (file: File, inventoryDate?: string) => {
      const formData = new FormData();
      formData.append('file', file);
      const qs = inventoryDate ? `?inventory_date=${encodeURIComponent(inventoryDate)}` : '';
      return apiFetch(`/api/upload/inventory${qs}`, {
        method: 'POST',
        body: formData,
        headers: {},
        timeout: 300000, // 5 minutes for ASG packed/unpacked uploads
      });
    },
    inventoryPreview: (file: File, inventoryDate?: string) => {
      const formData = new FormData();
      formData.append('file', file);
      const qs = inventoryDate ? `?inventory_date=${encodeURIComponent(inventoryDate)}` : '';
      return apiFetch(`/api/upload/inventory/preview${qs}`, {
        method: 'POST',
        body: formData,
        headers: {},
        timeout: 60000,
      });
    },
    products: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch('/api/products/upload', {
        method: 'POST',
        body: formData,
        headers: {},
        timeout: 300000,
      });
    },
    productsPreview: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch('/api/products/preview', {
        method: 'POST',
        body: formData,
        headers: {},
        timeout: 60000,
      });
    },
  },

  // Distributor endpoints
  distributors: {
    getAll: (params?: { channel?: string; active_only?: boolean }) => {
      const query = new URLSearchParams(params as any).toString();
      return apiFetch(`/api/distributors${query ? `?${query}` : ''}`);
    },
    create: (data: any) =>
      apiFetch('/api/distributors', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) =>
      apiFetch(`/api/distributors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) =>
      apiFetch(`/api/distributors/${id}`, { method: 'DELETE' }),

    getFacilities: (params?: { distributor_id?: number; facility_type?: string; active_only?: boolean }) => {
      const query = new URLSearchParams(params as any).toString();
      return apiFetch(`/api/distributors/facilities${query ? `?${query}` : ''}`);
    },
    createFacility: (data: any) =>
      apiFetch('/api/distributors/facilities', { method: 'POST', body: JSON.stringify(data) }),
    updateFacility: (id: number, data: any) =>
      apiFetch(`/api/distributors/facilities/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteFacility: (id: number) =>
      apiFetch(`/api/distributors/facilities/${id}`, { method: 'DELETE' }),

    getAsgWarehouses: (params?: { active_only?: boolean }) => {
      const query = new URLSearchParams(params as any).toString();
      return apiFetch(`/api/distributors/asg-warehouses${query ? `?${query}` : ''}`);
    },
    createAsgWarehouse: (data: any) =>
      apiFetch('/api/distributors/asg-warehouses', { method: 'POST', body: JSON.stringify(data) }),
    updateAsgWarehouse: (id: number, data: any) =>
      apiFetch(`/api/distributors/asg-warehouses/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteAsgWarehouse: (id: number) =>
      apiFetch(`/api/distributors/asg-warehouses/${id}`, { method: 'DELETE' }),
  },

  // Distributor Stock endpoints (weekly stock report from Eagle/RK)
  distributorStock: {
    getAll: (params?: { search?: string; report_date?: string; date_from?: string; date_to?: string; region?: string; distributor_id?: number; page?: number; page_size?: number }) => {
      const query = new URLSearchParams(params as any).toString();
      return apiFetch(`/api/upload/blinkit-data/distributor-stock${query ? `?${query}` : ''}`);
    },
    preview: (file: File, options: { distributorId?: number; channel?: string; reportDate?: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      const params = new URLSearchParams();
      if (options.channel) params.set('channel', options.channel);
      else if (options.distributorId) params.set('distributor_id', String(options.distributorId));
      if (options.reportDate) params.set('report_date', options.reportDate);
      const qs = params.toString() ? `?${params.toString()}` : '';
      return apiFetch(`/api/upload/blinkit-data/distributor-stock/preview${qs}`, {
        method: 'POST',
        body: formData,
        headers: {},
      });
    },
    upload: (file: File, options: { distributorId?: number; channel?: string; reportDate?: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      const params = new URLSearchParams();
      if (options.channel) params.set('channel', options.channel);
      else if (options.distributorId) params.set('distributor_id', String(options.distributorId));
      if (options.reportDate) params.set('report_date', options.reportDate);
      const qs = params.toString() ? `?${params.toString()}` : '';
      return apiFetch(`/api/upload/blinkit-data/distributor-stock${qs}`, {
        method: 'POST',
        body: formData,
        headers: {},
        timeout: 300000,
      });
    },
  },

  // Notifications endpoints
  notifications: {
    getAll: () => apiFetch('/api/notifications'),
    markAsRead: (id: number) =>
      apiFetch(`/api/notifications/${id}/read`, { method: 'PUT' }),
  },
};

export default api;
