export interface PaymentMethodDictionaryEntry {
  id: string
  label: string
  aliases: string[]
}

export interface AccountCategoryDictionaryEntry {
  id: string
  name: string
  aliases: string[]
  notes?: string
}

export interface DescriptionMappingEntry {
  pattern: string
  accountCategory: string
  confidence: number
  notes?: string
}

export interface DictionaryBundle {
  paymentMethods: PaymentMethodDictionaryEntry[]
  accountCategories: AccountCategoryDictionaryEntry[]
  descriptionMappings: DescriptionMappingEntry[]
}
