#!/usr/bin/env node
import chalk from 'chalk';
import { program } from 'commander';
import crypto from 'crypto';
import fs from 'fs-extra';
import http from 'http';
import httpProxy from 'http-proxy';
import path from 'path';

// CLI Konfigürasyonu
program
  .name('api-tape')
  .description('Record and Replay HTTP API responses for offline development.')
  .requiredOption('-t, --target <url>', 'Target API URL (e.g., https://api.github.com)')
  .option('-p, --port <number>', 'Local server port', '8080')
  .option('-m, --mode <mode>', 'Operation mode: "record" or "replay"', 'replay')
  .option('-d, --dir <path>', 'Directory to save tapes', './tapes')
  .version('1.0.0')
  .parse();

const opts = program.opts();
const TARGET_URL = opts.target;
const PORT = parseInt(opts.port);
const MODE = opts.mode;
const TAPES_DIR = path.resolve(opts.dir);

// Proxy Sunucusu
const proxy = httpProxy.createProxyServer({
  target: TARGET_URL,
  changeOrigin: true,
  selfHandleResponse: true, // Cevabı yakalayıp kaydetmek için kritik ayar
});

// Tapes Klasörünü Hazırla
fs.ensureDirSync(TAPES_DIR);

// Hash Algoritması (Kaset İsmi)
// METHOD + URL kombinasyonu unique bir hash oluşturur.
const getTapeKey = (req: http.IncomingMessage): string => {
  const key = `${req.method}|${req.url}`;
  return crypto.createHash('md5').update(key).digest('hex');
};

const timestamp = () => chalk.gray(`[${new Date().toLocaleTimeString()}]`);

const server = http.createServer((req, res) => {
  const tapeKey = getTapeKey(req);
  const tapePath = path.join(TAPES_DIR, `${tapeKey}.json`);

  // ---------------------------------------------------------
  // MODE: REPLAY (Kasetten Çal)
  // ---------------------------------------------------------
  if (MODE === 'replay') {
    if (fs.existsSync(tapePath)) {
      try {
        const tape = fs.readJsonSync(tapePath);

        // Headerları set et
        Object.keys(tape.headers).forEach(key => {
          res.setHeader(key, tape.headers[key]);
        });

        // Replay olduğunu belli eden header (Debug için)
        res.setHeader('X-Api-Tape', 'Replayed');

        res.writeHead(tape.statusCode);
        res.end(Buffer.from(tape.body, 'base64')); // Binary safe

        console.log(`${timestamp()} ${chalk.green('↺ REPLAY')} ${req.method} ${req.url}`);
      } catch (e) {
        console.error(chalk.red('Corrupted Tape:'), tapePath);
        res.statusCode = 500;
        res.end('Corrupted Tape');
      }
    } else {
      console.log(`${timestamp()} ${chalk.red('✘ MISSING')} ${req.method} ${req.url}`);
      res.statusCode = 404;
      res.end(`Tape not found for: ${req.method} ${req.url}`);
    }
    return;
  }

  // ---------------------------------------------------------
  // MODE: RECORD (Kaydet ve İlet)
  // ---------------------------------------------------------
  if (MODE === 'record') {
    console.log(`${timestamp()} ${chalk.blue('● RECORD')} ${req.method} ${req.url}`);

    proxy.web(req, res, {}, (e) => {
      console.error(chalk.red('Proxy Error:'), e.message);
      res.statusCode = 502;
      res.end('Proxy Error');
    });
  }
});

// Proxy Cevap Event'i (Sadece Record modunda çalışır)
proxy.on('proxyRes', (proxyRes, req, res) => {
  const bodyChunks: any[] = [];

  proxyRes.on('data', (chunk) => bodyChunks.push(chunk));

  proxyRes.on('end', () => {
    const bodyBuffer = Buffer.concat(bodyChunks);

    // Encoding (Gzip/Brotli) varsa açmaya çalışma, direkt raw kaydet.
    // Ancak JSON'a yazarken base64 kullan ki binary data (resim vs) bozulmasın.
    const tapeData = {
      meta: {
        url: req.url,
        method: req.method,
        timestamp: new Date().toISOString(),
      },
      statusCode: proxyRes.statusCode,
      headers: proxyRes.headers,
      body: bodyBuffer.toString('base64')
    };

    const tapeKey = getTapeKey(req);
    const tapePath = path.join(TAPES_DIR, `${tapeKey}.json`);

    fs.writeJsonSync(tapePath, tapeData, { spaces: 2 });

    // Cevabı asıl istemciye dön
    Object.keys(proxyRes.headers).forEach(key => {
      res.setHeader(key, proxyRes.headers[key] as string);
    });
    res.writeHead(proxyRes.statusCode || 200);
    res.end(bodyBuffer);
  });
});

console.log(chalk.bold(`\n📼 API Tape Running`));
console.log(`   ${chalk.dim('Mode:')}   ${MODE === 'record' ? chalk.red('● RECORD') : chalk.green('↺ REPLAY')}`);
console.log(`   ${chalk.dim('Target:')} ${TARGET_URL}`);
console.log(`   ${chalk.dim('Port:')}   http://localhost:${PORT}`);
console.log(`   ${chalk.dim('Dir:')}    ${TAPES_DIR}\n`);

server.listen(PORT);
