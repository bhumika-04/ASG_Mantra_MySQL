/**
 * Shared presentation helpers for purchase-order rows.
 *
 * The effective status is computed by the backend (`_po_expired_sql` / `_eff_status` in
 * purchase_orders.py) and returned on every PO payload as `status`. The frontend must
 * NOT re-derive it.
 *
 * Five pages previously carried their own `effStatus` that flipped a PO to Expired one
 * day past its expiry date, while the backend required `_EXPIRY_DAYS` (15). A PO in that
 * window showed an "Expired" badge in the grid while the KPI above it counted the PO
 * under its stored status. Trusting the backend value removes the disagreement by
 * construction rather than by keeping two thresholds in step.
 *
 * Colour follows from that same status:
 *   red    — the backend says Expired
 *   yellow — needs attention: within EXPIRY_WARNING_DAYS of expiry, or past the date but
 *            still inside the backend's grace period
 *   none   — settled (delivered/cancelled/in transit) or nothing due soon
 */

/** Statuses where the expiry date no longer matters — the PO has moved on. */
const SETTLED_STATUSES = new Set([
  'Delivered', 'Received', 'Cancelled', 'Closed', 'Dispatched', 'In Transit',
]);

/** Highlight a PO this many days before its expiry date. */
export const EXPIRY_WARNING_DAYS = 7;

/** Days until the expiry date. Negative once the date has passed. Null if no date. */
export function daysUntilExpiry(expiryISO: string | null): number | null {
  if (!expiryISO) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(expiryISO + 'T00:00:00').getTime() - today.getTime()) / 86400000);
}

function severity(status: string, expiryISO: string | null): 'expired' | 'warning' | null {
  if (status === 'Expired') return 'expired';
  if (SETTLED_STATUSES.has(status)) return null;
  const d = daysUntilExpiry(expiryISO);
  // d <= WARNING covers both "expiring soon" and "past the date but not yet Expired"
  if (d !== null && d <= EXPIRY_WARNING_DAYS) return 'warning';
  return null;
}

/** Tailwind classes for the row. */
export function getPoRowClass(status: string, expiryISO: string | null): string | undefined {
  const s = severity(status, expiryISO);
  if (s === 'expired') return 'bg-red-50 dark:bg-red-950/20';
  if (s === 'warning') return 'bg-yellow-50 dark:bg-yellow-950/20';
  return undefined;
}

/**
 * Explicit CSS colour for DataGrid's sticky columns, which set an inline background and
 * would otherwise override the Tailwind class above.
 */
export function getPoRowBgColor(status: string, expiryISO: string | null): string | undefined {
  const s = severity(status, expiryISO);
  if (s === 'expired') return 'rgb(254,242,242)';
  if (s === 'warning') return 'rgb(254,252,232)';
  return undefined;
}
