const cron = require('node-cron');
const db = require('../config/database');
const dockerService = require('./docker');
const activity = require('./activity');

const activeJobs = new Map();

const schedulerService = {
  init() {
    console.log('⏰ Initializing Nova Server Scheduler...');
    const schedules = db.query('SELECT * FROM server_schedules WHERE is_active = 1');
    for (const schedule of schedules) {
      this.registerJob(schedule);
    }

    // Auto-Suspend Expired Servers check every 10 minutes
    const addonService = require('./addons');
    cron.schedule('*/10 * * * *', async () => {
      try {
        await addonService.checkAndSuspendExpiredServers();
      } catch (e) {
        console.error('Auto-suspend check failed:', e.message);
      }
    });
  },

  registerJob(schedule) {
    if (activeJobs.has(schedule.id)) {
      activeJobs.get(schedule.id).stop();
      activeJobs.delete(schedule.id);
    }

    if (!cron.validate(schedule.cron_expression)) {
      console.warn(`⚠️ Invalid cron expression for schedule ID ${schedule.id}: ${schedule.cron_expression}`);
      return;
    }

    const task = cron.schedule(schedule.cron_expression, async () => {
      console.log(`⏰ Executing schedule ${schedule.id} (${schedule.name}) for server ${schedule.server_id}`);
      try {
        if (schedule.action_type === 'command' && schedule.action_payload) {
          await dockerService.sendCommand(schedule.server_id, schedule.action_payload);
        } else if (schedule.action_type === 'power') {
          if (schedule.action_payload === 'start') await dockerService.start(schedule.server_id);
          else if (schedule.action_payload === 'stop') await dockerService.stop(schedule.server_id);
          else if (schedule.action_payload === 'restart') await dockerService.restart(schedule.server_id);
        }
        db.run('UPDATE server_schedules SET last_run = CURRENT_TIMESTAMP WHERE id = ?', [schedule.id]);
        activity.log({
          serverId: schedule.server_id,
          event: 'schedule.run',
          details: `Schedule "${schedule.name}" executed action: ${schedule.action_type}`
        });
      } catch (err) {
        console.error(`❌ Schedule ${schedule.id} error:`, err.message);
      }
    });

    activeJobs.set(schedule.id, task);
  },

  removeJob(scheduleId) {
    if (activeJobs.has(scheduleId)) {
      activeJobs.get(scheduleId).stop();
      activeJobs.delete(scheduleId);
    }
  }
};

module.exports = schedulerService;
