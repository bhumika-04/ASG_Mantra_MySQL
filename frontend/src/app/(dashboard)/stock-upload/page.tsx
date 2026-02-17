'use client';

import { useState, useEffect, useRef } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  Package, Plus, Download, Table, Trash2, CheckCircle2, AlertCircle,
  FileText, Upload, Eye, XCircle, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';

interface Product {
  id: number;
  productName: string;
  asgSku: string;
}

interface AsgWarehouse {
  id: number;
  warehouseName: string;
  city: string | null;
  state: string | null;
  active: boolean;
}

interface ManualEntry {
  id: string;
  productId: number;
  productName: string;
  asgSku: string;
  warehouseId: number;
  warehouse: string;
  packedQty: number;
  unpackedQty: number;
}

interface PreviewRow {
  rowNumber: number;
  status: 'valid' | 'sku_not_found';
  reason: string | null;
  asgSku: string;
  productName: string | null;
  packedQty: number;
  unpackedQty: number;
  warehouse: string | null;
  warehouseFound: boolean;
  channel: string;
}

interface PreviewResult {
  success: boolean;
  totalRows: number;
  valid: number;
  skuNotFound: number;
  rows: PreviewRow[];
}

interface UploadResult {
  success: boolean;
  message: string;
  data: {
    rows_created: number;
    rows_updated: number;
    rows_skipped: number;
    total_rows: number;
    errors?: string[];
  };
}

export default function InventoryUploadPage() {
  const [activeTab, setActiveTab] = useState('excel');
  const [isUploading, setIsUploading] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<AsgWarehouse[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [productSearch, setProductSearch] = useState('');
  const [warehouseSearch, setWarehouseSearch] = useState('');
  const [formData, setFormData] = useState({
    productId: 0,
    productName: '',
    asgSku: '',
    warehouseId: 0,
    warehouse: '',
    packedQty: 0,
    unpackedQty: 0,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('token');
        const [productsData, warehousesData] = await Promise.all([
          api.products.getAll(),
          fetch('http://localhost:8000/api/distributors/asg-warehouses?active_only=true', {
            headers: { 'Authorization': `Bearer ${token}` }
          }).then(r => r.json()),
        ]);
        const productsArray = Array.isArray(productsData) ? productsData : ((productsData as any)?.items || []);
        const warehousesArray = Array.isArray(warehousesData) ? warehousesData : ((warehousesData as any)?.items || []);

        setProducts(productsArray);
        setWarehouses(warehousesArray);
      } catch (error) {
        console.error('Error fetching data:', error);
        toast.error('Failed to load products and warehouses');
      } finally {
        setLoadingData(false);
      }
    };
    fetchData();
  }, []);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext || '')) {
      toast.error('Invalid file type. Please upload CSV or Excel file.');
      return;
    }

    setSelectedFile(file);
    setPreviewResult(null);
    setUploadResult(null);

    try {
      setIsPreviewing(true);
      const result = await api.upload.inventoryPreview(file) as PreviewResult;
      setPreviewResult(result);
    } catch (error: any) {
      toast.error(error.message || 'Failed to preview file');
      setSelectedFile(null);
    } finally {
      setIsPreviewing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleConfirmUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    try {
      const result = await api.upload.inventory(selectedFile) as UploadResult;
      setUploadResult(result);
      setPreviewResult(null);
      setSelectedFile(null);
      toast.success(
        `Upload complete: ${result.data.rows_created} created, ${result.data.rows_updated} updated`
      );
    } catch (error: any) {
      toast.error(error.message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancelPreview = () => {
    setPreviewResult(null);
    setSelectedFile(null);
    setUploadResult(null);
  };

  const handleDownloadTemplate = () => {
    const headers = ['Product Name', 'ASG SKU ID', 'Packed Qty', 'Unpacked Qty', 'Warehouse'];
    const sampleData = [
      ['Epsom Salt 1KG', 'ASG-OM-EPSOM-1KG', '150', '50', 'ASG Main'],
      ['Rosemary Oil 15ML', 'ASG-OM-ROSE-15ML', '200', '0', 'ASG Main'],
      ['Tea Tree Oil 15ML', 'ASG-OM-TT-15ML', '75', '125', 'ASG Main'],
    ];

    const csvContent = [headers.join(','), ...sampleData.map(row => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inventory_upload_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success('Template downloaded');
  };

  const handleAddEntry = () => {
    if (!formData.productId) {
      toast.error('Please select a product');
      return;
    }
    if (!formData.warehouseId) {
      toast.error('Please select a warehouse');
      return;
    }

    const newEntry: ManualEntry = {
      id: Date.now().toString(),
      productId: formData.productId,
      productName: formData.productName,
      asgSku: formData.asgSku,
      warehouseId: formData.warehouseId,
      warehouse: formData.warehouse,
      packedQty: formData.packedQty,
      unpackedQty: formData.unpackedQty,
    };

    setManualEntries([...manualEntries, newEntry]);
    setFormData({
      productId: 0,
      productName: '',
      asgSku: '',
      warehouseId: 0,
      warehouse: '',
      packedQty: 0,
      unpackedQty: 0,
    });
    setProductSearch('');
    setWarehouseSearch('');
    toast.success('Entry added successfully!');
  };

  const handleProductSelect = (productId: string) => {
    const product = products.find(p => p.id === parseInt(productId));
    if (product) {
      setFormData({
        ...formData,
        productId: product.id,
        productName: product.productName,
        asgSku: product.asgSku,
      });
    }
  };

  const handleWarehouseSelect = (warehouseId: string) => {
    const warehouse = warehouses.find(w => w.id === parseInt(warehouseId));
    if (warehouse) {
      setFormData({
        ...formData,
        warehouseId: warehouse.id,
        warehouse: warehouse.warehouseName,
      });
    }
  };

  const handleRemoveEntry = (id: string) => {
    setManualEntries(manualEntries.filter(entry => entry.id !== id));
  };

  const handleSubmitManualEntries = async () => {
    if (manualEntries.length === 0) {
      toast.error('No entries to submit');
      return;
    }

    setIsUploading(true);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        toast.error('Authentication required');
        return;
      }

      const headers = ['ASG SKU ID', 'Packed Qty', 'Unpacked Qty', 'Warehouse'];
      const csvContent = [
        headers.join(','),
        ...manualEntries.map(entry =>
          [entry.asgSku, entry.packedQty, entry.unpackedQty, entry.warehouse].join(',')
        ),
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const file = new File([blob], 'manual_entries.csv', { type: 'text/csv' });

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('http://localhost:8000/api/upload/inventory', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        setUploadResult(result);
        setManualEntries([]);
        toast.success(`Submitted ${result.data.rows_updated + result.data.rows_created} entries`);
      } else {
        toast.error(result.detail || 'Submission failed');
      }
    } catch (error) {
      console.error('Submit error:', error);
      toast.error('Failed to submit entries');
    } finally {
      setIsUploading(false);
    }
  };

  const filteredProducts = products.filter(p =>
    p.productName.toLowerCase().includes(productSearch.toLowerCase()) ||
    p.asgSku.toLowerCase().includes(productSearch.toLowerCase())
  );

  const filteredAsgWarehouses = warehouses.filter(w =>
    w.warehouseName.toLowerCase().includes(warehouseSearch.toLowerCase())
  );

  return (
    <ProtectedRoute>
      <div className="p-6">
        {/* Upload Result */}
        {uploadResult && (
          <Card className={`mb-6 ${uploadResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                {uploadResult.success ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                )}
                <div className="flex-1">
                  <p className={`font-medium ${uploadResult.success ? 'text-green-800' : 'text-red-800'}`}>
                    {uploadResult.message}
                  </p>
                  <div className="mt-2 grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Created:</span>{' '}
                      <span className="font-medium">{uploadResult.data.rows_created}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Updated:</span>{' '}
                      <span className="font-medium">{uploadResult.data.rows_updated}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Skipped:</span>{' '}
                      <span className="font-medium">{uploadResult.data.rows_skipped}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Total:</span>{' '}
                      <span className="font-medium">{uploadResult.data.total_rows}</span>
                    </div>
                  </div>
                  {uploadResult.data.errors && uploadResult.data.errors.length > 0 && (
                    <div className="mt-3 p-2 bg-yellow-100 rounded text-xs text-yellow-800">
                      <p className="font-medium mb-1">Errors:</p>
                      <ul className="list-disc list-inside">
                        {uploadResult.data.errors.slice(0, 5).map((err, idx) => (
                          <li key={idx}>{err}</li>
                        ))}
                        {uploadResult.data.errors.length > 5 && (
                          <li>...and {uploadResult.data.errors.length - 5} more</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className={`grid grid-cols-1 ${activeTab === 'manual' ? '' : 'lg:grid-cols-3'} gap-6`}>
          <div className={activeTab === 'manual' ? '' : 'lg:col-span-2'}>
            <Card className="h-full">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-5 w-5 text-primary" />
                    <CardTitle>Upload Inventory Data</CardTitle>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                    <Download className="h-4 w-4 mr-2" />
                    Download Template
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="excel" onValueChange={setActiveTab} className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="excel">Excel Upload</TabsTrigger>
                    <TabsTrigger value="manual">Add Manually</TabsTrigger>
                  </TabsList>

                  <TabsContent value="excel" className="space-y-4 mt-6">
                    {/* Step 1: File selection (shown when no preview) */}
                    {!previewResult && (
                      <>
                        <div
                          className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/30 rounded-lg py-32 px-8 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          {isPreviewing ? (
                            <>
                              <Eye className="h-10 w-10 text-muted-foreground mb-3 animate-pulse" />
                              <p className="text-sm font-medium">Validating file…</p>
                              <p className="text-xs text-muted-foreground mt-1">Checking products and warehouses</p>
                            </>
                          ) : (
                            <>
                              <Upload className="h-10 w-10 text-muted-foreground mb-3" />
                              <p className="text-sm font-medium">Drag and drop your inventory file here, or click to browse</p>
                              <p className="text-xs text-muted-foreground mt-1">Supported: .xlsx, .xls, .csv (max 10 MB)</p>
                            </>
                          )}
                        </div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".csv,.xlsx,.xls"
                          className="hidden"
                          onChange={handleFileSelect}
                        />

                        <Card className="bg-muted/30 border-dashed">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <Table className="h-4 w-4" />
                              Expected Columns
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="pt-0">
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="secondary">ASG SKU ID</Badge>
                              <Badge variant="secondary">Packed Qty</Badge>
                              <Badge variant="secondary">Unpacked Qty</Badge>
                              <Badge variant="outline">Product Name (optional)</Badge>
                              <Badge variant="outline">Warehouse (optional)</Badge>
                              <Badge variant="outline">Channel (optional)</Badge>
                            </div>
                          </CardContent>
                        </Card>
                      </>
                    )}

                    {/* Step 2: Preview table */}
                    {previewResult && (
                      <div className="space-y-4">
                        {/* Summary bar */}
                        <div className="flex items-center justify-between p-3 bg-muted/40 rounded-lg">
                          <div className="flex items-center gap-4 text-sm">
                            <span className="font-medium">{previewResult.totalRows} rows found</span>
                            <span className="flex items-center gap-1 text-green-700">
                              <CheckCircle2 className="h-4 w-4" />
                              {previewResult.valid} valid
                            </span>
                            {previewResult.skuNotFound > 0 && (
                              <span className="flex items-center gap-1 text-red-600">
                                <XCircle className="h-4 w-4" />
                                {previewResult.skuNotFound} SKU not found
                              </span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={handleCancelPreview} disabled={isUploading}>
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={handleConfirmUpload}
                              disabled={isUploading || previewResult.valid === 0}
                            >
                              {isUploading
                                ? 'Uploading…'
                                : `Confirm & Upload ${previewResult.valid} row${previewResult.valid !== 1 ? 's' : ''}`}
                            </Button>
                          </div>
                        </div>

                        {/* Preview rows table */}
                        <div className="overflow-x-auto rounded-lg border max-h-96 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/50 sticky top-0">
                              <tr>
                                <th className="text-left p-2 font-medium whitespace-nowrap">#</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">Status</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">ASG SKU</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">Product Name</th>
                                <th className="text-right p-2 font-medium whitespace-nowrap">Packed</th>
                                <th className="text-right p-2 font-medium whitespace-nowrap">Unpacked</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">Warehouse</th>
                              </tr>
                            </thead>
                            <tbody>
                              {previewResult.rows.map((row) => (
                                <tr
                                  key={row.rowNumber}
                                  className={`border-t ${row.status === 'sku_not_found' ? 'bg-red-50' : ''}`}
                                >
                                  <td className="p-2 text-muted-foreground">{row.rowNumber}</td>
                                  <td className="p-2">
                                    {row.status === 'valid' ? (
                                      row.reason ? (
                                        <span className="flex items-center gap-1 text-amber-600">
                                          <AlertTriangle className="h-3 w-3" />
                                          <span>Warning</span>
                                        </span>
                                      ) : (
                                        <span className="flex items-center gap-1 text-green-700">
                                          <CheckCircle2 className="h-3 w-3" />
                                          <span>Valid</span>
                                        </span>
                                      )
                                    ) : (
                                      <span className="flex items-center gap-1 text-red-600">
                                        <XCircle className="h-3 w-3" />
                                        <span>Skip</span>
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-2 font-mono">{row.asgSku}</td>
                                  <td className="p-2 whitespace-nowrap max-w-[180px] truncate" title={row.productName || undefined}>
                                    {row.productName || (
                                      <span className="text-red-500 italic">Not found</span>
                                    )}
                                  </td>
                                  <td className="p-2 text-right text-emerald-700 font-medium">{row.packedQty}</td>
                                  <td className="p-2 text-right text-amber-700 font-medium">{row.unpackedQty}</td>
                                  <td className="p-2 whitespace-nowrap">
                                    {row.warehouse ? (
                                      row.warehouseFound ? (
                                        row.warehouse
                                      ) : (
                                        <span className="text-blue-600 flex items-center gap-1">
                                          <Plus className="h-3 w-3" />
                                          {row.warehouse}
                                          <span className="text-[10px] bg-blue-100 px-1 rounded">NEW</span>
                                        </span>
                                      )
                                    ) : (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Warnings / errors legend */}
                        {previewResult.rows.some(r => r.reason) && (
                          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                            <p className="font-medium flex items-center gap-1">
                              <AlertTriangle className="h-3.5 w-3.5" /> Notes:
                            </p>
                            {Array.from(new Set(previewResult.rows.filter(r => r.reason).map(r => r.reason!))).map((reason, i) => (
                              <p key={i}>{reason}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="manual" className="space-y-4 mt-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-lg">
                            <Plus className="h-5 w-5 text-primary" />
                            Add Inventory Entry
                          </CardTitle>
                          <CardDescription>
                            Manually add inventory for individual products
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">
                              Product Name <span className="text-destructive">*</span>
                            </label>
                            <Select
                              value={formData.productId ? formData.productId.toString() : ''}
                              onValueChange={handleProductSelect}
                              disabled={loadingData}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={loadingData ? 'Loading products...' : 'Select product'} />
                              </SelectTrigger>
                              <SelectContent>
                                <div className="px-2 pt-1 pb-1">
                                  <Input
                                    placeholder="Search products..."
                                    value={productSearch}
                                    onChange={(e) => setProductSearch(e.target.value)}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    className="h-8 text-sm"
                                  />
                                </div>
                                {filteredProducts.length === 0 ? (
                                  <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                                    No products found
                                  </div>
                                ) : (
                                  filteredProducts.map((product) => (
                                    <SelectItem key={product.id} value={product.id.toString()}>
                                      {product.productName}
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">ASG SKU ID</label>
                              <Input
                                placeholder="Auto-filled"
                                value={formData.asgSku}
                                disabled
                                className="bg-muted"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-medium">
                                ASG Warehouse <span className="text-destructive">*</span>
                              </label>
                              <Select
                                value={formData.warehouseId ? formData.warehouseId.toString() : ''}
                                onValueChange={handleWarehouseSelect}
                                disabled={loadingData}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={loadingData ? 'Loading...' : 'Select warehouse'} />
                                </SelectTrigger>
                                <SelectContent>
                                  <div className="px-2 pt-1 pb-1">
                                    <Input
                                      placeholder="Search warehouses..."
                                      value={warehouseSearch}
                                      onChange={(e) => setWarehouseSearch(e.target.value)}
                                      onKeyDown={(e) => e.stopPropagation()}
                                      className="h-8 text-sm"
                                    />
                                  </div>
                                  {filteredAsgWarehouses.length === 0 ? (
                                    <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                                      No warehouses found
                                    </div>
                                  ) : (
                                    filteredAsgWarehouses.map((warehouse) => (
                                      <SelectItem key={warehouse.id} value={warehouse.id.toString()}>
                                        {warehouse.warehouseName}{warehouse.city ? ` — ${warehouse.city}` : ''}
                                      </SelectItem>
                                    ))
                                  )}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Packed Qty</label>
                              <Input
                                type="text"
                                inputMode="numeric"
                                placeholder="0"
                                value={formData.packedQty === 0 ? '' : formData.packedQty.toString()}
                                onChange={(e) => {
                                  const raw = e.target.value.replace(/[^0-9]/g, '');
                                  setFormData({ ...formData, packedQty: raw === '' ? 0 : parseInt(raw) });
                                }}
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Unpacked Qty</label>
                              <Input
                                type="text"
                                inputMode="numeric"
                                placeholder="0"
                                value={formData.unpackedQty === 0 ? '' : formData.unpackedQty.toString()}
                                onChange={(e) => {
                                  const raw = e.target.value.replace(/[^0-9]/g, '');
                                  setFormData({ ...formData, unpackedQty: raw === '' ? 0 : parseInt(raw) });
                                }}
                              />
                            </div>
                          </div>

                          <Button className="w-full" onClick={handleAddEntry}>
                            <Plus className="h-4 w-4 mr-2" />
                            Add Entry
                          </Button>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-lg">
                            <Package className="h-5 w-5 text-primary" />
                            Added Entries
                          </CardTitle>
                          <CardDescription>
                            {manualEntries.length} entries added manually
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          {manualEntries.length > 0 ? (
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                              {manualEntries.map((entry) => (
                                <div
                                  key={entry.id}
                                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                                >
                                  <div className="flex-1">
                                    <p className="font-medium text-sm">{entry.productName}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {entry.asgSku} • {entry.warehouse}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                      Packed: {entry.packedQty} | Unpacked: {entry.unpackedQty}
                                    </p>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRemoveEntry(entry.id)}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              ))}
                              <Button
                                className="w-full mt-4"
                                onClick={handleSubmitManualEntries}
                                disabled={isUploading}
                              >
                                {isUploading ? 'Submitting...' : `Submit ${manualEntries.length} Entries`}
                              </Button>
                            </div>
                          ) : (
                            <EmptyState
                              title="No entries added"
                              description="Use the form to add inventory entries manually"
                              variant="no-data"
                            />
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {activeTab === 'excel' && !previewResult && (
            <div className="lg:col-span-1">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-5 w-5 text-primary" />
                    Data Format Preview
                  </CardTitle>
                  <CardDescription>
                    Sample format showing expected columns
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2 font-medium whitespace-nowrap">Product Name</th>
                          <th className="text-left p-2 font-medium whitespace-nowrap">ASG SKU ID *</th>
                          <th className="text-right p-2 font-medium whitespace-nowrap">Packed Qty *</th>
                          <th className="text-right p-2 font-medium whitespace-nowrap">Unpacked Qty *</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t">
                          <td className="p-2 whitespace-nowrap">Epsom Salt 1KG</td>
                          <td className="p-2 font-mono whitespace-nowrap">ASG-OM-EPSOM-1KG</td>
                          <td className="p-2 text-right text-emerald-600 font-medium">150</td>
                          <td className="p-2 text-right text-amber-600 font-medium">50</td>
                        </tr>
                        <tr className="border-t">
                          <td className="p-2 whitespace-nowrap">Rosemary Oil 15ML</td>
                          <td className="p-2 font-mono whitespace-nowrap">ASG-OM-ROSE-15ML</td>
                          <td className="p-2 text-right text-emerald-600 font-medium">200</td>
                          <td className="p-2 text-right text-muted-foreground">0</td>
                        </tr>
                        <tr className="border-t">
                          <td className="p-2 whitespace-nowrap">Tea Tree Oil 15ML</td>
                          <td className="p-2 font-mono whitespace-nowrap">ASG-OM-TT-15ML</td>
                          <td className="p-2 text-right text-emerald-600 font-medium">75</td>
                          <td className="p-2 text-right text-amber-600 font-medium">125</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-3 pt-2 border-t">
                    <div>
                      <h4 className="font-medium text-sm mb-1">Required Columns <span className="text-red-500">*</span></h4>
                      <p className="text-xs text-muted-foreground">ASG SKU ID, Packed Qty, Unpacked Qty</p>
                    </div>
                    <div>
                      <h4 className="font-medium text-sm mb-1">Optional Columns</h4>
                      <p className="text-xs text-muted-foreground">Product Name, Warehouse, Channel</p>
                    </div>
                    <div>
                      <h4 className="font-medium text-sm mb-1">Upload Flow</h4>
                      <ul className="text-xs text-muted-foreground space-y-0.5">
                        <li>1. Select file — a preview will appear automatically</li>
                        <li>2. Review rows and fix any SKU issues</li>
                        <li>3. Click "Confirm & Upload" to save to database</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-medium text-sm mb-1">Notes</h4>
                      <ul className="text-xs text-muted-foreground space-y-0.5">
                        <li>• Accepted formats: .xlsx, .xls, .csv (max 10 MB)</li>
                        <li>• If Channel is omitted, updates both Amazon &amp; Blinkit</li>
                        <li>• Packed and Unpacked values must be integers</li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
