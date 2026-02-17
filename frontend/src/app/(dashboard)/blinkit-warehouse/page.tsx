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
import { Upload, Warehouse, Plus, FileText, Building2, MapPin, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';

export default function BlinkitWarehousePage() {
  const [isSavingFE, setIsSavingFE] = useState(false);
  const [isSavingBE, setIsSavingBE] = useState(false);
  const [isUploadingFE, setIsUploadingFE] = useState(false);
  const [isUploadingBE, setIsUploadingBE] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Upload results state
  const [feUploadResults, setFeUploadResults] = useState<any>(null);
  const [beUploadResults, setBeUploadResults] = useState<any>(null);

  const feFileInputRef = useRef<HTMLInputElement>(null);
  const beFileInputRef = useRef<HTMLInputElement>(null);

  // FE Form State
  const [feFormData, setFeFormData] = useState({
    warehouseCode: '',
    warehouseName: '',
    city: '',
    state: '',
    region: '',
    isActive: true,
  });

  // BE Form State
  const [beFormData, setBeFormData] = useState({
    warehouseCode: '',
    warehouseName: '',
    city: '',
    state: '',
    region: '',
    isActive: true,
  });

  const handleFeInputChange = (field: string, value: string | boolean) => {
    setFeFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleBeInputChange = (field: string, value: string | boolean) => {
    setBeFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const fetchWarehouses = async () => {
    try {
      setIsLoading(true);
      const data: any = await api.warehouses.getBlinkit();
      setWarehouses(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching warehouses:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveFEWarehouse = async () => {
    if (!feFormData.warehouseCode || !feFormData.warehouseName || !feFormData.state) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      setIsSavingFE(true);
      const payload = {
        warehouseCode: feFormData.warehouseCode,
        warehouseName: feFormData.warehouseName,
        channel: 'Blinkit',
        warehouseType: 'Frontend',
        city: feFormData.city || undefined,
        state: feFormData.state,
        region: feFormData.region || undefined,
        isActive: feFormData.isActive,
      };

      await api.warehouses.create('blinkit', payload);

      toast.success('FE Warehouse added successfully!', {
        description: `${feFormData.warehouseName} has been added`,
      });

      // Reset form
      setFeFormData({
        warehouseCode: '',
        warehouseName: '',
        city: '',
        state: '',
        region: '',
        isActive: true,
      });

      // Refresh list
      fetchWarehouses();

    } catch (error: any) {
      console.error('Error saving FE warehouse:', error);
      toast.error(error.message || 'Failed to add FE warehouse');
    } finally {
      setIsSavingFE(false);
    }
  };

  const handleSaveBEWarehouse = async () => {
    if (!beFormData.warehouseCode || !beFormData.warehouseName || !beFormData.state) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      setIsSavingBE(true);
      const payload = {
        warehouseCode: beFormData.warehouseCode,
        warehouseName: beFormData.warehouseName,
        channel: 'Blinkit',
        warehouseType: 'Backend',
        city: beFormData.city || undefined,
        state: beFormData.state,
        region: beFormData.region || undefined,
        isActive: beFormData.isActive,
      };

      await api.warehouses.create('blinkit', payload);

      toast.success('BE Warehouse added successfully!', {
        description: `${beFormData.warehouseName} has been added`,
      });

      // Reset form
      setBeFormData({
        warehouseCode: '',
        warehouseName: '',
        city: '',
        state: '',
        region: '',
        isActive: true,
      });

      // Refresh list
      fetchWarehouses();

    } catch (error: any) {
      console.error('Error saving BE warehouse:', error);
      toast.error(error.message || 'Failed to add BE warehouse');
    } finally {
      setIsSavingBE(false);
    }
  };

  const handleFEFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(fileExtension || '')) {
      toast.error('Invalid file type. Please upload CSV or Excel file');
      return;
    }

    try {
      setIsUploadingFE(true);
      setFeUploadResults(null);

      const result: any = await api.warehouses.uploadBlinkit(file, 'Frontend');

      setFeUploadResults(result);

      toast.success(result.message, {
        description: `${result.summary.uploaded} warehouses uploaded, ${result.summary.skipped} skipped`,
      });

      fetchWarehouses();
    } catch (error: any) {
      console.error('Error uploading FE warehouses:', error);
      toast.error(error.message || 'Failed to upload file');
    } finally {
      setIsUploadingFE(false);
      if (feFileInputRef.current) {
        feFileInputRef.current.value = '';
      }
    }
  };

  const handleBEFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(fileExtension || '')) {
      toast.error('Invalid file type. Please upload CSV or Excel file');
      return;
    }

    try {
      setIsUploadingBE(true);
      setBeUploadResults(null);

      const result: any = await api.warehouses.uploadBlinkit(file, 'Backend');

      setBeUploadResults(result);

      toast.success(result.message, {
        description: `${result.summary.uploaded} warehouses uploaded, ${result.summary.skipped} skipped`,
      });

      fetchWarehouses();
    } catch (error: any) {
      console.error('Error uploading BE warehouses:', error);
      toast.error(error.message || 'Failed to upload file');
    } finally {
      setIsUploadingBE(false);
      if (beFileInputRef.current) {
        beFileInputRef.current.value = '';
      }
    }
  };

  useEffect(() => {
    fetchWarehouses();
  }, []);

  const feWarehouses = warehouses.filter(w => w.warehouseType === 'Frontend');
  const beWarehouses = warehouses.filter(w => w.warehouseType === 'Backend');

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Warehouse className="h-5 w-5 text-yellow-500" />
              Blinkit Warehouse Management
            </CardTitle>
            <CardDescription>
              Upload or manually add Front End (FE) and Back End (BE) warehouse data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="fe" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="fe" className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  FE Warehouse (Front End)
                </TabsTrigger>
                <TabsTrigger value="be" className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  BE Warehouse (Back End)
                </TabsTrigger>
              </TabsList>

              {/* FE Warehouse Tab */}
              <TabsContent value="fe">
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

                  {/* FE Excel Upload */}
                  <TabsContent value="excel" className="space-y-6 mt-6">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-2">
                        <div className="border-2 border-dashed rounded-lg p-12 text-center bg-muted/30">
                          <div className="flex justify-center mb-4">
                            <div className="h-16 w-16 rounded-full bg-yellow-100 flex items-center justify-center">
                              <Building2 className="h-8 w-8 text-yellow-600" />
                            </div>
                          </div>
                          <h3 className="text-xl font-semibold mb-2">Upload FE Warehouse Data</h3>
                          <p className="text-muted-foreground mb-4">
                            Front End warehouses - customer-facing delivery hubs
                          </p>
                          <input
                            ref={feFileInputRef}
                            type="file"
                            accept=".csv,.xlsx,.xls"
                            onChange={handleFEFileUpload}
                            className="hidden"
                          />
                          <Button
                            size="lg"
                            onClick={() => feFileInputRef.current?.click()}
                            disabled={isUploadingFE}
                          >
                            <Upload className="h-4 w-4 mr-2" />
                            {isUploadingFE ? 'Uploading...' : 'Choose Files'}
                          </Button>
                          <p className="text-xs text-muted-foreground mt-4">
                            Accepted formats: .xlsx, .xls, .csv
                          </p>
                        </div>

                        <div className="bg-muted/50 rounded-lg p-4 mt-6">
                          <h4 className="font-medium mb-2">Expected Columns:</h4>
                          <p className="text-sm text-muted-foreground">
                            FE Code, FE Name, City, State, Region, Status
                          </p>
                        </div>

                        {/* FE Upload Results */}
                        {feUploadResults && (
                          <div className="space-y-4 mt-6">
                            {/* Summary Stats */}
                            <div className="grid grid-cols-4 gap-4">
                              <Card>
                                <CardContent className="p-4">
                                  <div className="flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-blue-500" />
                                    <div>
                                      <p className="text-xs text-muted-foreground">Total Rows</p>
                                      <p className="text-2xl font-bold">{feUploadResults.summary.totalRows}</p>
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
                                      <p className="text-2xl font-bold text-green-600">{feUploadResults.summary.uploaded}</p>
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
                                      <p className="text-2xl font-bold text-yellow-600">{feUploadResults.summary.skipped}</p>
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
                                      <p className="text-2xl font-bold text-red-600">{feUploadResults.summary.errors}</p>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            </div>

                            {/* Uploaded Warehouses */}
                            {feUploadResults.uploadedWarehouses && feUploadResults.uploadedWarehouses.length > 0 && (
                              <Card>
                                <CardHeader>
                                  <CardTitle className="text-sm flex items-center gap-2">
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                    Uploaded Warehouses ({feUploadResults.uploadedWarehouses.length})
                                  </CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <div className="max-h-48 overflow-y-auto space-y-2">
                                    {feUploadResults.uploadedWarehouses.map((warehouse: any, index: number) => (
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
                            {feUploadResults.skippedWarehouses && feUploadResults.skippedWarehouses.length > 0 && (
                              <Card>
                                <CardHeader>
                                  <CardTitle className="text-sm flex items-center gap-2">
                                    <XCircle className="h-4 w-4 text-yellow-500" />
                                    Skipped Warehouses ({feUploadResults.skippedWarehouses.length})
                                  </CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <div className="max-h-48 overflow-y-auto space-y-2">
                                    {feUploadResults.skippedWarehouses.map((warehouse: any, index: number) => (
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
                            {feUploadResults.errors && feUploadResults.errors.length > 0 && (
                              <Card>
                                <CardHeader>
                                  <CardTitle className="text-sm flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4 text-red-500" />
                                    Errors ({feUploadResults.errors.length})
                                  </CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <div className="max-h-48 overflow-y-auto space-y-2">
                                    {feUploadResults.errors.map((error: any, index: number) => (
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

                      <div className="lg:col-span-1">
                        <Card>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                              <FileText className="h-4 w-4 text-yellow-500" />
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
                                    <th className="text-left p-2 font-medium whitespace-nowrap">FE Code *</th>
                                    <th className="text-left p-2 font-medium whitespace-nowrap">FE Name *</th>
                                    <th className="text-left p-2 font-medium whitespace-nowrap">City</th>
                                    <th className="text-left p-2 font-medium whitespace-nowrap">State *</th>
                                    <th className="text-left p-2 font-medium whitespace-nowrap">Region</th>
                                    <th className="text-left p-2 font-medium whitespace-nowrap">Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr className="border-t">
                                    <td className="p-2 font-mono whitespace-nowrap">GGN-FE-01</td>
                                    <td className="p-2 whitespace-nowrap">Gurugram Hub 1</td>
                                    <td className="p-2 whitespace-nowrap">Gurugram</td>
                                    <td className="p-2 whitespace-nowrap">Haryana</td>
                                    <td className="p-2 whitespace-nowrap">North</td>
                                    <td className="p-2 whitespace-nowrap">Active</td>
                                  </tr>
                                  <tr className="border-t">
                                    <td className="p-2 font-mono whitespace-nowrap">DEL-FE-02</td>
                                    <td className="p-2 whitespace-nowrap">Delhi Hub 2</td>
                                    <td className="p-2 whitespace-nowrap">New Delhi</td>
                                    <td className="p-2 whitespace-nowrap">Delhi</td>
                                    <td className="p-2 whitespace-nowrap">North</td>
                                    <td className="p-2 whitespace-nowrap">Active</td>
                                  </tr>
                                  <tr className="border-t">
                                    <td className="p-2 font-mono whitespace-nowrap">BOM-FE-03</td>
                                    <td className="p-2 whitespace-nowrap">Mumbai Hub 3</td>
                                    <td className="p-2 whitespace-nowrap">Mumbai</td>
                                    <td className="p-2 whitespace-nowrap">Maharashtra</td>
                                    <td className="p-2 whitespace-nowrap">West</td>
                                    <td className="p-2 whitespace-nowrap">Active</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>

                            <div className="space-y-3 pt-2 border-t">
                              <div>
                                <h4 className="font-medium text-sm mb-1">Required Columns <span className="text-red-500">*</span></h4>
                                <p className="text-xs text-muted-foreground">FE Code, FE Name, State</p>
                              </div>
                              <div>
                                <h4 className="font-medium text-sm mb-1">Optional Columns</h4>
                                <p className="text-xs text-muted-foreground">City, Region, Status</p>
                              </div>
                              <div>
                                <h4 className="font-medium text-sm mb-1">Notes</h4>
                                <ul className="text-xs text-muted-foreground space-y-0.5">
                                  <li>• Duplicate FE Code rows are skipped</li>
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

                  {/* FE Add Manually */}
                  <TabsContent value="manual" className="space-y-4 mt-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-lg">
                            <Plus className="h-5 w-5 text-yellow-500" />
                            Add FE Warehouse
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">
                                FE Code <span className="text-destructive">*</span>
                              </label>
                              <Input
                                type="text"
                                placeholder="e.g., GGN-FE-01"
                                value={feFormData.warehouseCode}
                                onChange={(e) => handleFeInputChange('warehouseCode', e.target.value)}
                              />
                            </div>

                            <div className="space-y-2">
                              <label className="text-sm font-medium">
                                FE Name <span className="text-destructive">*</span>
                              </label>
                              <Input
                                type="text"
                                placeholder="e.g., Gurugram Hub 1"
                                value={feFormData.warehouseName}
                                onChange={(e) => handleFeInputChange('warehouseName', e.target.value)}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">City</label>
                              <Input
                                type="text"
                                placeholder="e.g., Gurugram"
                                value={feFormData.city}
                                onChange={(e) => handleFeInputChange('city', e.target.value)}
                              />
                            </div>

                            <div className="space-y-2">
                              <label className="text-sm font-medium">
                                State <span className="text-destructive">*</span>
                              </label>
                              <Input
                                type="text"
                                placeholder="e.g., Haryana"
                                value={feFormData.state}
                                onChange={(e) => handleFeInputChange('state', e.target.value)}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Region</label>
                              <Select value={feFormData.region} onValueChange={(value) => handleFeInputChange('region', value)}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select" />
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
                              <label className="text-sm font-medium">Status</label>
                              <Select
                                value={feFormData.isActive ? "active" : "inactive"}
                                onValueChange={(value) => handleFeInputChange('isActive', value === 'active')}
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
                          </div>

                          <Button
                            className="w-full bg-yellow-600 hover:bg-yellow-700"
                            size="lg"
                            onClick={handleSaveFEWarehouse}
                            disabled={isSavingFE}
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            {isSavingFE ? 'Adding...' : 'Add FE Warehouse'}
                          </Button>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">Recent FE Entries ({feWarehouses.length})</CardTitle>
                        </CardHeader>
                        <CardContent>
                          {isLoading ? (
                            <div className="flex items-center justify-center py-12">
                              <p className="text-muted-foreground">Loading...</p>
                            </div>
                          ) : feWarehouses.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-center">
                              <Building2 className="h-16 w-16 text-muted-foreground/40 mb-4" />
                              <p className="text-muted-foreground">No entries yet</p>
                            </div>
                          ) : (
                            <div className="space-y-3 max-h-96 overflow-y-auto">
                              {feWarehouses.slice(0, 10).map((warehouse: any) => (
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
              </TabsContent>

              {/* BE Warehouse Tab */}
              <TabsContent value="be">
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

                  {/* BE Excel Upload */}
                  <TabsContent value="excel" className="space-y-6 mt-6">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-2">
                        <div className="border-2 border-dashed rounded-lg p-12 text-center bg-muted/30">
                          <div className="flex justify-center mb-4">
                            <div className="h-16 w-16 rounded-full bg-orange-100 flex items-center justify-center">
                              <MapPin className="h-8 w-8 text-orange-600" />
                            </div>
                          </div>
                          <h3 className="text-xl font-semibold mb-2">Upload BE Warehouse Data</h3>
                          <p className="text-muted-foreground mb-4">
                            Back End warehouses - inventory storage and supply centers
                          </p>
                          <input
                            ref={beFileInputRef}
                            type="file"
                            accept=".csv,.xlsx,.xls"
                            onChange={handleBEFileUpload}
                            className="hidden"
                          />
                          <Button
                            size="lg"
                            onClick={() => beFileInputRef.current?.click()}
                            disabled={isUploadingBE}
                          >
                            <Upload className="h-4 w-4 mr-2" />
                            {isUploadingBE ? 'Uploading...' : 'Choose Files'}
                          </Button>
                          <p className="text-xs text-muted-foreground mt-4">
                            Accepted formats: .xlsx, .xls, .csv
                          </p>
                        </div>

                        <div className="bg-muted/50 rounded-lg p-4 mt-6">
                          <h4 className="font-medium mb-2">Expected Columns:</h4>
                          <p className="text-sm text-muted-foreground">
                            BE Code, BE Name, City, State, Region, Status
                          </p>
                        </div>

                        {/* BE Upload Results */}
                        {beUploadResults && (
                          <div className="space-y-4 mt-6">
                            {/* Summary Stats */}
                            <div className="grid grid-cols-4 gap-4">
                              <Card>
                                <CardContent className="p-4">
                                  <div className="flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-blue-500" />
                                    <div>
                                      <p className="text-xs text-muted-foreground">Total Rows</p>
                                      <p className="text-2xl font-bold">{beUploadResults.summary.totalRows}</p>
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
                                      <p className="text-2xl font-bold text-green-600">{beUploadResults.summary.uploaded}</p>
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
                                      <p className="text-2xl font-bold text-yellow-600">{beUploadResults.summary.skipped}</p>
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
                                      <p className="text-2xl font-bold text-red-600">{beUploadResults.summary.errors}</p>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            </div>

                            {/* Uploaded Warehouses */}
                            {beUploadResults.uploadedWarehouses && beUploadResults.uploadedWarehouses.length > 0 && (
                              <Card>
                                <CardHeader>
                                  <CardTitle className="text-sm flex items-center gap-2">
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                    Uploaded Warehouses ({beUploadResults.uploadedWarehouses.length})
                                  </CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <div className="max-h-48 overflow-y-auto space-y-2">
                                    {beUploadResults.uploadedWarehouses.map((warehouse: any, index: number) => (
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
                            {beUploadResults.skippedWarehouses && beUploadResults.skippedWarehouses.length > 0 && (
                              <Card>
                                <CardHeader>
                                  <CardTitle className="text-sm flex items-center gap-2">
                                    <XCircle className="h-4 w-4 text-yellow-500" />
                                    Skipped Warehouses ({beUploadResults.skippedWarehouses.length})
                                  </CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <div className="max-h-48 overflow-y-auto space-y-2">
                                    {beUploadResults.skippedWarehouses.map((warehouse: any, index: number) => (
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
                            {beUploadResults.errors && beUploadResults.errors.length > 0 && (
                              <Card>
                                <CardHeader>
                                  <CardTitle className="text-sm flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4 text-red-500" />
                                    Errors ({beUploadResults.errors.length})
                                  </CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <div className="max-h-48 overflow-y-auto space-y-2">
                                    {beUploadResults.errors.map((error: any, index: number) => (
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
                                    <th className="text-left p-2 font-medium whitespace-nowrap">BE Code *</th>
                                    <th className="text-left p-2 font-medium whitespace-nowrap">BE Name *</th>
                                    <th className="text-left p-2 font-medium whitespace-nowrap">City</th>
                                    <th className="text-left p-2 font-medium whitespace-nowrap">State *</th>
                                    <th className="text-left p-2 font-medium whitespace-nowrap">Region</th>
                                    <th className="text-left p-2 font-medium whitespace-nowrap">Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr className="border-t">
                                    <td className="p-2 font-mono whitespace-nowrap">GGN-BE-01</td>
                                    <td className="p-2 whitespace-nowrap">Gurugram Storage 1</td>
                                    <td className="p-2 whitespace-nowrap">Gurugram</td>
                                    <td className="p-2 whitespace-nowrap">Haryana</td>
                                    <td className="p-2 whitespace-nowrap">North</td>
                                    <td className="p-2 whitespace-nowrap">Active</td>
                                  </tr>
                                  <tr className="border-t">
                                    <td className="p-2 font-mono whitespace-nowrap">DEL-BE-02</td>
                                    <td className="p-2 whitespace-nowrap">Delhi Storage 2</td>
                                    <td className="p-2 whitespace-nowrap">New Delhi</td>
                                    <td className="p-2 whitespace-nowrap">Delhi</td>
                                    <td className="p-2 whitespace-nowrap">North</td>
                                    <td className="p-2 whitespace-nowrap">Active</td>
                                  </tr>
                                  <tr className="border-t">
                                    <td className="p-2 font-mono whitespace-nowrap">BOM-BE-03</td>
                                    <td className="p-2 whitespace-nowrap">Mumbai Storage 3</td>
                                    <td className="p-2 whitespace-nowrap">Mumbai</td>
                                    <td className="p-2 whitespace-nowrap">Maharashtra</td>
                                    <td className="p-2 whitespace-nowrap">West</td>
                                    <td className="p-2 whitespace-nowrap">Active</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>

                            <div className="space-y-3 pt-2 border-t">
                              <div>
                                <h4 className="font-medium text-sm mb-1">Required Columns <span className="text-red-500">*</span></h4>
                                <p className="text-xs text-muted-foreground">BE Code, BE Name, State</p>
                              </div>
                              <div>
                                <h4 className="font-medium text-sm mb-1">Optional Columns</h4>
                                <p className="text-xs text-muted-foreground">City, Region, Status</p>
                              </div>
                              <div>
                                <h4 className="font-medium text-sm mb-1">Notes</h4>
                                <ul className="text-xs text-muted-foreground space-y-0.5">
                                  <li>• Duplicate BE Code rows are skipped</li>
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

                  {/* BE Add Manually */}
                  <TabsContent value="manual" className="space-y-4 mt-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-lg">
                            <Plus className="h-5 w-5 text-orange-500" />
                            Add BE Warehouse
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">
                                BE Code <span className="text-destructive">*</span>
                              </label>
                              <Input
                                type="text"
                                placeholder="e.g., GGN-BE-01"
                                value={beFormData.warehouseCode}
                                onChange={(e) => handleBeInputChange('warehouseCode', e.target.value)}
                              />
                            </div>

                            <div className="space-y-2">
                              <label className="text-sm font-medium">
                                BE Name <span className="text-destructive">*</span>
                              </label>
                              <Input
                                type="text"
                                placeholder="e.g., Gurugram Storage 1"
                                value={beFormData.warehouseName}
                                onChange={(e) => handleBeInputChange('warehouseName', e.target.value)}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">City</label>
                              <Input
                                type="text"
                                placeholder="e.g., Gurugram"
                                value={beFormData.city}
                                onChange={(e) => handleBeInputChange('city', e.target.value)}
                              />
                            </div>

                            <div className="space-y-2">
                              <label className="text-sm font-medium">
                                State <span className="text-destructive">*</span>
                              </label>
                              <Input
                                type="text"
                                placeholder="e.g., Haryana"
                                value={beFormData.state}
                                onChange={(e) => handleBeInputChange('state', e.target.value)}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Region</label>
                              <Select value={beFormData.region} onValueChange={(value) => handleBeInputChange('region', value)}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select" />
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
                              <label className="text-sm font-medium">Status</label>
                              <Select
                                value={beFormData.isActive ? "active" : "inactive"}
                                onValueChange={(value) => handleBeInputChange('isActive', value === 'active')}
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
                          </div>

                          <Button
                            className="w-full bg-orange-600 hover:bg-orange-700"
                            size="lg"
                            onClick={handleSaveBEWarehouse}
                            disabled={isSavingBE}
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            {isSavingBE ? 'Adding...' : 'Add BE Warehouse'}
                          </Button>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">Recent BE Entries ({beWarehouses.length})</CardTitle>
                        </CardHeader>
                        <CardContent>
                          {isLoading ? (
                            <div className="flex items-center justify-center py-12">
                              <p className="text-muted-foreground">Loading...</p>
                            </div>
                          ) : beWarehouses.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-center">
                              <MapPin className="h-16 w-16 text-muted-foreground/40 mb-4" />
                              <p className="text-muted-foreground">No entries yet</p>
                            </div>
                          ) : (
                            <div className="space-y-3 max-h-96 overflow-y-auto">
                              {beWarehouses.slice(0, 10).map((warehouse: any) => (
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
              </TabsContent>
            </Tabs>

            {/* Blinkit Warehouse Hierarchy */}
            <div className="mt-8 pt-6 border-t">
              <h3 className="font-semibold mb-3">Blinkit Warehouse Hierarchy</h3>
              <div className="flex items-center gap-3 text-sm">
                <span className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded font-medium">
                  State
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="px-3 py-1.5 bg-yellow-200 text-yellow-700 rounded font-medium">
                  FE Warehouse
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="px-3 py-1.5 bg-orange-200 text-orange-700 rounded font-medium">
                  BE Warehouse
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-3">
                Back End (BE) warehouses supply inventory to Front End (FE) warehouses for last-mile delivery.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
