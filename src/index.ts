#!/usr/bin/env node
import chalk from 'chalk'
import { program } from 'commander'
import crypto from 'crypto'
import fs from 'fs-extra'
import http from 'http'
import httpProxy from 'http-proxy'
import path from 'path'
import pkg from '../package.json'

const CURRENT_SCHEMA_VERSION = 1

type Mode = 'record' | 'replay' | 'hybrid'

const parseBooleanOption = (value: string): boolean => {
  const normalized = value.toLowerCase().trim()

  if (normalized === 'true') {
    return true
  }

  if (normalized === 'false') {
    return false
  }

  throw new Error('Option must be either "true" or "false".')
}

program
  .name('api-tape')
  .description('Record and Replay HTTP API responses for offline development.')
  .requiredOption('-t, --target <url>', 'Target API URL (e.g., https://api.github.com)')
  .option('-p, --port <number>', 'Local server port', '8080')
  .option('-m, --mode <mode>', 'Operation mode: "record", "replay", or "hybrid', 'replay')
  .option('-d, --dir <path>', 'Directory to save tapes', './tapes')
  .option(
    '--record-on-miss <boolean>',
    'In hybrid mode, save upstream response when tape is missing',
    parseBooleanOption,
    true,
  )
  .version(pkg.version)
  .parse()

const opts = program.opts()
const TARGET_URL: string = opts.target
const PORT = parseInt(opts.port, 10)
const MODE = opts.mode as Mode
const TAPES_DIR = path.resolve(opts.dir)
const RECORD_ON_MISS: boolean = opts.recordOnMiss
const VALID_MODES: Mode[] = ['record', 'replay', 'hybrid']

if (!Number.isInteger(PORT) || PORT <= 0) {
  console.error(chalk.red('Invalid port. Please provide a positive integer.'))
  process.exit(1)
}

if (!VALID_MODES.includes(MODE)) {
  console.error(chalk.red(`Invalid mode: ${MODE}. Expected one of: ${VALID_MODES.join(', ')}`))
  process.exit(1)
}

const proxy = httpProxy.createProxyServer({
  target: TARGET_URL,
  changeOrigin: true,
  selfHandleResponse: true,
})

fs.ensureDirSync(TAPES_DIR)

const getTapeKey = (req: http.IncomingMessage): string => {
  const key = `${req.method}|${req.url}`
  return crypto.createHash('md5').update(key).digest('hex')
}

const timestamp = () => chalk.gray(`[${new Date().toLocaleTimeString()}]`)

const recordByRequest = new WeakMap<http.IncomingMessage, boolean>()

const replayTape = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  tapePath: string,
): boolean => {
  if (!fs.existsSync(tapePath)) {
    return false
  }

  try {
    const tape = fs.readJsonSync(tapePath)
    const schemaVersion = tape.schemaVersion ?? 0

    if (![0, CURRENT_SCHEMA_VERSION].includes(schemaVersion)) {
      res.statusCode = 500
      res.end(`Unsupported tape schema version: ${schemaVersion}`)
      console.error(chalk.red('Unsupported Tape Schema:'), tapePath)
      return true
    }

    Object.keys(tape.headers).forEach((key) => {
      res.setHeader(key, tape.headers[key])
    })

    res.setHeader('X-Api-Tape', 'Replayed')

    res.writeHead(tape.statusCode)
    res.end(Buffer.from(tape.body, 'base64'))

    console.log(`${timestamp()} ${chalk.green('↺ REPLAY_HIT')} ${req.method} ${req.url}`)
    return true
  } catch {
    console.error(chalk.red('Corrupted Tape:'), tapePath)
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
  console.log(`${timestamp()} ${logPrefix} ${req.method} ${req.url}`)

  proxy.web(req, res, {}, (error) => {
    console.error(chalk.red('Proxy Error:'), error.message)
    res.statusCode = 502
    res.end('Proxy Error')
  })
}

const server = http.createServer((req, res) => {
  const tapeKey = getTapeKey(req)
  const tapePath = path.join(TAPES_DIR, `${tapeKey}.json`)

  if (MODE === 'replay') {
    const hit = replayTape(req, res, tapePath)

    if (!hit) {
      console.log(`${timestamp()} ${chalk.red('✘ REPLAY_MISS')} ${req.method} ${req.url}`)
      res.statusCode = 404
      res.end(`Tape not found for: ${req.method} ${req.url}`)
    }
    return
  }

  if (MODE === 'record') {
    proxyRequest(req, res, true, chalk.blue('● RECORD'))
    return
  }

  const hit = replayTape(req, res, tapePath)
  if (hit) {
    return
  }

  console.log(`${timestamp()} ${chalk.yellow('⇢ REPLAY_MISS')} ${req.method} ${req.url}`)
  proxyRequest(
    req,
    res,
    RECORD_ON_MISS,
    RECORD_ON_MISS ? chalk.magenta('⇢ FALLBACK_RECORD') : chalk.magenta('⇢ FALLBACK_PROXY'),
  )
})

proxy.on('proxyRes', (proxyRes, req, res) => {
  const bodyChunks: Buffer[] = []

  proxyRes.on('data', (chunk) => bodyChunks.push(chunk))

  proxyRes.on('end', () => {
    const bodyBuffer = Buffer.concat(bodyChunks)

    const tapeData = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      meta: {
        url: req.url,
        method: req.method,
        timestamp: new Date().toISOString(),
      },
      statusCode: proxyRes.statusCode,
      headers: proxyRes.headers,
      body: bodyBuffer.toString('base64'),
    }

    const shouldRecord = recordByRequest.get(req) ?? true

    if (shouldRecord) {
      const tapeKey = getTapeKey(req)
      const tapePath = path.join(TAPES_DIR, `${tapeKey}.json`)
      fs.writeJsonSync(tapePath, tapeData, { spaces: 2 })
      console.log(`${timestamp()} ${chalk.cyan('💾 SAVED')} ${req.method} ${req.url}`)
    }

    Object.keys(proxyRes.headers).forEach((key) => {
      res.setHeader(key, proxyRes.headers[key] as string)
    })
    res.writeHead(proxyRes.statusCode || 200)
    res.end(bodyBuffer)
  })
})

console.log(chalk.bold(`\n📼 API Tape Running`))
console.log(
  `   ${chalk.dim('Mode:')}   ${
    MODE === 'record'
      ? chalk.red('● RECORD')
      : MODE === 'hybrid'
        ? chalk.yellow('⇢ HYBRID')
        : chalk.green('↺ REPLAY')
  }`,
)
console.log(`   ${chalk.dim('Target:')} ${TARGET_URL}`)
console.log(`   ${chalk.dim('Port:')}   http://localhost:${PORT}`)
console.log(`   ${chalk.dim('Dir:')}    ${TAPES_DIR}`)
if (MODE === 'hybrid') {
  console.log(`   ${chalk.dim('Record Miss:')} ${RECORD_ON_MISS}`)
}
console.log('')

server.listen(PORT)
