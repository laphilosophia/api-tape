export type Mode = 'record' | 'replay' | 'hybrid'

export interface TapeRecord {
  schemaVersion?: number
  meta: {
    url?: string
    method?: string
    timestamp?: string
  }
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

export interface ServeOptions {
  target: string
  port: string
  mode: Mode
  dir: string
  recordOnMiss: boolean
  redactHeader: string
}
