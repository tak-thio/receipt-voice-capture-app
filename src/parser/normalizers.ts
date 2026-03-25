export function normalizeSpeechText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[、。]/g, ' ')
    .replace(/税込み/g, '税込')
    .replace(/税抜き/g, '税抜')
    .replace(/\s+/g, ' ')
    .trim()
}
