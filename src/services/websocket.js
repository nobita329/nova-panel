const { WebSocketServer } = require('ws');
const dockerService = require('./docker');
const db = require('../config/database');

function initWebSocketServer(server) {
  const wss = new WebSocketServer({ server, path: '/ws/console' });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const serverId = parseInt(url.searchParams.get('serverId'), 10);
    const token = url.searchParams.get('token');

    if (!serverId) {
      ws.close(1008, 'Missing serverId');
      return;
    }

    const srv = db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (!srv) {
      ws.close(1008, 'Server not found');
      return;
    }

    // Send initial history
    try {
      const initialLogs = await dockerService.getLogs(serverId, 100);
      ws.send(JSON.stringify({ event: 'log', data: initialLogs }));
    } catch (e) {}

    // Start streaming logs
    const logProc = dockerService.streamLogs(serverId, (chunk) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ event: 'log', data: chunk }));
      }
    });

    // Stats interval
    const statsInterval = setInterval(async () => {
      if (ws.readyState !== ws.OPEN) return;
      try {
        const stats = await dockerService.getStats(serverId);
        ws.send(JSON.stringify({ event: 'stats', data: stats }));
      } catch (e) {}
    }, 2000);

    ws.on('message', async (message) => {
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed.event === 'command' && parsed.command) {
          await dockerService.sendCommand(serverId, parsed.command);
        } else if (parsed.event === 'power' && parsed.action) {
          if (parsed.action === 'start') await dockerService.start(serverId);
          else if (parsed.action === 'stop') await dockerService.stop(serverId);
          else if (parsed.action === 'restart') await dockerService.restart(serverId);
          else if (parsed.action === 'kill') await dockerService.kill(serverId);
        }
      } catch (err) {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ event: 'error', message: err.message }));
        }
      }
    });

    ws.on('close', () => {
      clearInterval(statsInterval);
      dockerService.stopLogStream(serverId);
    });
  });

  return wss;
}

module.exports = { initWebSocketServer };
