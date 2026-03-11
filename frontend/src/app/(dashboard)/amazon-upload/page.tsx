'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { FileUpload } from '@/components/ui/file-upload';
import {
  ShoppingCart,
  FileText,
  Package,
  Download,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Upload,
  CalendarDays,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface UploadResult {
  success: boolean;
  message: string;
  data: {
    rows_processed?: number;
    rows_created?: number;
    rows_updated?: number;
    rows_skipped: number;
    total_rows: number;
    errors?: string[];
  };
}

interface NewProduct {
  asin?: string;
  modelNumber?: string;
  productTitle?: string;
  placeholderSku: string;
}

interface PreviewRow {
  rowNumber: number;
  asin: string | null;
  productTitle: string;
  orderedUnits?: number;
  orderedRevenue?: number;
  shippedUnits?: number;
  shippedRevenue?: number;
  sellableQuantity?: number;
  unfulfilledQuantity?: number;
  reservedQuantity?: number;
}

interface POItem {
  poNumber: string;
  asin: string;
  externalId: string | null;
  modelNumber: string | null;
  hsn: string | null;
  title: string | null;
  status: string | null;
  cancellationStatus: string | null;
  windowType: string | null;
  expectedDate: string | null;
  quantityRequested: number | null;
  acceptedQuantity: number | null;
  quantityReceived: number | null;
  quantityOutstanding: number | null;
  unitCost: number | null;
  totalCost: number | null;
}

interface SemanticPreview {
  file: File;
  uploadType: string; // 'amazon/sales' | 'amazon/inventory' | 'amazon/purchase-orders'
  salesFormat?: string; // 'VendorCSV' | 'RKExcel'
  validRows: number;
  previewRows?: PreviewRow[]; // Actual row data
  newProducts: NewProduct[];
  detectedDate: string | null; // null = date not found in CSV metadata
  duplicateDataWarning?: string | null; // Warning if similar data already exists
  poSummary?: {
    poNumber: string;
    shipToLocationCode: string;
    shipToCity: string;
    shipToState: string;
    status: string;
    orderedOnDate: string;
    paymentTerms: string;
  }[];
  poItems?: POItem[];
  duplicatePos?: { poNumber: string; uploadedOn: string }[];
}

export default function AmazonUploadPage() {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [activeTab, setActiveTab] = useState('sales');
  const [semanticPreview, setSemanticPreview] = useState<SemanticPreview | null>(null);
  // Date the user provides when CSV has no metadata date
  const [reportDate, setReportDate] = useState<string>('');

  // PDF extraction state for Amazon PO
  const [pdfExtractData, setPdfExtractData] = useState<any>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [packingAlerts, setPackingAlerts] = useState<{ asin: string; title: string; ordered_qty: number; packed_qty: number; gap: number }[]>([]);
  const [inventoryWarnings, setInventoryWarnings] = useState<{ asin: string; title: string; ordered_qty: number; packed_qty: number; shortfall: number }[]>([]);

  // Hidden file input refs for Sales and Inventory
  const salesFileInputRef = useRef<HTMLInputElement>(null);
  const inventoryFileInputRef = useRef<HTMLInputElement>(null);

  // ─── Semantic preview flow ────────────────────────────────────────────────

  const handleFileSelectForPreview = async (
    file: File,
    previewFn: (f: File) => Promise<any>,
    uploadType: string,
  ) => {
    setIsPreviewing(true);
    setUploadResult(null);
    setSemanticPreview(null);
    try {
      const result = await previewFn(file);
      if (result.success) {
        const detectedDate = result.detectedDate ?? null;
        setSemanticPreview({
          file,
          uploadType,
          salesFormat: result.salesFormat ?? undefined,
          validRows: result.validRows ?? 0,
          previewRows: result.previewRows ?? [],
          newProducts: result.newProducts ?? [],
          detectedDate,
          duplicateDataWarning: result.duplicateDataWarning ?? null,
          poSummary: result.poSummary,
          poItems: result.poItems,
          duplicatePos: result.duplicatePos ?? [],
        });
        // Pre-fill the date input if detected
        setReportDate(detectedDate ?? '');
      } else {
        toast.error(result.message || 'Preview failed');
      }
    } catch (err: any) {
      toast.error(err.message || 'Preview failed');
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleConfirmSemanticUpload = async () => {
    if (!semanticPreview) return;
    // User must provide/confirm the date for Sales and Inventory uploads
    if (semanticPreview.uploadType !== 'amazon/purchase-orders' && !reportDate) {
      toast.error('Please select the report date for this file before uploading.');
      return;
    }
    setIsUploading(true);
    setPackingAlerts([]);
    setInventoryWarnings([]);
    // Always use the user's date (which may be the detected date or user-edited)
    const dateOverride = semanticPreview.uploadType !== 'amazon/purchase-orders' ? reportDate : undefined;
    try {
      let result: any;
      if (semanticPreview.uploadType === 'amazon/sales') {
        result = await api.upload.amazonSales(semanticPreview.file, dateOverride);
      } else if (semanticPreview.uploadType === 'amazon/inventory') {
        result = await api.upload.amazonInventory(semanticPreview.file, dateOverride);
      } else {
        result = await api.upload.amazonPurchaseOrders(semanticPreview.file);
        if (result.data?.packing_alerts?.length > 0) {
          setPackingAlerts(result.data.packing_alerts);
        }
        if (result.data?.inventory_warnings?.length > 0) {
          setInventoryWarnings(result.data.inventory_warnings);
        }
        router.refresh();
      }
      setUploadResult(result);
      const processed =
        (result.data?.rows_processed || 0) +
        (result.data?.rows_created || 0) +
        (result.data?.rows_updated || 0);
      toast.success(`Upload complete: ${processed} records processed`);

      // Notify about auto-created products and warehouses
      if (result.data?.products_created?.length > 0) {
        toast.info(`${result.data.products_created.length} new product(s) auto-created: ${result.data.products_created.map((p: any) => p.name).join(', ')}`);
      }
      if (result.data?.warehouses_created?.length > 0) {
        toast.info(`${result.data.warehouses_created.length} new warehouse(s) auto-created: ${result.data.warehouses_created.map((w: any) => w.name).join(', ')}`);
      }

      setSemanticPreview(null);
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
      setUploadResult({
        success: false,
        message: err.message || 'Upload failed',
        data: { rows_skipped: 0, total_rows: 0 },
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancelSemanticPreview = () => {
    setSemanticPreview(null);
    setReportDate('');
  };

  // ─── Sales + Inventory tab handlers ──────────────────────────────────────

  const handleSalesFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    handleFileSelectForPreview(file, api.upload.amazonSalesPreview, 'amazon/sales');
  };

  const handleInventoryFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    handleFileSelectForPreview(file, api.upload.amazonInventoryPreview, 'amazon/inventory');
  };

  // ─── PO tab handlers ──────────────────────────────────────────────────────

  const handlePOFileUpload = async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    if (file.name.toLowerCase().endsWith('.pdf')) {
      handlePOPdfUpload(files);
    } else {
      // CSV / Excel → semantic preview
      handleFileSelectForPreview(file, api.upload.amazonPurchaseOrdersPreview, 'amazon/purchase-orders');
    }
  };

  const handlePOPdfUpload = async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    setIsExtracting(true);
    setPdfExtractData(null);
    setUploadResult(null);
    try {
      const result: any = await api.upload.amazonPOExtractPdf(file);
      if (result.success) {
        setPdfExtractData(result);
        toast.success(`Extracted PO ${result.header?.po_number || ''} with ${result.item_count} items`);
      } else {
        toast.error(result.errors?.[0] || 'Failed to extract PO data from PDF');
      }
    } catch (error: any) {
      toast.error(error.message || 'PDF extraction failed');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleConfirmPdfUpload = async () => {
    if (!pdfExtractData) return;
    setIsConfirming(true);
    setPackingAlerts([]);
    setInventoryWarnings([]);
    try {
      const result: any = await api.upload.amazonPOConfirmPdf({
        header: pdfExtractData.header,
        items: pdfExtractData.items,
      });
      if (result.success) {
        if (result.data?.packing_alerts?.length > 0) {
          setPackingAlerts(result.data.packing_alerts);
        }
        if (result.data?.inventory_warnings?.length > 0) {
          setInventoryWarnings(result.data.inventory_warnings);
        }
        toast.success(result.message);

        // Notify about auto-created products and warehouses
        if (result.data?.products_created?.length > 0) {
          toast.info(`${result.data.products_created.length} new product(s) auto-created: ${result.data.products_created.map((p: any) => p.name).join(', ')}`);
        }
        if (result.data?.warehouses_created?.length > 0) {
          toast.info(`${result.data.warehouses_created.length} new warehouse(s) auto-created: ${result.data.warehouses_created.map((w: any) => w.name).join(', ')}`);
        }

        setUploadResult({
          success: true,
          message: result.message,
          data: {
            rows_processed: result.data.items_created,
            rows_skipped: 0,
            total_rows: result.data.items_created,
          },
        });
        setPdfExtractData(null);
        router.refresh();
      } else {
        toast.error(result.message || 'Failed to save PO');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to save PO');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCancelPdfPreview = () => {
    setPdfExtractData(null);
  };

  const formatINR = (val: number | null | undefined) => {
    if (val == null) return '—';
    return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const handleDownloadTemplate = (type: string) => {
    let headers: string[];
    let sampleData: string[][];
    let filename: string;

    if (type === 'sales') {
      headers = ['ASIN', 'Product Title', 'Brand', 'Model Number', 'Category', 'Ordered Revenue', 'Ordered Units', 'Shipped Revenue', 'Shipped Units', 'Customer Returns'];
      sampleData = [
        ['B0123456789', 'Organix Mantra Rosemary Oil 15ML', 'Organix Mantra', 'ASG-OM-ROSEMARY-15ML', 'Hair Care', '₹17,624.66', '65', '₹0.00', '54', '1'],
        ['B0123456790', 'Organix Mantra Epsom Salt 1KG', 'Organix Mantra', 'ASG-OM-EPSOM-1KG', 'Bath', '₹1,02,243.13', '431', '₹0.00', '343', '11'],
      ];
      filename = 'amazon_sales_template.csv';
    } else if (type === 'po') {
      headers = ['PONumber', 'AmazonId', 'SKU', 'OrderDate', 'ExpectedDeliveryDate', 'Quantity', 'ReceivedQuantity', 'UnitPrice', 'TotalAmount', 'Status', 'WarehouseId'];
      sampleData = [
        ['PO-AMZ-001', 'B0123456789', 'ASG-001', '2024-01-10', '2024-01-17', '100', '0', '250.00', '25000.00', 'CREATED', ''],
        ['PO-AMZ-002', 'B0123456790', 'ASG-002', '2024-01-12', '2024-01-19', '50', '50', '180.00', '9000.00', 'DELIVERED', ''],
      ];
      filename = 'amazon_po_template.csv';
    } else {
      headers = ['ASIN', 'Product Title', 'Brand', 'Model Number', 'Category', 'Sellable On Hand Units', 'Unsellable On-Hand Units', 'Open Purchase Order Quantity'];
      sampleData = [
        ['B0123456789', 'Organix Mantra Rosemary Oil 15ML', 'Organix Mantra', 'ASG-OM-ROSEMARY-15ML', 'Hair Care', '223', '0', '0'],
        ['B0123456790', 'Organix Mantra Epsom Salt 1KG', 'Organix Mantra', 'ASG-OM-EPSOM-1KG', 'Bath', '449', '0', '441'],
      ];
      filename = 'amazon_inventory_template.csv';
    }

    const csvContent = [headers.join(','), ...sampleData.map(row => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success('Template downloaded');
  };

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">

        {/* Hidden file inputs */}
        <input
          ref={salesFileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={handleSalesFileChange}
        />
        <input
          ref={inventoryFileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={handleInventoryFileChange}
        />

        {/* Upload Result */}
        {uploadResult && (
          <Card className={`${uploadResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
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
                  {uploadResult.success && (
                    <div className="mt-2 grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Processed:</span>{' '}
                        <span className="font-medium">
                          {(uploadResult.data.rows_processed || 0) + (uploadResult.data.rows_created || 0) + (uploadResult.data.rows_updated || 0)}
                        </span>
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
                  )}
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

        {/* Semantic Preview Card */}
        {semanticPreview && (
          <Card className="border-blue-200 bg-blue-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                Preview: {semanticPreview.file.name}
              </CardTitle>
              <CardDescription>
                {semanticPreview.validRows} valid row{semanticPreview.validRows !== 1 ? 's' : ''} found.
                Review what will be created before uploading.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">

              {/* Date Section — shown for Sales and Inventory uploads only */}
              {semanticPreview.uploadType !== 'amazon/purchase-orders' && (
                <div className={`p-3 rounded-lg space-y-2 ${semanticPreview.detectedDate ? 'bg-blue-50 border border-blue-200' : 'bg-amber-50 border border-amber-300'}`}>
                  <div className="flex items-center gap-2">
                    {semanticPreview.detectedDate ? (
                      <>
                        <CalendarDays className="h-4 w-4 text-blue-600 flex-shrink-0" />
                        <span className="text-sm font-semibold text-blue-800">
                          Report date detected from file (editable)
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
                        <span className="text-sm font-semibold text-amber-800">
                          Report date not found in CSV — please specify the date this data is for
                        </span>
                      </>
                    )}
                  </div>
                  {!semanticPreview.detectedDate && (
                    <p className="text-xs text-amber-700 ml-6">
                      Amazon Vendor Central CSVs include a date in the first line. This file does not have one (e.g. it&apos;s a plain export). Enter the correct date so the data is stored accurately.
                    </p>
                  )}
                  <div className="ml-6 flex items-center gap-2">
                    <label className={`text-xs font-medium ${semanticPreview.detectedDate ? 'text-blue-800' : 'text-amber-800'}`} htmlFor="report-date-input">
                      Report Date:
                    </label>
                    <input
                      id="report-date-input"
                      type="date"
                      value={reportDate}
                      onChange={(e) => setReportDate(e.target.value)}
                      max={new Date().toISOString().split('T')[0]}
                      className={`text-sm border rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 ${semanticPreview.detectedDate ? 'border-blue-300 focus:ring-blue-400' : 'border-amber-300 focus:ring-amber-400'}`}
                    />
                  </div>
                </div>
              )}

              {/* Duplicate Data Warning */}
              {semanticPreview.duplicateDataWarning && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                    <span className="text-sm font-semibold text-red-800">
                      Duplicate Data Detected
                    </span>
                  </div>
                  <p className="text-sm text-red-700 mt-2 ml-6">
                    {semanticPreview.duplicateDataWarning}
                  </p>
                  <p className="text-xs text-red-600 mt-1 ml-6">
                    Uploading this file may create duplicate records. Please verify this is intentional before proceeding.
                  </p>
                </div>
              )}

              {/* New Products */}
              {semanticPreview.newProducts.length > 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-semibold text-amber-800">
                      {semanticPreview.newProducts.length} new product{semanticPreview.newProducts.length !== 1 ? 's' : ''} will be auto-created (unlinked placeholders)
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-amber-200">
                          <th className="text-left py-1 px-2 text-amber-700 font-medium">ASIN</th>
                          <th className="text-left py-1 px-2 text-amber-700 font-medium">Model No.</th>
                          <th className="text-left py-1 px-2 text-amber-700 font-medium">Product Title</th>
                          <th className="text-left py-1 px-2 text-amber-700 font-medium">Placeholder SKU</th>
                        </tr>
                      </thead>
                      <tbody>
                        {semanticPreview.newProducts.map((p, i) => (
                          <tr key={i} className="border-b border-amber-100">
                            <td className="py-1 px-2 font-mono text-amber-900">{p.asin || '—'}</td>
                            <td className="py-1 px-2 text-amber-900">{p.modelNumber || '—'}</td>
                            <td className="py-1 px-2 text-amber-900 max-w-[250px] truncate" title={p.productTitle}>{p.productTitle || '—'}</td>
                            <td className="py-1 px-2 font-mono text-amber-700">{p.placeholderSku}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-amber-600 mt-2">
                    These will be linked to an ASG SKU automatically. You can update the mapping later in the Products master.
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-green-800">All products are already mapped to ASG SKUs — no new products will be created.</span>
                </div>
              )}

              {/* Duplicate PO warning */}
              {semanticPreview.duplicatePos && semanticPreview.duplicatePos.length > 0 && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-300 rounded-lg">
                  <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-red-800">
                    <span className="font-semibold">Duplicate POs detected:</span>{' '}
                    {semanticPreview.duplicatePos.map(d => `PO ${d.poNumber} (uploaded ${d.uploadedOn})`).join(', ')}.
                    {' '}These POs already exist in the database and will be skipped on confirm.
                  </div>
                </div>
              )}

              {/* PO Summary header cards */}
              {semanticPreview.poSummary && semanticPreview.poSummary.length > 0 && (
                <div className="overflow-x-auto bg-white rounded-lg border">
                  <p className="text-xs font-semibold text-gray-600 px-3 pt-3 pb-1">
                    {semanticPreview.poSummary.length} Purchase Order{semanticPreview.poSummary.length !== 1 ? 's' : ''} in this file:
                  </p>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">PO Number</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Ship To (FC)</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">City / State</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Status</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Order Date</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Payment Terms</th>
                      </tr>
                    </thead>
                    <tbody>
                      {semanticPreview.poSummary.map((po, idx) => (
                        <tr key={idx} className="border-b hover:bg-gray-50">
                          <td className="px-3 py-2 font-mono text-xs font-semibold text-blue-700">{po.poNumber}</td>
                          <td className="px-3 py-2 text-xs">{po.shipToLocationCode || '—'}</td>
                          <td className="px-3 py-2 text-xs">
                            {[po.shipToCity, po.shipToState].filter(Boolean).join(', ') || '—'}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                              po.status === 'Confirmed' ? 'bg-green-100 text-green-800' :
                              po.status === 'Received' ? 'bg-purple-100 text-purple-800' :
                              po.status === 'Closed' ? 'bg-gray-100 text-gray-700' :
                              po.status === 'Cancelled' ? 'bg-red-100 text-red-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {po.status || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs">{po.orderedOnDate || '—'}</td>
                          <td className="px-3 py-2 text-xs">{po.paymentTerms || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* PO Line Items detail table */}
              {semanticPreview.poItems && semanticPreview.poItems.length > 0 && (
                <div className="overflow-x-auto bg-white rounded-lg border">
                  <p className="text-xs font-semibold text-gray-600 px-3 pt-3 pb-1">
                    Line Items ({semanticPreview.poItems.length} rows):
                  </p>
                  <div className="max-h-96 overflow-auto">
                    <table className="w-full text-xs whitespace-nowrap">
                      <thead className="bg-gray-50 border-b sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-700">#</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700">PO Number</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700">ASIN</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700">External ID</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700">Model No.</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700">HSN</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700 min-w-[180px]">Title</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700">Status</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700">Window</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700">Expected</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-700">Qty Req</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-700">Accepted</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-700">Received</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-700">Outstanding</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-700">Unit Cost</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-700">Total Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {semanticPreview.poItems.map((item, idx) => (
                          <tr key={idx} className="border-b hover:bg-gray-50">
                            <td className="px-3 py-1.5 text-gray-400">{idx + 1}</td>
                            <td className="px-3 py-1.5 font-mono font-semibold text-blue-700">{item.poNumber}</td>
                            <td className="px-3 py-1.5 font-mono">{item.asin}</td>
                            <td className="px-3 py-1.5 text-gray-600">{item.externalId || '—'}</td>
                            <td className="px-3 py-1.5">{item.modelNumber || '—'}</td>
                            <td className="px-3 py-1.5">{item.hsn || '—'}</td>
                            <td className="px-3 py-1.5 max-w-[200px] truncate" title={item.title ?? ''}>{item.title || '—'}</td>
                            <td className="px-3 py-1.5">
                              {item.status ? (
                                <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                                  item.status === 'Confirmed' ? 'bg-green-100 text-green-800' :
                                  item.status === 'Received' ? 'bg-purple-100 text-purple-800' :
                                  item.status === 'Cancelled' ? 'bg-red-100 text-red-800' :
                                  'bg-yellow-100 text-yellow-800'
                                }`}>{item.status}</span>
                              ) : '—'}
                            </td>
                            <td className="px-3 py-1.5">{item.windowType || '—'}</td>
                            <td className="px-3 py-1.5">{item.expectedDate || '—'}</td>
                            <td className="px-3 py-1.5 text-right font-semibold">{item.quantityRequested ?? '—'}</td>
                            <td className="px-3 py-1.5 text-right text-green-700">{item.acceptedQuantity ?? '—'}</td>
                            <td className="px-3 py-1.5 text-right text-blue-700">{item.quantityReceived ?? '—'}</td>
                            <td className="px-3 py-1.5 text-right text-orange-600">{item.quantityOutstanding ?? '—'}</td>
                            <td className="px-3 py-1.5 text-right">{item.unitCost != null ? `₹${item.unitCost.toFixed(2)}` : '—'}</td>
                            <td className="px-3 py-1.5 text-right font-medium">{item.totalCost != null ? `₹${item.totalCost.toFixed(2)}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Preview Data Table */}
              {semanticPreview.previewRows && semanticPreview.previewRows.length > 0 && (
                <div className="border rounded-lg">
                  <div className="max-h-96 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left p-2 font-medium text-xs">#</th>
                          <th className="text-left p-2 font-medium text-xs">ASIN</th>
                          <th className="text-left p-2 font-medium text-xs">
                            {semanticPreview.salesFormat === 'RKExcel' ? 'SKU' : 'Product Title'}
                          </th>
                          {semanticPreview.uploadType === 'amazon/sales' && semanticPreview.salesFormat === 'RKExcel' && (
                            <>
                              <th className="text-right p-2 font-medium text-xs">DRR (D-1)</th>
                              <th className="text-right p-2 font-medium text-xs">Net Shipped GMS</th>
                              <th className="text-right p-2 font-medium text-xs">Sellable Stock</th>
                            </>
                          )}
                          {semanticPreview.uploadType === 'amazon/sales' && semanticPreview.salesFormat !== 'RKExcel' && (
                            <>
                              <th className="text-right p-2 font-medium text-xs">Ordered Units</th>
                              <th className="text-right p-2 font-medium text-xs">Ordered Revenue</th>
                              <th className="text-right p-2 font-medium text-xs">Shipped Units</th>
                              <th className="text-right p-2 font-medium text-xs">Shipped Revenue</th>
                            </>
                          )}
                          {semanticPreview.uploadType === 'amazon/inventory' && (
                            <>
                              <th className="text-right p-2 font-medium text-xs">Sellable</th>
                              <th className="text-right p-2 font-medium text-xs">Unfulfillable</th>
                              <th className="text-right p-2 font-medium text-xs">Reserved</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {semanticPreview.previewRows.map((row, idx) => (
                          <tr key={idx} className="border-t hover:bg-muted/30">
                            <td className="p-2 text-muted-foreground text-xs">{row.rowNumber}</td>
                            <td className="p-2 font-mono text-xs">{row.asin || '—'}</td>
                            <td className="p-2 text-xs max-w-[300px] truncate" title={row.productTitle}>{row.productTitle}</td>
                            {semanticPreview.uploadType === 'amazon/sales' && semanticPreview.salesFormat === 'RKExcel' && (
                              <>
                                <td className="p-2 text-right text-xs">{row.orderedUnits != null ? row.orderedUnits.toFixed(2) : '—'}</td>
                                <td className="p-2 text-right text-xs">{row.orderedRevenue ? `₹${row.orderedRevenue.toFixed(2)}` : '—'}</td>
                                <td className="p-2 text-right text-xs">{row.shippedUnits ?? '—'}</td>
                              </>
                            )}
                            {semanticPreview.uploadType === 'amazon/sales' && semanticPreview.salesFormat !== 'RKExcel' && (
                              <>
                                <td className="p-2 text-right text-xs">{row.orderedUnits ?? '—'}</td>
                                <td className="p-2 text-right text-xs">{row.orderedRevenue ? `₹${row.orderedRevenue.toFixed(2)}` : '—'}</td>
                                <td className="p-2 text-right text-xs">{row.shippedUnits ?? '—'}</td>
                                <td className="p-2 text-right text-xs">{row.shippedRevenue ? `₹${row.shippedRevenue.toFixed(2)}` : '—'}</td>
                              </>
                            )}
                            {semanticPreview.uploadType === 'amazon/inventory' && (
                              <>
                                <td className="p-2 text-right text-xs">{row.sellableQuantity ?? '—'}</td>
                                <td className="p-2 text-right text-xs">{row.unfulfilledQuantity ?? '—'}</td>
                                <td className="p-2 text-right text-xs">{row.reservedQuantity ?? '—'}</td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <p className="text-sm text-muted-foreground">
                  {semanticPreview.validRows} row{semanticPreview.validRows !== 1 ? 's' : ''} ready to upload
                  {semanticPreview.newProducts.length > 0 && ` · ${semanticPreview.newProducts.length} new product placeholder${semanticPreview.newProducts.length !== 1 ? 's' : ''} will be created`}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleCancelSemanticPreview} disabled={isUploading}>
                    Cancel
                  </Button>
                  <Button onClick={handleConfirmSemanticUpload} disabled={isUploading}>
                    {isUploading ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading...</>
                    ) : (
                      'Confirm & Upload'
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-orange-500" />
                <CardTitle>Amazon Data Management</CardTitle>
              </div>
              {activeTab !== 'po' && (
                <Button variant="outline" size="sm" onClick={() => handleDownloadTemplate(activeTab)}>
                  <Download className="h-4 w-4 mr-2" />
                  Download Template
                </Button>
              )}
              {activeTab === 'po' && (
                <Button variant="outline" size="sm" onClick={() => handleDownloadTemplate('po')}>
                  <Download className="h-4 w-4 mr-2" />
                  Download CSV Template
                </Button>
              )}
            </div>
            <CardDescription>
              Upload your Amazon data files to populate the dashboards. Supported formats: Excel (.xlsx, .xls), CSV, PDF
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="sales" className="w-full" onValueChange={(v) => { setActiveTab(v); setUploadResult(null); setSemanticPreview(null); setReportDate(''); setPackingAlerts([]); setInventoryWarnings([]); }}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="sales" className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4" />
                  Sales Data
                </TabsTrigger>
                <TabsTrigger value="po" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  PO Data
                </TabsTrigger>
                <TabsTrigger value="inventory" className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Inventory Info
                </TabsTrigger>
              </TabsList>

              {/* Sales Upload Tab */}
              <TabsContent value="sales" className="space-y-4 mt-6">
                <div
                  className="border-2 border-dashed border-gray-300 rounded-lg py-32 px-8 text-center cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-colors"
                  onClick={() => salesFileInputRef.current?.click()}
                >
                  {isPreviewing ? (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
                      <p className="text-sm font-medium">Validating file against database...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Upload className="h-8 w-8 text-gray-400" />
                      <p className="text-sm font-medium">Drag and drop your Amazon sales file here, or click to browse</p>
                      <p className="text-xs text-gray-400">Supported: CSV, Excel (.xlsx, .xls)</p>
                    </div>
                  )}
                </div>
                <div className="px-1 space-y-1">
                  <p className="text-sm font-medium">Expected Columns:</p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Format 1 (Vendor Central):</span>{' '}
                    ASIN, Product Title, Ordered Units, Ordered Revenue, Brand, Model Number, Category, Shipped Revenue, Shipped Units, Customer Returns
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Format 2 (RK Report):</span>{' '}
                    ASIN, SKU, Brand, ASP, DRR (0-1), 7 days DRR, 30 days DRR, Net Shipped GMS, Sellable, DOH, Open PO, OOS
                  </p>
                </div>
              </TabsContent>

              {/* PO Upload Tab — unified PDF + CSV/Excel */}
              <TabsContent value="po" className="space-y-4 mt-6">
                {pdfExtractData ? (
                  /* PDF extract preview */
                  <Card className="border-blue-200">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-blue-600" />
                        Extracted PO: {pdfExtractData.header?.po_number || 'Unknown'}
                      </CardTitle>
                      <CardDescription>
                        Review the extracted data below. Click &quot;Confirm &amp; Save&quot; to save to database.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Duplicate PO warning */}
                      {pdfExtractData.duplicateWarning && (
                        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-300 rounded-lg">
                          <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                          <div className="text-sm text-red-800 font-medium">{pdfExtractData.duplicateWarning}</div>
                        </div>
                      )}

                      {/* Warnings */}
                      {pdfExtractData.warnings && pdfExtractData.warnings.length > 0 && (
                        <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                          <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                          <div className="text-sm text-yellow-800">
                            {pdfExtractData.warnings.map((w: string, i: number) => (
                              <p key={i}>{w}</p>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Header summary */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div className="p-2 bg-gray-50 rounded">
                          <span className="text-gray-500 block text-xs">PO Number</span>
                          <span className="font-medium">{pdfExtractData.header?.po_number || '—'}</span>
                        </div>
                        <div className="p-2 bg-gray-50 rounded">
                          <span className="text-gray-500 block text-xs">Status</span>
                          <span className="font-medium">{pdfExtractData.header?.po_status || '—'}</span>
                        </div>
                        <div className="p-2 bg-gray-50 rounded">
                          <span className="text-gray-500 block text-xs">Vendor Code</span>
                          <span className="font-medium">{pdfExtractData.header?.vendor_code || '—'}</span>
                        </div>
                        <div className="p-2 bg-gray-50 rounded">
                          <span className="text-gray-500 block text-xs">Ordered On</span>
                          <span className="font-medium">{pdfExtractData.header?.ordered_on_date || '—'}</span>
                        </div>
                        <div className="p-2 bg-gray-50 rounded">
                          <span className="text-gray-500 block text-xs">Ship To</span>
                          <span className="font-medium">
                            {pdfExtractData.header?.ship_to_location_code || '—'}
                            {pdfExtractData.header?.ship_to_city ? ` - ${pdfExtractData.header.ship_to_city}` : ''}
                            {pdfExtractData.header?.ship_to_state ? `, ${pdfExtractData.header.ship_to_state}` : ''}
                          </span>
                        </div>
                        <div className="p-2 bg-gray-50 rounded">
                          <span className="text-gray-500 block text-xs">Ship Window</span>
                          <span className="font-medium">
                            {pdfExtractData.header?.ship_window_start_date || '—'} to {pdfExtractData.header?.ship_window_end_date || '—'}
                          </span>
                        </div>
                        <div className="p-2 bg-gray-50 rounded">
                          <span className="text-gray-500 block text-xs">Freight / Payment</span>
                          <span className="font-medium">
                            {pdfExtractData.header?.freight_terms || '—'} / {pdfExtractData.header?.payment_method || '—'}
                          </span>
                        </div>
                        <div className="p-2 bg-gray-50 rounded">
                          <span className="text-gray-500 block text-xs">Purchasing Entity</span>
                          <span className="font-medium">{pdfExtractData.header?.purchasing_entity_name || '—'}</span>
                        </div>
                      </div>

                      {/* Summary row */}
                      {pdfExtractData.header?.submitted_quantity != null && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div className="p-2 bg-blue-50 rounded border border-blue-100">
                            <span className="text-blue-600 block text-xs">Submitted</span>
                            <span className="font-medium">{pdfExtractData.header.submitted_items} items, {pdfExtractData.header.submitted_quantity} qty — {formatINR(pdfExtractData.header.submitted_total_cost)}</span>
                          </div>
                          <div className="p-2 bg-green-50 rounded border border-green-100">
                            <span className="text-green-600 block text-xs">Accepted</span>
                            <span className="font-medium">{pdfExtractData.header.accepted_items ?? 0} items, {pdfExtractData.header.accepted_quantity ?? 0} qty — {formatINR(pdfExtractData.header.accepted_total_cost)}</span>
                          </div>
                          <div className="p-2 bg-red-50 rounded border border-red-100">
                            <span className="text-red-600 block text-xs">Cancelled</span>
                            <span className="font-medium">{pdfExtractData.header.cancelled_items ?? 0} items, {pdfExtractData.header.cancelled_quantity ?? 0} qty — {formatINR(pdfExtractData.header.cancelled_total_cost)}</span>
                          </div>
                          <div className="p-2 bg-purple-50 rounded border border-purple-100">
                            <span className="text-purple-600 block text-xs">Received</span>
                            <span className="font-medium">{pdfExtractData.header.received_items ?? 0} items, {pdfExtractData.header.received_quantity ?? 0} qty — {formatINR(pdfExtractData.header.received_total_cost)}</span>
                          </div>
                        </div>
                      )}

                      {/* Line items table */}
                      <div className="overflow-x-auto bg-white rounded-lg border">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 border-b">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">#</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">ASIN</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">External Id</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Model Number</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700 min-w-[200px]">Title</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Window</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Expected</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-700">Qty Req</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-700">Accepted</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-700">Received</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-700">Unit Cost</th>
                              <th className="px-3 py-2 text-right font-medium text-gray-700">Total Cost</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pdfExtractData.items?.map((item: any, idx: number) => (
                              <tr key={idx} className="border-b hover:bg-gray-50">
                                <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                                <td className="px-3 py-2 font-mono text-xs">{item.asin || '—'}</td>
                                <td className="px-3 py-2 text-xs">{item.external_id || '—'}</td>
                                <td className="px-3 py-2 text-xs">{item.model_number || '—'}</td>
                                <td className="px-3 py-2 text-xs max-w-[250px] truncate" title={item.title}>{item.title || '—'}</td>
                                <td className="px-3 py-2 text-xs">{item.window_type || '—'}</td>
                                <td className="px-3 py-2 text-xs">{item.expected_date || '—'}</td>
                                <td className="px-3 py-2 text-right">{item.quantity_requested ?? '—'}</td>
                                <td className="px-3 py-2 text-right">{item.accepted_quantity ?? '—'}</td>
                                <td className="px-3 py-2 text-right">{item.quantity_received ?? '—'}</td>
                                <td className="px-3 py-2 text-right">{formatINR(item.unit_cost)}</td>
                                <td className="px-3 py-2 text-right font-medium">{formatINR(item.total_cost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-between pt-2">
                        <p className="text-sm text-muted-foreground">
                          {pdfExtractData.item_count} item{pdfExtractData.item_count !== 1 ? 's' : ''} extracted from {pdfExtractData.page_count} page{pdfExtractData.page_count !== 1 ? 's' : ''}
                        </p>
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={handleCancelPdfPreview}>
                            Cancel
                          </Button>
                          <Button onClick={handleConfirmPdfUpload} disabled={isConfirming || !!pdfExtractData.duplicateWarning}>
                            {isConfirming ? (
                              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                            ) : (
                              'Confirm & Save to Database'
                            )}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <FileUpload
                      accept=".pdf,.csv,.xlsx,.xls"
                      maxSize={10}
                      onUpload={handlePOFileUpload}
                      description={
                        isPreviewing ? "Validating file against database..."
                        : isExtracting ? "Extracting PO data from PDF..."
                        : isUploading ? "Uploading..."
                        : "Drag and drop your PO file here — PDF (Vendor Central) or CSV/Excel"
                      }
                    />
                    {(isExtracting || isPreviewing) && (
                      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {isExtracting ? 'Extracting data from PDF...' : 'Validating file against database...'}
                      </div>
                    )}

                    <div className="px-1 space-y-1">
                      <p className="text-sm font-medium">Expected Columns:</p>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">PDF (Vendor Central):</span>{' '}
                        PO header, line items, quantities &amp; costs are extracted automatically
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">CSV / Excel:</span>{' '}
                        PONumber, AmazonId (ASIN), SKU, OrderDate, Quantity, Status, ExpectedDeliveryDate, UnitPrice
                      </p>
                    </div>
                  </>
                )}

                {/* Packing Alerts */}
                {packingAlerts.length > 0 && activeTab === 'po' && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-amber-800">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <p className="font-medium text-sm">{packingAlerts.length} item{packingAlerts.length > 1 ? 's' : ''} need packing before dispatch</p>
                    </div>
                    <div className="overflow-x-auto rounded border border-amber-200">
                      <table className="w-full text-xs">
                        <thead className="bg-amber-100">
                          <tr>
                            <th className="text-left p-2 font-medium">ASIN</th>
                            <th className="text-left p-2 font-medium">Product Title</th>
                            <th className="text-right p-2 font-medium">Ordered</th>
                            <th className="text-right p-2 font-medium">Packed</th>
                            <th className="text-right p-2 font-medium text-red-700">Still to Pack</th>
                          </tr>
                        </thead>
                        <tbody>
                          {packingAlerts.map((alert, i) => (
                            <tr key={i} className="border-t border-amber-200 bg-white">
                              <td className="p-2 font-mono">{alert.asin}</td>
                              <td className="p-2 max-w-[200px] truncate" title={alert.title}>{alert.title}</td>
                              <td className="p-2 text-right">{alert.ordered_qty}</td>
                              <td className="p-2 text-right text-emerald-700">{alert.packed_qty}</td>
                              <td className="p-2 text-right font-semibold text-red-700">{alert.gap}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-amber-700">Go to <span className="font-medium">Stock Upload</span> page to update packed quantities.</p>
                  </div>
                )}

                {/* Inventory Deduction Warnings */}
                {inventoryWarnings.length > 0 && activeTab === 'po' && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-red-800">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <p className="font-medium text-sm">
                        Insufficient packed inventory for {inventoryWarnings.length} item{inventoryWarnings.length > 1 ? 's' : ''} — deducted what was available
                      </p>
                    </div>
                    <div className="overflow-x-auto rounded border border-red-200">
                      <table className="w-full text-xs">
                        <thead className="bg-red-100">
                          <tr>
                            <th className="text-left p-2 font-medium">ASIN</th>
                            <th className="text-left p-2 font-medium">Product Title</th>
                            <th className="text-right p-2 font-medium">Ordered</th>
                            <th className="text-right p-2 font-medium">Was Packed</th>
                            <th className="text-right p-2 font-medium text-red-700">Shortfall</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inventoryWarnings.map((w, i) => (
                            <tr key={i} className="border-t border-red-200 bg-white">
                              <td className="p-2 font-mono">{w.asin}</td>
                              <td className="p-2 max-w-[200px] truncate" title={w.title}>{w.title}</td>
                              <td className="p-2 text-right">{w.ordered_qty}</td>
                              <td className="p-2 text-right text-emerald-700">{w.packed_qty}</td>
                              <td className="p-2 text-right font-semibold text-red-700">{w.shortfall}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-red-700">Packed inventory was automatically deducted. Please replenish stock for the shortfall quantities.</p>
                  </div>
                )}
              </TabsContent>

              {/* Inventory Upload Tab */}
              <TabsContent value="inventory" className="space-y-4 mt-6">
                <div
                  className="border-2 border-dashed border-gray-300 rounded-lg py-32 px-8 text-center cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-colors"
                  onClick={() => inventoryFileInputRef.current?.click()}
                >
                  {isPreviewing ? (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
                      <p className="text-sm font-medium">Validating file against database...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Upload className="h-8 w-8 text-gray-400" />
                      <p className="text-sm font-medium">Drag and drop your Amazon Vendor Central inventory file here, or click to browse</p>
                      <p className="text-xs text-gray-400">Supported: CSV, Excel (.xlsx, .xls)</p>
                    </div>
                  )}
                </div>

                <div className="px-1 space-y-1">
                  <p className="text-sm font-medium">Expected Columns:</p>
                  <p className="text-sm text-muted-foreground">
                    ASIN, Product Title, Model Number, Sellable On Hand Units, Unsellable On-Hand Units, Brand, Open Purchase Order Quantity, Category
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
