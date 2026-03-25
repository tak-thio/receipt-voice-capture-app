import type { OcrExtractedCandidates } from '../../types/domain'

const DATE_PATTERN = /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/g
const ISO_DATE_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})\b/g
const AMOUNT_PATTERN = /(\d[\d,]*)円/g
const INVOICE_PATTERN = /\bT\d{13}\b/gi

function normalizeWhitespace(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[、。]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function extractDates(rawText: string, referenceDate: Date): string[] {
  const values = new Set<string>()

  for (const match of rawText.matchAll(ISO_DATE_PATTERN)) {
    values.add(formatDate(Number(match[1]), Number(match[2]), Number(match[3])))
  }

  for (const match of rawText.matchAll(DATE_PATTERN)) {
    const year = match[1] ? Number(match[1]) : referenceDate.getFullYear()
    values.add(formatDate(year, Number(match[2]), Number(match[3])))
  }

  return Array.from(values)
}

function extractAmounts(rawText: string): number[] {
  const values = new Set<number>()

  for (const match of rawText.matchAll(AMOUNT_PATTERN)) {
    values.add(Number(match[1].replaceAll(',', '')))
  }

  return Array.from(values)
}

function extractInvoiceNumbers(rawText: string): string[] {
  return Array.from(new Set(Array.from(rawText.matchAll(INVOICE_PATTERN), (match) => match[0].toUpperCase())))
}

function extractVendors(rawText: string, dates: string[], amounts: number[], invoiceNumbers: string[]): string[] {
  let normalized = normalizeWhitespace(rawText)

  for (const value of dates) {
    normalized = normalized.replaceAll(value, ' ')
  }

  normalized = normalized.replace(DATE_PATTERN, ' ')

  for (const amount of amounts) {
    normalized = normalized.replaceAll(`${amount}円`, ' ')
    normalized = normalized.replaceAll(String(amount), ' ')
  }

  for (const invoiceNumber of invoiceNumbers) {
    normalized = normalized.replaceAll(invoiceNumber, ' ')
  }

  const tokens = normalizeWhitespace(normalized)
    .split(' ')
    .filter(Boolean)

  if (!tokens.length) {
    return []
  }

  return [tokens.join(' ')]
}

export function extractOcrCandidates(
  rawText: string,
  referenceDate: Date = new Date(),
): OcrExtractedCandidates {
  const normalized = normalizeWhitespace(rawText)
  const dates = extractDates(normalized, referenceDate)
  const amounts = extractAmounts(normalized)
  const invoiceNumbers = extractInvoiceNumbers(normalized)
  const vendors = extractVendors(normalized, dates, amounts, invoiceNumbers)

  return {
    dates,
    vendors,
    amounts,
    invoiceNumbers,
  }
}
