/**
 * Shared business thresholds.
 *
 * Must match the backend (backend/app/utils/stock.py, LOW_STOCK_THRESHOLD).
 */

/** A product is low on stock when Packed + Unpacked is at or below this many units. */
export const LOW_STOCK_THRESHOLD = 50;
