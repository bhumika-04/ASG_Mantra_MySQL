/**
 * Shared business thresholds.
 *
 * These must stay in step with the backend. Low stock previously used three different
 * values — 10 on the Inventory page, 50 in inventory.py, and a separate 200 on packed
 * quantity in the dispatch overview — so the same product appeared low in one view and
 * healthy in another.
 *
 * Backend counterparts:
 *   backend/app/routers/inventory.py  LOW_STOCK_THRESHOLD
 *   backend/app/routers/alerts.py     LOW_STOCK_THRESHOLD
 */

/** A product is low on stock at or below this many sellable units. */
export const LOW_STOCK_THRESHOLD = 50;
