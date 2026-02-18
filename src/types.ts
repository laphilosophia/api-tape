export type Mode = 'record' | 'replay' | 'hybrid'
export type MatchStrategy = 'exact' | 'normalized'

export interface TapeRecord {
  schemaVersion?: number
  meta: {
    url?: string
    method?: string
    timestamp?: string
    matchStrategy?: MatchStrategy
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
  statsInterval: string
  statsJson: boolean
  matchStrategy: MatchStrategy
}

export interface ServeMetrics {
  totalRequests: number
  replayHits: number
  replayMisses: number
  upstreamRequests: number
  upstreamErrors: number
  totalLatencyMs: number
  completedResponses: number
}
