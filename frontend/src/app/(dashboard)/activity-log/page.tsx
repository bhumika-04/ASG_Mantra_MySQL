'use client';

import { useState, useEffect, useCallback } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import api from '@/lib/api';

interface AuditLogEntry {
  id: number;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: string;
  tableName: string | null;
  recordId: string | null;
  oldValues: string | null;
  newValues: string | null;
  createdAt: string | null;
}

interface AuditLogsResponse {
  items: AuditLogEntry[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

const ACTION_COLORS: Record<string, string> = {
  UPLOAD: 'bg-blue-100 text-blue-800',
  STATUS_CHANGE: 'bg-amber-100 text-amber-800',
  CREATE: 'bg-green-100 text-green-800',
  UPDATE: 'bg-purple-100 text-purple-800',
  DELETE: 'bg-red-100 text-red-800',
};

export default function ActivityLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [tableFilter, setTableFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const pageSize = 25;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, page_size: pageSize };
      if (actionFilter && actionFilter !== 'all') params.action = actionFilter;
      if (tableFilter && tableFilter !== 'all') params.table_name = tableFilter;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      const data = await api.auditLogs.getAll(params) as AuditLogsResponse;
      setLogs(data.items);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, tableFilter, startDate, endDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) +
      ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  };

  const parseJson = (str: string | null): Record<string, any> | null => {
    if (!str) return null;
    try { return JSON.parse(str); } catch { return null; }
  };

  const renderDetails = (entry: AuditLogEntry) => {
    const oldV = parseJson(entry.oldValues);
    const newV = parseJson(entry.newValues);
    if (!oldV && !newV) return <span className="text-muted-foreground">-</span>;

    if (entry.action === 'STATUS_CHANGE' && oldV && newV) {
      return (
        <span className="text-xs">
          <span className="text-red-600">{oldV.status}</span>
          {' → '}
          <span className="text-green-600">{newV.status}</span>
        </span>
      );
    }

    if (newV) {
      const parts: string[] = [];
      if (newV.type) parts.push(newV.type);
      if (newV.file) parts.push(newV.file);
      if (newV.rows !== undefined) parts.push(`${newV.rows} rows`);
      if (newV.created !== undefined) parts.push(`${newV.created} created`);
      if (newV.updated !== undefined) parts.push(`${newV.updated} updated`);
      if (newV.items !== undefined) parts.push(`${newV.items} items`);
      if (newV.po_number) parts.push(`PO: ${newV.po_number}`);
      return <span className="text-xs text-muted-foreground">{parts.join(' | ')}</span>;
    }

    return <span className="text-muted-foreground">-</span>;
  };

  return (
    <ProtectedRoute allowedRoles={['Admin', 'Manager']}>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Activity Log</h1>
            <p className="text-muted-foreground">Audit trail of all uploads and status changes</p>
          </div>
          <Badge variant="outline" className="text-sm">
            {total} entries
          </Badge>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="w-40">
                <label className="text-xs text-muted-foreground mb-1 block">Action</label>
                <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Actions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Actions</SelectItem>
                    <SelectItem value="UPLOAD">Upload</SelectItem>
                    <SelectItem value="STATUS_CHANGE">Status Change</SelectItem>
                    <SelectItem value="CREATE">Create</SelectItem>
                    <SelectItem value="UPDATE">Update</SelectItem>
                    <SelectItem value="DELETE">Delete</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-48">
                <label className="text-xs text-muted-foreground mb-1 block">Table</label>
                <Select value={tableFilter} onValueChange={(v) => { setTableFilter(v); setPage(1); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Tables" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Tables</SelectItem>
                    <SelectItem value="Sales">Sales</SelectItem>
                    <SelectItem value="Inventory">Inventory</SelectItem>
                    <SelectItem value="AmazonSales">Amazon Sales</SelectItem>
                    <SelectItem value="AmazonInventory">Amazon Inventory</SelectItem>
                    <SelectItem value="AmazonPO">Amazon PO</SelectItem>
                    <SelectItem value="BlinkitSales">Blinkit Sales</SelectItem>
                    <SelectItem value="BlinkitInventory">Blinkit Inventory</SelectItem>
                    <SelectItem value="BlinkitPO">Blinkit PO</SelectItem>
                    <SelectItem value="PurchaseOrders">Purchase Orders</SelectItem>
                    <SelectItem value="DistributorStock">Distributor Stock</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-40">
                <label className="text-xs text-muted-foreground mb-1 block">From</label>
                <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }} />
              </div>
              <div className="w-40">
                <label className="text-xs text-muted-foreground mb-1 block">To</label>
                <Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }} />
              </div>
              <Button variant="outline" size="sm" onClick={() => {
                setActionFilter('all');
                setTableFilter('all');
                setStartDate('');
                setEndDate('');
                setPage(1);
              }}>
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Time</th>
                    <th className="text-left p-3 font-medium">User</th>
                    <th className="text-left p-3 font-medium">Action</th>
                    <th className="text-left p-3 font-medium">Table</th>
                    <th className="text-left p-3 font-medium">Record</th>
                    <th className="text-left p-3 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="text-center p-8 text-muted-foreground">Loading...</td></tr>
                  ) : logs.length === 0 ? (
                    <tr><td colSpan={6} className="text-center p-8 text-muted-foreground">No activity logs found</td></tr>
                  ) : (
                    logs.map((entry) => (
                      <tr key={entry.id} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="p-3 whitespace-nowrap text-xs">{formatDate(entry.createdAt)}</td>
                        <td className="p-3">
                          <div className="text-xs font-medium">{entry.userName || '-'}</div>
                          <div className="text-xs text-muted-foreground">{entry.userEmail || ''}</div>
                        </td>
                        <td className="p-3">
                          <Badge className={`text-xs ${ACTION_COLORS[entry.action] || 'bg-gray-100 text-gray-800'}`}>
                            {entry.action}
                          </Badge>
                        </td>
                        <td className="p-3 text-xs">{entry.tableName || '-'}</td>
                        <td className="p-3 text-xs font-mono">{entry.recordId || '-'}</td>
                        <td className="p-3">{renderDetails(entry)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between p-4 border-t">
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages} ({total} entries)
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
