// language: JavaScript, file: server.js, runtime: Node.js (stdlib only), target: Windows 11 / cross-platform
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DATA_FILE = path.join(__dirname, 'count.txt');
let count = 0;
try { count = parseInt(fs.readFileSync(DATA_FILE, 'utf8'), 10) || 0; } catch {}

const clients = new Set();

function broadcast() {
  const msg = `data: ${count}\n\n`;
  for (const res of clients) res.write(msg);
}

const HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Contador em Tempo Real</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
  body {
    background: #0b0d10; color: #f0f4f8; font-family: system-ui, -apple-system, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 100vh; gap: 2rem; padding: 1.5rem;
  }
  #count {
    font-size: clamp(5rem, 20vw, 12rem); font-weight: 800; font-variant-numeric: tabular-nums;
    letter-spacing: -0.03em; color: #38bdf8; text-shadow: 0 0 40px rgba(56,189,248,0.25);
    transition: transform 0.06s ease-out; cursor: pointer;
  }
  #count.bump { transform: scale(1.06); }
  .controls {
    display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
    background: #151921; border: 1px solid #262c3a; padding: 1.25rem 1.75rem; border-radius: 12px;
  }
  .row { display: flex; align-items: center; gap: 0.75rem; font-size: 0.95rem; color: #94a3b8; }
  kbd {
    background: #1e2530; border: 1px solid #334155; border-bottom-width: 3px;
    padding: 0.35rem 0.75rem; border-radius: 6px; color: #f8fafc; font-family: monospace;
    font-size: 1rem; font-weight: 700; min-width: 2.5rem; text-align: center;
  }
  button {
    background: #2563eb; color: #fff; border: none; padding: 0.45rem 0.9rem;
    border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 0.875rem;
  }
  button:hover { background: #1d4ed8; }
  button.listening { background: #dc2626; animation: pulse 1s infinite; }
  .status { font-size: 0.8rem; color: #64748b; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #22c55e; margin-right: 6px; }
  .dot.off { background: #ef4444; }
  @keyframes pulse { 50% { opacity: 0.7; } }
</style>
</head>
<body>
  <div id="count" title="Clique ou pressione a tecla configurada">0</div>
  <div class="controls">
    <div class="row">
      <span>Tecla de disparo:</span>
      <kbd id="keyDisplay">Space</kbd>
      <button id="bindBtn">Trocar tecla</button>
    </div>
    <div class="status"><span id="dot" class="dot"></span><span id="statusText">Conectado em tempo real</span></div>
  </div>
<script>
  const countEl = document.getElementById('count');
  const keyDisplay = document.getElementById('keyDisplay');
  const bindBtn = document.getElementById('bindBtn');
  const dot = document.getElementById('dot');
  const statusText = document.getElementById('statusText');

  let targetCode = localStorage.getItem('counter_key_code') || 'Space';
  let targetLabel = localStorage.getItem('counter_key_label') || 'Space';
  let listeningForKey = false;

  keyDisplay.textContent = targetLabel;

  function render(val) {
    countEl.textContent = val;
    countEl.classList.add('bump');
    setTimeout(() => countEl.classList.remove('bump'), 60);
  }

  function increment() {
    fetch('/inc', { method: 'POST' }).catch(() => {});
  }

  bindBtn.addEventListener('click', () => {
    listeningForKey = !listeningForKey;
    bindBtn.classList.toggle('listening', listeningForKey);
    bindBtn.textContent = listeningForKey ? 'Pressione qualquer tecla...' : 'Trocar tecla';
  });

  window.addEventListener('keydown', (e) => {
    if (listeningForKey) {
      e.preventDefault();
      targetCode = e.code;
      targetLabel = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      localStorage.setItem('counter_key_code', targetCode);
      localStorage.setItem('counter_key_label', targetLabel);
      keyDisplay.textContent = targetLabel;
      listeningForKey = false;
      bindBtn.classList.remove('listening');
      bindBtn.textContent = 'Trocar tecla';
      return;
    }
    if (e.repeat) return;
    if (e.code === targetCode) {
      e.preventDefault();
      increment();
    }
  });

  countEl.addEventListener('click', increment);

  const es = new EventSource('/events');
  es.onmessage = (e) => render(e.data);
  es.onopen = () => { dot.classList.remove('off'); statusText.textContent = 'Conectado em tempo real'; };
  es.onerror = () => { dot.classList.add('off'); statusText.textContent = 'Reconectando...'; };
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`data: ${count}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'GET' && (req.url === '/api/count' || req.url === '/count')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ count }));
    return;
  }

  if (req.method === 'POST' && (req.url === '/api/count' || req.url === '/inc')) {
    count += 1;
    try { fs.writeFileSync(DATA_FILE, String(count)); } catch {}
    broadcast();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ count }));
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(htmlPath));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  res.writeHead(404);
  res.end();
});

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const assert = require('node:assert');
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      http.get(`${base}/events`, (res) => {
        const chunks = [];
        res.on('data', (chunk) => {
          chunks.push(chunk.toString());
          if (chunks.length === 1) {
            const req = http.request(`${base}/inc`, { method: 'POST' }, (r) => assert.strictEqual(r.statusCode, 204));
            req.end();
          } else if (chunks.length === 2) {
            const v0 = parseInt(chunks[0].replace('data: ', ''), 10);
            const v1 = parseInt(chunks[1].replace('data: ', ''), 10);
            assert.strictEqual(v1, v0 + 1);
            res.destroy();
            server.close(() => process.exit(0));
          }
        });
      });
    });
  } else {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Counter listening on http://localhost:${PORT}`);
    });
  }
}

module.exports = server;
