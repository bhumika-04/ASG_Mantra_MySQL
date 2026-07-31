/**
 * Convert an all-uppercase product name to title case for display.
 * If the string is already mixed case, it is returned unchanged.
 */
export function toTitleCase(str: string | null | undefined): string {
  if (!str) return str ?? '';
  const letters = str.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 3 && letters === letters.toUpperCase()) {
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  return str;
}

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
 * Date display helpers.
 *
 * Every date shown in the UI is day-month-year. These live here rather than in the
 * pages so the format cannot drift: several pages previously formatted dates inline,
 * and one shadowed fmtDate with a local copy that rendered "31 Jul 26".
 *
 * The backend already emits %d-%m-%Y for its pre-formatted date strings.
 */

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

/**
 * Compact day-month for chart axes, e.g. "31-07".
 * Keeps day-before-month ordering where a full year would not fit.
 */
export function fmtDayMonth(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const [, m, d] = dateStr.slice(0, 10).split('-');
  if (!m || !d) return dateStr;
  return `${d}-${m}`;
}

/**
 * Month and year for chart axes and period labels, e.g. "Jul 2026".
 * Accepts YYYY-MM or a full date. A month has no day component, so the
 * day-month-year rule does not apply; the month name stays for readability.
 */
export function fmtMonthYear(period: string | null | undefined): string {
  if (!period) return '';
  const [y, m] = period.split('-');
  const mi = parseInt(m, 10) - 1;
  if (!y || isNaN(mi) || mi < 0 || mi > 11) return period;
  return `${MONTHS_SHORT[mi]} ${y}`;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
