/**
 * Currency formatting utilities
 */

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const currencyFormatterWithCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/**
 * Format a number as currency (e.g., "$125,000")
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return '$0';
  return currencyFormatter.format(amount);
}

/**
 * Format a number as currency with cents (e.g., "$125,000.00")
 */
export function formatCurrencyWithCents(amount: number | null | undefined): string {
  if (amount == null) return '$0.00';
  return currencyFormatterWithCents.format(amount);
}

/**
 * Format a large number as compact currency (e.g., "$1.2M", "$450K")
 */
export function formatCurrencyCompact(amount: number | null | undefined): string {
  if (amount == null) return '$0';
  return compactFormatter.format(amount);
}

/**
 * Format a decimal as a percentage (e.g., 0.25 -> "25%")
 */
export function formatPercent(value: number | null | undefined): string {
  if (value == null) return '0%';
  return percentFormatter.format(value / 100);
}

/**
 * Format a number with sign (e.g., "+$12,000" or "-$5,000")
 */
export function formatCurrencyWithSign(amount: number | null | undefined): string {
  if (amount == null) return '$0';
  const formatted = formatCurrency(Math.abs(amount));
  if (amount > 0) return `+${formatted}`;
  if (amount < 0) return `-${formatted}`;
  return formatted;
}

/**
 * Format a number with thousands separator (e.g., 1234567 -> "1,234,567")
 */
export function formatNumber(value: number | null | undefined): string {
  if (value == null) return '0';
  return new Intl.NumberFormat('en-US').format(value);
}
