/**
 * server-local.js — Servidor local para desenvolvimento
 * Usa puppeteer-core com o Chrome/Chromium local do sistema
 * 
 * Instalar: npm install
 * Rodar:    node server-local.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Tenta puppeteer completo primeiro, depois core
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch(e) {
  puppeteer = require('puppeteer-core');
}

const PORT = process.env.PORT || 7700;
const EDITOR_HTML = fs.readFileSync(path.join(__dirname, 'imageapi-studio.html'), 'utf8');

// Importa a função de build do HTML do api/generate.js
// (reusamos o mesmo buildHTML para não duplicar código)
const generateFn = require('./api/generate.js');

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(EDITOR_HTML);
    return;
  }

  if (parsed.pathname === '/generate') {
    // Adapta req/res para o formato Vercel function
    const mockReq = {
      method: 'GET',
      query: Object.fromEntries(parsed.searchParams.entries()),
    };

    const chunks = [];
    const mockRes = {
      _status: 200,
      _headers: {},
      status(code) { this._status = code; return this; },
      setHeader(k, v) { this._headers[k] = v; },
      send(buf) {
        res.writeHead(this._status, this._headers);
        res.end(buf);
      },
      json(obj) {
        res.writeHead(this._status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      },
      end() { res.writeHead(this._status); res.end(); }
    };

    try {
      await generateFn(mockReq, mockRes);
    } catch(e) {
      console.error(e);
      res.writeHead(500); res.end('Erro: ' + e.message);
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n✅ ImageAPI Studio local rodando!`);
  console.log(`   Editor:  http://localhost:${PORT}/`);
  console.log(`   API PNG: http://localhost:${PORT}/generate?ImgSize=800x800&Background=000000&Txt1Pos=50,50&Txt1Size=60&Txt1Content=Ola&Txt1Font=sans-serif&Txt1Color=ffffff\n`);
});
