import chalk from 'chalk'

export const timestamp = () => chalk.gray(`[${new Date().toLocaleTimeString()}]`)

export const parseBooleanOption = (value: string): boolean => {
  const normalized = value.toLowerCase().trim()

  if (normalized === 'true') {
    return true
  }

  if (normalized === 'false') {
    return false
  }

  throw new Error('Option must be either "true" or "false".')
}

export const parsePositiveInt = (value: string, label: string): number => {
  const parsed = parseInt(value, 10)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`)
  }

  return parsed
}

export const parseNonNegativeInt = (value: string, label: string): number => {
  const parsed = parseInt(value, 10)

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`)
  }

  return parsed
}

export const parseCsv = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`
}
