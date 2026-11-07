/*
 * Servidor estático mínimo para publicar Torneos (por ejemplo, en Railway).
 * Solo usa módulos de Node, así que no hay dependencias que instalar.
 *
 *   npm start                → escucha en el puerto de la variable PORT (o 8080)
 *   PORT=3000 npm start      → escucha en el 3000
 *
 * Solo se sirven los archivos de la app (lista blanca de abajo): package.json,
 * server.js, las pruebas o la carpeta .git nunca quedan expuestos.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const DEFAULT_PORT = 8080;

const PUBLIC_FILES = new Set(['index.html', 'sw.js', 'manifest.webmanifest', 'icon.svg']);
const PUBLIC_DIRS = new Set(['css', 'js']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// La app solo carga sus propios archivos y las fuentes de Google Fonts.
// 'unsafe-inline' en estilos es necesario por los atributos style="--team: …" de los escudos.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const BASE_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function send(res, status, body, extra) {
  const text = body == null ? '' : String(body);
  res.writeHead(status, Object.assign({}, BASE_HEADERS, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  }, extra));
  res.end(res.req.method === 'HEAD' ? undefined : text);
}

/**
 * Convierte la ruta pedida en un archivo de la lista blanca, o null si no se puede servir.
 * Rechaza rutas que salgan de la carpeta, archivos ocultos y cualquier cosa fuera de la lista.
 */
function resolvePublicFile(rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname);
  } catch (e) {
    return { error: 400 };
  }
  if (pathname.includes('\0')) return { error: 400 };
  if (pathname === '/' || pathname === '/index.html') return { file: path.join(ROOT, 'index.html') };

  const resolved = path.resolve(ROOT, '.' + path.posix.normalize('/' + pathname));
  const rel = path.relative(ROOT, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { error: 404 };

  const parts = rel.split(path.sep);
  if (parts.some((p) => p.startsWith('.'))) return { error: 404 };
  const allowed = (parts.length === 1 && PUBLIC_FILES.has(parts[0])) ||
    (parts.length >= 2 && PUBLIC_DIRS.has(parts[0]));
  if (!allowed || !MIME[path.extname(resolved).toLowerCase()]) return { error: 404 };
  return { file: resolved };
}

function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Método no permitido', { Allow: 'GET, HEAD' });
    return;
  }

  const target = resolvePublicFile(req.url);
  if (target.error) {
    send(res, target.error, target.error === 400 ? 'Solicitud inválida' : 'No encontrado');
    return;
  }

  fs.stat(target.file, (err, stat) => {
    if (err || !stat.isFile()) {
      send(res, 404, 'No encontrado');
      return;
    }

    // Sin nombres con huella (hash), así que el navegador revalida cada vez:
    // si el archivo no cambió responde 304 y no se vuelve a descargar.
    const etag = 'W/"' + stat.size.toString(16) + '-' + Math.floor(stat.mtimeMs).toString(16) + '"';
    const headers = Object.assign({}, BASE_HEADERS, {
      'Content-Type': MIME[path.extname(target.file).toLowerCase()],
      'Cache-Control': 'no-cache',
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString(),
    });

    const inm = req.headers['if-none-match'];
    if (inm && inm.split(',').map((s) => s.trim()).includes(etag)) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    headers['Content-Length'] = stat.size;
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    const stream = fs.createReadStream(target.file);
    stream.on('open', () => {
      res.writeHead(200, headers);
      stream.pipe(res);
    });
    stream.on('error', () => {
      if (!res.headersSent) send(res, 500, 'Error al leer el archivo');
      else res.destroy();
    });
  });
}

function createServer() {
  return http.createServer(handle);
}

function start() {
  const raw = process.env.PORT;
  const port = raw === undefined || raw === '' ? DEFAULT_PORT : Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('PORT inválido: "' + raw + '". Usa un número entre 0 y 65535.');
    process.exit(1);
  }
  const host = process.env.HOST || '0.0.0.0';
  const server = createServer();

  server.on('error', (err) => {
    console.error('No se pudo iniciar el servidor: ' + err.message);
    process.exit(1);
  });

  server.listen(port, host, () => {
    const addr = server.address();
    console.log('Torneos disponible en http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + addr.port);
  });

  // Railway y Docker detienen el contenedor con SIGTERM: cerrar ordenadamente.
  const shutdown = (signal) => {
    console.log('Recibido ' + signal + ', cerrando el servidor…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) start();

module.exports = { createServer, resolvePublicFile };
