// systems/voiceRank.js
const fs = require('fs');
const path = require('path');
const { Events, EmbedBuilder } = require('discord.js');
const config = require('../config.json'); // 레벨 룰(고정)

const CHANNEL_CONFIG_PATH = path.join(process.cwd(), 'channelConfig.json');

function loadChannelConfig() {
  try {
    return JSON.parse(fs.readFileSync(CHANNEL_CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = (client) => {
  // ===== Load data =====
  let data = {};
  try {
    data = fs.existsSync('./data.json')
      ? JSON.parse(fs.readFileSync('./data.json', 'utf8'))
      : {};
  } catch (e) {
    console.error('[voice-rank] Failed to read data.json:', e);
    data = {};
  }

  let dirty = false;

  function saveData() {
    if (!dirty) return;
    dirty = false;
    try {
      fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('[voice-rank] Failed to write data.json:', e);
      dirty = true;
    }
  }

  setInterval(saveData, 60 * 1000);

  process.on('SIGINT', () => {
    try { saveData(); } finally { process.exit(0); }
  });
  process.on('SIGTERM', () => {
    try { saveData(); } finally { process.exit(0); }
  });

  // ===== Helpers =====
  function ensureUser(userId) {
    if (!data[userId]) data[userId] = { totalMinutes: 0, tier: null };
    if (typeof data[userId].totalMinutes !== 'number') data[userId].totalMinutes = 0;
    if (typeof data[userId].tier !== 'string' && data[userId].tier !== null) data[userId].tier = null;
  }

  function cleanName(x) {
    return String(x ?? '')
      .toLowerCase()
      .normalize('NFKC')
      .replace(/\s+/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  const TIER_KEYS = [
    'iron',
    'bronze',
    'silver',
    'gold',
    'platinum',
    'diamond',
    'ascendant',
    'immortal',
    'radiant',
  ];

  function extractTierKeyFromAnyName(name) {
    const s = cleanName(name);
    for (const k of TIER_KEYS) {
      if (s.includes(k)) return k;
    }
    return null;
  }

  function roleNameToTierKey(roleName) {
    return extractTierKeyFromAnyName(roleName);
  }

  function getHighestRoleName(totalMinutes) {
    let roleName = null;
    for (const level of config.levelRoles) {
      if (totalMinutes >= level.time) roleName = level.roleName;
      else break;
    }
    return roleName;
  }

  function getRankRolesInGuild(guild) {
    return guild.roles.cache.filter((r) => !!extractTierKeyFromAnyName(r.name));
  }

  function pickBestRoleForTierKey(roles, tierKey) {
    if (!roles?.size) return null;

    const exactNames = config.levelRoles.map((x) => x.roleName).filter(Boolean);

    for (const n of exactNames) {
      if (roleNameToTierKey(n) !== tierKey) continue;
      const wanted = cleanName(n);
      const exact = roles.find((r) => cleanName(r.name) === wanted);
      if (exact) return exact;
    }

    return roles.find((r) => extractTierKeyFromAnyName(r.name) === tierKey) || null;
  }

  // ===== Rankup Notify (Gold+) =====
  const TIER_ORDER = ['iron','bronze','silver','gold','platinum','diamond','ascendant','immortal','radiant'];

  function isGoldOrAbove(roleName) {
    const key = extractTierKeyFromAnyName(roleName);
    if (!key) return false;
    return TIER_ORDER.indexOf(key) >= TIER_ORDER.indexOf('gold');
  }

  function formatHM(totalMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}h ${m}m`;
  }

  async function notifyRankUp(guild, member, oldRoleName, newRoleName, totalMinutes) {
    try {
      if (!guild || !member) return;
      if (!isGoldOrAbove(newRoleName)) return;

      const chCfg = loadChannelConfig();
      const channelId = chCfg?.[guild.id]?.rankup; 
      if (!channelId) return;

      const ch = await guild.channels.fetch(channelId).catch(() => null);
      if (!ch) return;

      const embed = new EmbedBuilder()
        .setTitle('🏆 RANK UP!')
        .setDescription(
          [
            `**${member}** 님이 승급했어요!`,
            '',
            `**${oldRoleName ?? 'UNRANKED'}** ➜ **${newRoleName}**`,
            `총 시간: **${formatHM(totalMinutes)}**`,
          ].join('\n')
        )
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setTimestamp();

      await ch.send({ embeds: [embed] });
    } catch (e) {
      console.warn('[voice-rank] notifyRankUp fail:', e?.message ?? e);
    }
  }

  // ===== Role Set
  async function setSingleRankRole(member, newRoleName) {
    if (!member?.guild) return;

    const guild = member.guild;
    if (member.id === guild.ownerId) return;

    if (!member.manageable) return;

    const tierKey = roleNameToTierKey(newRoleName);
    if (!tierKey) return;

    const rankRoles = getRankRolesInGuild(guild);
    if (!rankRoles.size) return;

    const newRole = pickBestRoleForTierKey(rankRoles, tierKey);
    if (!newRole) return;

    const toRemove = member.roles.cache.filter(
      (r) => rankRoles.has(r.id) && r.id !== newRole.id
    );

    if (toRemove.size > 0) {
      await member.roles.remove([...toRemove.keys()], 'Voice rank cleanup').catch(() => {});
    }

    if (!member.roles.cache.has(newRole.id)) {
      await member.roles.add(newRole, 'Voice rank set').catch(() => {});
    }
  }

  function isEligibleForMinute(member) {
    if (!member || member.user?.bot) return false;

    const channel = member.voice?.channel;
    if (!channel) return false;

    const nonBots = channel.members.filter((m) => !m.user.bot);
    if (nonBots.size <= 1) return false;

    if (member.voice.selfMute || member.voice.serverMute) return false;
    if (member.voice.selfDeaf || member.voice.serverDeaf) return false;

    return true;
  }

  // ===== Guild Timer =====
  const guildTimers = new Map();
  const guildLocks = new Set();

  function startGuildTimer(guild) {
    if (!guild) return;
    if (guildTimers.has(guild.id)) return;

    const interval = setInterval(async () => {
      if (guildLocks.has(guild.id)) return;
      guildLocks.add(guild.id);

      try {
        const voiceStates = guild.voiceStates.cache;

        for (const vs of voiceStates.values()) {
          const member = vs.member ?? await guild.members.fetch(vs.id).catch(() => null);
          if (!member) continue;

          if (!isEligibleForMinute(member)) continue;

          const userId = member.id;
          ensureUser(userId);

          data[userId].totalMinutes += 1;
          dirty = true;

          const newRoleName = getHighestRoleName(data[userId].totalMinutes);
          if (!newRoleName) continue;

          const oldTier = data[userId].tier;

          // 역할은 오너 > 스킵됨
          await setSingleRankRole(member, newRoleName);

          if (oldTier !== newRoleName) {
            await notifyRankUp(guild, member, oldTier, newRoleName, data[userId].totalMinutes);
            data[userId].tier = newRoleName;
            dirty = true;
          }
        }
      } catch (e) {
        console.error('[voice-rank] tick error:', e);
      } finally {
        guildLocks.delete(guild.id);
      }
    }, 60 * 1000);

    guildTimers.set(guild.id, interval);
  }

  function stopGuildTimer(guildId) {
    const t = guildTimers.get(guildId);
    if (t) clearInterval(t);
    guildTimers.delete(guildId);
    guildLocks.delete(guildId);
  }

  client.on(Events.ClientReady, () => {
    console.log('[voice-rank] timers starting...');
    for (const guild of client.guilds.cache.values()) startGuildTimer(guild);
  });

  client.on('guildCreate', (guild) => startGuildTimer(guild));
  client.on('guildDelete', (guild) => stopGuildTimer(guild.id));

  client.on('voiceStateUpdate', () => {
    // 확장용
  });
};