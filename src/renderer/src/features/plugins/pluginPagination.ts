/**
 * Pure pagination logic for the plugin sections (renderer).
 * Kept in a separate module so it can be tested with node --test without a DOM.
 */

export const INSTALLED_PAGE_SIZE = 6;
export const SHOWCASE_PAGE_SIZE = 10;

/** Number of pages for total items at pageSize items per page. */
export function pageCount(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(pageSize) || pageSize <= 0) {
    return 0;
  }
  return Math.ceil(total / pageSize);
}

/** Clamps a page number (0-based) to the range [0, count-1]. */
export function clampPage(page: number, total: number, pageSize: number): number {
  const count = pageCount(total, pageSize);
  if (count <= 1) return 0;
  if (!Number.isFinite(page) || page < 0) return 0;
  return Math.min(page, count - 1);
}

/** Returns the slice of items for the given page (0-based). */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): T[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const safePage = clampPage(page, items.length, pageSize);
  const start = safePage * pageSize;
  return items.slice(start, start + pageSize);
}
