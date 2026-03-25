export function tokenizeSpeech(input: string): string[] {
  if (!input.trim()) {
    return []
  }

  return input
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
}
