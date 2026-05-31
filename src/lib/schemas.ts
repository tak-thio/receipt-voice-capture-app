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
  sttMode: z.enum(['mock', 'local', 'openai', 'gemini']),
  sttModel: z.string(),
  sttDevice: z.string(),
  sttComputeType: z.string(),
  sttLanguage: z.string(),
  sttBeamSize: z.number().int().positive(),
  aiProvider: z.enum(['openai', 'gemini']),
  openaiApiKey: z.string(),
  geminiApiKey: z.string(),
  openaiSttModel: z.string(),
  geminiModel: z.string(),
  aiFormatMode: z.enum(['rule', 'openai', 'gemini', 'local']),
  aiFormatterModel: z.string(),
  ocrEnabled: z.boolean(),
  ocrMode: z.enum(['mock', 'local', 'gemini']),
  exportTargetDefault: z.enum(['freee', 'yayoi', 'generic', 'mas']),
  customDictionaries: dictionaryBundleSchema.optional().default({
    paymentMethods: [],
    accountCategories: [],
    descriptionMappings: [],
  }),
})

export const sessionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  settingsSnapshot: appSettingsSchema,
  records: z.array(z.unknown()),
})
