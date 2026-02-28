// commands/ranking.js
// 💜 요청사항 반영 최종 완성본
// - 구분선 기본 = 맨 위
// - BUT 첫 줄이 티어 이모지면 → 이모지 바로 아래로 자동 이동
// - YOUR RANK 임베드 색상은 연보라 고정
// - TOP1~3만 연보라 계열 ANSI 글자색
// - 나머지는 기본 검정

const fs = require('fs');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

const config = require('../config.json');
const { formatHoursDecimal } = require('../utils/time');

const PAGE_SIZE = 10;
const PREFIX = 'vrank12';

const COLOR_RANKING = 0x2b2d31;
const COLOR_YOURRANK = 0xcba6f7; // 💜 고정
const DIVIDER_LEN = 28;

// 💜 연보라 계열 ANSI
const ANSI_RESET = '\u001b[0m';
const ANSI_TOP1 = '\u001b[1;35m'; // 가장 진한
const ANSI_TOP2 = '\u001b[0;35m'; // 연보라
const ANSI_TOP3 = '\u001b[0;35m'; // 보라톤

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

function readData() {
  try {
    return fs.existsSync('./data.json')
      ? JSON.parse(fs.readFileSync('./data.json', 'utf8'))
      : {};
  } catch {
    return {};
  }
}

function buildRanking(data) {
  return Object.entries(data)
    .filter(([id]) => id !== '__meta')
    .map(([id, info]) => ({ id, minutes: Number(info.totalMinutes) || 0 }))
    .sort((a, b) => b.minutes - a.minutes);
}

function getTierKey(totalMinutes) {
  let roleName = 'unranked';
  for (const lvl of config.levelRoles) {
    if (totalMinutes >= lvl.time) roleName = lvl.roleName;
    else break;
  }
  roleName = String(roleName).toLowerCase();
  return TIER_EMOJI[roleName] ? roleName : 'unranked';
}

function prettyTier(tierKey) {
  if (!tierKey || tierKey === 'unranked') return 'Unranked';
  return tierKey.charAt(0).toUpperCase() + tierKey.slice(1);
}

async function ensureMembersCached(guild, ids) {
  if (!guild) return;
  const unique = [...new Set(ids)].filter(Boolean);
  const missing = unique.filter((id) => !guild.members.cache.has(id));
  if (!missing.length) return;

  try {
    await guild.members.fetch({ user: missing });
  } catch {}
}

function displayNameOnly(guild, id) {
  const m = guild?.members?.cache?.get(id);
  return m?.displayName ?? `User-${String(id).slice(-4)}`;
}

function clampPage(page, totalPages) {
  const max = Math.max(0, totalPages - 1);
  return Math.min(Math.max(0, page), max);
}

function makeId(action, page, authorId) {
  return `${PREFIX}:${action}:${page}:${authorId}`;
}

function parseId(customId) {
  const p = String(customId).split(':');
  if (p.length !== 4) return null;
  if (p[0] !== PREFIX) return null;

  const page = Number(p[2]);
  if (!Number.isFinite(page)) return null;

  return { action: p[1], page, authorId: p[3] };
}

function buildTierSections({ slice, guild, viewerId, startRank }) {
  const sections = [];
  const idx = new Map();

  for (let i = 0; i < slice.length; i++) {
    const u = slice[i];
    const tierKey = getTierKey(u.minutes);
    const rankNum = startRank + i;

    const name = displayNameOnly(guild, u.id);
    const isMe = u.id === viewerId;
    const time = formatHoursDecimal(u.minutes);

    if (!idx.has(tierKey)) {
      idx.set(tierKey, sections.length);
      sections.push({ tierKey, users: [] });
    }
    sections[idx.get(tierKey)].users.push({ rankNum, name, isMe, time });
  }

  return sections;
}

function colorizeTop3(rankNum, text) {
  if (rankNum === 1) return `${ANSI_TOP1}${text}${ANSI_RESET}`;
  if (rankNum === 2) return `${ANSI_TOP2}${text}${ANSI_RESET}`;
  if (rankNum === 3) return `${ANSI_TOP3}${text}${ANSI_RESET}`;
  return text;
}

// 💜 핵심 로직
function renderSectionsToDescription(sections) {
  const parts = [];

  let isFirstLine = true;

  for (const sec of sections) {
    const emoji = TIER_EMOJI[sec.tierKey] || '▫️';
    const tierLabel = prettyTier(sec.tierKey);

    const lines = sec.users.map((x) => {
      const base = `#${x.rankNum} | ${x.name}${x.isMe ? '💜' : ''} · ${x.time}`;
      return colorizeTop3(x.rankNum, base);
    });

    if (isFirstLine) {
      // ✅ 첫 줄이 티어이므로 divider는 이모지 아래
      parts.push(`${emoji} ${tierLabel}`);
      parts.push(
        '```ansi\n' +
        '─'.repeat(DIVIDER_LEN) + '\n' +
        lines.join('\n') +
        '\n```'
      );
      isFirstLine = false;
    } else {
      parts.push(`${emoji} ${tierLabel}`);
      parts.push('```ansi\n' + lines.join('\n') + '\n```');
    }
  }

  // 만약 티어가 없을 경우
  if (!sections.length) {
    parts.unshift('```text\n' + '─'.repeat(DIVIDER_LEN) + '\n```');
  }

  return parts.join('\n');
}

async function buildEmbeds({ guild, ranking, page, viewerId, viewerUser }) {
  const total = ranking.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = clampPage(page, totalPages);

  const startIdx = safePage * PAGE_SIZE;
  const slice = ranking.slice(startIdx, startIdx + PAGE_SIZE);

  const myIndex = ranking.findIndex((u) => u.id === viewerId);

  const idsToFetch = [
    ...slice.map((u) => u.id),
    ...(myIndex !== -1 ? [ranking[myIndex].id] : []),
  ];
  await ensureMembersCached(guild, idsToFetch);

  const sections = buildTierSections({
    slice,
    guild,
    viewerId,
    startRank: startIdx + 1,
  });

  const rankDesc = renderSectionsToDescription(sections);

  const guildIcon = guild?.iconURL?.({ dynamic: true, size: 64 }) || undefined;

  const rankEmbed = new EmbedBuilder()
    .setColor(COLOR_RANKING)
    .setAuthor({ name: 'RANKING', iconURL: guildIcon })
    .setDescription(rankDesc);

  let myTierKey = 'unranked';
  let myLine = 'No record yet.';
  if (myIndex !== -1) {
    const me = ranking[myIndex];
    myTierKey = getTierKey(me.minutes);

    const name = displayNameOnly(guild, me.id);
    const time = formatHoursDecimal(me.minutes);

    myLine = colorizeTop3(
      myIndex + 1,
      `#${myIndex + 1} | ${name}💜 · ${time}`
    );
  }

  const myEmoji = TIER_EMOJI[myTierKey] || '▫️';
  const myTierLabel = prettyTier(myTierKey);

  const myEmbed = new EmbedBuilder()
    .setColor(COLOR_YOURRANK)
    .setAuthor({
      name: 'YOUR RANK',
      iconURL: viewerUser.displayAvatarURL({ size: 128, dynamic: true }),
    })
    .setDescription(
      `${myEmoji} ${myTierLabel}\n` +
      '```ansi\n' +
      myLine +
      '\n' +
      '─'.repeat(DIVIDER_LEN) +
      '\n```'
    )
    .setFooter({ text: `Page ${safePage + 1}/${totalPages} · Total ${total}` });

  return { rankEmbed, myEmbed, safePage, totalPages, myIndex };
}

function buildButtons({ safePage, totalPages, authorId, myIndex }) {
  const hasMe = myIndex !== -1;
  const myPage = hasMe ? Math.floor(myIndex / PAGE_SIZE) : 0;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(makeId('prev', safePage - 1, authorId))
      .setLabel('‹')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 0),

    new ButtonBuilder()
      .setCustomId(makeId('me', myPage, authorId))
      .setLabel('내 순위')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasMe || safePage === myPage),

    new ButtonBuilder()
      .setCustomId(makeId('next', safePage + 1, authorId))
      .setLabel('›')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= totalPages - 1),
  );

  return [row];
}

module.exports = (client) => {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== '랭킹') return;

    try {
      await interaction.deferReply();
    } catch {
      return;
    }

    try {
      const ranking = buildRanking(readData());
      if (!ranking.length) return interaction.editReply('No ranking data.');

      const { rankEmbed, myEmbed, safePage, totalPages, myIndex } =
        await buildEmbeds({
          guild: interaction.guild,
          ranking,
          page: 0,
          viewerId: interaction.user.id,
          viewerUser: interaction.user,
        });

      return interaction.editReply({
        embeds: [rankEmbed, myEmbed],
        components: buildButtons({
          safePage,
          totalPages,
          authorId: interaction.user.id,
          myIndex,
        }),
      });
    } catch (e) {
      console.error('[ranking] error:', e);
    }
  });
};