'use client';

import { useState, useEffect } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface Distributor {
  id: number;
  distributorName: string;
  channel: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
}

interface Facility {
  id: number;
  distributorId: number;
  facilityName: string;
  facilityType: string;
  city: string | null;
  state: string | null;
  active: boolean;
}

const emptyDistributor: Omit<Distributor, 'id'> = {
  distributorName: '', channel: 'Blinkit', contactPerson: '', phone: '', email: '', active: true,
};

const emptyFacility: Omit<Facility, 'id'> = {
  distributorId: 0, facilityName: '', facilityType: 'Backend', city: '', state: '', active: true,
};

export default function DistributorMasterPage() {
  const [activeTab, setActiveTab] = useState('distributors');

  // Distributors state
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [distribLoading, setDistribLoading] = useState(true);
  const [showDistribForm, setShowDistribForm] = useState(false);
  const [editingDistrib, setEditingDistrib] = useState<Distributor | null>(null);
  const [distribForm, setDistribForm] = useState<Omit<Distributor, 'id'>>(emptyDistributor);

  // Facilities state
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityLoading, setFacilityLoading] = useState(true);
  const [showFacilityForm, setShowFacilityForm] = useState(false);
  const [editingFacility, setEditingFacility] = useState<Facility | null>(null);
  const [facilityForm, setFacilityForm] = useState<Omit<Facility, 'id'>>(emptyFacility);

  const fetchDistributors = async () => {
    setDistribLoading(true);
    try {
      const data: any = await api.distributors.getAll({ active_only: false });
      setDistributors(data.items || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load distributors');
    } finally {
      setDistribLoading(false);
    }
  };

  const fetchFacilities = async () => {
    setFacilityLoading(true);
    try {
      const data: any = await api.distributors.getFacilities({ active_only: false });
      setFacilities(data.items || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load facilities');
    } finally {
      setFacilityLoading(false);
    }
  };

  useEffect(() => { fetchDistributors(); fetchFacilities(); }, []);

  // ── Distributor CRUD ──
  const handleSaveDistributor = async () => {
    if (!distribForm.distributorName.trim()) { toast.error('Name is required'); return; }
    try {
      if (editingDistrib) {
        await api.distributors.update(editingDistrib.id, distribForm);
        toast.success('Distributor updated');
      } else {
        await api.distributors.create(distribForm);
        toast.success('Distributor created');
      }
      setShowDistribForm(false);
      setEditingDistrib(null);
      setDistribForm(emptyDistributor);
      fetchDistributors();
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    }
  };

  const handleEditDistributor = (d: Distributor) => {
    setEditingDistrib(d);
    setDistribForm({ distributorName: d.distributorName, channel: d.channel, contactPerson: d.contactPerson || '', phone: d.phone || '', email: d.email || '', active: d.active });
    setShowDistribForm(true);
  };

  const handleDeleteDistributor = async (id: number, name: string) => {
    if (!confirm(`Deactivate distributor "${name}"?`)) return;
    try {
      await api.distributors.delete(id);
      toast.success('Distributor deactivated');
      fetchDistributors();
    } catch (e: any) {
      toast.error(e.message || 'Delete failed');
    }
  };

  // ── Facility CRUD ──
  const handleSaveFacility = async () => {
    if (!facilityForm.facilityName.trim()) { toast.error('Facility name is required'); return; }
    if (!facilityForm.distributorId) { toast.error('Select a distributor'); return; }
    try {
      if (editingFacility) {
        await api.distributors.updateFacility(editingFacility.id, facilityForm);
        toast.success('Facility updated');
      } else {
        await api.distributors.createFacility(facilityForm);
        toast.success('Facility created');
      }
      setShowFacilityForm(false);
      setEditingFacility(null);
      setFacilityForm(emptyFacility);
      fetchFacilities();
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    }
  };

  const handleEditFacility = (f: Facility) => {
    setEditingFacility(f);
    setFacilityForm({ distributorId: f.distributorId, facilityName: f.facilityName, facilityType: f.facilityType, city: f.city || '', state: f.state || '', active: f.active });
    setShowFacilityForm(true);
  };

  const handleDeleteFacility = async (id: number, name: string) => {
    if (!confirm(`Deactivate facility "${name}"?`)) return;
    try {
      await api.distributors.deleteFacility(id);
      toast.success('Facility deactivated');
      fetchFacilities();
    } catch (e: any) {
      toast.error(e.message || 'Delete failed');
    }
  };

  const getDistributorName = (id: number) =>
    distributors.find((d) => d.id === id)?.distributorName || `Distributor #${id}`;

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="h-6 w-6 text-blue-600" />
            <p className="text-sm text-gray-500">Manage distributors and their facilities</p>
          </div>
          <Badge variant="outline" className="text-xs">Admin Only</Badge>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 max-w-sm">
            <TabsTrigger value="distributors">Distributors</TabsTrigger>
            <TabsTrigger value="facilities">Distributor Facilities</TabsTrigger>
          </TabsList>

          {/* ── Distributors Tab ── */}
          <TabsContent value="distributors" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Distributors</CardTitle>
                    <CardDescription>RK (Amazon) and Eagle (Blinkit)</CardDescription>
                  </div>
                  <Button size="sm" onClick={() => { setShowDistribForm(true); setEditingDistrib(null); setDistribForm(emptyDistributor); }}>
                    <Plus className="h-4 w-4 mr-1" /> Add
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Inline form */}
                {showDistribForm && (
                  <div className="mb-4 p-4 border border-blue-200 rounded-lg bg-blue-50 space-y-3">
                    <p className="text-sm font-medium">{editingDistrib ? 'Edit Distributor' : 'New Distributor'}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-600">Name *</label>
                        <Input value={distribForm.distributorName} onChange={(e) => setDistribForm({ ...distribForm, distributorName: e.target.value })} placeholder="e.g. Eagle Network" className="mt-1" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">Channel *</label>
                        <select value={distribForm.channel} onChange={(e) => setDistribForm({ ...distribForm, channel: e.target.value })} className="mt-1 w-full text-sm border border-gray-200 rounded-md px-3 py-2 bg-white">
                          <option value="Blinkit">Blinkit</option>
                          <option value="Amazon">Amazon</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">Contact Person</label>
                        <Input value={distribForm.contactPerson || ''} onChange={(e) => setDistribForm({ ...distribForm, contactPerson: e.target.value })} placeholder="Name" className="mt-1" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">Phone</label>
                        <Input value={distribForm.phone || ''} onChange={(e) => setDistribForm({ ...distribForm, phone: e.target.value })} placeholder="+91..." className="mt-1" />
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-gray-600">Email</label>
                        <Input value={distribForm.email || ''} onChange={(e) => setDistribForm({ ...distribForm, email: e.target.value })} placeholder="email@example.com" className="mt-1" />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setShowDistribForm(false); setEditingDistrib(null); }}>Cancel</Button>
                      <Button size="sm" onClick={handleSaveDistributor}>Save</Button>
                    </div>
                  </div>
                )}

                {/* Table */}
                {distribLoading ? (
                  <div className="text-center py-8"><div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" /></div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Name</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Channel</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Contact</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Status</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-600">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {distributors.length === 0 ? (
                          <tr><td colSpan={5} className="text-center py-8 text-gray-400">No distributors found</td></tr>
                        ) : distributors.map((d) => (
                          <tr key={d.id} className="border-b hover:bg-gray-50">
                            <td className="px-3 py-2 font-medium">{d.distributorName}</td>
                            <td className="px-3 py-2">
                              <Badge variant={d.channel === 'Amazon' ? 'default' : 'secondary'}>{d.channel}</Badge>
                            </td>
                            <td className="px-3 py-2 text-gray-500">{d.contactPerson || '—'}</td>
                            <td className="px-3 py-2">
                              {d.active
                                ? <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle2 className="h-3 w-3" />Active</span>
                                : <span className="flex items-center gap-1 text-red-500 text-xs"><XCircle className="h-3 w-3" />Inactive</span>}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="sm" onClick={() => handleEditDistributor(d)}><Pencil className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={() => handleDeleteDistributor(d.id, d.distributorName)}><Trash2 className="h-3.5 w-3.5" /></Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Facilities Tab ── */}
          <TabsContent value="facilities" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Distributor Facilities</CardTitle>
                    <CardDescription>Backend and Frontend facilities for all distributors</CardDescription>
                  </div>
                  <Button size="sm" onClick={() => { setShowFacilityForm(true); setEditingFacility(null); setFacilityForm(emptyFacility); }}>
                    <Plus className="h-4 w-4 mr-1" /> Add
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Inline form */}
                {showFacilityForm && (
                  <div className="mb-4 p-4 border border-blue-200 rounded-lg bg-blue-50 space-y-3">
                    <p className="text-sm font-medium">{editingFacility ? 'Edit Facility' : 'New Facility'}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-600">Distributor *</label>
                        <select value={facilityForm.distributorId || ''} onChange={(e) => setFacilityForm({ ...facilityForm, distributorId: Number(e.target.value) })} className="mt-1 w-full text-sm border border-gray-200 rounded-md px-3 py-2 bg-white">
                          <option value="">Select distributor</option>
                          {distributors.map((d) => (
                            <option key={d.id} value={d.id}>{d.distributorName}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">Facility Type *</label>
                        <select value={facilityForm.facilityType} onChange={(e) => setFacilityForm({ ...facilityForm, facilityType: e.target.value })} className="mt-1 w-full text-sm border border-gray-200 rounded-md px-3 py-2 bg-white">
                          <option value="Backend">Backend</option>
                          <option value="Frontend">Frontend</option>
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-gray-600">Facility Name *</label>
                        <Input value={facilityForm.facilityName} onChange={(e) => setFacilityForm({ ...facilityForm, facilityName: e.target.value })} placeholder="e.g. Noida N1 - Feeder Warehouse" className="mt-1" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">City</label>
                        <Input value={facilityForm.city || ''} onChange={(e) => setFacilityForm({ ...facilityForm, city: e.target.value })} placeholder="Noida" className="mt-1" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">State</label>
                        <Input value={facilityForm.state || ''} onChange={(e) => setFacilityForm({ ...facilityForm, state: e.target.value })} placeholder="Uttar Pradesh" className="mt-1" />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setShowFacilityForm(false); setEditingFacility(null); }}>Cancel</Button>
                      <Button size="sm" onClick={handleSaveFacility}>Save</Button>
                    </div>
                  </div>
                )}

                {/* Table */}
                {facilityLoading ? (
                  <div className="text-center py-8"><div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" /></div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Facility Name</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Type</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Distributor</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">City</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">State</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Status</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-600">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {facilities.length === 0 ? (
                          <tr><td colSpan={7} className="text-center py-8 text-gray-400">No facilities found</td></tr>
                        ) : facilities.map((f) => (
                          <tr key={f.id} className="border-b hover:bg-gray-50">
                            <td className="px-3 py-2 font-medium">{f.facilityName}</td>
                            <td className="px-3 py-2">
                              <Badge variant={f.facilityType === 'Backend' ? 'default' : 'secondary'}>{f.facilityType}</Badge>
                            </td>
                            <td className="px-3 py-2 text-gray-500">{getDistributorName(f.distributorId)}</td>
                            <td className="px-3 py-2 text-gray-500">{f.city || '—'}</td>
                            <td className="px-3 py-2 text-gray-500">{f.state || '—'}</td>
                            <td className="px-3 py-2">
                              {f.active
                                ? <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle2 className="h-3 w-3" />Active</span>
                                : <span className="flex items-center gap-1 text-red-500 text-xs"><XCircle className="h-3 w-3" />Inactive</span>}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="sm" onClick={() => handleEditFacility(f)}><Pencil className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={() => handleDeleteFacility(f.id, f.facilityName)}><Trash2 className="h-3.5 w-3.5" /></Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ProtectedRoute>
  );
}
