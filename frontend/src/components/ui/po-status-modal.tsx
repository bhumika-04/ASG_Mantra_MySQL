'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import api from '@/lib/api';

export interface POModalData {
  id: number;
  ids?: number[];
  po_number: string;
  status: string;
  quantity: number;
}

const TRANSITIONS: Record<string, string[]> = {
  'Created': ['Dispatched', 'Cancelled'],
  'Dispatched': ['In Transit', 'Delayed', 'Cancelled'],
  'In Transit': ['Delivered', 'Delayed', 'Cancelled'],
  'Delayed': ['In Transit', 'Delivered', 'Cancelled'],
  'Delivered': [],
  'Cancelled': [],
};

const STATUS_STYLES: Record<string, string> = {
  'Created': 'bg-gray-50 text-gray-700 border-gray-200',
  'Dispatched': 'bg-yellow-50 text-yellow-700 border-yellow-200',
  'In Transit': 'bg-blue-50 text-blue-700 border-blue-200',
  'Delivered': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Delayed': 'bg-red-50 text-red-700 border-red-200',
  'Cancelled': 'bg-gray-50 text-gray-600 border-gray-200',
};

const SELECTED_STYLES: Record<string, string> = {
  'Created': 'bg-gray-100 text-gray-800 border-gray-400 ring-2 ring-gray-300',
  'Dispatched': 'bg-yellow-100 text-yellow-800 border-yellow-400 ring-2 ring-yellow-300',
  'In Transit': 'bg-blue-100 text-blue-800 border-blue-400 ring-2 ring-blue-300',
  'Delivered': 'bg-emerald-100 text-emerald-800 border-emerald-400 ring-2 ring-emerald-300',
  'Delayed': 'bg-red-100 text-red-800 border-red-400 ring-2 ring-red-300',
  'Cancelled': 'bg-gray-100 text-gray-800 border-gray-400 ring-2 ring-gray-300',
};

export function POStatusModal({
  po,
  onClose,
  onStatusUpdated,
}: {
  po: POModalData | null;
  onClose: () => void;
  onStatusUpdated: (poNumber: string, newStatus: string) => void;
}) {
  const [newStatus, setNewStatus] = useState<string | null>(null);
  const [courier, setCourier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [receivedQty, setReceivedQty] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().split('T')[0]);
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!po) return null;

  const transitions = TRANSITIONS[po.status] || [];

  const handleSave = async () => {
    if (!newStatus) return;
    setLoading(true);
    setError(null);

    const payload: any = { status: newStatus };
    if (remarks.trim()) payload.remarks = remarks.trim();
    if (courier.trim()) payload.courier = courier.trim();
    if (trackingNumber.trim()) payload.trackingNumber = trackingNumber.trim();
    if (newStatus === 'Delivered') {
      payload.receivedQuantity = receivedQty ? parseInt(receivedQty) : po.quantity;
      payload.actualDeliveryDate = deliveryDate;
    }

    try {
      const ids = po.ids && po.ids.length > 0 ? po.ids : [po.id];
      await Promise.all(ids.map(id => api.purchaseOrders.updateStatus(id, payload)));
      onStatusUpdated(po.po_number, newStatus);
      onClose();
    } catch {
      setError('Failed to update. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card border rounded-xl shadow-xl w-full max-w-md p-6 text-foreground">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold">{po.po_number}</h3>
            <p className="text-xs text-muted-foreground">{po.quantity.toLocaleString()} units</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={STATUS_STYLES[po.status]}>{po.status}</Badge>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {transitions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            This PO is in a terminal status. No further updates possible.
          </p>
        ) : (
          <>
            {/* Status options */}
            <div className="mb-4">
              <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Update to</p>
              <div className="flex flex-wrap gap-2">
                {transitions.map(s => (
                  <button
                    key={s}
                    onClick={() => setNewStatus(s)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                      newStatus === s ? SELECTED_STYLES[s] : 'border-input hover:bg-muted'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Dispatched: courier + tracking */}
            {newStatus === 'Dispatched' && (
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Courier</label>
                  <input
                    type="text"
                    value={courier}
                    onChange={e => setCourier(e.target.value)}
                    placeholder="e.g., BlueDart"
                    className="w-full border border-input rounded-lg bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Tracking No.</label>
                  <input
                    type="text"
                    value={trackingNumber}
                    onChange={e => setTrackingNumber(e.target.value)}
                    placeholder="e.g., 1234567890"
                    className="w-full border border-input rounded-lg bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            )}

            {/* Delivered: received qty + date */}
            {newStatus === 'Delivered' && (
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Received Qty</label>
                  <input
                    type="number"
                    value={receivedQty}
                    onChange={e => setReceivedQty(e.target.value)}
                    placeholder={po.quantity.toString()}
                    className="w-full border border-input rounded-lg bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Delivery Date</label>
                  <input
                    type="date"
                    value={deliveryDate}
                    onChange={e => setDeliveryDate(e.target.value)}
                    className="w-full border border-input rounded-lg bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            )}

            {/* Remarks */}
            <div className="mb-4">
              <label className="text-xs font-medium text-muted-foreground block mb-1">Remarks (optional)</label>
              <textarea
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                placeholder="Add notes..."
                rows={2}
                className="w-full border border-input rounded-lg bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>

            {error && <p className="text-red-500 text-xs mb-3">{error}</p>}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" disabled={!newStatus || loading} onClick={handleSave}>
                {loading ? 'Updating…' : 'Update Status'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
