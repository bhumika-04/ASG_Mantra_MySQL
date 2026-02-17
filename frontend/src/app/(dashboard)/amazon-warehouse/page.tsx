'use client';

import { useState, useEffect, useRef } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Upload, Warehouse, Plus, FileText, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';

export default function AmazonWarehousePage() {
  const [isSaving, setIsSaving] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [formData, setFormData] = useState({
    warehouseCode: '',
    warehouseName: '',
    city: '',
    state: '',
    region: '',
    fcType: '',
    isActive: true,
  });

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const fetchWarehouses = async () => {
    try {
      setIsLoading(true);
      const data: any = await api.warehouses.getAmazon();
      setWarehouses(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching warehouses:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveWarehouse = async () => {
    if (!formData.warehouseCode || !formData.warehouseName || !formData.state) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      setIsSaving(true);
      const payload = {
        warehouseCode: formData.warehouseCode,
        warehouseName: formData.warehouseName,
        channel: 'Amazon',
        city: formData.city || undefined,
        state: formData.state,
        region: formData.region || undefined,
        fcType: formData.fcType || undefined,
        isActive: formData.isActive,
      };

      await api.warehouses.create('amazon', payload);

      toast.success('Fulfillment Center added successfully!', {
        description: `${formData.warehouseName} has been added`,
      });

      // Reset form
      setFormData({
        warehouseCode: '',
        warehouseName: '',
        city: '',
        state: '',
        region: '',
        fcType: '',
        isActive: true,
      });

      // Refresh list
      fetchWarehouses();

    } catch (error: any) {
      console.error('Error saving warehouse:', error);
      toast.error(error.message || 'Failed to add fulfillment center');
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(fileExtension || '')) {
      toast.error('Invalid file type. Please upload CSV or Excel file');
      return;
    }

    try {
      setIsUploading(true);
      setUploadResults(null);

      const result: any = await api.warehouses.uploadAmazon(file);

      setUploadResults(result);

      toast.success(result.message, {
        description: `${result.summary.uploaded} warehouses uploaded, ${result.summary.skipped} skipped`,
      });

      fetchWarehouses();
    } catch (error: any) {
      console.error('Error uploading warehouses:', error);
      toast.error(error.message || 'Failed to upload file');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  useEffect(() => {
    fetchWarehouses();
  }, []);
  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Warehouse className="h-5 w-5 text-orange-500" />
              Amazon FC Management
            </CardTitle>
            <CardDescription>
              Upload your Amazon Fulfillment Center master list or add entries manually
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="excel" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="excel" className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Excel Upload
                </TabsTrigger>
                <TabsTrigger value="manual" className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add Manually
                </TabsTrigger>
              </TabsList>

              {/* Excel Upload Tab */}
              <TabsContent value="excel" className="space-y-6 mt-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left side - Upload */}
                  <div className="lg:col-span-2">
                    <div className="border-2 border-dashed rounded-lg p-12 text-center bg-muted/30">
                      <div className="flex justify-center mb-4">
                        <div className="h-16 w-16 rounded-full bg-orange-100 flex items-center justify-center">
                          <Warehouse className="h-8 w-8 text-orange-600" />
                        </div>
                      </div>
                      <h3 className="text-xl font-semibold mb-2">Upload Amazon FC Master File</h3>
                      <p className="text-muted-foreground mb-4">
                        Upload your Amazon Fulfillment Center list
                      </p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                      <Button
                        size="lg"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        {isUploading ? 'Uploading...' : 'Choose Files'}
                      </Button>
                      <p className="text-xs text-muted-foreground mt-4">
                        Accepted formats: .xlsx, .xls, .csv
                      </p>
                    </div>

                    <div className="bg-muted/50 rounded-lg p-4 mt-6">
                      <h4 className="font-medium mb-2">Expected Columns:</h4>
                      <p className="text-sm text-muted-foreground">
                        FC Code, FC Name, City, State, Region, FC Type, Status
                      </p>
                    </div>

                    {/* Upload Results */}
                    {uploadResults && (
                      <div className="space-y-4 mt-6">
                        {/* Summary Stats */}
                        <div className="grid grid-cols-4 gap-4">
                          <Card>
                            <CardContent className="p-4">
                              <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-blue-500" />
                                <div>
                                  <p className="text-xs text-muted-foreground">Total Rows</p>
                                  <p className="text-2xl font-bold">{uploadResults.summary.totalRows}</p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="p-4">
                              <div className="flex items-center gap-2">
                                <CheckCircle className="h-4 w-4 text-green-500" />
                                <div>
                                  <p className="text-xs text-muted-foreground">Uploaded</p>
                                  <p className="text-2xl font-bold text-green-600">{uploadResults.summary.uploaded}</p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="p-4">
                              <div className="flex items-center gap-2">
                                <XCircle className="h-4 w-4 text-yellow-500" />
                                <div>
                                  <p className="text-xs text-muted-foreground">Skipped</p>
                                  <p className="text-2xl font-bold text-yellow-600">{uploadResults.summary.skipped}</p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="p-4">
                              <div className="flex items-center gap-2">
                                <AlertCircle className="h-4 w-4 text-red-500" />
                                <div>
                                  <p className="text-xs text-muted-foreground">Errors</p>
                                  <p className="text-2xl font-bold text-red-600">{uploadResults.summary.errors}</p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </div>

                        {/* Uploaded Warehouses */}
                        {uploadResults.uploadedWarehouses && uploadResults.uploadedWarehouses.length > 0 && (
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-sm flex items-center gap-2">
                                <CheckCircle className="h-4 w-4 text-green-500" />
                                Uploaded Warehouses ({uploadResults.uploadedWarehouses.length})
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="max-h-48 overflow-y-auto space-y-2">
                                {uploadResults.uploadedWarehouses.map((warehouse: any, index: number) => (
                                  <div key={index} className="flex items-center justify-between p-2 bg-green-50 rounded text-sm">
                                    <span className="font-medium">{warehouse.warehouseName}</span>
                                    <span className="text-muted-foreground">{warehouse.warehouseCode}</span>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {/* Skipped Warehouses */}
                        {uploadResults.skippedWarehouses && uploadResults.skippedWarehouses.length > 0 && (
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-sm flex items-center gap-2">
                                <XCircle className="h-4 w-4 text-yellow-500" />
                                Skipped Warehouses ({uploadResults.skippedWarehouses.length})
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="max-h-48 overflow-y-auto space-y-2">
                                {uploadResults.skippedWarehouses.map((warehouse: any, index: number) => (
                                  <div key={index} className="p-2 bg-yellow-50 rounded text-sm">
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium">{warehouse.warehouseName}</span>
                                      <span className="text-muted-foreground">{warehouse.warehouseCode}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">{warehouse.reason}</p>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {/* Errors */}
                        {uploadResults.errors && uploadResults.errors.length > 0 && (
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-sm flex items-center gap-2">
                                <AlertCircle className="h-4 w-4 text-red-500" />
                                Errors ({uploadResults.errors.length})
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="max-h-48 overflow-y-auto space-y-2">
                                {uploadResults.errors.map((error: any, index: number) => (
                                  <div key={index} className="p-2 bg-red-50 rounded text-sm">
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium">Row {error.row}</span>
                                      <span className="text-red-600 text-xs">{error.error}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right side - Data Structure Preview */}
                  <div className="lg:col-span-1">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <FileText className="h-4 w-4 text-orange-500" />
                          Data Structure Preview
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
                                <th className="text-left p-2 font-medium whitespace-nowrap">FC Code *</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">FC Name *</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">City</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">State *</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">Region</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">FC Type</th>
                                <th className="text-left p-2 font-medium whitespace-nowrap">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="border-t">
                                <td className="p-2 font-mono whitespace-nowrap">DEL5</td>
                                <td className="p-2 whitespace-nowrap">Gurugram FC</td>
                                <td className="p-2 whitespace-nowrap">Gurugram</td>
                                <td className="p-2 whitespace-nowrap">Haryana</td>
                                <td className="p-2 whitespace-nowrap">North</td>
                                <td className="p-2 whitespace-nowrap">Standard</td>
                                <td className="p-2 whitespace-nowrap">Active</td>
                              </tr>
                              <tr className="border-t">
                                <td className="p-2 font-mono whitespace-nowrap">DEL4</td>
                                <td className="p-2 whitespace-nowrap">Delhi FC</td>
                                <td className="p-2 whitespace-nowrap">New Delhi</td>
                                <td className="p-2 whitespace-nowrap">Delhi</td>
                                <td className="p-2 whitespace-nowrap">North</td>
                                <td className="p-2 whitespace-nowrap">Sortable</td>
                                <td className="p-2 whitespace-nowrap">Active</td>
                              </tr>
                              <tr className="border-t">
                                <td className="p-2 font-mono whitespace-nowrap">BOM7</td>
                                <td className="p-2 whitespace-nowrap">Mumbai FC</td>
                                <td className="p-2 whitespace-nowrap">Mumbai</td>
                                <td className="p-2 whitespace-nowrap">Maharashtra</td>
                                <td className="p-2 whitespace-nowrap">West</td>
                                <td className="p-2 whitespace-nowrap">Large</td>
                                <td className="p-2 whitespace-nowrap">Active</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        <div className="space-y-3 pt-2 border-t">
                          <div>
                            <h4 className="font-medium text-sm mb-1">Required Columns <span className="text-red-500">*</span></h4>
                            <p className="text-xs text-muted-foreground">FC Code, FC Name, State</p>
                          </div>
                          <div>
                            <h4 className="font-medium text-sm mb-1">Optional Columns</h4>
                            <p className="text-xs text-muted-foreground">City, Region, FC Type, Status</p>
                          </div>
                          <div>
                            <h4 className="font-medium text-sm mb-1">Notes</h4>
                            <ul className="text-xs text-muted-foreground space-y-0.5">
                              <li>• Duplicate FC Code rows are skipped</li>
                              <li>• Status defaults to Active if omitted</li>
                              <li>• Region: North, South, East, West, Central</li>
                            </ul>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </TabsContent>

              {/* Add Manually Tab */}
              <TabsContent value="manual" className="space-y-4 mt-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left side - Add Form */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Plus className="h-5 w-5 text-orange-500" />
                        Add New Fulfillment Center
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">
                            FC Code <span className="text-destructive">*</span>
                          </label>
                          <Input
                            type="text"
                            placeholder="e.g., DEL5"
                            value={formData.warehouseCode}
                            onChange={(e) => handleInputChange('warehouseCode', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">
                            FC Name <span className="text-destructive">*</span>
                          </label>
                          <Input
                            type="text"
                            placeholder="e.g., Gurugram FC"
                            value={formData.warehouseName}
                            onChange={(e) => handleInputChange('warehouseName', e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">City</label>
                          <Input
                            type="text"
                            placeholder="e.g., Gurugram"
                            value={formData.city}
                            onChange={(e) => handleInputChange('city', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">
                            State <span className="text-destructive">*</span>
                          </label>
                          <Input
                            type="text"
                            placeholder="e.g., Haryana"
                            value={formData.state}
                            onChange={(e) => handleInputChange('state', e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Region</label>
                          <Select value={formData.region} onValueChange={(value) => handleInputChange('region', value)}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select region" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="North">North</SelectItem>
                              <SelectItem value="South">South</SelectItem>
                              <SelectItem value="East">East</SelectItem>
                              <SelectItem value="West">West</SelectItem>
                              <SelectItem value="Central">Central</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">FC Type</label>
                          <Select value={formData.fcType} onValueChange={(value) => handleInputChange('fcType', value)}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Standard">Standard</SelectItem>
                              <SelectItem value="Sortable">Sortable</SelectItem>
                              <SelectItem value="Large">Large</SelectItem>
                              <SelectItem value="Small">Small</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Status</label>
                        <Select
                          value={formData.isActive ? "active" : "inactive"}
                          onValueChange={(value) => handleInputChange('isActive', value === 'active')}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <Button
                        className="w-full bg-orange-600 hover:bg-orange-700"
                        size="lg"
                        onClick={handleSaveWarehouse}
                        disabled={isSaving}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        {isSaving ? 'Adding...' : 'Add Fulfillment Center'}
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Right side - Recent Entries */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Warehouse className="h-5 w-5 text-orange-500" />
                        Recent Entries ({warehouses.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                          <p className="text-muted-foreground">Loading...</p>
                        </div>
                      ) : warehouses.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                          <Warehouse className="h-16 w-16 text-muted-foreground/40 mb-4" />
                          <p className="text-lg font-medium text-muted-foreground mb-1">
                            No entries added yet
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Use the form to add fulfillment centers
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                          {warehouses.slice(0, 10).map((warehouse: any) => (
                            <div
                              key={warehouse.id}
                              className="p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-semibold text-sm">{warehouse.warehouseCode}</span>
                                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                                      warehouse.isActive
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-gray-100 text-gray-700'
                                    }`}>
                                      {warehouse.isActive ? 'Active' : 'Inactive'}
                                    </span>
                                  </div>
                                  <p className="text-sm text-muted-foreground mb-2">{warehouse.warehouseName}</p>
                                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                    {warehouse.city && <span>📍 {warehouse.city}</span>}
                                    {warehouse.state && <span>{warehouse.state}</span>}
                                    {warehouse.fcType && <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded">
                                      {warehouse.fcType}
                                    </span>}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
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
