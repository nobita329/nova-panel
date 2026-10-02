const { spawn, spawnSync, execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');

const activeLogStreams = new Map(); // serverId -> ChildProcess

const dockerService = {
  getContainerName(server) {
    return `nova-${server.id}-${server.uuid ? server.uuid.slice(0, 8) : 'srv'}`;
  },

  getServerDir(serverId) {
    const dir = path.resolve(process.cwd(), 'Instance/server', String(serverId));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  },

  async createContainer(server) {
    const containerName = this.getContainerName(server);
    const serverDir = this.getServerDir(server.id);

    // Pull or remove old container if exists with same name
    try {
      execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' });
    } catch (e) {
      // Ignored if doesn't exist
    }

    // Pull image if not local
    try {
      console.log(`🐳 Checking image ${server.docker_image}...`);
      execSync(`docker pull ${server.docker_image}`, { stdio: 'inherit' });
    } catch (err) {
      console.warn(`⚠️ Warning pulling image ${server.docker_image}:`, err.message);
    }

    // Resolve startup command with variable interpolation
    let cmd = server.startup_command || 'sh';
    let envObj = {};
    try {
      envObj = JSON.parse(server.environment || '{}');
    } catch (e) {
      envObj = {};
    }

    // Interpolate variables
    cmd = cmd.replace(/\{\{SERVER_MEMORY\}\}/g, String(server.memory_limit || 1024));
    cmd = cmd.replace(/\{\{SERVER_PORT\}\}/g, String(server.primary_port || 25565));
    cmd = cmd.replace(/\{\{SERVER_JARFILE\}\}/g, envObj.SERVER_JARFILE || 'server.jar');
    cmd = cmd.replace(/\{\{MAIN_FILE\}\}/g, envObj.MAIN_FILE || 'index.js');

    for (const [k, v] of Object.entries(envObj)) {
      cmd = cmd.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }

    const args = [
      'create',
      '--name', containerName,
      '--restart', 'unless-stopped',
      '-i', '-t',
      '-w', '/home/container',
      '-v', `${serverDir}:/home/container`
    ];

    if (server.primary_port) {
      args.push('-p', `${server.primary_port}:${server.primary_port}`);
    }

    if (server.memory_limit) {
      args.push('-m', `${server.memory_limit}m`);
    }

    if (server.cpu_limit) {
      args.push(`--cpus=${(server.cpu_limit / 100).toFixed(2)}`);
    }

    args.push('-e', `SERVER_PORT=${server.primary_port || 25565}`);
    args.push('-e', `SERVER_MEMORY=${server.memory_limit || 1024}`);

    for (const [k, v] of Object.entries(envObj)) {
      args.push('-e', `${k}=${String(v)}`);
    }

    args.push(server.docker_image);

    if (/[;&|<>]/.test(cmd) || cmd.startsWith('if ')) {
      args.push('sh', '-c', cmd);
    } else {
      args.push(...cmd.split(/\s+/).filter(Boolean));
    }

    console.log(`🐳 Creating container with spawnSync: docker ${args.join(' ')}`);
    const res = spawnSync('docker', args, { encoding: 'utf8' });
    if (res.error || res.status !== 0) {
      throw new Error(res.stderr || res.stdout || 'Failed to create container');
    }
    const out = res.stdout.trim();
    
    // Update container ID in database
    db.run('UPDATE servers SET container_id = ?, status = ? WHERE id = ?', [out, 'offline', server.id]);

    return { containerId: out, containerName };
  },

  async start(serverId) {
    const server = db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (!server) throw new Error('Server not found');

    const containerName = this.getContainerName(server);
    
    // Check if container exists; if not, create it
    try {
      execSync(`docker inspect ${containerName}`, { stdio: 'ignore' });
    } catch (e) {
      await this.createContainer(server);
    }

    db.run('UPDATE servers SET status = ? WHERE id = ?', ['starting', serverId]);

    try {
      execSync(`docker start ${containerName}`);
      db.run('UPDATE servers SET status = ? WHERE id = ?', ['online', serverId]);
      return { success: true, status: 'online' };
    } catch (err) {
      db.run('UPDATE servers SET status = ? WHERE id = ?', ['offline', serverId]);
      throw new Error(`Failed to start container: ${err.message}`);
    }
  },

  async stop(serverId) {
    const server = db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (!server) throw new Error('Server not found');

    const containerName = this.getContainerName(server);
    db.run('UPDATE servers SET status = ? WHERE id = ?', ['stopping', serverId]);

    try {
      execSync(`docker stop -t 10 ${containerName}`);
      db.run('UPDATE servers SET status = ? WHERE id = ?', ['offline', serverId]);
      return { success: true, status: 'offline' };
    } catch (err) {
      // If failed, try kill
      try {
        execSync(`docker kill ${containerName}`);
      } catch (e) {}
      db.run('UPDATE servers SET status = ? WHERE id = ?', ['offline', serverId]);
      return { success: true, status: 'offline' };
    }
  },

  async restart(serverId) {
    await this.stop(serverId);
    await new Promise(r => setTimeout(r, 1000));
    return await this.start(serverId);
  },

  async kill(serverId) {
    const server = db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (!server) throw new Error('Server not found');

    const containerName = this.getContainerName(server);
    try {
      execSync(`docker kill ${containerName}`);
    } catch (err) {}
    db.run('UPDATE servers SET status = ? WHERE id = ?', ['offline', serverId]);
    return { success: true, status: 'offline' };
  },

  async deleteContainer(serverId) {
    const server = db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (!server) return;

    const containerName = this.getContainerName(server);
    try {
      execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' });
    } catch (err) {}
    db.run('UPDATE servers SET container_id = NULL, status = ? WHERE id = ?', ['offline', serverId]);
  },

  async sendCommand(serverId, command) {
    const server = db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (!server) throw new Error('Server not found');

    const containerName = this.getContainerName(server);
    
    // Check if running
    try {
      const inspectOut = execSync(`docker inspect -f "{{.State.Running}}" ${containerName}`, { encoding: 'utf8' }).trim();
      if (inspectOut !== 'true') {
        throw new Error('Server container is not running');
      }
    } catch (err) {
      throw new Error('Server container is offline');
    }

    return new Promise((resolve, reject) => {
      // Send input into container's stdin
      const proc = spawn('docker', ['exec', '-i', containerName, 'sh', '-c', `echo "${command.replace(/"/g, '\\"')}" > /proc/1/fd/0`]);
      proc.on('close', (code) => {
        if (code === 0) resolve({ success: true });
        else {
          // Fallback: try direct pipe
          const attachProc = spawn('docker', ['attach', '--no-stdin=false', containerName]);
          attachProc.stdin.write(command + '\n');
          resolve({ success: true });
        }
      });
      proc.on('error', (err) => {
        reject(err);
      });
    });
  },

  async getLogs(serverId, tail = 150) {
    const server = db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (!server) return '';

    const containerName = this.getContainerName(server);
    try {
      const logs = execSync(`docker logs --tail ${tail} ${containerName} 2>&1`, { encoding: 'utf8' });
      return logs;
    } catch (err) {
      return 'Container is not created or no logs available yet.\n';
    }
  },

  async getStats(serverId) {
    const server = db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (!server) return { cpu: '0%', memory: '0 MB / 0 MB', disk: '0 MB', status: 'offline' };

    const containerName = this.getContainerName(server);
    try {
      const out = execSync(`docker stats --no-stream --format "{{json .}}" ${containerName}`, { encoding: 'utf8' }).trim();
      if (!out) return { cpu: '0%', memory: '0 MB', disk: '0 MB', status: 'offline' };
      const parsed = JSON.parse(out);
      return {
        cpu: parsed.CPUPerc || '0%',
        memory: parsed.MemUsage || '0 MB',
        netIO: parsed.NetIO || '0 B / 0 B',
        blockIO: parsed.BlockIO || '0 B / 0 B',
        pids: parsed.PIDs || '0',
        status: 'online'
      };
    } catch (err) {
      return { cpu: '0%', memory: '0 MB / ' + (server.memory_limit || 1024) + ' MB', status: server.status || 'offline' };
    }
  },

  streamLogs(serverId, onData) {
    const server = db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (!server) return null;

    const containerName = this.getContainerName(server);

    // Stop existing stream if any
    if (activeLogStreams.has(serverId)) {
      try {
        activeLogStreams.get(serverId).kill();
      } catch (e) {}
      activeLogStreams.delete(serverId);
    }

    const logProcess = spawn('docker', ['logs', '-f', '--tail', '100', containerName]);
    activeLogStreams.set(serverId, logProcess);

    logProcess.stdout.on('data', (data) => onData(data.toString()));
    logProcess.stderr.on('data', (data) => onData(data.toString()));

    logProcess.on('close', () => {
      activeLogStreams.delete(serverId);
    });

    return logProcess;
  },

  stopLogStream(serverId) {
    if (activeLogStreams.has(serverId)) {
      try {
        activeLogStreams.get(serverId).kill();
      } catch (e) {}
      activeLogStreams.delete(serverId);
    }
  }
};

module.exports = dockerService;
