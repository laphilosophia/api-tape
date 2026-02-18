#!/usr/bin/env node
import chalk from 'chalk'
import { Command } from 'commander'
import crypto from 'crypto'
import fs, { Mode } from 'fs-extra'
import http from 'http'
import httpProxy from 'http-proxy'
import path from 'path'
import { CURRENT_SCHEMA_VERSION } from './constants'
import { ServeMetrics, ServeOptions, TapeRecord } from './types'
import {
  parseBooleanOption,
  parseCsv,
  parseNonNegativeInt,
  parsePositiveInt,
  timestamp,
} from './utils'

const getTapeKey = (req: http.IncomingMessage): string => {
  const key = `${req.method}|${req.url}`
  return crypto.createHash('md5').update(key).digest('hex')
}

const readTape = (tapePath: string): TapeRecord => fs.readJsonSync(tapePath) as TapeRecord

const redactHeaders = (
  headers: Record<string, string | string[] | undefined>,
  redactedHeaders: string[],
): Record<string, string | string[] | undefined> => {
  if (redactedHeaders.length === 0) {
    return headers
  }

  const redactedSet = new Set(redactedHeaders.map((header) => header.toLowerCase()))
  const nextHeaders: Record<string, string | string[] | undefined> = { ...headers }

  Object.keys(nextHeaders).forEach((key) => {
    if (redactedSet.has(key.toLowerCase())) {
      nextHeaders[key] = '[REDACTED]'
    }
  })

  return nextHeaders
}

const ensureSchemaCompatibility = (record: TapeRecord, tapePath: string): void => {
  const schemaVersion = record.schemaVersion ?? 0

  if (![0, CURRENT_SCHEMA_VERSION].includes(schemaVersion)) {
    throw new Error(`Unsupported tape schema version at ${tapePath}: ${schemaVersion}`)
  }
}

const createTapeRecord = (
  req: http.IncomingMessage,
  proxyRes: http.IncomingMessage,
  bodyBuffer: Buffer,
  redactedHeaders: string[],
): TapeRecord => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  meta: {
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
  },
  statusCode: proxyRes.statusCode || 200,
  headers: redactHeaders(
    proxyRes.headers as Record<string, string | string[] | undefined>,
    redactedHeaders,
  ),
  body: bodyBuffer.toString('base64'),
})

const buildMetricsSnapshot = (metrics: ServeMetrics) => ({
  totalRequests: metrics.totalRequests,
  replayHits: metrics.replayHits,
  replayMisses: metrics.replayMisses,
  upstreamRequests: metrics.upstreamRequests,
  upstreamErrors: metrics.upstreamErrors,
  completedResponses: metrics.completedResponses,
  averageLatencyMs:
    metrics.completedResponses === 0
      ? 0
      : Number((metrics.totalLatencyMs / metrics.completedResponses).toFixed(2)),
})

const printMetrics = (metrics: ServeMetrics, asJson: boolean, prefix = 'STATS'): void => {
  const snapshot = buildMetricsSnapshot(metrics)

  if (asJson) {
    console.log(JSON.stringify({ event: prefix, ...snapshot }))
    return
  }

  console.log(
    `${timestamp()} ${chalk.cyan(prefix)} total=${snapshot.totalRequests} replay_hit=${snapshot.replayHits} replay_miss=${snapshot.replayMisses} upstream=${snapshot.upstreamRequests} upstream_errors=${snapshot.upstreamErrors} avg_latency_ms=${snapshot.averageLatencyMs}`,
  )
}

const runServe = (opts: ServeOptions): void => {
  const targetUrl = opts.target
  const port = parsePositiveInt(opts.port, 'Port')
  const mode = opts.mode
  const tapesDir = path.resolve(opts.dir)
  const recordOnMiss = opts.recordOnMiss
  const redactedHeaders = parseCsv(opts.redactHeader)
  const statsIntervalSec = parseNonNegativeInt(opts.statsInterval, 'stats-interval')
  const statsJson = opts.statsJson

  const validModes: Mode[] = ['record', 'replay', 'hybrid']
  if (!validModes.includes(mode)) {
    throw new Error(`Invalid mode: ${mode}. Expected one of: ${validModes.join(', ')}`)
  }

  fs.ensureDirSync(tapesDir)

  const proxy = httpProxy.createProxyServer({
    target: targetUrl,
    changeOrigin: true,
    selfHandleResponse: true,
  })

  const recordByRequest = new WeakMap<http.IncomingMessage, boolean>()
  const requestStartByResponse = new WeakMap<http.ServerResponse, number>()
  const metrics: ServeMetrics = {
    totalRequests: 0,
    replayHits: 0,
    replayMisses: 0,
    upstreamRequests: 0,
    upstreamErrors: 0,
    totalLatencyMs: 0,
    completedResponses: 0,
  }

  const replayTape = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    tapePath: string,
  ): boolean => {
    if (!fs.existsSync(tapePath)) {
      return false
    }

    try {
      const tape = readTape(tapePath)
      ensureSchemaCompatibility(tape, tapePath)

      Object.keys(tape.headers).forEach((key) => {
        res.setHeader(key, tape.headers[key] as string | number | readonly string[])
      })

      res.setHeader('X-Api-Tape', 'Replayed')

      res.writeHead(tape.statusCode)
      res.end(Buffer.from(tape.body, 'base64'))

      metrics.replayHits += 1
      console.log(`${timestamp()} ${chalk.green('↺ REPLAY_HIT')} ${req.method} ${req.url}`)
      return true
    } catch (error) {
      console.error(
        chalk.red('Corrupted Tape:'),
        tapePath,
        error instanceof Error ? error.message : 'unknown error',
      )
      res.statusCode = 500
      res.end('Corrupted Tape')
      return true
    }
  }

  const proxyRequest = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    shouldRecord: boolean,
    logPrefix: string,
  ): void => {
    recordByRequest.set(req, shouldRecord)
    metrics.upstreamRequests += 1
    console.log(`${timestamp()} ${logPrefix} ${req.method} ${req.url}`)

    proxy.web(req, res, {}, (error) => {
      metrics.upstreamErrors += 1
      console.error(chalk.red('Proxy Error:'), error.message)
      res.statusCode = 502
      res.end('Proxy Error')
    })
  }

  const server = http.createServer((req, res) => {
    metrics.totalRequests += 1
    requestStartByResponse.set(res, Date.now())

    res.on('finish', () => {
      const startedAt = requestStartByResponse.get(res)
      if (typeof startedAt === 'number') {
        metrics.totalLatencyMs += Date.now() - startedAt
        metrics.completedResponses += 1
      }
    })

    const tapeKey = getTapeKey(req)
    const tapePath = path.join(tapesDir, `${tapeKey}.json`)

    if (mode === 'replay') {
      const hit = replayTape(req, res, tapePath)

      if (!hit) {
        metrics.replayMisses += 1
        console.log(`${timestamp()} ${chalk.red('✘ REPLAY_MISS')} ${req.method} ${req.url}`)
        res.statusCode = 404
        res.end(`Tape not found for: ${req.method} ${req.url}`)
      }
      return
    }

    if (mode === 'record') {
      proxyRequest(req, res, true, chalk.blue('● RECORD'))
      return
    }

    const hit = replayTape(req, res, tapePath)
    if (hit) {
      return
    }

    metrics.replayMisses += 1
    console.log(`${timestamp()} ${chalk.yellow('⇢ REPLAY_MISS')} ${req.method} ${req.url}`)
    proxyRequest(
      req,
      res,
      recordOnMiss,
      recordOnMiss ? chalk.magenta('⇢ FALLBACK_RECORD') : chalk.magenta('⇢ FALLBACK_PROXY'),
    )
  })

  proxy.on('proxyRes', (proxyRes, req, res) => {
    const bodyChunks: Buffer[] = []

    proxyRes.on('data', (chunk) => bodyChunks.push(chunk))

    proxyRes.on('end', () => {
      const bodyBuffer = Buffer.concat(bodyChunks)
      const shouldRecord = recordByRequest.get(req) ?? true

      if (shouldRecord) {
        const tapeData = createTapeRecord(req, proxyRes, bodyBuffer, redactedHeaders)
        const tapeKey = getTapeKey(req)
        const tapePath = path.join(tapesDir, `${tapeKey}.json`)
        fs.writeJsonSync(tapePath, tapeData, { spaces: 2 })
        console.log(`${timestamp()} ${chalk.cyan('💾 SAVED')} ${req.method} ${req.url}`)
      }

      Object.keys(proxyRes.headers).forEach((key) => {
        res.setHeader(key, proxyRes.headers[key] as string | number | readonly string[])
      })
      res.writeHead(proxyRes.statusCode || 200)
      res.end(bodyBuffer)
    })
  })

  let metricsTimer: NodeJS.Timeout | undefined

  if (statsIntervalSec > 0) {
    metricsTimer = setInterval(() => {
      printMetrics(metrics, statsJson)
    }, statsIntervalSec * 1000)
  }

  const shutdown = (signal: NodeJS.Signals): void => {
    if (metricsTimer) {
      clearInterval(metricsTimer)
      metricsTimer = undefined
    }

    printMetrics(metrics, statsJson, 'FINAL_STATS')
    server.close(() => {
      process.exit(0)
    })

    setTimeout(() => {
      process.exit(0)
    }, 2000).unref()
  }

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))

  console.log(chalk.bold(`\n📼 API Tape Running`))
  console.log(
    `   ${chalk.dim('Mode:')}   ${
      mode === 'record'
        ? chalk.red('● RECORD')
        : mode === 'hybrid'
          ? chalk.yellow('⇢ HYBRID')
          : chalk.green('↺ REPLAY')
    }`,
  )
  console.log(`   ${chalk.dim('Target:')} ${targetUrl}`)
  console.log(`   ${chalk.dim('Port:')}   http://localhost:${port}`)
  console.log(`   ${chalk.dim('Dir:')}    ${tapesDir}`)
  if (mode === 'hybrid') {
    console.log(`   ${chalk.dim('Record Miss:')} ${recordOnMiss}`)
  }
  if (redactedHeaders.length > 0) {
    console.log(`   ${chalk.dim('Redact Headers:')} ${redactedHeaders.join(', ')}`)
  }
  if (statsIntervalSec > 0) {
    console.log(`   ${chalk.dim('Stats Every:')} ${statsIntervalSec}s`)
  }
  if (statsJson) {
    console.log(`   ${chalk.dim('Stats Format:')} json`)
  }
  console.log('')

  server.listen(port)
}

const listTapes = (dir: string): void => {
  const tapesDir = path.resolve(dir)
  fs.ensureDirSync(tapesDir)

  const files = fs
    .readdirSync(tapesDir)
    .filter((file) => file.endsWith('.json'))
    .sort()

  if (files.length === 0) {
    console.log('No tapes found.')
    return
  }

  files.forEach((file) => {
    const tapePath = path.join(tapesDir, file)
    const tape = readTape(tapePath)
    ensureSchemaCompatibility(tape, tapePath)
    const method = tape.meta.method || 'UNKNOWN'
    const route = tape.meta.url || '(unknown-url)'
    const time = tape.meta.timestamp || '(unknown-time)'
    console.log(`${path.basename(file, '.json')}  ${method}  ${route}  ${time}`)
  })
}

const inspectTape = (dir: string, tapeId: string): void => {
  const tapesDir = path.resolve(dir)
  const tapePath = path.join(tapesDir, `${tapeId}.json`)

  if (!fs.existsSync(tapePath)) {
    throw new Error(`Tape not found: ${tapeId}`)
  }

  const tape = readTape(tapePath)
  ensureSchemaCompatibility(tape, tapePath)

  const preview = {
    id: tapeId,
    schemaVersion: tape.schemaVersion ?? 0,
    meta: tape.meta,
    statusCode: tape.statusCode,
    headers: tape.headers,
    bodyBytes: Buffer.from(tape.body, 'base64').byteLength,
  }

  console.log(JSON.stringify(preview, null, 2))
}

const clearTapes = (dir: string, confirmed: boolean): void => {
  if (!confirmed) {
    throw new Error('Refusing to clear tapes without --yes flag.')
  }

  const tapesDir = path.resolve(dir)
  fs.ensureDirSync(tapesDir)
  const files = fs.readdirSync(tapesDir).filter((file) => file.endsWith('.json'))

  files.forEach((file) => {
    fs.removeSync(path.join(tapesDir, file))
  })

  console.log(`Cleared ${files.length} tape file(s).`)
}

const pruneTapes = (dir: string, olderThanDays: string): void => {
  const days = parsePositiveInt(olderThanDays, 'older-than')
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const tapesDir = path.resolve(dir)

  fs.ensureDirSync(tapesDir)
  const files = fs.readdirSync(tapesDir).filter((file) => file.endsWith('.json'))
  let removed = 0

  files.forEach((file) => {
    const target = path.join(tapesDir, file)
    const stat = fs.statSync(target)

    if (stat.mtimeMs < cutoff) {
      fs.removeSync(target)
      removed += 1
    }
  })

  console.log(`Pruned ${removed} tape file(s) older than ${days} day(s).`)
}

const addServeOptions = (command: Command): Command =>
  command
    .requiredOption('-t, --target <url>', 'Target API URL (e.g., https://api.github.com)')
    .option('-p, --port <number>', 'Local server port', '8080')
    .option('-m, --mode <mode>', 'Operation mode: "record", "replay", or "hybrid"', 'replay')
    .option('-d, --dir <path>', 'Directory to save tapes', './tapes')
    .option(
      '--record-on-miss <boolean>',
      'In hybrid mode, save upstream response when tape is missing',
      parseBooleanOption,
      true,
    )
    .option(
      '--redact-header <headers>',
      'Comma-separated response header names to redact before saving',
      '',
    )
    .option('--stats-interval <seconds>', 'Emit runtime stats every N seconds (0 disables)', '0')
    .option('--stats-json', 'Emit stats in JSON format', false)

const run = (): void => {
  const argv = process.argv
  const hasSubCommand = argv.length > 2 && ['serve', 'tape'].includes(argv[2])

  if (!hasSubCommand) {
    const legacy = addServeOptions(new Command())
      .name('api-tape')
      .description('Record and Replay HTTP API responses for offline development.')
      .version('1.3.0')
      .action((options: ServeOptions) => {
        runServe(options)
      })

    legacy.parse(argv)
    return
  }

  const program = new Command()

  program
    .name('api-tape')
    .description('Record and Replay HTTP API responses for offline development.')
    .version('1.3.0')

  addServeOptions(program.command('serve').description('Run API Tape proxy server')).action(
    (options: ServeOptions) => {
      runServe(options)
    },
  )

  const tape = program.command('tape').description('Manage recorded tape files')

  tape
    .command('list')
    .description('List all recorded tapes')
    .option('-d, --dir <path>', 'Directory to save tapes', './tapes')
    .action((options: { dir: string }) => {
      listTapes(options.dir)
    })

  tape
    .command('inspect <id>')
    .description('Inspect a recorded tape by hash id')
    .option('-d, --dir <path>', 'Directory to save tapes', './tapes')
    .action((id: string, options: { dir: string }) => {
      inspectTape(options.dir, id)
    })

  tape
    .command('clear')
    .description('Delete all tape files from directory')
    .option('-d, --dir <path>', 'Directory to save tapes', './tapes')
    .option('--yes', 'Confirm destructive deletion', false)
    .action((options: { dir: string; yes: boolean }) => {
      clearTapes(options.dir, options.yes)
    })

  tape
    .command('prune')
    .description('Delete tape files older than N days')
    .requiredOption('--older-than <days>', 'Remove files older than N days')
    .option('-d, --dir <path>', 'Directory to save tapes', './tapes')
    .action((options: { dir: string; olderThan: string }) => {
      pruneTapes(options.dir, options.olderThan)
    })

  program.parse(argv)
}

run()
