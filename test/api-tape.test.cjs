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

const startCli = ({ target, port, dir, mode, recordOnMiss }) =>
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
