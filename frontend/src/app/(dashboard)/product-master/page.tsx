'use client';

import { useState, useEffect, useRef } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Upload, Package, Database, Plus, FileText,
  CheckCircle, XCircle, AlertCircle, Download, Eye, RefreshCw,
} from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';

interface PreviewRow {
  rowNumber: number;
  status: 'valid' | 'duplicate' | 'error';
  reason: string | null;
  productName: string;
  asgSku: string;
  amazonId: string | null;
  blinkitId: string | null;
  gs1: string | null;
  brand: string | null;
  category: string | null;
  unitPrice: number | null;
  unitWeight: string | null;
  packSize: number | null;
}

interface PreviewResult {
  success: boolean;
  totalRows: number;
  valid: number;
  duplicates: number;
  errors: number;
  rows: PreviewRow[];
}

interface UploadResult {
  success: boolean;
  message: string;
  summary: { totalRows: number; uploaded: number; skipped: number; errors: number };
  uploadedProducts: { asgSku: string; productName: string }[];
  skippedProducts: { asgSku: string; productName: string; reason: string }[];
  errors: { row: number; error: string }[];
}

export default function ProductMasterPage() {
  const [isSaving, setIsSaving] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [formData, setFormData] = useState({
    productName: '',
    asgSku: '',
    amazonId: '',
    blinkitId: '',
    gs1: '',
    brand: '',
    category: '',
    unitPrice: '',
    unitWeight: '',
    packSize: '',
  });

  // Upload flow state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext || '')) {
      toast.error('Invalid file type. Please upload CSV or Excel file');
      return;
    }

    setSelectedFile(file);
    setPreviewResult(null);
    setUploadResult(null);

    try {
      setIsPreviewing(true);
      const result = await api.upload.productsPreview(file) as PreviewResult;
      setPreviewResult(result);
    } catch (error: any) {
      toast.error(error.message || 'Failed to preview file');
    } finally {
      setIsPreviewing(false);
      // Reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleConfirmUpload = async () => {
    if (!selectedFile) return;
    try {
      setIsUploading(true);
      const result = await api.upload.products(selectedFile) as UploadResult;
      setUploadResult(result);
      setPreviewResult(null);
      setSelectedFile(null);
      toast.success(result.message, {
        description: `${result.summary.uploaded} added, ${result.summary.skipped} skipped`,
      });
      fetchProducts();
    } catch (error: any) {
      toast.error(error.message || 'Failed to upload file');
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setPreviewResult(null);
    setUploadResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSaveProduct = async () => {
    if (!formData.productName || !formData.asgSku) {
      toast.error('Product Name and ASG SKU are required');
      return;
    }
    try {
      setIsSaving(true);
      const payload = {
        ...formData,
        unitPrice: formData.unitPrice ? parseFloat(formData.unitPrice) : undefined,
        packSize: formData.packSize ? parseInt(formData.packSize) : undefined,
      };
      await api.products.create(payload);
      toast.success('Product added successfully!', {
        description: `${formData.productName} has been added to the product master`,
      });
      setFormData({
        productName: '', asgSku: '', amazonId: '', blinkitId: '',
        gs1: '', brand: '', category: '', unitPrice: '', unitWeight: '', packSize: '',
      });
      fetchProducts();
    } catch (error: any) {
      toast.error(error.message || 'Failed to add product');
    } finally {
      setIsSaving(false);
    }
  };

  const fetchProducts = async () => {
    try {
      setIsLoading(true);
      const response: any = await api.products.getAll({ page: 1, page_size: 1000 });
      const arr = Array.isArray(response) ? response : (response?.items || response?.data || []);
      setProducts(arr);
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchProducts(); }, []);

  const statusBadge = (status: PreviewRow['status']) => {
    if (status === 'valid') return <Badge className="bg-green-100 text-green-700 border-green-200">Valid</Badge>;
    if (status === 'duplicate') return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">Duplicate</Badge>;
    return <Badge className="bg-red-100 text-red-700 border-red-200">Error</Badge>;
  };

  const rowBg = (status: PreviewRow['status']) => {
    if (status === 'valid') return 'bg-green-50/40';
    if (status === 'duplicate') return 'bg-yellow-50/60';
    return 'bg-red-50/60';
  };

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-blue-500" />
                Product Master Management
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const headers = ['Product Name', 'ASG SKU ID', 'Amazon ID', 'Blinkit ID', 'GS1', 'Brand', 'Category', 'Unit Price', 'Unit Weight', 'Pack Size'];
                  const sample = [
                    ['ASG Mantra Rosemary Hair Oil 100ml', 'ASG-001', 'B0CRZ1J1K1', '12345001', '8906123450011', 'ASG Mantra', 'Hair Care', '299.00', '100g', '1'],
                    ['ASG Mantra Vitamin C Face Wash 100g', 'ASG-004', 'B0CRZ1J4K4', '12345004', '8906123450042', 'ASG Mantra', 'Skin Care', '249.00', '100g', '1'],
                  ];
                  const csv = [headers.join(','), ...sample.map(r => r.join(','))].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'product_master_template.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="h-4 w-4 mr-2" />
                Download Template
              </Button>
            </div>
            <CardDescription>Upload your master product list or add products manually</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="excel" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="excel" className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Excel / CSV Upload
                </TabsTrigger>
                <TabsTrigger value="manual" className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add Manually
                </TabsTrigger>
              </TabsList>

              {/* ── Excel Upload Tab ── */}
              <TabsContent value="excel" className="mt-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Column: Upload Section */}
                  <div className="space-y-6 lg:col-span-2">
                    {/* Drop zone — only show when no preview/result */}
                    {!previewResult && !uploadResult && (
                  <div className="border-2 border-dashed rounded-lg py-32 px-8 text-center bg-muted/30">
                    <div className="flex justify-center mb-4">
                      <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center">
                        <Package className="h-8 w-8 text-blue-600" />
                      </div>
                    </div>
                    <h3 className="text-xl font-semibold mb-2">Upload Product Master File</h3>
                    <p className="text-sm text-muted-foreground mb-6">
                      Select a CSV or Excel file — a preview will appear before anything is saved
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <Button
                      size="lg"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isPreviewing}
                    >
                      {isPreviewing ? (
                        <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Analysing...</>
                      ) : (
                        <><Eye className="h-4 w-4 mr-2" />Choose File & Preview</>
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground mt-4">
                      Accepted formats: .xlsx, .xls, .csv
                    </p>
                  </div>
                )}

                {/* Expected Columns Section */}
                {!previewResult && !uploadResult && (
                  <div className="bg-muted/30 rounded-lg p-4">
                    <h4 className="font-semibold text-sm mb-2">Expected Columns:</h4>
                    <p className="text-sm text-muted-foreground">
                      Product Name, ASG-SKU-ID, Amazon ASIN, Blinkit SKU ID, GS-1 Code, Brand, Category, MRP, Unit Weight, Pack Size
                    </p>
                  </div>
                )}

                {/* ── PREVIEW RESULT ── */}
                {previewResult && !uploadResult && (
                  <div className="space-y-4">
                    {/* Summary bar */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <Card>
                        <CardContent className="p-4 flex items-center gap-2">
                          <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                          <div>
                            <p className="text-xs text-muted-foreground">Total Rows</p>
                            <p className="text-2xl font-bold">{previewResult.totalRows}</p>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                          <div>
                            <p className="text-xs text-muted-foreground">Will be Added</p>
                            <p className="text-2xl font-bold text-green-600">{previewResult.valid}</p>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-yellow-500 shrink-0" />
                          <div>
                            <p className="text-xs text-muted-foreground">Duplicate (skip)</p>
                            <p className="text-2xl font-bold text-yellow-600">{previewResult.duplicates}</p>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                          <div>
                            <p className="text-xs text-muted-foreground">Errors (skip)</p>
                            <p className="text-2xl font-bold text-red-600">{previewResult.errors}</p>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Preview table */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Eye className="h-4 w-4 text-blue-500" />
                          File Preview — {previewResult.totalRows} rows
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="overflow-auto max-h-96 rounded-b-lg">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/70 sticky top-0">
                              <tr>
                                <th className="text-left p-2 font-medium whitespace-nowrap">#</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">Status</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">Product Name <span className="text-red-500">*</span></th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">ASG SKU <span className="text-red-500">*</span></th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">Amazon ASIN</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">Blinkit ID</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">Brand</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">Category</th>
                                <th className="text-right p-2 font-medium whitespace-nowrap">Price</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {previewResult.rows.map((row) => (
                                <tr key={row.rowNumber} className={`border-t ${rowBg(row.status)}`}>
                                  <td className="p-2 text-muted-foreground">{row.rowNumber}</td>
                                  <td className="p-2">{statusBadge(row.status)}</td>
                                  <td className="p-2 font-medium max-w-[180px] truncate">
                                    {row.productName || <span className="text-red-400 italic">missing</span>}
                                  </td>
                                  <td className="p-2 font-mono">
                                    {row.asgSku || <span className="text-red-400 italic">missing</span>}
                                  </td>
                                  <td className="p-2 font-mono text-muted-foreground">{row.amazonId || '—'}</td>
                                  <td className="p-2 font-mono text-muted-foreground">{row.blinkitId || '—'}</td>
                                  <td className="p-2 text-muted-foreground">{row.brand || '—'}</td>
                                  <td className="p-2 text-muted-foreground">{row.category || '—'}</td>
                                  <td className="p-2 text-right text-muted-foreground">
                                    {row.unitPrice != null ? `₹${row.unitPrice}` : '—'}
                                  </td>
                                  <td className="p-2 text-muted-foreground italic max-w-[200px] truncate">
                                    {row.reason || ''}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Action buttons */}
                    <div className="flex items-center gap-3">
                      <Button
                        onClick={handleConfirmUpload}
                        disabled={isUploading || previewResult.valid === 0}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        {isUploading ? (
                          <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Uploading...</>
                        ) : (
                          <><CheckCircle className="h-4 w-4 mr-2" />Upload {previewResult.valid} valid product{previewResult.valid !== 1 ? 's' : ''}</>
                        )}
                      </Button>
                      <Button variant="outline" onClick={handleReset} disabled={isUploading}>
                        Choose another file
                      </Button>
                    </div>

                    {previewResult.valid === 0 && (
                      <p className="text-sm text-red-500">
                        No valid rows to upload. Fix the errors above and try again.
                      </p>
                    )}
                  </div>
                )}

                {/* ── UPLOAD RESULT ── */}
                {uploadResult && (
                  <div className="space-y-4">
                    {/* Summary */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <Card>
                        <CardContent className="p-4 flex items-center gap-2">
                          <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                          <div>
                            <p className="text-xs text-muted-foreground">Total Rows</p>
                            <p className="text-2xl font-bold">{uploadResult.summary.totalRows}</p>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                          <div>
                            <p className="text-xs text-muted-foreground">Uploaded</p>
                            <p className="text-2xl font-bold text-green-600">{uploadResult.summary.uploaded}</p>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-yellow-500 shrink-0" />
                          <div>
                            <p className="text-xs text-muted-foreground">Skipped</p>
                            <p className="text-2xl font-bold text-yellow-600">{uploadResult.summary.skipped}</p>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                          <div>
                            <p className="text-xs text-muted-foreground">Errors</p>
                            <p className="text-2xl font-bold text-red-600">{uploadResult.summary.errors}</p>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Uploaded */}
                    {uploadResult.uploadedProducts?.length > 0 && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                            Added Products ({uploadResult.uploadedProducts.length})
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="max-h-48 overflow-y-auto space-y-1">
                            {uploadResult.uploadedProducts.map((p, i) => (
                              <div key={i} className="flex items-center justify-between p-2 bg-green-50 rounded text-sm">
                                <span className="font-medium">{p.productName}</span>
                                <span className="text-muted-foreground font-mono text-xs">{p.asgSku}</span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Skipped duplicates */}
                    {uploadResult.skippedProducts?.length > 0 && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <XCircle className="h-4 w-4 text-yellow-500" />
                            Skipped — Duplicate ({uploadResult.skippedProducts.length})
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="max-h-48 overflow-y-auto space-y-1">
                            {uploadResult.skippedProducts.map((p, i) => (
                              <div key={i} className="p-2 bg-yellow-50 rounded text-sm">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">{p.productName}</span>
                                  <span className="font-mono text-xs text-muted-foreground">{p.asgSku}</span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">{p.reason}</p>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Errors */}
                    {uploadResult.errors?.length > 0 && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-red-500" />
                            Errors ({uploadResult.errors.length})
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="max-h-48 overflow-y-auto space-y-1">
                            {uploadResult.errors.map((e, i) => (
                              <div key={i} className="p-2 bg-red-50 rounded text-sm flex items-center justify-between">
                                <span className="font-medium">Row {e.row}</span>
                                <span className="text-red-600 text-xs">{e.error}</span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    <Button variant="outline" onClick={handleReset}>
                      <Upload className="h-4 w-4 mr-2" />
                      Upload another file
                    </Button>
                  </div>
                )}
                  </div>

                  {/* Right Column: Data Structure Preview */}
                  <Card className="lg:col-span-1">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <FileText className="h-5 w-5 text-blue-500" />
                        Data Structure Preview
                      </CardTitle>
                      <CardDescription>Sample format showing expected columns and data types</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Sample Data Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left p-2 font-semibold text-xs">Product Name</th>
                              <th className="text-left p-2 font-semibold text-xs">ASG-SKU-ID</th>
                              <th className="text-left p-2 font-semibold text-xs">Amazon ASIN</th>
                              <th className="text-left p-2 font-semibold text-xs">Blinkit SKU</th>
                              <th className="text-left p-2 font-semibold text-xs">GS-1</th>
                            </tr>
                          </thead>
                          <tbody className="text-xs">
                            <tr className="border-b">
                              <td className="p-2">Epsom Salt 1KG</td>
                              <td className="p-2 font-mono">ASG-OM-EPSOM-1KG</td>
                              <td className="p-2 font-mono">B07C16V2TC</td>
                              <td className="p-2 font-mono">BLK-EP-001</td>
                              <td className="p-2 font-mono">890617250XX</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-2">Rosemary Oil 15ML</td>
                              <td className="p-2 font-mono">ASG-OM-ROSE-15ML</td>
                              <td className="p-2 font-mono">B86XX40TV8</td>
                              <td className="p-2 font-mono">BLK-RO-002</td>
                              <td className="p-2 font-mono">890617250XX</td>
                            </tr>
                            <tr className="border-b">
                              <td className="p-2">Tea Tree Oil 15ML</td>
                              <td className="p-2 font-mono">ASG-OM-TT-15ML</td>
                              <td className="p-2 font-mono">B882M0DKCL</td>
                              <td className="p-2 font-mono">BLK-TT-003</td>
                              <td className="p-2 font-mono">890617250XX</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {/* Required Columns */}
                      <div className="space-y-2">
                        <h4 className="font-semibold text-sm">Required Columns</h4>
                        <ul className="text-xs text-muted-foreground space-y-1 ml-4">
                          <li>• Product Name - Full product name</li>
                          <li>• ASG-SKU-ID - Internal ASG SKU identifier</li>
                        </ul>
                      </div>

                      {/* Optional Columns */}
                      <div className="space-y-2">
                        <h4 className="font-semibold text-sm">Optional Columns</h4>
                        <ul className="text-xs text-muted-foreground space-y-1 ml-4">
                          <li>• Amazon ASIN - Amazon product identifier</li>
                          <li>• Blinkit SKU - Blinkit product identifier</li>
                          <li>• GS-1 Code - Global barcode number</li>
                          <li>• Brand - Product brand name</li>
                          <li>• Category - Product category</li>
                          <li>• MRP - Maximum retail price</li>
                          <li>• Unit Weight - Product weight with unit</li>
                          <li>• Pack Size - Number of units per pack</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* ── Add Manually Tab ── */}
              <TabsContent value="manual" className="space-y-4 mt-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Plus className="h-5 w-5 text-blue-500" />
                        Add New Product
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2 space-y-2">
                          <label className="text-sm font-medium">
                            Product Name <span className="text-red-500">*</span>
                          </label>
                          <Input
                            placeholder="Enter product name"
                            value={formData.productName}
                            onChange={(e) => handleInputChange('productName', e.target.value)}
                          />
                        </div>

                        <div className="col-span-2 space-y-2">
                          <label className="text-sm font-medium">
                            ASG SKU <span className="text-red-500">*</span>
                          </label>
                          <Input
                            placeholder="ASG-001"
                            value={formData.asgSku}
                            onChange={(e) => handleInputChange('asgSku', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Amazon ASIN</label>
                          <Input
                            placeholder="B07C16V2TC"
                            value={formData.amazonId}
                            onChange={(e) => handleInputChange('amazonId', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Blinkit SKU ID</label>
                          <Input
                            placeholder="12345001"
                            value={formData.blinkitId}
                            onChange={(e) => handleInputChange('blinkitId', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">GS-1 Code</label>
                          <Input
                            placeholder="890617250XXXX"
                            value={formData.gs1}
                            onChange={(e) => handleInputChange('gs1', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Brand</label>
                          <Input
                            placeholder="Brand name"
                            value={formData.brand}
                            onChange={(e) => handleInputChange('brand', e.target.value)}
                          />
                        </div>

                        <div className="col-span-2 space-y-2">
                          <label className="text-sm font-medium">Category</label>
                          <Input
                            placeholder="e.g. Hair Care"
                            value={formData.category}
                            onChange={(e) => handleInputChange('category', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Unit Weight</label>
                          <Input
                            placeholder="100g / 250ml"
                            value={formData.unitWeight}
                            onChange={(e) => handleInputChange('unitWeight', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Pack Size</label>
                          <Input
                            type="number"
                            placeholder="1"
                            value={formData.packSize}
                            onChange={(e) => handleInputChange('packSize', e.target.value)}
                          />
                        </div>

                        <div className="col-span-2 space-y-2">
                          <label className="text-sm font-medium">Unit Price (MRP)</label>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="299.00"
                            value={formData.unitPrice}
                            onChange={(e) => handleInputChange('unitPrice', e.target.value)}
                          />
                        </div>
                      </div>

                      <Button
                        onClick={handleSaveProduct}
                        disabled={isSaving}
                        className="w-full bg-blue-600 hover:bg-blue-700"
                      >
                        {isSaving ? 'Saving...' : 'Add Product'}
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Product list */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <FileText className="h-5 w-5 text-blue-500" />
                        All Products ({products.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-y-auto max-h-[560px]">
                        {isLoading ? (
                          <div className="flex items-center justify-center h-64">
                            <p className="text-muted-foreground">Loading...</p>
                          </div>
                        ) : products.length === 0 ? (
                          <div className="flex items-center justify-center h-64">
                            <div className="text-center text-muted-foreground">
                              <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                              <p>No products found</p>
                              <p className="text-sm">Use the form or upload to add products</p>
                            </div>
                          </div>
                        ) : (
                          <div className="divide-y">
                            {products.map((product) => (
                              <div
                                key={product.id}
                                className="px-4 py-3 hover:bg-muted/50 transition-colors"
                              >
                                <p className="font-medium text-sm truncate">{product.productName}</p>
                                <div className="flex items-center gap-3 mt-1">
                                  <span className="text-xs text-muted-foreground font-mono truncate">SKU: {product.asgSku}</span>
                                  {product.amazonId && (
                                    <span className="text-xs text-muted-foreground font-mono shrink-0">ASIN: {product.amazonId}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
