/** Format a number using the Indian number system (lakhs/crores). */
export function fmtN(n: number): string {
  return n.toLocaleString('en-IN');
}

/** Format a currency value using the Indian number system with ₹ prefix.
 *  Pass decimals=2 for paisa-level precision (e.g. ₹1,23,456.78). */
export function fmtCurrency(n: number, decimals = 0): string {
  return '₹' + n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Convert an ISO/YYYY-MM-DD date string to DD-MM-YYYY display format.
 * Safe for ISO timestamps (takes first 10 chars).
 */
export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const part = dateStr.slice(0, 10);
  const [y, m, d] = part.split('-');
  if (!y || !m || !d) return dateStr;
  return `${d}-${m}-${y}`;
}
