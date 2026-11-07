const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
const fs = require('node:fs');
const { createServer, parsePort } = require('../server.js');

let server;
let port;

test.before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

/** Petición cruda: la ruta se envía tal cual, sin que el cliente la normalice. */
function request(rawPath, opts) {
  const o = opts || {};
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: o.method || 'GET', headers: o.headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('sirve la página principal', async () => {
  const r = await request('/');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^text\/html/);
  assert.match(r.body, /<title>Torneos<\/title>/);
  assert.equal(Number(r.headers['content-length']), Buffer.byteLength(r.body));
});

test('sirve cada archivo de la app con su tipo', async () => {
  const cases = {
    '/index.html': /^text\/html/,
    '/css/styles.css': /^text\/css/,
    '/js/app.js': /^text\/javascript/,
    '/js/tournament.js': /^text\/javascript/,
    '/sw.js': /^text\/javascript/,
    '/manifest.webmanifest': /^application\/manifest\+json/,
    '/icon.svg': /^image\/svg\+xml/,
  };
  for (const [p, type] of Object.entries(cases)) {
    const r = await request(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers['content-type'], type, p);
    assert.equal(r.headers['x-content-type-options'], 'nosniff', p);
    assert.ok(r.headers['content-security-policy'], p);
  }
});

test('las URLs con parámetros también funcionan', async () => {
  const r = await request('/?utm_source=x');
  assert.equal(r.status, 200);
  assert.equal((await request('/js/app.js?v=2')).status, 200);
});

test('nunca expone archivos privados', async () => {
  for (const p of [
    '/package.json', '/server.js', '/README.md', '/tests/server.test.js',
    '/.git/config', '/.git/HEAD', '/js/', '/css', '/nada.html', '/js/nada.js',
  ]) {
    const r = await request(p);
    assert.equal(r.status, 404, p);
    assert.doesNotMatch(r.body, /"scripts"|require\(|\[core\]/, p);
  }
});

test('bloquea intentos de salir de la carpeta', async () => {
  for (const p of [
    '/../package.json',
    '/js/../server.js',
    '/js/../../etc/passwd',
    '/%2e%2e/package.json',
    '/js/%2e%2e/server.js',
    '/js/..%2fserver.js',
    '/js/..%2f..%2fetc%2fpasswd',
    '/js/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/css/..%5cserver.js',
    '//etc/passwd',
    '/js/.hidden.js',
    '/index.html/',
    '/index.html%2F',
    '/index.html//',
    '/css/styles.css/',
    '/sw.js/',
    '/js/app.js/',
  ]) {
    const r = await request(p);
    assert.ok(r.status === 404 || r.status === 400, p + ' → ' + r.status);
    assert.doesNotMatch(r.body, /root:|"scripts"|createServer/, p);
  }
});

test('rutas mal codificadas o con byte nulo devuelven 400', async () => {
  assert.equal((await request('/%E0%A4%A')).status, 400);
  assert.equal((await request('/js/app.js%00.css')).status, 400);
});

test('HEAD responde cabeceras sin cuerpo', async () => {
  const r = await request('/js/app.js', { method: 'HEAD' });
  assert.equal(r.status, 200);
  assert.equal(r.body, '');
  assert.ok(Number(r.headers['content-length']) > 0);
});

test('otros métodos devuelven 405', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const r = await request('/', { method });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.allow, 'GET, HEAD');
  }
});

test('revalidación de caché con ETag (304)', async () => {
  const first = await request('/css/styles.css');
  assert.equal(first.headers['cache-control'], 'no-cache');
  assert.ok(first.headers.etag);
  const again = await request('/css/styles.css', { headers: { 'If-None-Match': first.headers.etag } });
  assert.equal(again.status, 304);
  assert.equal(again.body, '');
  const other = await request('/css/styles.css', { headers: { 'If-None-Match': 'W/"otro"' } });
  assert.equal(other.status, 200);
});

function runServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: Object.assign({}, process.env, env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('El servidor no respondió a tiempo: ' + out));
    }, 5000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
    child.stdout.on('data', () => {
      if (/disponible/.test(out)) child.kill('SIGTERM');
    });
  });
}

test('al arrancar usa PORT y se cierra limpio con SIGTERM', async () => {
  const r = await runServer({ PORT: '0', HOST: '127.0.0.1' });
  assert.match(r.out, /Torneos disponible en http:\/\/127\.0\.0\.1:\d+/);
  assert.match(r.out, /SIGTERM/);
  assert.equal(r.code, 0);
});

test('un PORT inválido detiene el arranque con un mensaje claro', async () => {
  const r = await runServer({ PORT: 'abc' });
  assert.equal(r.code, 1);
  assert.match(r.out, /PORT inválido/);
});

test('parsePort: número válido, vacío o con espacios usa 8080, lo demás es inválido', () => {
  assert.equal(parsePort(undefined), 8080);
  assert.equal(parsePort(''), 8080);
  assert.equal(parsePort('   '), 8080);
  assert.equal(parsePort('\t'), 8080);
  assert.equal(parsePort(' 3000 '), 3000);
  assert.equal(parsePort('0'), 0);
  assert.equal(parsePort('65535'), 65535);
  for (const bad of ['abc', '-1', '70000', '1e3', '0x1F90', '80.5', '8080abc']) {
    assert.ok(Number.isNaN(parsePort(bad)), bad);
  }
});

// Linux expone los descriptores abiertos del proceso en /proc/self/fd.
const canCountFds = fs.existsSync('/proc/self/fd');

test('no deja archivos abiertos si el cliente cancela la petición', { skip: !canCountFds && 'requiere /proc/self/fd' }, async () => {
  const countFds = () => fs.readdirSync('/proc/self/fd').length;
  const settle = () => new Promise((r) => setTimeout(r, 300));
  await settle();
  const before = countFds();
  const N = 60;
  const paths = ['/', '/js/app.js', '/css/styles.css'];
  await Promise.all(Array.from({ length: N }, (_, i) => new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write('GET ' + paths[i % paths.length] + ' HTTP/1.1\r\nHost: x\r\n\r\n');
      // Cancelar justo después de pedir: entre stat y open del archivo.
      setImmediate(() => { socket.destroy(); resolve(); });
    });
    socket.on('error', resolve);
  })));
  await settle();
  const after = countFds();
  assert.ok(after - before < 5, 'quedaron ' + (after - before) + ' descriptores abiertos tras ' + N + ' peticiones canceladas');
  // El servidor sigue respondiendo con normalidad.
  assert.equal((await request('/js/app.js')).status, 200);
});

test('railway.json arranca node directamente para que reciba SIGTERM', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'railway.json'), 'utf8'));
  assert.equal(cfg.deploy.startCommand, 'node server.js');
});

test('package.json no fija una versión de Node que Railpack reduciría a una sin soporte', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.engines, undefined);
  assert.equal(pkg.scripts.start, 'node server.js');
});
