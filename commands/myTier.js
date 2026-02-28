const fs = require('fs');
const config = require('../config.json');
const { formatHoursDecimal } = require('../utils/time');
const { EmbedBuilder } = require('discord.js');

const EMBED_COLOR = 0x2B2D31;

const TIER_EMOJI = {
  iron: '<:iron:1474773523317784607>',
  bronze: '<:bronze:1474773579500621955>',
  silver: '<:silver:1474773647678898196>',
  gold: '<:gold:1474773687038251221>',
  platinum: '<:platinum:1474773716000051405>',
  diamond: '<:diamond:1474773804436689050>',
  ascendant: '<:ascendant:1474773841640292352>',
  immortal: '<:immortal:1474774183836782623>',
  radiant: '<:radiant:1474774247057395853>',
};

const TIER_COLORS = {
  diamond: 0x3498DB,
  ascendant: 0x9B59B6,
  immortal: 0xE91E63,
  radiant: 0xFF4655,
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function makeProgressBar(percent, size = 18) {
  const filled = Math.round((percent / 100) * size);
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

function getTierKey(roleName) {
  if (!roleName) return null;
  return roleName.toLowerCase().replace(/[0-9]/g, '').replace(/\s+/g, '');
}

function withTierEmoji(roleName) {
  if (!roleName) return roleName;
  const key = getTierKey(roleName);
  const emoji = TIER_EMOJI[key];
  return emoji ? `${emoji} ${roleName}` : roleName;
}

function getEmbedColorByTier(roleName) {
  if (!roleName) return EMBED_COLOR;
  const key = getTierKey(roleName);
  return TIER_COLORS[key] ?? EMBED_COLOR;
}

module.exports = (client) => {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== '내티어') return;

    const data = fs.existsSync('./data.json')
      ? JSON.parse(fs.readFileSync('./data.json', 'utf8'))
      : {};

    const userId = interaction.user.id;

    if (!data[userId]) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle('RANK STATUS')
            .setDescription('No voice activity record found.')
            .setThumbnail(interaction.user.displayAvatarURL({ size: 256 })),
        ],
        ephemeral: true,
      });
    }

    const totalMinutes = data[userId].totalMinutes || 0;

    let currentRole = null;
    let nextRole = null;

    for (let i = 0; i < config.levelRoles.length; i++) {
      if (totalMinutes >= config.levelRoles[i].time) currentRole = config.levelRoles[i];
      else {
        nextRole = config.levelRoles[i];
        break;
      }
    }

    const embedColor = getEmbedColorByTier(currentRole?.roleName);

    // ⭐ 최고 랭크
    if (!nextRole) {
      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle('RANK STATUS')
        .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'MY RANK', value: `${withTierEmoji(currentRole?.roleName ?? 'UNRANKED')}`, inline: true },
          { name: 'TOTAL TIME', value: `${formatHoursDecimal(totalMinutes)}`, inline: true },
          { name: 'STATUS', value: 'MAX RANK REACHED', inline: false }
        );

      return interaction.reply({ embeds: [embed] });
    }

    const remainingMinutes = nextRole.time - totalMinutes;

    const currentStart = currentRole ? currentRole.time : 0;
    const span = Math.max(1, nextRole.time - currentStart);
    const gained = totalMinutes - currentStart;

    const ratio = clamp(gained / span, 0, 1);
    const percent = Math.floor(ratio * 100);
    const bar = makeProgressBar(percent, 18);

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle('RANK STATUS')
      .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
      .addFields(
        // ⭐ 첫 줄
        { name: 'MY RANK', value: `${withTierEmoji(currentRole ? currentRole.roleName : 'UNRANKED')}`, inline: true },
        { name: 'NEXT RANK', value: `${withTierEmoji(nextRole.roleName)}`, inline: true },
        { name: 'TOTAL TIME', value: `${formatHoursDecimal(totalMinutes)}`, inline: true },

        // ⭐ 둘째 줄
        { name: 'PROGRESS', value: `${bar}\n${percent}%`, inline: false },

        // ⭐ 마지막 줄
        { name: 'REMAINING', value: `${formatHoursDecimal(remainingMinutes)}`, inline: false }
      );

    return interaction.reply({ embeds: [embed] });
  });
};