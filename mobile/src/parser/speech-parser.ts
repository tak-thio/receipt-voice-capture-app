import { BOUNDARY_KEYWORDS } from '../lib/constants'
import type {
  DictionaryBundle,
  AccountCategoryDictionaryEntry,
} from '../types/dictionaries'
import type { ParsedSpeechFields, SpeechParseResult, TaxMode } from '../types/domain'
import { normalizeSpeechText } from './normalizers'
import { tokenizeSpeech } from './tokenize'

const DATE_PATTERN = /^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日$/
const AMOUNT_PATTERN = /(\d[\d,]*)円?$/
const INVOICE_PATTERN = /^T\d{13}$/i

interface ParseSpeechInput {
  rawText: string
  dictionaries: DictionaryBundle
  referenceDate?: Date
}

interface ParsedDateResult {
  value: string
  consumedCount: number
}

function makeEmptyFields(): ParsedSpeechFields {
  return {
    date: '',
    vendor: '',
    taxMode: 'unknown',
    amount: null,
    paymentMethod: '',
    descriptionRaw: '',
    accountCategoryCandidate: '',
    accountCategoryFinal: '',
    summary: '',
    invoiceNumber: '',
    memo: '',
  }
}

function formatDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function consumeDate(tokens: string[], referenceDate: Date): ParsedDateResult | null {
  let joined = ''

  for (let index = 0; index < Math.min(tokens.length, 3); index += 1) {
    joined += tokens[index]
    const match = joined.match(DATE_PATTERN)

    if (match) {
      const year = match[1] ? Number(match[1]) : referenceDate.getFullYear()
      return {
        value: formatDate(year, Number(match[2]), Number(match[3])),
        consumedCount: index + 1,
      }
    }
  }

  return null
}

function extractTaxMode(token: string): TaxMode | null {
  if (token.includes('税込')) {
    return 'inclusive'
  }

  if (token.includes('税抜')) {
    return 'exclusive'
  }

  return null
}

function extractAmount(token: string): number | null {
  const match = token.match(AMOUNT_PATTERN)

  if (!match) {
    return null
  }

  return Number(match[1].replaceAll(',', ''))
}

function isBoundaryToken(token: string): boolean {
  return BOUNDARY_KEYWORDS.includes(token)
}

function lookupPaymentMethod(
  token: string,
  dictionaries: DictionaryBundle,
): string | null {
  const matched = dictionaries.paymentMethods.find((entry) =>
    [entry.label, ...entry.aliases].includes(token),
  )

  return matched?.label ?? null
}

function lookupAccountCategory(
  token: string,
  dictionaries: DictionaryBundle,
): AccountCategoryDictionaryEntry | null {
  return (
    dictionaries.accountCategories.find((entry) =>
      [entry.name, ...entry.aliases].includes(token),
    ) ?? null
  )
}

function mapDescriptionToCategory(
  descriptionRaw: string,
  dictionaries: DictionaryBundle,
): string {
  const directCategory = lookupAccountCategory(descriptionRaw, dictionaries)
  if (directCategory) {
    return directCategory.name
  }

  const matched = dictionaries.descriptionMappings.find(
    (entry) => entry.pattern === descriptionRaw,
  )

  return matched?.accountCategory ?? ''
}

export function parseSpeech({
  rawText,
  dictionaries,
  referenceDate = new Date(),
}: ParseSpeechInput): SpeechParseResult {
  const normalizedText = normalizeSpeechText(rawText)
  const rawTokens = tokenizeSpeech(normalizedText)
  const warnings: string[] = []
  const boundaryDetected = rawTokens.some(isBoundaryToken)
  const tokens = rawTokens.filter((token) => !isBoundaryToken(token))
  const fields = makeEmptyFields()

  const dateResult = consumeDate(tokens, referenceDate)

  let workingTokens = tokens
  if (dateResult) {
    fields.date = dateResult.value
    workingTokens = workingTokens.slice(dateResult.consumedCount)
  } else {
    warnings.push('日付を特定できませんでした。')
  }

  const vendorTokens: string[] = []
  while (workingTokens.length > 0) {
    const token = workingTokens[0]
    const paymentMethod = lookupPaymentMethod(token, dictionaries)
    const taxMode = extractTaxMode(token)
    const amount = extractAmount(token)

    if (paymentMethod || taxMode || amount !== null) {
      break
    }

    vendorTokens.push(token)
    workingTokens = workingTokens.slice(1)
  }

  fields.vendor = vendorTokens.join(' ')
  if (!fields.vendor) {
    warnings.push('支払先を特定できませんでした。')
  }

  let taxMode: TaxMode = 'unknown'
  let amount: number | null = null
  while (workingTokens.length > 0) {
    const token = workingTokens[0]
    const maybeTaxMode = extractTaxMode(token)
    const maybeAmount = extractAmount(token)
    const maybePaymentMethod = lookupPaymentMethod(token, dictionaries)

    if (maybePaymentMethod && amount !== null) {
      break
    }

    if (maybeTaxMode) {
      taxMode = maybeTaxMode
    }

    if (maybeAmount !== null && amount === null) {
      amount = maybeAmount
    }

    workingTokens = workingTokens.slice(1)

    if (amount !== null && maybePaymentMethod) {
      fields.paymentMethod = maybePaymentMethod
      break
    }

    if (amount !== null && workingTokens.length > 0) {
      const nextPaymentMethod = lookupPaymentMethod(workingTokens[0], dictionaries)
      if (nextPaymentMethod) {
        fields.paymentMethod = nextPaymentMethod
        workingTokens = workingTokens.slice(1)
        break
      }
    }
  }

  fields.taxMode = taxMode
  fields.amount = amount

  if (fields.taxMode === 'unknown') {
    warnings.push('税区分が未指定です。')
  }

  if (fields.amount === null) {
    warnings.push('金額を特定できませんでした。')
  }

  if (!fields.paymentMethod) {
    const paymentToken = workingTokens.find((token) => lookupPaymentMethod(token, dictionaries))
    if (paymentToken) {
      fields.paymentMethod = lookupPaymentMethod(paymentToken, dictionaries) ?? ''
      workingTokens = workingTokens.filter((token) => token !== paymentToken)
    } else {
      warnings.push('支払方法を特定できませんでした。')
    }
  }

  const invoiceToken = workingTokens.find((token) => INVOICE_PATTERN.test(token))
  if (invoiceToken) {
    fields.invoiceNumber = invoiceToken.toUpperCase()
    workingTokens = workingTokens.filter((token) => token !== invoiceToken)
  }

  const categoryIndex = workingTokens.findIndex((token) =>
    Boolean(lookupAccountCategory(token, dictionaries)),
  )
  const laterCategoryOffset = workingTokens
    .slice(1)
    .findIndex((token) => Boolean(lookupAccountCategory(token, dictionaries)))

  if (categoryIndex === 0 && laterCategoryOffset >= 0) {
    const actualCategoryIndex = laterCategoryOffset + 1
    const category = lookupAccountCategory(workingTokens[actualCategoryIndex], dictionaries)
    fields.descriptionRaw = workingTokens[0] ?? ''
    fields.accountCategoryCandidate = category?.name ?? ''
    fields.accountCategoryFinal = category?.name ?? ''
    fields.summary = workingTokens
      .filter((_, index) => index > 0 && index !== actualCategoryIndex)
      .join(' ')
  } else if (categoryIndex === 0) {
    const category = lookupAccountCategory(workingTokens[0], dictionaries)
    fields.accountCategoryCandidate = category?.name ?? ''
    fields.accountCategoryFinal = category?.name ?? ''
    fields.descriptionRaw =
      workingTokens[1] ??
      (workingTokens.length === 1 && category && workingTokens[0] === category.name
        ? ''
        : workingTokens[0] ?? '')
    fields.summary = workingTokens.length > 1 ? workingTokens.slice(2).join(' ') : ''
  } else {
    fields.descriptionRaw = workingTokens[0] ?? ''

    if (categoryIndex > 0) {
      const category = lookupAccountCategory(workingTokens[categoryIndex], dictionaries)
      fields.accountCategoryCandidate = category?.name ?? ''
      fields.accountCategoryFinal = category?.name ?? ''
      fields.summary = workingTokens
        .filter((_, index) => index > 0 && index !== categoryIndex)
        .join(' ')
    } else {
      const mappedCategory = mapDescriptionToCategory(fields.descriptionRaw, dictionaries)
      fields.accountCategoryCandidate = mappedCategory
      fields.accountCategoryFinal = mappedCategory
      fields.summary = workingTokens.slice(1).join(' ')
    }
  }

  if (!fields.accountCategoryCandidate && fields.descriptionRaw) {
    warnings.push('勘定項目候補を推定できませんでした。')
  }

  return {
    normalizedText,
    tokens,
    fields,
    warnings,
    boundaryDetected,
  }
}
