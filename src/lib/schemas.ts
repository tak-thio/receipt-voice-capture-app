import { z } from 'zod'

export const paymentMethodDictionaryEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  aliases: z.array(z.string()),
})

export const accountCategoryDictionaryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  notes: z.string().optional(),
})

export const descriptionMappingEntrySchema = z.object({
  pattern: z.string(),
  accountCategory: z.string(),
  confidence: z.number(),
  notes: z.string().optional(),
})

export const dictionaryBundleSchema = z.object({
  paymentMethods: z.array(paymentMethodDictionaryEntrySchema),
  accountCategories: z.array(accountCategoryDictionaryEntrySchema),
  descriptionMappings: z.array(descriptionMappingEntrySchema),
})

export const appSettingsSchema = z.object({
  storageRoot: z.string(),
  preferredCameraId: z.string(),
  preferredMicrophoneId: z.string(),
  sttMode: z.enum(['mock', 'local']),
  ocrEnabled: z.boolean(),
  ocrMode: z.enum(['mock', 'local']),
  exportTargetDefault: z.enum(['freee', 'yayoi', 'generic']),
})

export const sessionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  settingsSnapshot: appSettingsSchema,
  records: z.array(z.unknown()),
})
