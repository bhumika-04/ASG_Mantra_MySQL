/**
 * Export data as a CSV file download.
 * Adds a UTF-8 BOM so Excel opens it correctly with special characters (₹, etc.).
 */
export function exportToCSV(data: Record<string, any>[], filename: string): void {
  if (!data.length) return;

  const headers = Object.keys(data[0]);

  const escapeCell = (val: any): string => {
    const str = val == null ? '' : String(val);
    // Wrap in quotes if the value contains commas, quotes, or newlines
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = [
    headers.map(escapeCell).join(','),
    ...data.map(row => headers.map(h => escapeCell(row[h])).join(',')),
  ];

  const csv = rows.join('\n');
  // BOM (\uFEFF) ensures Excel reads UTF-8 correctly (shows ₹ etc.)
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
