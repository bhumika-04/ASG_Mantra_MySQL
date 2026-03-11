'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { FileUpload } from '@/components/ui/file-upload';
import {
  Zap,
  FileText,
  Package,
  Download,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Eye,
  Building2,
  Tag,
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

interface PdfExtractData {
  header: Record<string, any>;
  items: Record<string, any>[];
  warnings: string[];
  page_count: number;
  item_count: number;
  duplicate_warning?: string;
}

interface PackingAlert {
  item_code: string;
  item_name: string;
  ordered_qty: number;
  packed_qty: number;
  gap: number;
}

interface NewProduct {
  itemId?: number;
  itemName?: string;
  asin?: string;
  placeholderSku: string;
}

interface NewFacility {
  facilityId: number | null;
  facilityName: string;
}

interface PreviewRow {
  rowNumber: number;
  itemId?: number;
  itemName?: string;
  manufacturerName?: string;
  cityName?: string;
  category?: string;
  qtySold?: number;
  mrp?: number;
  facilityName?: string;
  backendQty?: number;
  frontendQty?: number;
}

interface POItem {
  poNumber: string;
  sno: number | null;
  eagleCode: number | null;
  itemCode: string | null;
  itemName: string | null;
  mrp: number | null;
  size: string | null;
  hsnCode: string | null;
  qty: number | null;
  uom: string | null;
  unitBaseCost: number | null;
  discount: number | null;
  taxableValue: number | null;
  cgstRate: number | null;
  cgstAmt: number | null;
  sgstRate: number | null;
  sgstAmt: number | null;
  igstRate: number | null;
  igstAmt: number | null;
  totalAmount: number | null;
}

interface SemanticPreview {
  file: File;
  uploadType: string;
  validRows: number;
  newProducts: NewProduct[];
  newFacilities: NewFacility[];
  poSummary?: { poNumber: string; shipToName: string; status: string; expectedDelivery: string; poDate?: string; paymentTerms?: string }[];
  poItems?: POItem[];
  detectedDate?: string | null;
  previewRows?: PreviewRow[];
  duplicateDataWarning?: string | null;
  duplicatePos?: { poNumber: string; uploadedOn: string }[];
}

export default function BlinkitUploadPage() {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [activeTab, setActiveTab] = useState('sales');
  const [semanticPreview, setSemanticPreview] = useState<SemanticPreview | null>(null);
  const [pdfExtractData, setPdfExtractData] = useState<PdfExtractData | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [reportDate, setReportDate] = useState('');
  const [packingAlerts, setPackingAlerts] = useState<PackingAlert[]>([]);
  const [inventoryWarnings, setInventoryWarnings] = useState<{ item_code: string; item_name: string; ordered_qty: number; packed_qty: number; shortfall: number }[]>([]);

  const salesFileInputRef = useRef<HTMLInputElement>(null);
  const inventoryFileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelectForPreview = async (
    file: File,
    previewFn: (f: File) => Promise<any>,
    uploadType: string
  ) => {
    setSemanticPreview(null);
    setUploadResult(null);
    setIsPreviewing(true);
    try {
      const result: any = await previewFn(file);
      setSemanticPreview({
        file,
        uploadType,
        validRows: result.validRows ?? 0,
        newProducts: result.newProducts ?? [],
        newFacilities: result.newFacilities ?? [],
        poSummary: result.poSummary,
        poItems: result.poItems,
        detectedDate: result.detectedDate,
        previewRows: result.previewRows ?? [],
        duplicateDataWarning: result.duplicateDataWarning,
        duplicatePos: result.duplicatePos ?? [],
      });
      // Set report date from preview
      setReportDate(result.detectedDate || '');
    } catch (error: any) {
      toast.error(error.message || 'Failed to preview file');
    } finally {
      setIsPreviewing(false);
      if (salesFileInputRef.current) salesFileInputRef.current.value = '';
      if (inventoryFileInputRef.current) inventoryFileInputRef.current.value = '';
    }
  };

  const handleConfirmSemanticUpload = async () => {
    if (!semanticPreview) return;
    setIsUploading(true);
    setPackingAlerts([]);
    setInventoryWarnings([]);
    try {
      let result: any;

      if (semanticPreview.uploadType === 'blinkit/sales') {
        result = await api.upload.blinkitSales(semanticPreview.file, reportDate || undefined);
      } else if (semanticPreview.uploadType === 'blinkit/inventory') {
        result = await api.upload.blinkitInventory(semanticPreview.file, reportDate || undefined);
      } else {
        result = await api.upload.blinkitPurchaseOrders(semanticPreview.file);
        if (result.data?.packing_alerts?.length > 0) {
          setPackingAlerts(result.data.packing_alerts);
        }
        if (result.data?.inventory_warnings?.length > 0) {
          setInventoryWarnings(result.data.inventory_warnings);
        }
        router.refresh();
      }

      setUploadResult(result);
      setSemanticPreview(null);
      const processed = result.data?.rows_processed || result.data?.rows_created || 0;
      const updated = result.data?.rows_updated || 0;
      toast.success(`Upload complete: ${processed + updated} records processed`);

      // Notify about auto-created products and warehouses
      if (result.data?.products_created?.length > 0) {
        toast.info(`${result.data.products_created.length} new product(s) auto-created: ${result.data.products_created.map((p: any) => p.name).join(', ')}`);
      }
      if (result.data?.warehouses_created?.length > 0) {
        toast.info(`${result.data.warehouses_created.length} new warehouse(s) auto-created: ${result.data.warehouses_created.map((w: any) => w.name).join(', ')}`);
      }
    } catch (error: any) {
      toast.error(error.message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancelSemanticPreview = () => setSemanticPreview(null);

  const handleSalesFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleFileSelectForPreview(file, api.upload.blinkitSalesPreview, 'blinkit/sales');
  };

  const handleInventoryFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleFileSelectForPreview(file, api.upload.blinkitInventoryPreview, 'blinkit/inventory');
  };


  const handlePOFileUpload = async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    if (file.name.toLowerCase().endsWith('.pdf')) {
      handlePOPdfUpload(files);
    } else {
      await handleFileSelectForPreview(file, api.upload.blinkitPurchaseOrdersPreview, 'blinkit/purchase-orders');
    }
  };

  const handlePOPdfUpload = async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    setIsExtracting(true);
    setPdfExtractData(null);
    setUploadResult(null);
    try {
      const result = await api.upload.blinkitPOExtractPdf(file) as any;
      if (result.success) {
        setPdfExtractData({
          header: result.header,
          items: result.items,
          warnings: result.warnings || [],
          page_count: result.page_count,
          item_count: result.item_count,
          duplicate_warning: result.duplicate_warning,
        });
        if (result.warnings?.length > 0) {
          toast.warning(`Extracted with ${result.warnings.length} warning(s). Please review.`);
        } else {
          toast.success(`Extracted PO ${result.header?.po_number || '(unknown)'}: ${result.item_count} item(s)`);
        }
      } else {
        toast.error('PDF extraction failed');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to extract PDF');
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
      const result = await api.upload.blinkitPOConfirmPdf({
        header: pdfExtractData.header,
        items: pdfExtractData.items,
        status: 'Created',
      }) as any;
      if (result.data?.packing_alerts?.length > 0) {
        setPackingAlerts(result.data.packing_alerts);
      }
      if (result.data?.inventory_warnings?.length > 0) {
        setInventoryWarnings(result.data.inventory_warnings);
      }
      setUploadResult({
        success: true,
        message: result.message,
        data: { rows_processed: result.data.items_created, rows_skipped: 0, total_rows: result.data.items_created },
      });
      setPdfExtractData(null);
      toast.success(result.message);
      router.refresh();

      // Notify about auto-created products and warehouses
      if (result.data?.products_created?.length > 0) {
        toast.info(`${result.data.products_created.length} new product(s) auto-created: ${result.data.products_created.map((p: any) => p.name).join(', ')}`);
      }
      if (result.data?.warehouses_created?.length > 0) {
        toast.info(`${result.data.warehouses_created.length} new warehouse(s) auto-created: ${result.data.warehouses_created.map((w: any) => w.name).join(', ')}`);
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to save PO');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCancelPdfPreview = () => setPdfExtractData(null);

  const handleDownloadTemplate = (type: string) => {
    let headers: string[];
    let sampleData: string[][];
    let filename: string;
    if (type === 'sales') {
      headers = ['item_id', 'item_name', 'manufacturer_id', 'manufacturer_name', 'city_id', 'city_name', 'category', 'date', 'qty_sold', 'mrp'];
      sampleData = [['10169419', 'Organix Mantra Indian Rosemary Essential Oil(Box)', '4894', 'ASG Mantra', '7', 'Delhi', 'Personal Care', '2025-01-01', '3', '1197.0']];
      filename = 'blinkit_sales_template.csv';
    } else if (type === 'po') {
      headers = ['PONumber', 'BlinkitId', 'SKU', 'OrderDate', 'ExpectedDeliveryDate', 'Quantity', 'ReceivedQuantity', 'UnitPrice', 'TotalAmount', 'Status', 'WarehouseId'];
      sampleData = [['PO-BLK-001', 'BLK-SKU-101', 'ASG-001', '2024-01-10', '2024-01-13', '200', '200', '240.00', '48000.00', 'DELIVERED', '']];
      filename = 'blinkit_po_template.csv';
    } else {
      headers = ['created_at', 'backend_facility_name', 'backend_facility_id', 'item_id', 'item_name', 'backend_inv_qty', 'frontend_inv_qty'];
      sampleData = [['2025-12-02', 'Noida N1 - Feeder Warehouse', '2576', '10169419', 'Organix Mantra Indian Rosemary Essential Oil(Box) 15 ml - Rs 399', '60', '57']];
      filename = 'blinkit_inventory_template.csv';
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

  const formatINR = (val: number | null | undefined) => {
    if (val == null) return '-';
    return val.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
  };

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">

        {/* Semantic Preview */}
        {semanticPreview && (
          <Card className="border-blue-200 bg-blue-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5 text-blue-600" />
                Upload Preview: {semanticPreview.file.name}
              </CardTitle>
              <CardDescription>
                {semanticPreview.validRows} row(s) ready. Review what will be created, then confirm.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Report Date (editable) */}
              {(semanticPreview.uploadType === 'blinkit/sales' || semanticPreview.uploadType === 'blinkit/inventory') && (
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
                          No date detected — please enter manually
                        </span>
                      </>
                    )}
                  </div>
                  <div className="ml-6 flex items-center gap-2">
                    <label className={`text-xs font-medium ${semanticPreview.detectedDate ? 'text-blue-700' : 'text-amber-700'}`} htmlFor="report-date-input">
                      Report Date:
                    </label>
                    <input
                      id="report-date-input"
                      type="date"
                      value={reportDate}
                      onChange={(e) => setReportDate(e.target.value)}
                      className="px-2 py-1 text-xs border rounded"
                    />
                  </div>
                </div>
              )}

              {/* Duplicate Warning */}
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
                </div>
              )}

              {/* Preview Rows Table */}
              {semanticPreview.previewRows && semanticPreview.previewRows.length > 0 && (
                <div className="border rounded-lg">
                  <div className="bg-muted/30 px-3 py-2 border-b">
                    <p className="text-sm font-semibold">Data Preview (first {semanticPreview.previewRows.length} rows)</p>
                  </div>
                  <div className="max-h-96 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left p-2 font-medium text-xs">#</th>
                          {semanticPreview.uploadType === 'blinkit/sales' && (
                            <>
                              <th className="text-left p-2 font-medium text-xs">Item ID</th>
                              <th className="text-left p-2 font-medium text-xs">Item Name</th>
                              <th className="text-left p-2 font-medium text-xs">Manufacturer</th>
                              <th className="text-left p-2 font-medium text-xs">City</th>
                              <th className="text-left p-2 font-medium text-xs">Category</th>
                              <th className="text-right p-2 font-medium text-xs">Qty Sold</th>
                              <th className="text-right p-2 font-medium text-xs">MRP</th>
                            </>
                          )}
                          {semanticPreview.uploadType === 'blinkit/inventory' && (
                            <>
                              <th className="text-left p-2 font-medium text-xs">Item ID</th>
                              <th className="text-left p-2 font-medium text-xs">Item Name</th>
                              <th className="text-left p-2 font-medium text-xs">Facility</th>
                              <th className="text-right p-2 font-medium text-xs">Backend Qty</th>
                              <th className="text-right p-2 font-medium text-xs">Frontend Qty</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {semanticPreview.previewRows.map((row, idx) => (
                          <tr key={idx} className="border-t hover:bg-muted/20">
                            <td className="p-2 text-xs text-muted-foreground">{row.rowNumber}</td>
                            {semanticPreview.uploadType === 'blinkit/sales' && (
                              <>
                                <td className="p-2 text-xs font-mono">{row.itemId || '—'}</td>
                                <td className="p-2 text-xs max-w-[200px] truncate">{row.itemName || '—'}</td>
                                <td className="p-2 text-xs">{row.manufacturerName || '—'}</td>
                                <td className="p-2 text-xs">{row.cityName || '—'}</td>
                                <td className="p-2 text-xs">{row.category || '—'}</td>
                                <td className="p-2 text-xs text-right">{row.qtySold?.toFixed(2) || '—'}</td>
                                <td className="p-2 text-xs text-right font-semibold">₹{row.mrp?.toFixed(2) || '—'}</td>
                              </>
                            )}
                            {semanticPreview.uploadType === 'blinkit/inventory' && (
                              <>
                                <td className="p-2 text-xs font-mono">{row.itemId || '—'}</td>
                                <td className="p-2 text-xs max-w-[200px] truncate">{row.itemName || '—'}</td>
                                <td className="p-2 text-xs max-w-[150px] truncate">{row.facilityName || '—'}</td>
                                <td className="p-2 text-xs text-right font-semibold">{row.backendQty ?? '—'}</td>
                                <td className="p-2 text-xs text-right font-semibold">{row.frontendQty ?? '—'}</td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* New Products */}
              {semanticPreview.newProducts.length > 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Tag className="h-4 w-4 text-amber-600" />
                    <p className="font-medium text-amber-800 text-sm">
                      {semanticPreview.newProducts.length} new product(s) will be auto-created
                      <span className="font-normal ml-1 text-amber-700">(needs ASG SKU mapping after upload)</span>
                    </p>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {semanticPreview.newProducts.map((p, i) => (
                      <div key={i} className="text-xs text-amber-700 flex justify-between">
                        <span className="truncate max-w-[60%]">{p.itemName || p.asin || `Item ${p.itemId}`}</span>
                        <span className="font-mono text-amber-500 ml-2">{p.placeholderSku}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
                  <CheckCircle2 className="h-4 w-4" />
                  All products already in master — no new products will be created.
                </div>
              )}

              {/* New Facilities (Blinkit Inventory / PO) */}
              {semanticPreview.newFacilities.length > 0 ? (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Building2 className="h-4 w-4 text-orange-600" />
                    <p className="font-medium text-orange-800 text-sm">
                      {semanticPreview.newFacilities.length} new Blinkit facility/facilities will be created in Distributor Facilities
                    </p>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {semanticPreview.newFacilities.map((f, i) => (
                      <div key={i} className="text-xs text-orange-700 flex gap-2">
                        <Building2 className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        <span>{f.facilityName}</span>
                        {f.facilityId ? <span className="text-orange-400">(ID: {f.facilityId})</span> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : semanticPreview.uploadType !== 'blinkit/sales' ? (
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
                  <CheckCircle2 className="h-4 w-4" />
                  All facilities already in master — no new facilities will be created.
                </div>
              ) : null}

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

              {/* PO Summary */}
              {semanticPreview.poSummary && semanticPreview.poSummary.length > 0 && (
                <div className="border rounded-lg">
                  <div className="bg-muted/30 px-3 py-2 border-b">
                    <p className="text-sm font-semibold">POs in file ({semanticPreview.poSummary.length})</p>
                  </div>
                  <div className="max-h-48 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left p-2 font-medium">PO Number</th>
                          <th className="text-left p-2 font-medium">Ship To</th>
                          <th className="text-left p-2 font-medium">PO Date</th>
                          <th className="text-left p-2 font-medium">Payment Terms</th>
                          <th className="text-left p-2 font-medium">Expected Delivery</th>
                          <th className="text-left p-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {semanticPreview.poSummary.map((po, i) => (
                          <tr key={i} className="border-t hover:bg-muted/20">
                            <td className="p-2 font-mono font-semibold">{po.poNumber}</td>
                            <td className="p-2 max-w-[180px] truncate text-muted-foreground">{po.shipToName || '—'}</td>
                            <td className="p-2 text-muted-foreground">{po.poDate || '—'}</td>
                            <td className="p-2 text-muted-foreground">{po.paymentTerms || '—'}</td>
                            <td className="p-2 text-muted-foreground">{po.expectedDelivery || '—'}</td>
                            <td className="p-2">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                po.status === 'Delivered' ? 'bg-purple-100 text-purple-700' :
                                po.status === 'Dispatched' || po.status === 'In Transit' ? 'bg-blue-100 text-blue-700' :
                                po.status === 'Packed' ? 'bg-emerald-100 text-emerald-700' :
                                po.status === 'Cancelled' ? 'bg-red-100 text-red-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>{po.status || '—'}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Line Items Detail */}
              {semanticPreview.poItems && semanticPreview.poItems.length > 0 && (
                <div className="border rounded-lg">
                  <div className="bg-muted/30 px-3 py-2 border-b">
                    <p className="text-sm font-semibold">Line Items ({semanticPreview.poItems.length})</p>
                  </div>
                  <div className="max-h-96 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left p-2 font-medium">#</th>
                          <th className="text-left p-2 font-medium">PO Number</th>
                          <th className="text-left p-2 font-medium">S.No</th>
                          <th className="text-left p-2 font-medium">Eagle Code</th>
                          <th className="text-left p-2 font-medium">Item Code</th>
                          <th className="text-left p-2 font-medium">Item Name</th>
                          <th className="text-left p-2 font-medium">HSN</th>
                          <th className="text-left p-2 font-medium">Size</th>
                          <th className="text-right p-2 font-medium">MRP</th>
                          <th className="text-right p-2 font-medium">Qty</th>
                          <th className="text-left p-2 font-medium">UOM</th>
                          <th className="text-right p-2 font-medium">Unit Cost</th>
                          <th className="text-right p-2 font-medium">Discount</th>
                          <th className="text-right p-2 font-medium">Taxable Val</th>
                          <th className="text-right p-2 font-medium">CGST%</th>
                          <th className="text-right p-2 font-medium">CGST Amt</th>
                          <th className="text-right p-2 font-medium">SGST%</th>
                          <th className="text-right p-2 font-medium">SGST Amt</th>
                          <th className="text-right p-2 font-medium">IGST%</th>
                          <th className="text-right p-2 font-medium">IGST Amt</th>
                          <th className="text-right p-2 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {semanticPreview.poItems.map((item, idx) => (
                          <tr key={idx} className="border-t hover:bg-muted/20">
                            <td className="p-2 text-muted-foreground">{idx + 1}</td>
                            <td className="p-2 font-mono">{item.poNumber}</td>
                            <td className="p-2 text-muted-foreground">{item.sno ?? '—'}</td>
                            <td className="p-2 font-mono">{item.eagleCode ?? '—'}</td>
                            <td className="p-2 font-mono">{item.itemCode || '—'}</td>
                            <td className="p-2 max-w-[180px] truncate" title={item.itemName ?? ''}>{item.itemName || '—'}</td>
                            <td className="p-2 font-mono">{item.hsnCode || '—'}</td>
                            <td className="p-2">{item.size || '—'}</td>
                            <td className="p-2 text-right">₹{item.mrp?.toFixed(2) ?? '—'}</td>
                            <td className="p-2 text-right font-semibold text-blue-700">{item.qty ?? '—'}</td>
                            <td className="p-2">{item.uom || '—'}</td>
                            <td className="p-2 text-right">₹{item.unitBaseCost?.toFixed(2) ?? '—'}</td>
                            <td className="p-2 text-right">{item.discount != null ? `₹${item.discount.toFixed(2)}` : '—'}</td>
                            <td className="p-2 text-right font-semibold">{item.taxableValue != null ? `₹${item.taxableValue.toFixed(2)}` : '—'}</td>
                            <td className="p-2 text-right">{item.cgstRate != null ? `${item.cgstRate}%` : '—'}</td>
                            <td className="p-2 text-right">{item.cgstAmt != null ? `₹${item.cgstAmt.toFixed(2)}` : '—'}</td>
                            <td className="p-2 text-right">{item.sgstRate != null ? `${item.sgstRate}%` : '—'}</td>
                            <td className="p-2 text-right">{item.sgstAmt != null ? `₹${item.sgstAmt.toFixed(2)}` : '—'}</td>
                            <td className="p-2 text-right">{item.igstRate != null ? `${item.igstRate}%` : '—'}</td>
                            <td className="p-2 text-right">{item.igstAmt != null ? `₹${item.igstAmt.toFixed(2)}` : '—'}</td>
                            <td className="p-2 text-right font-semibold text-green-700">{item.totalAmount != null ? `₹${item.totalAmount.toFixed(2)}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t">
                <p className="text-sm text-muted-foreground">
                  {semanticPreview.validRows} row(s) • {semanticPreview.newProducts.length} new product(s) • {semanticPreview.newFacilities.length} new facility/facilities
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleCancelSemanticPreview} disabled={isUploading}>Cancel</Button>
                  <Button onClick={handleConfirmSemanticUpload} disabled={isUploading}>
                    {isUploading ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading...</>
                    ) : (
                      <><CheckCircle2 className="h-4 w-4 mr-2" />Confirm &amp; Upload</>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upload Result */}
        {uploadResult && (
          <Card className={`${uploadResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                {uploadResult.success ? <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" /> : <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />}
                <div className="flex-1">
                  <p className={`font-medium ${uploadResult.success ? 'text-green-800' : 'text-red-800'}`}>{uploadResult.message}</p>
                  {uploadResult.success && (
                    <div className="mt-2 grid grid-cols-3 gap-4 text-sm">
                      <div><span className="text-gray-600">Processed:</span> <span className="font-medium">{(uploadResult.data.rows_processed || 0) + (uploadResult.data.rows_created || 0) + (uploadResult.data.rows_updated || 0)}</span></div>
                      <div><span className="text-gray-600">Skipped:</span> <span className="font-medium">{uploadResult.data.rows_skipped}</span></div>
                      <div><span className="text-gray-600">Total:</span> <span className="font-medium">{uploadResult.data.total_rows}</span></div>
                    </div>
                  )}
                  {uploadResult.data.errors && uploadResult.data.errors.length > 0 && (
                    <div className="mt-3 p-2 bg-yellow-100 rounded text-xs text-yellow-800">
                      <p className="font-medium mb-1">Errors:</p>
                      <ul className="list-disc list-inside">
                        {uploadResult.data.errors.slice(0, 5).map((err, idx) => <li key={idx}>{err}</li>)}
                        {uploadResult.data.errors.length > 5 && <li>...and {uploadResult.data.errors.length - 5} more</li>}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-500" />
                <CardTitle>Blinkit Data Management</CardTitle>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleDownloadTemplate(activeTab === 'po' ? 'po' : activeTab)}>
                <Download className="h-4 w-4 mr-2" />
                Download Template
              </Button>
            </div>
            <CardDescription>
              Upload your Blinkit data files. A preview showing new products/facilities will appear before any data is saved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="sales" className="w-full" onValueChange={(v) => {
              setActiveTab(v);
              setUploadResult(null);
              setPdfExtractData(null);
              setSemanticPreview(null);
              setPackingAlerts([]);
              setInventoryWarnings([]);
            }}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="sales" className="flex items-center gap-2"><Zap className="h-4 w-4" />Sales Data</TabsTrigger>
                <TabsTrigger value="po" className="flex items-center gap-2"><FileText className="h-4 w-4" />PO Data</TabsTrigger>
                <TabsTrigger value="inventory" className="flex items-center gap-2"><Package className="h-4 w-4" />Inventory Info</TabsTrigger>
              </TabsList>

              {/* Sales Tab */}
              <TabsContent value="sales" className="space-y-4 mt-6">
                {isPreviewing && activeTab === 'sales' ? (
                  <div className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/30 rounded-lg py-32 px-8">
                    <Eye className="h-10 w-10 text-muted-foreground mb-3 animate-pulse" />
                    <p className="text-sm font-medium">Validating file…</p>
                    <p className="text-xs text-muted-foreground mt-1">Checking products against master</p>
                  </div>
                ) : (
                  <div
                    className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/30 rounded-lg py-32 px-8 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                    onClick={() => salesFileInputRef.current?.click()}
                  >
                    <Upload className="h-10 w-10 text-muted-foreground mb-3" />
                    <p className="text-sm font-medium">Drag and drop your Blinkit sales file here, or click to browse</p>
                    <p className="text-xs text-muted-foreground mt-1">Supported: .xlsx, .xls, .csv (max 10 MB) — preview before upload</p>
                  </div>
                )}
                <input ref={salesFileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleSalesFileChange} />
                <div className="px-1 space-y-1 text-sm">
                  <p className="font-medium">Expected Columns:</p>
                  <p className="text-muted-foreground">item_id, item_name, date, qty_sold, mrp, city_name, category, manufacturer_id, manufacturer_name</p>
                  <p className="text-xs text-muted-foreground">mrp = Total Revenue (qty_sold × unit price). Products auto-created if not found — preview shows which ones.</p>
                </div>
              </TabsContent>

              {/* PO Tab */}
              <TabsContent value="po" className="space-y-4 mt-6">
                {pdfExtractData ? (
                  <Card className="border-blue-200">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-blue-600" />
                        Extracted PO: {pdfExtractData.header?.po_number || '(PO Number not found)'}
                      </CardTitle>
                      <CardDescription>
                        {pdfExtractData.page_count} page(s), {pdfExtractData.item_count} line item(s). Review and confirm to save.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {pdfExtractData.duplicate_warning && (
                        <div className="p-3 bg-red-50 border border-red-400 rounded-lg flex items-start gap-2">
                          <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-red-800 text-sm">Duplicate PO — Cannot Save</p>
                            <p className="text-sm text-red-700 mt-0.5">{pdfExtractData.duplicate_warning}</p>
                          </div>
                        </div>
                      )}
                      {pdfExtractData.warnings.length > 0 && (
                        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                          <div className="flex items-center gap-2 mb-1">
                            <AlertTriangle className="h-4 w-4 text-yellow-600" />
                            <p className="font-medium text-yellow-800 text-sm">Extraction Warnings</p>
                          </div>
                          <ul className="list-disc list-inside text-xs text-yellow-700">
                            {pdfExtractData.warnings.map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                        </div>
                      )}
                      <div>
                        <h4 className="font-medium text-sm mb-3">PO Header</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          {([
                            ['PO Number', pdfExtractData.header?.po_number],
                            ['PO Date', pdfExtractData.header?.po_date],
                            ['Expected Delivery', pdfExtractData.header?.expected_delivery_date],
                            ['Payment Terms', pdfExtractData.header?.payment_terms],
                            ['Vendor Name', pdfExtractData.header?.vendor_name],
                            ['Vendor GSTIN', pdfExtractData.header?.vendor_gstin],
                            ['Ship To', pdfExtractData.header?.ship_to_name],
                            ['Grand Total', formatINR(pdfExtractData.header?.grand_total)],
                          ] as [string, any][]).map(([label, value], idx) => (
                            <div key={idx} className="bg-gray-50 rounded px-3 py-2">
                              <span className="text-muted-foreground text-xs">{label}</span>
                              <p className="font-medium truncate">{value || '-'}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h4 className="font-medium text-sm mb-3">Line Items ({pdfExtractData.items.length})</h4>
                        <div className="overflow-x-auto bg-white rounded-lg border max-h-80 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50 border-b sticky top-0">
                              <tr>
                                {['S.No', 'Item Code', 'Item Name', 'MRP', 'Qty', 'Unit Cost', 'Taxable Value', 'Total'].map(h => (
                                  <th key={h} className="px-3 py-2 text-left font-medium text-gray-700 whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {pdfExtractData.items.map((item, idx) => (
                                <tr key={idx} className="border-b hover:bg-gray-50">
                                  <td className="px-3 py-2">{item.sno ?? '-'}</td>
                                  <td className="px-3 py-2 font-mono">{item.item_code ?? '-'}</td>
                                  <td className="px-3 py-2 max-w-[200px] truncate" title={item.item_name}>{item.item_name ?? '-'}</td>
                                  <td className="px-3 py-2">{item.mrp ?? '-'}</td>
                                  <td className="px-3 py-2 font-semibold">{item.qty ?? '-'}</td>
                                  <td className="px-3 py-2">{item.unit_base_cost ?? '-'}</td>
                                  <td className="px-3 py-2">{item.taxable_value?.toLocaleString('en-IN') ?? '-'}</td>
                                  <td className="px-3 py-2 font-semibold">{item.total_amount?.toLocaleString('en-IN') ?? '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t">
                        <p className="text-sm text-muted-foreground">
                          {pdfExtractData.duplicate_warning ? 'This PO already exists — saving blocked.' : `${pdfExtractData.item_count} item(s) will be saved`}
                        </p>
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={handleCancelPdfPreview} disabled={isConfirming}>Cancel</Button>
                          <Button onClick={handleConfirmPdfUpload} disabled={isConfirming || !!pdfExtractData.duplicate_warning}>
                            {isConfirming ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : <><CheckCircle2 className="h-4 w-4 mr-2" />Confirm &amp; Save to Database</>}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ) : isPreviewing && activeTab === 'po' ? (
                  <div className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/30 rounded-lg p-10">
                    <Eye className="h-10 w-10 text-muted-foreground mb-3 animate-pulse" />
                    <p className="text-sm font-medium">Validating PO file…</p>
                    <p className="text-xs text-muted-foreground mt-1">Checking facilities against master</p>
                  </div>
                ) : (
                  <>
                    <FileUpload
                      accept=".pdf,.csv,.xlsx,.xls"
                      maxSize={20}
                      onUpload={handlePOFileUpload}
                      description={isExtracting ? "Extracting PO data from PDF..." : "Drag and drop your PO file — PDF (Eagle Network) or CSV/Excel"}
                    />
                    {isExtracting && (
                      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
                        <Loader2 className="h-4 w-4 animate-spin" />Parsing PDF and extracting PO data...
                      </div>
                    )}
                    <div className="px-1 space-y-1 text-sm">
                      <p className="font-medium">Supported formats:</p>
                      <p className="text-muted-foreground"><span className="font-medium text-foreground">PDF:</span> Eagle Network PO — auto-extracted with preview</p>
                      <p className="text-muted-foreground"><span className="font-medium text-foreground">CSV/Excel:</span> PONumber, ShipToName, ItemCode, QTY, UnitBaseCost... — shows facility preview before saving</p>
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
                            <th className="text-left p-2 font-medium">Item Code</th>
                            <th className="text-left p-2 font-medium">Item Name</th>
                            <th className="text-right p-2 font-medium">Ordered</th>
                            <th className="text-right p-2 font-medium">Packed</th>
                            <th className="text-right p-2 font-medium text-red-700">Still to Pack</th>
                          </tr>
                        </thead>
                        <tbody>
                          {packingAlerts.map((alert, i) => (
                            <tr key={i} className="border-t border-amber-200 bg-white">
                              <td className="p-2 font-mono">{alert.item_code}</td>
                              <td className="p-2 max-w-[200px] truncate" title={alert.item_name}>{alert.item_name}</td>
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
                            <th className="text-left p-2 font-medium">Item Code</th>
                            <th className="text-left p-2 font-medium">Item Name</th>
                            <th className="text-right p-2 font-medium">Ordered</th>
                            <th className="text-right p-2 font-medium">Was Packed</th>
                            <th className="text-right p-2 font-medium text-red-700">Shortfall</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inventoryWarnings.map((w, i) => (
                            <tr key={i} className="border-t border-red-200 bg-white">
                              <td className="p-2 font-mono">{w.item_code}</td>
                              <td className="p-2 max-w-[200px] truncate" title={w.item_name}>{w.item_name}</td>
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


              {/* Inventory Tab */}
              <TabsContent value="inventory" className="space-y-4 mt-6">
                {isPreviewing && activeTab === 'inventory' ? (
                  <div className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/30 rounded-lg py-32 px-8">
                    <Eye className="h-10 w-10 text-muted-foreground mb-3 animate-pulse" />
                    <p className="text-sm font-medium">Validating file…</p>
                    <p className="text-xs text-muted-foreground mt-1">Checking products and facilities against master</p>
                  </div>
                ) : (
                  <div
                    className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/30 rounded-lg py-32 px-8 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                    onClick={() => inventoryFileInputRef.current?.click()}
                  >
                    <Upload className="h-10 w-10 text-muted-foreground mb-3" />
                    <p className="text-sm font-medium">Drag and drop your Blinkit inventory file here, or click to browse</p>
                    <p className="text-xs text-muted-foreground mt-1">Supported: .xlsx, .xls, .csv (max 10 MB) — preview before upload</p>
                  </div>
                )}
                <input ref={inventoryFileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleInventoryFileChange} />
                <div className="px-1 space-y-1 text-sm">
                  <p className="font-medium">Expected Columns:</p>
                  <p className="text-muted-foreground">item_id, item_name, backend_inv_qty, frontend_inv_qty, backend_facility_name, backend_facility_id, created_at</p>
                  <p className="text-xs text-muted-foreground">New products and new facilities are shown in preview before upload — you confirm before anything is created.</p>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
