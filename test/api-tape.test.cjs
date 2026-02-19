// @ts-nocheck
const test = require('node:test')
const assert = require('node:assert/strict')
const { execFile, spawn } = require('node:child_process')
const http = require('node:http')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const execFileAsync = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, () => resolve())
  })

const getFreePort = async () => {
  const server = http.createServer()
  await new Promise((resolve) => server.listen(0, resolve))
  const address = server.address()
  const port = address.port
  await new Promise((resolve) => server.close(resolve))
  return port
}

const request = (url, options = {}) =>
  new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })

const requestWithRetry = async (url, retries = 10, options = {}) => {
  let lastError
  for (let i = 0; i < retries; i += 1) {
    try {
      return await request(url, options)
    } catch (error) {
      lastError = error
      if (error && error.code === 'ECONNREFUSED') {
        await wait(50)
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
      stdio: ['pipe', 'pipe', 'pipe'],
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

    const startupTimeout = setTimeout(() => {
      cleanup()
      child.kill()
      reject(new Error(`CLI did not become ready in time.\n${output}`))
    }, 7000)

    const cleanup = () => {
      clearTimeout(startupTimeout)
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
      stdio: ['pipe', 'pipe', 'pipe'],
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

const stopProcess = async (child, signal = 'SIGTERM') => {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return
  }

  if (signal) {
    try {
      child.kill(signal)
    } catch {
      // noop
    }
  }

  let result = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve('exited'))),
    wait(1500).then(() => 'timeout'),
  ])

  if (result === 'timeout' && child.exitCode === null && child.signalCode === null) {
    try {
      child.kill()
    } catch {
      // noop
    }

    result = await Promise.race([
      new Promise((resolve) => child.once('exit', () => resolve('exited'))),
      wait(1000).then(() => 'timeout'),
    ])
  }

  if (result === 'timeout' && process.platform === 'win32' && child.pid) {
    await execFileAsync('taskkill', ['/PID', String(child.pid), '/T', '/F'])

    await Promise.race([
      new Promise((resolve) => child.once('exit', () => resolve('exited'))),
      wait(1000),
    ])
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

test('record mode redacts configured json paths in saved tape body', async () => {
  const upstreamPort = await getFreePort()
  const proxyPort = await getFreePort()
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'api-tape-redact-json-'))

  const upstream = http.createServer((_, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({ user: { profile: { email: 'dev@example.com' } }, token: 'secret-token' }),
    )
  })
  await new Promise((resolve) => upstream.listen(upstreamPort, resolve))

  let cli
  try {
    cli = await startCli({
      target: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
      dir: tmpDir,
      mode: 'record',
      extraArgs: ['--redact-json-path', 'user.profile.email,token'],
    })

    const response = await requestWithRetry(`http://127.0.0.1:${proxyPort}/users/1`)
    assert.equal(response.statusCode, 200)

    await stopProcess(cli.child)

    const files = (await fsp.readdir(tmpDir)).filter((name) => name.endsWith('.json'))
    assert.equal(files.length, 1)

    const saved = JSON.parse(await fsp.readFile(path.join(tmpDir, files[0]), 'utf8'))
    const savedBody = JSON.parse(Buffer.from(saved.body, 'base64').toString('utf8'))

    assert.equal(savedBody.user.profile.email, '[REDACTED]')
    assert.equal(savedBody.token, '[REDACTED]')
    assert.deepEqual(saved.meta.redactionsApplied.jsonPaths.sort(), ['token', 'user.profile.email'])
  } finally {
    await stopProcess(cli && cli.child)
    await new Promise((resolve) => upstream.close(resolve))
    await fsp.rm(tmpDir, { recursive: true, force: true })
  }
})

test('normalized match strategy replays regardless of query order', async () => {
  const upstreamPort = await getFreePort()
  const proxyPort = await getFreePort()
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'api-tape-normalized-'))

  let upstreamHits = 0
  const upstream = http.createServer((req, res) => {
    upstreamHits += 1
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ upstreamHits, url: req.url }))
  })
  await new Promise((resolve) => upstream.listen(upstreamPort, resolve))

  let cli
  try {
    cli = await startCli({
      target: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
      dir: tmpDir,
      mode: 'record',
      extraArgs: ['--match-strategy', 'normalized'],
    })

    const first = await requestWithRetry(`http://127.0.0.1:${proxyPort}/search?b=2&a=1`)
    assert.equal(first.statusCode, 200)
    assert.equal(upstreamHits, 1)

    await stopProcess(cli.child)

    cli = await startCli({
      target: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
      dir: tmpDir,
      mode: 'replay',
      extraArgs: ['--match-strategy', 'normalized'],
    })

    const replay = await requestWithRetry(`http://127.0.0.1:${proxyPort}/search?a=1&b=2`)
    assert.equal(replay.statusCode, 200)
    assert.equal(replay.headers['x-api-tape'], 'Replayed')
    assert.equal(upstreamHits, 1)
  } finally {
    await stopProcess(cli && cli.child)
    await new Promise((resolve) => upstream.close(resolve))
    await fsp.rm(tmpDir, { recursive: true, force: true })
  }
})

test('body-aware strategy differentiates by request body', async () => {
  const upstreamPort = await getFreePort()
  const proxyPort = await getFreePort()
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'api-tape-body-aware-'))

  let upstreamHits = 0
  const upstream = http.createServer((req, res) => {
    const bodyChunks = []
    req.on('data', (chunk) => bodyChunks.push(chunk))
    req.on('end', () => {
      upstreamHits += 1
      const body = Buffer.concat(bodyChunks).toString('utf8')
      const parsed = body ? JSON.parse(body) : {}
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ upstreamHits, id: parsed.id }))
    })
  })
  await new Promise((resolve) => upstream.listen(upstreamPort, resolve))

  let cli
  try {
    cli = await startCli({
      target: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
      dir: tmpDir,
      mode: 'record',
      extraArgs: ['--match-strategy', 'body-aware'],
    })

    const postA = await requestWithRetry(`http://127.0.0.1:${proxyPort}/items`, 20, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 1 }),
    })
    const postB = await requestWithRetry(`http://127.0.0.1:${proxyPort}/items`, 20, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 2 }),
    })

    assert.equal(postA.statusCode, 200)
    assert.equal(postB.statusCode, 200)
    assert.equal(upstreamHits, 2)

    await stopProcess(cli.child)

    cli = await startCli({
      target: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
      dir: tmpDir,
      mode: 'replay',
      extraArgs: ['--match-strategy', 'body-aware'],
    })

    const replayA = await requestWithRetry(`http://127.0.0.1:${proxyPort}/items`, 20, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 1 }),
    })
    const replayB = await requestWithRetry(`http://127.0.0.1:${proxyPort}/items`, 20, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 2 }),
    })

    assert.equal(replayA.statusCode, 200)
    assert.equal(replayB.statusCode, 200)
    assert.equal(replayA.headers['x-api-tape'], 'Replayed')
    assert.equal(replayB.headers['x-api-tape'], 'Replayed')
    assert.equal(upstreamHits, 2)
  } finally {
    await stopProcess(cli && cli.child)
    await new Promise((resolve) => upstream.close(resolve))
    await fsp.rm(tmpDir, { recursive: true, force: true })
  }
})

test('serve mode emits periodic and final stats in json format', async () => {
  const upstreamPort = await getFreePort()
  const proxyPort = await getFreePort()
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'api-tape-stats-'))

  const upstream = http.createServer((_, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  })
  await new Promise((resolve) => upstream.listen(upstreamPort, resolve))

  const child = spawn(
    'node',
    [
      'dist/index.js',
      'serve',
      '--target',
      `http://127.0.0.1:${upstreamPort}`,
      '--port',
      String(proxyPort),
      '--dir',
      tmpDir,
      '--mode',
      'hybrid',
      '--stats-interval',
      '1',
      '--stats-json',
    ],
    { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] },
  )

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  try {
    // Wait for the server to start (polling)
    let ready = false
    for (let i = 0; i < 50; i += 1) {
      if (output.includes('API Tape Running')) {
        ready = true
        break
      }
      await wait(100)
    }
    assert.ok(ready, 'CLI should become ready')

    // Make a request to ensure metrics are recorded
    const response = await requestWithRetry(`http://127.0.0.1:${proxyPort}/stats`)
    assert.equal(response.statusCode, 200)

    // Wait for periodic stats (polling)
    let hasStats = false
    for (let i = 0; i < 30; i += 1) {
      if (output.includes('"event":"STATS"')) {
        hasStats = true
        break
      }
      await wait(200)
    }
    assert.ok(hasStats, 'Should emit periodic JSON stats')

    // Graceful shutdown
    if (process.platform === 'win32') {
      child.stdin.end()
    } else {
      child.kill('SIGINT')
    }
    await stopProcess(child, null)

    assert.ok(output.includes('"event":"FINAL_STATS"'), 'Should emit final JSON stats')
  } finally {
    await new Promise((resolve) => upstream.close(resolve))
    await fsp.rm(tmpDir, { recursive: true, force: true })
  }
})
