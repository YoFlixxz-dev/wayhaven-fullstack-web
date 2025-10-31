// playercount.js
// Tracks live online members (online/idle/dnd) using presence updates.
// Exported API: init({token,guildId,cacheThreshold}), getSummary({limit}), stop()

const EventEmitter = require('events');

let client = null;
let enabled = false;
const onlineMembers = new Map();
const emitter = new EventEmitter();

async function init({ token, guildId, cacheThreshold = 2000 } = {}) {
  if (!token || !guildId) {
    console.warn('playercount: DISCORD_TOKEN or DISCORD_GUILD_ID missing — disabled');
    return { enabled: false };
  }

  try {
    const { Client, GatewayIntentBits, Partials } = require('discord.js');

    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
      ],
      partials: [Partials.GuildMember]
    });

    client.on('ready', async () => {
      enabled = true;
      console.log('playercount: Discord client ready as', client.user?.tag || '(unknown)');

      try {
        const guild = await client.guilds.fetch(guildId);

        // For small guilds: fetch members to seed presence cache (be careful for large servers)
        if (guild && guild.memberCount && guild.memberCount < cacheThreshold) {
          await guild.members.fetch();
        }

        // Seed from cache
        guild.members.cache.forEach(m => {
          try {
            const p = m.presence;
            if (p && ['online', 'idle', 'dnd'].includes(p.status)) {
              const u = m.user;
              onlineMembers.set(u.id, {
                id: u.id,
                username: u.username,
                avatar: u.displayAvatarURL({ extension: 'png', size: 64 }),
                status: p.status
              });
            }
          } catch (e) {}
        });

        console.log('playercount: seeded online members:', onlineMembers.size);
      } catch (err) {
        console.warn('playercount: error during seeding:', err && err.message);
      }

      emitter.emit('ready');
    });

    client.on('presenceUpdate', (oldPresence, newPresence) => {
      try {
        const user = newPresence?.user;
        if (!user) return;
        const status = newPresence.status;
        if (status && ['online', 'idle', 'dnd'].includes(status)) {
          const avatar = newPresence.member
            ? newPresence.member.displayAvatarURL({ extension: 'png', size: 64 })
            : newPresence.user?.displayAvatarURL?.();
          onlineMembers.set(user.id, {
            id: user.id,
            username: newPresence.member?.user?.username || newPresence.user?.username,
            avatar,
            status
          });
        } else {
          // offline or invisible -> remove
          onlineMembers.delete(user.id);
        }
      } catch (err) {
        console.warn('playercount: presenceUpdate error', err && err.message);
      }
    });

    client.on('guildMemberRemove', (member) => {
      try { onlineMembers.delete(member.id); } catch (e) {}
    });

    client.on('error', (err) => {
      console.warn('playercount: client error', err && err.message);
    });

    await client.login(token);

    // Wait briefly for ready or timeout to proceed
    await Promise.race([
      new Promise(resolve => emitter.once('ready', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);

    return { enabled: true };
  } catch (e) {
    console.warn('playercount: failed to init (is discord.js installed?)', e && e.message);
    enabled = false;
    return { enabled: false };
  }
}

function getSummary({ limit = 100 } = {}) {
  if (!enabled) return { enabled: false, count: 0, members: [] };
  const arr = Array.from(onlineMembers.values()).slice(0, limit);
  return { enabled: true, count: onlineMembers.size, members: arr };
}

async function stop() {
  try {
    if (client) {
      await client.destroy();
      client = null;
      enabled = false;
      onlineMembers.clear();
    }
  } catch (e) { /* ignore */ }
}

module.exports = { init, getSummary, stop };