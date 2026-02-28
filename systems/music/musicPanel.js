// systems/music/musicPanel.js
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const FILE = path.join(process.cwd(), 'channelConfig.json');

function loadCfg() {
  try {
    return fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  } catch (e) {
    console.error('[music] channelConfig.json read fail:', e);
    return {};
  }
}
function saveCfg(obj) {
  fs.writeFileSync(FILE, JSON.stringify(obj, null, 2), 'utf8');
}

function getMusicChannelId(guildId) {
  const cfg = loadCfg();
  return cfg[guildId]?.music || null;
}
function getPanelMessageId(guildId) {
  const cfg = loadCfg();
  return cfg[guildId]?.musicPlayerMessageId || null;
}
function setPanelMessageId(guildId, messageId) {
  const cfg = loadCfg();
  cfg[guildId] ??= {};
  cfg[guildId].musicPlayerMessageId = messageId;
  saveCfg(cfg);
}

// -------------------- helpers --------------------
function getYouTubeThumb(url) {
  try {
    const u = new URL(url);
    let id = u.searchParams.get('v');
    if (!id && u.hostname.includes('youtu.be')) id = u.pathname.replace('/', '').trim();
    if (!id) return null;
    return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  } catch {
    return null;
  }
}

function formatMMSS(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ✅ durationSec가 숫자/문자열(mm:ss)/ms 로 들어와도 안정적으로 초로 변환
function parseDurationToSec(v) {
  if (v == null) return null;

  if (typeof v === 'number' && Number.isFinite(v)) {
    return v > 100000 ? Math.floor(v / 1000) : Math.floor(v); // ms 가능성 처리
  }

  if (typeof v === 'string') {
    const s = v.trim();

    // "mm:ss" or "hh:mm:ss"
    if (/^\d+:\d{2}(:\d{2})?$/.test(s)) {
      const parts = s.split(':').map(Number);
      if (parts.some((n) => !Number.isFinite(n))) return null;
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    const n = Number(s);
    if (Number.isFinite(n)) return n > 100000 ? Math.floor(n / 1000) : Math.floor(n);
  }

  return null;
}

// “채워지는” 진행바 + 시간 표시 (LIVE 대신 ▶/❚❚/■)
function makeFillBar(elapsedSec, totalSec, symbol, width = 14) {
  if (!totalSec || !Number.isFinite(totalSec) || totalSec <= 0) {
    return `${symbol}  ${formatMMSS(elapsedSec)}  ${'▱'.repeat(width)}  --:--`;
  }
  const ratio = Math.max(0, Math.min(1, elapsedSec / totalSec));
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  const empty = width - filled;

  const bar = `${'▰'.repeat(filled)}${'▱'.repeat(empty)}`;
  return `${symbol}  ${formatMMSS(elapsedSec)}  ${bar}  ${formatMMSS(totalSec)}`;
}

// “재생중...” 점 애니메이션 (표시용)
const PLAYING_FRAMES = ['재생중...', '재생중..', '재생중.', '재생중..'];

// TIP (이모지 없음)
const TIPS = [
  '도움이 필요하시다면 !!help 를 입력해주세요',
  '급한 문의가 있으실 경우 제작자 개인 DM 을 이용해주세요',
  '같은 음성 채널에 있어야 조작할 수 있어요',
  '음악 채널에서만 버튼 조작이 가능해요',
  '음성 랭크는 골드 이상부터 축하 메시지가 표시돼요',
  '매주 제작자 플리는 업데이트 된답니다',
  '대기열이 가득 차면 더 이상 곡을 추가할 수 없어요',
];

// 한글 안전 “글자 단위”
function chars(s) {
  return Array.from(String(s));
}

function tipByTimeChars() {
  const STEP_MS = 700;
  const HOLD_STEPS = 6;
  const GAP_STEPS = 2;

  const t = Math.floor(Date.now() / STEP_MS);

  const blocks = TIPS.map((s) => {
    const arr = chars(s);
    const len = arr.length;
    return { arr, len, total: len + HOLD_STEPS + len + GAP_STEPS };
  });

  const cycle = blocks.reduce((a, b) => a + b.total, 0);
  let x = t % cycle;

  for (const b of blocks) {
    if (x < b.total) {
      const { arr, len } = b;

      if (x < len) return arr.slice(0, x + 1).join('');

      x -= len;
      if (x < HOLD_STEPS) return arr.join('');

      x -= HOLD_STEPS;
      if (x < len) {
        const remain = len - (x + 1);
        return arr.slice(0, Math.max(0, remain)).join('');
      }

      return '';
    }
    x -= b.total;
  }
  return '';
}

function getAnimatedStatus(state) {
  if (state.paused) return '일시정지';
  if (!state.playing) return '정지';
  const idx = Math.floor(Date.now() / 1500) % PLAYING_FRAMES.length;
  return PLAYING_FRAMES[idx];
}

// 진행줄 앞 심볼(특수문자)
function getStateSymbol(state) {
  if (state.paused) return '❚❚';
  if (state.playing) return '▶';
  return '■';
}

function buildEmbeds(state, guildIconUrl) {
  const now = state.now;

  // -------------------- 위 임베드: 다음 예약(썸네일 없음, 인라인 코드) --------------------
  let upNextText = '다음 예약 | 없음';
  if (state.queue.length > 0) {
    const first = state.queue[0];
    const rest = state.queue.length - 1;
    upNextText = `다음 예약 | ${first.title}${rest > 0 ? ` (+${rest}곡)` : ''}`;
  }

  const embedNext = new EmbedBuilder()
    .setColor(0x000000)
    .setDescription(`\`${upNextText}\` <`);

  // -------------------- 아래 임베드: 현재 재생 --------------------
  const header = `# MAY Music\n\u200b`; // 제목 밑에 “한 칸” 공백 느낌

  const err = state.lastError ? `\n주의: ${state.lastError}` : '';

  const trackTitle = now?.title ?? '지금 재생중인 음악이 없어요.';
  const trackLink = now?.url ? `[${trackTitle}](${now.url})` : trackTitle;

  // 썸네일: 현재 곡 유튜브 썸네일 -> 서버 아이콘
  const nowThumb =
    (now?.url ? getYouTubeThumb(now.url) : null) ||
    guildIconUrl ||
    null;

  // ✅ durationSec 정상화
  const totalSec = parseDurationToSec(now?.durationSec);

  // ✅ 진행바 계산 (state.startedAt / state.pausedMs / state.pauseStartedAt)
  let elapsedSec = 0;

  const startedAtMs = (() => {
    const v = state.startedAt;
    if (v == null) return null;
    const n = (typeof v === 'number') ? v : Number(v);
    if (!Number.isFinite(n)) return null;
    return n < 1e12 ? n * 1000 : n; // sec 들어와도 ms로 변환
  })();

  if (startedAtMs) {
    const pausedExtra = state.pauseStartedAt ? (Date.now() - state.pauseStartedAt) : 0;
    const effectivePaused = (state.pausedMs || 0) + pausedExtra;
    elapsedSec = Math.max(0, (Date.now() - startedAtMs - effectivePaused) / 1000);
  }

  const symbol = getStateSymbol(state);
  const gaugeLine = makeFillBar(elapsedSec, totalSec, symbol, 14);

  const requester = now?.requestedBy ?? '—';
  const statusText = getAnimatedStatus(state);
  const queueText = `${state.queue.length}곡`;

  const tip = tipByTimeChars();
  const footerText = tip ? `TIP | ${tip}` : 'TIP |';

  const embedNow = new EmbedBuilder()
    .setColor(0xCFA7FF) // 연보라
    .setThumbnail(nowThumb)
    .setDescription((header + (err ? `\n${err}` : '')).trim())
    .addFields(
      { name: '제목', value: now ? trackLink : '—', inline: false },
      { name: '진행', value: '```' + gaugeLine + '```', inline: false },

      // 한 줄 3칸 + 각 값이 코드블럭
      { name: '요청자', value: '```' + requester + '```', inline: true },
      { name: '상태', value: '```' + statusText + '```', inline: true },
      { name: '대기열', value: '```' + queueText + '```', inline: true },
    )
    .setFooter({ text: footerText });

  return [embedNext, embedNow];
}

function buildButtons(guildId, state) {
  const rowTop = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`music:chart:billboard:${guildId}`)
      .setLabel('빌보드차트')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`music:chart:korea:${guildId}`)
      .setLabel('인기차트')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`music:plist:owner:${guildId}`)
      .setLabel('제작자플리')
      .setStyle(ButtonStyle.Secondary),
  );

  const rowBottom = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`music:toggle:${guildId}`)
      .setLabel(state.paused ? '재생' : '일시정지')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`music:skip:${guildId}`)
      .setLabel('스킵')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`music:stop:${guildId}`)
      .setLabel('중지')
      .setStyle(ButtonStyle.Danger),
  );

  return [rowTop, rowBottom];
}

// -------------------- ticker --------------------
const tickers = new Map();
const editLocks = new Map();

function ensureTicker(client, guildId, getState) {
  const state = getState(guildId);

  if (!state.playing || state.paused) {
    const t = tickers.get(guildId);
    if (t) {
      clearInterval(t);
      tickers.delete(guildId);
    }
    return;
  }

  if (tickers.has(guildId)) return;

  const interval = setInterval(async () => {
    try {
      const st = getState(guildId);
      if (!st.playing || st.paused) {
        clearInterval(interval);
        tickers.delete(guildId);
        return;
      }
      await ensurePanelMessage(client, guildId, getState);
    } catch {
      clearInterval(interval);
      tickers.delete(guildId);
    }
  }, 700);

  tickers.set(guildId, interval);
}

async function ensurePanelMessage(client, guildId, getState) {
  const channelId = getMusicChannelId(guildId);
  if (!channelId) return null;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;

  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch || !ch.isTextBased()) return null;

  const state = getState(guildId);
  const guildIconUrl = guild.iconURL({ size: 256 }) || null;

  const embeds = buildEmbeds(state, guildIconUrl);
  const rows = buildButtons(guildId, state);

  const msgId = getPanelMessageId(guildId);
  if (editLocks.get(guildId)) return null;

  if (msgId) {
    const msg = await ch.messages.fetch(msgId).catch(() => null);
    if (msg) {
      editLocks.set(guildId, true);
      await msg.edit({ embeds, components: rows }).catch(() => {});
      editLocks.set(guildId, false);

      ensureTicker(client, guildId, getState);
      return msg;
    }
  }

  const msg = await ch.send({ embeds, components: rows }).catch(() => null);
  if (msg) setPanelMessageId(guildId, msg.id);

  ensureTicker(client, guildId, getState);
  return msg;
}

async function updatePanel(client, guildId, getState) {
  await ensurePanelMessage(client, guildId, getState);
}

module.exports = {
  getMusicChannelId,
  ensurePanelMessage,
  updatePanel,
};