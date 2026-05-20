const http = require('http');
const state = require('./data/state');
const settings = require('./settings');

const PORT = settings.api.port;

function startApiServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/mapas') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(JSON.stringify(state.mapas));
    }

    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('MapasBot API activa');
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`API mapas activa en puerto ${PORT}`);
  });
}

module.exports = { startApiServer };
