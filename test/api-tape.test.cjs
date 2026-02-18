// @ts-nocheck
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const http = require('node:http')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const getFreePort = async () => {
  const server = http.createServer()
  await new Promise((resolve) => server.listen(0, resolve))
  const address = server.address()
  const port = address.port
  await new Promise((resolve) => server.close(resolve))
  return port
}

const request = (url) =>
  new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })

    req.on('error', reject)
  })

const requestWithRetry = async (url, retries = 20) => {
  let lastError
  for (let i = 0; i < retries; i += 1) {
    try {
      return await request(url)
    } catch (error) {
      lastError = error
      if (error && error.code === 'ECONNREFUSED') {
        await wait(100)
        continue
      }

      throw error
    }
  }

  throw lastError
}

const startCli = ({ target, port, dir, mode, recordOnMiss, extraArgs = [] }) =>
  new Promise((resolve, reject) => {
    const args = [
      'dist/index.js',
      '--target',
      target,
      '--port',
      String(port),
      '--dir',
      dir,
      '--mode',
      mode,
    ]
    if (recordOnMiss !== undefined) {
      args.push('--record-on-miss', String(recordOnMiss))
    }
    args.push(...extraArgs)

    const child = spawn('node', args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    const onData = (chunk) => {
      output += chunk.toString()
      if (output.includes('API Tape Running')) {
        cleanup()
        resolve({ child, output })
      }
    }

    const onExit = (code) => {
      cleanup()
      reject(new Error(`CLI exited early with code ${code}.\n${output}`))
    }

    const cleanup = () => {
      child.stdout.off('data', onData)
      child.stderr.off('data', onData)
      child.off('exit', onExit)
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', onExit)
  })

const runCliOnce = (args) =>
  new Promise((resolve) => {
    const child = spawn('node', ['dist/index.js', ...args], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('exit', (code) => {
      resolve({ code, stdout, stderr })
    })
  })

const stopProcess = async (child) => {
  if (!child || child.killed) {
    return
  }

  child.kill('SIGTERM')
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), wait(2000)])

  if (!child.killed) {
    child.kill('SIGKILL')
  }
}

test('record mode writes versioned tape and replay mode serves it', async () => {
  const upstreamPort = await getFreePort()
  const proxyPort = await getFreePort()
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'api-tape-test-'))

  const upstream = http.createServer((req, res) => {
    if (req.url === '/todos/1') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ id: 1, source: 'upstream' }))
      return
    }

    res.statusCode = 404
    res.end('not found')
  })
  await new Promise((resolve) => upstream.listen(upstreamPort, resolve))

  let cli
  try {
    cli = await startCli({
      target: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
      dir: tmpDir,
      mode: 'record',
    })

    const recordResponse = await requestWithRetry(`http://127.0.0.1:${proxyPort}/todos/1`)
    assert.equal(recordResponse.statusCode, 200)
    assert.match(recordResponse.body, /"source":"upstream"/)

    await stopProcess(cli.child)

    const files = await fsp.readdir(tmpDir)
    assert.equal(files.length, 1)
    const tape = JSON.parse(await fsp.readFile(path.join(tmpDir, files[0]), 'utf8'))
    assert.equal(tape.schemaVersion, 1)

    cli = await startCli({
      target: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
      dir: tmpDir,
      mode: 'replay',
    })

    const replayResponse = await requestWithRetry(`http://127.0.0.1:${proxyPort}/todos/1`)
    assert.equal(replayResponse.statusCode, 200)
    assert.equal(replayResponse.headers['x-api-tape'], 'Replayed')
    assert.match(replayResponse.body, /"source":"upstream"/)
  } finally {
    await stopProcess(cli && cli.child)
    await new Promise((resolve) => upstream.close(resolve))
    await fsp.rm(tmpDir, { recursive: true, force: true })
  }
})

test('hybrid mode can fallback without recording on miss', async () => {
  const upstreamPort = await getFreePort()
  const proxyPort = await getFreePort()
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'api-tape-hybrid-'))

  const upstream = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ path: req.url, mode: 'fallback' }))
  })
  await new Promise((resolve) => upstream.listen(upstreamPort, resolve))

  let cli
  try {
    cli = await startCli({
      target: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
      dir: tmpDir,
      mode: 'hybrid',
      recordOnMiss: false,
    })

    const response = await requestWithRetry(`http://127.0.0.1:${proxyPort}/missing`)
    assert.equal(response.statusCode, 200)
    assert.match(response.body, /"mode":"fallback"/)

    const tapes = await fsp.readdir(tmpDir)
    assert.equal(tapes.length, 0)
  } finally {
    await stopProcess(cli && cli.child)
    await new Promise((resolve) => upstream.close(resolve))
    await fsp.rm(tmpDir, { recursive: true, force: true })
  }
})

test('tape subcommands list/inspect/clear manage tapes', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'api-tape-manage-'))
  const tapeId = 'abcd1234'
  const tape = {
    schemaVersion: 1,
    meta: {
      url: '/users/1',
      method: 'GET',
      timestamp: '2026-01-01T00:00:00.000Z',
    },
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ id: 1 })).toString('base64'),
  }

  await fsp.writeFile(path.join(tmpDir, `${tapeId}.json`), JSON.stringify(tape, null, 2))

  try {
    const listResult = await runCliOnce(['tape', 'list', '--dir', tmpDir])
    assert.equal(listResult.code, 0)
    assert.match(listResult.stdout, new RegExp(tapeId))

    const inspectResult = await runCliOnce(['tape', 'inspect', tapeId, '--dir', tmpDir])
    assert.equal(inspectResult.code, 0)
    const inspectJson = JSON.parse(inspectResult.stdout)
    assert.equal(inspectJson.id, tapeId)

    const denied = await runCliOnce(['tape', 'clear', '--dir', tmpDir])
    assert.notEqual(denied.code, 0)

    const clearResult = await runCliOnce(['tape', 'clear', '--yes', '--dir', tmpDir])
    assert.equal(clearResult.code, 0)

    const files = (await fsp.readdir(tmpDir)).filter((name) => name.endsWith('.json'))
    assert.equal(files.length, 0)
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  }
})

test('record mode redacts configured response headers in saved tape', async () => {
  const upstreamPort = await getFreePort()
  const proxyPort = await getFreePort()
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'api-tape-redact-'))

  const upstream = http.createServer((_, res) => {
    res.setHeader('authorization', 'Bearer secret-token')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  })
  await new Promise((resolve) => upstream.listen(upstreamPort, resolve))

  let cli
  try {
    cli = await startCli({
      target: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
      dir: tmpDir,
      mode: 'record',
      extraArgs: ['--redact-header', 'authorization'],
    })

    const response = await requestWithRetry(`http://127.0.0.1:${proxyPort}/redact`)
    assert.equal(response.statusCode, 200)

    await stopProcess(cli.child)

    const files = (await fsp.readdir(tmpDir)).filter((name) => name.endsWith('.json'))
    assert.equal(files.length, 1)
    const saved = JSON.parse(await fsp.readFile(path.join(tmpDir, files[0]), 'utf8'))
    assert.equal(saved.headers.authorization, '[REDACTED]')
  } finally {
    await stopProcess(cli && cli.child)
    await new Promise((resolve) => upstream.close(resolve))
    await fsp.rm(tmpDir, { recursive: true, force: true })
  }
})
