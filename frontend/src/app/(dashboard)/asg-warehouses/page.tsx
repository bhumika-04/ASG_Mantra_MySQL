'use client';

import { useState, useEffect } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Warehouse,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface AsgWarehouse {
  id: number;
  warehouseName: string;
  city: string | null;
  state: string | null;
  active: boolean;
  createdAt: string | null;
}

const emptyForm: Omit<AsgWarehouse, 'id' | 'createdAt'> = {
  warehouseName: '',
  city: '',
  state: '',
  active: true,
};

export default function AsgWarehousesPage() {
  const [warehouses, setWarehouses] = useState<AsgWarehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AsgWarehouse | null>(null);
  const [form, setForm] = useState<Omit<AsgWarehouse, 'id' | 'createdAt'>>(emptyForm);

  const fetchWarehouses = async () => {
    setLoading(true);
    try {
      const data: any = await api.distributors.getAsgWarehouses({ active_only: false });
      setWarehouses(data.items || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load warehouses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchWarehouses(); }, []);

  const handleSave = async () => {
    if (!form.warehouseName.trim()) { toast.error('Warehouse name is required'); return; }
    try {
      if (editing) {
        await api.distributors.updateAsgWarehouse(editing.id, form);
        toast.success('Warehouse updated');
      } else {
        await api.distributors.createAsgWarehouse(form);
        toast.success('Warehouse created');
      }
      setShowForm(false);
      setEditing(null);
      setForm(emptyForm);
      fetchWarehouses();
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    }
  };

  const handleEdit = (w: AsgWarehouse) => {
    setEditing(w);
    setForm({ warehouseName: w.warehouseName, city: w.city || '', state: w.state || '', active: w.active });
    setShowForm(true);
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Deactivate warehouse "${name}"?`)) return;
    try {
      await api.distributors.deleteAsgWarehouse(id);
      toast.success('Warehouse deactivated');
      fetchWarehouses();
    } catch (e: any) {
      toast.error(e.message || 'Delete failed');
    }
  };

  return (
    <ProtectedRoute>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Warehouse className="h-6 w-6 text-blue-600" />
            <p className="text-sm text-gray-500">
              ASG Mantra's own internal storage locations
            </p>
          </div>
          <Badge variant="outline" className="text-xs">Admin Only</Badge>
        </div>

        {/* Info */}
        <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-lg">
          <Warehouse className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800">ASG Internal Warehouses</p>
            <p className="text-sm text-blue-700 mt-0.5">
              Stock uploaded via Inventory Upload is held here (packed/unpacked) before being dispatched to distributors RK or Eagle.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">ASG Warehouses</CardTitle>
                <CardDescription>Internal storage before dispatch to RK / Eagle</CardDescription>
              </div>
              <Button
                size="sm"
                onClick={() => { setShowForm(true); setEditing(null); setForm(emptyForm); }}
              >
                <Plus className="h-4 w-4 mr-1" /> Add Warehouse
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Inline form */}
            {showForm && (
              <div className="mb-4 p-4 border border-blue-200 rounded-lg bg-blue-50 space-y-3">
                <p className="text-sm font-medium">
                  {editing ? 'Edit Warehouse' : 'New Warehouse'}
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-3 md:col-span-1">
                    <label className="text-xs text-gray-600">Warehouse Name *</label>
                    <Input
                      value={form.warehouseName}
                      onChange={(e) => setForm({ ...form, warehouseName: e.target.value })}
                      placeholder="e.g. ASG Warehouse 1"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">City</label>
                    <Input
                      value={form.city || ''}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                      placeholder="Delhi"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">State</label>
                    <Input
                      value={form.state || ''}
                      onChange={(e) => setForm({ ...form, state: e.target.value })}
                      placeholder="Delhi"
                      className="mt-1"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="active-check"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <label htmlFor="active-check" className="text-sm text-gray-600">Active</label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setShowForm(false); setEditing(null); }}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSave}>Save</Button>
                </div>
              </div>
            )}

            {/* Table */}
            {loading ? (
              <div className="text-center py-10">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Warehouse Name</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">City</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">State</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Status</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warehouses.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-10 text-gray-400">
                          <Warehouse className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                          <p>No warehouses yet. Add your first ASG warehouse.</p>
                        </td>
                      </tr>
                    ) : warehouses.map((w) => (
                      <tr key={w.id} className="border-b hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium">{w.warehouseName}</td>
                        <td className="px-3 py-2 text-gray-500">{w.city || '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{w.state || '—'}</td>
                        <td className="px-3 py-2">
                          {w.active
                            ? <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle2 className="h-3 w-3" />Active</span>
                            : <span className="flex items-center gap-1 text-red-500 text-xs"><XCircle className="h-3 w-3" />Inactive</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(w)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-700"
                              onClick={() => handleDelete(w.id, w.warehouseName)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
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
      </div>
    </ProtectedRoute>
  );
}
