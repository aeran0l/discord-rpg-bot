// systems/music/musicSystem.js
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const playdl = require('play-dl');
const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = process.env.FFMPEG_PATH || ffmpegPath;

const {
  Events,
  MessageFlags,
} = require('discord.js');

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  entersState,
  demuxProbe,
} = require('@discordjs/voice');

const OWNER_PL_FILE = path.join(process.cwd(), 'ownerPlaylist.json');

// =========================
// 튜닝 값
const CHART_ADD_COUNT = 30;
const OWNER_ADD_COUNT = 20;
const MAX_QUEUE = 99;
const MAX_DURATION_SEC = 5 * 60 * 60; // ✅ 5시간 제한
const COOLDOWN_MS_CHART = 12_000;
const COOLDOWN_MS_PLIST = 12_000;
const CHART_RESOLVE_CONCURRENCY = 6;

// 유저별 연타 방지
const cooldowns = new Map();
function makeCooldownKey(type, guildId, userId) {
  return `${type}:${guildId}:${userId}`;
}
function checkCooldown(type, guildId, userId, ms) {
  const key = makeCooldownKey(type, guildId, userId);
  const now = Date.now();
  const last = cooldowns.get(key) || 0;
  const remain = ms - (now - last);
  if (remain > 0) return remain;
  cooldowns.set(key, now);
  return 0;
}

function safeString(v) {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  try { return String(v); } catch { return ''; }
}
function stripAngleBrackets(text) {
  const s = safeString(text).trim();
  return (s.startsWith('<') && s.endsWith('>')) ? s.slice(1, -1).trim() : s;
}
function makeWatchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}
function normalizeYouTubeUrl(raw) {
  let input = stripAngleBrackets(raw);
  if (!/^https?:\/\//i.test(input)) return input;

  try {
    const u = new URL(input);

    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace('/', '').trim();
      if (id) input = makeWatchUrl(id);
    }

    if (u.pathname.startsWith('/shorts/')) {
      const id = u.pathname.split('/shorts/')[1]?.split('/')[0]?.trim();
      if (id) input = makeWatchUrl(id);
    }

    if (u.hostname === 'music.youtube.com') {
      u.hostname = 'www.youtube.com';
      input = u.toString();
    }

    const clean = new URL(input);
    [
      'si', 'feature', 'pp', 'ab_channel',
      'utm_source', 'utm_medium', 'utm_campaign',
      'list', 'index', 'start_radio',
      't', 'time_continue'
    ].forEach(k => clean.searchParams.delete(k));

    input = clean.toString();
  } catch {}

  return input;
}
function isHttpUrl(s) {
  return /^https?:\/\//i.test(safeString(s));
}

function formatDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${hh}시간 ${mm}분 ${ss}초`;
  return `${mm}분 ${ss}초`;
}

// ✅ 병렬 제한 실행기
async function mapPool(items, limit, mapper) {
  const results = new Array(items.length);
  let idx = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      try {
        results[i] = await mapper(items[i], i);
      } catch (e) {
        results[i] = { __error: e };
      }
    }
  });

  await Promise.all(workers);
  return results;
}

// ===== yt-dlp path/cookies =====
const YTDLP_PATH = (() => {
  const localLinux = path.join(process.cwd(), 'bin', 'yt-dlp');
  const localWin = path.join(process.cwd(), 'bin', 'yt-dlp.exe');

  if (fs.existsSync(localLinux)) return localLinux;
  if (fs.existsSync(localWin)) return localWin;

  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
})();

const YTDLP_COOKIES_TXT = path.join(process.cwd(), 'cookies.txt');
const HAS_DENO = (() => {
  try {
    const r = spawnSync('deno', ['--version'], { stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
})();

function ytDlpGetInfo(urlOrSearch) {
  return new Promise((resolve, reject) => {
    const args = [
      '--no-playlist',
      '-J',
    ];

    if (HAS_DENO) args.unshift('--js-runtimes', 'deno');

    if (fs.existsSync(YTDLP_COOKIES_TXT)) {
      args.push('--cookies', YTDLP_COOKIES_TXT);
    }

    args.push(urlOrSearch);

    const p = spawn(YTDLP_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let out = '';
    let err = '';
    p.stdout.on('data', (d) => {
      out += d.toString();
      if (out.length > 20 * 1024 * 1024) p.kill('SIGKILL');
    });
    p.stderr.on('data', (d) => {
      err += d.toString();
      if (err.length > 5 * 1024 * 1024) p.kill('SIGKILL');
    });

    p.on('error', (e) => reject(e));
    p.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error((err || out || '').trim() || `yt-dlp exited with ${code}`));
      }
      try {
        const j = JSON.parse(out);
        const v = Array.isArray(j?.entries) ? j.entries[0] : j;
        resolve({
          title: safeString(v?.title) || '제목 없음',
          webpage_url: safeString(v?.webpage_url) || safeString(v?.original_url) || safeString(urlOrSearch),
          duration: (typeof v?.duration === 'number') ? v.duration : null,
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

function writeNetscapeCookiesTxtFromEditThisCookieJson(jsonPath, outPath) {
  try {
    if (!jsonPath || !fs.existsSync(jsonPath)) return false;

    const cookies = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (!Array.isArray(cookies) || cookies.length === 0) return false;

    const lines = [];
    lines.push('# Netscape HTTP Cookie File');
    lines.push('# Generated from cookies.json (EditThisCookie JSON)');

    for (const c of cookies) {
      const domain = String(c.domain ?? '').trim();
      const name = String(c.name ?? '').trim();
      const value = String(c.value ?? '').trim();
      const cookiePath = (String(c.path ?? '/').trim() || '/');

      if (!domain || !name) continue;

      const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
      const secure = c.secure ? 'TRUE' : 'FALSE';

      let expiry = 0;
      if (typeof c.expirationDate === 'number') expiry = Math.floor(c.expirationDate);
      else if (typeof c.expires === 'number') expiry = Math.floor(c.expires);

      lines.push([domain, includeSubdomains, cookiePath, secure, String(expiry), name, value].join('\t'));
    }

    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    console.log('[music] yt-dlp cookies.txt generated:', outPath);
    return true;
  } catch (e) {
    console.warn('[music] failed to generate cookies.txt for yt-dlp:', e?.message ?? e);
    return false;
  }
}

function cleanupPlayerScriptsOnce() {
  try {
    const files = fs.readdirSync(process.cwd());
    for (const f of files) {
      if (/-player-script\.js$/i.test(f)) fs.unlinkSync(path.join(process.cwd(), f));
    }
  } catch {}
}

// ===== chart cache =====
const chartCache = new Map(); // key -> { ts, items }
const CHART_CACHE_MS = 10 * 60 * 1000;
async function fetchChartItemsCached(key, fetcher) {
  const now = Date.now();
  const cached = chartCache.get(key);
  if (cached && (now - cached.ts) < CHART_CACHE_MS) return cached.items;

  const items = await fetcher();
  chartCache.set(key, { ts: now, items });
  return items;
}

async function fetchBillboardHot100Top(n = 100) {
  const url = 'https://raw.githubusercontent.com/mhollingshead/billboard-hot-100/main/recent.json';

  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Billboard fetch 실패: HTTP ${res.status}`);

  const json = await res.json();
  const data = Array.isArray(json?.data) ? json.data : [];

  return data.slice(0, n).map((s) => ({
    title: safeString(s?.song),
    artist: safeString(s?.artist),
  })).filter((x) => x.title);
}

async function fetchKoreaTop100(n = 100) {
  const url = 'https://raw.githubusercontent.com/edwinvillafane/melon-scraper/master/melon-trends.json';

  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`인기차트 fetch 실패: HTTP ${res.status}`);

  const json = await res.json();
  const items = [];

  for (let i = 1; i <= 100; i++) {
    const row = json?.[String(i)];
    const title = safeString(row?.name).trim();
    const artist = safeString(row?.artists).trim();
    if (title) items.push({ title, artist });
  }

  if (items.length === 0) throw new Error('인기차트를 불러왔는데 곡이 비어있어요.');
  return items.slice(0, Math.min(n, items.length));
}

// ===== owner playlist =====
function loadOwnerPlaylist() {
  try {
    if (!fs.existsSync(OWNER_PL_FILE)) return null;
    const obj = JSON.parse(fs.readFileSync(OWNER_PL_FILE, 'utf8'));
    const tracks = Array.isArray(obj?.tracks) ? obj.tracks.filter(Boolean) : [];
    if (tracks.length === 0) return null;
    return { name: obj?.name || '제작자플리', tracks };
  } catch {
    return null;
  }
}

// ===== per-guild state =====
const states = new Map();
function getState(guildId) {
  if (!states.has(guildId)) {
    states.set(guildId, {
      guildId,
      connection: null,
      player: null,
      now: null,
      queue: [],
      paused: false,
      playing: false,
      lastError: null,
      prefetch: null, // { url, source }

      // ✅ 진행바 타이머 상태
      startedAt: null,       // ms
      pausedMs: 0,           // ms 누적
      pauseStartedAt: null,  // ms
    });
  }
  return states.get(guildId);
}

function pickDurationSec(info) {
  const vd = info?.video_details;
  const a = vd?.durationInSec;
  const b = vd?.durationInSeconds;
  const c = vd?.durationInMs != null ? Math.floor(Number(vd.durationInMs) / 1000) : null;
  const raw = (a ?? b ?? c);
  const sec = Number(raw);
  return Number.isFinite(sec) ? sec : null;
}

function enforceDurationLimit(durationSec) {
  if (durationSec == null) return; // 라이브/정보없음은 통과(원하면 여기서 막아도 됨)
  if (durationSec > MAX_DURATION_SEC) {
    throw new Error(`⛔ 5시간 초과 곡은 추가할 수 없어요. (길이: ${formatDuration(durationSec)})`);
  }
}

// ===== resolve (✅ 5시간 제한 포함 + ✅ durationSec 반환 포함) =====
async function resolveToSong(inputText) {
  const raw = safeString(inputText).trim();
  if (!raw) throw new Error('텍스트가 비어있어요!');

  const normalized = normalizeYouTubeUrl(raw);

  // ✅ URL이면: yt-dlp(쿠키/deno)로 제목/길이까지 조회해서 제한 적용
  if (isHttpUrl(normalized)) {
    const info = await ytDlpGetInfo(normalized).catch((e) => {
      throw new Error(`정보 불러오기 실패: ${e?.message ?? e}`);
    });

    const title = safeString(info?.title) || '제목 없음';
    const url = safeString(info?.webpage_url) || normalized;

    const dur = (typeof info?.duration === 'number') ? info.duration : null;
    enforceDurationLimit(dur);

    if (!isHttpUrl(url)) throw new Error('Invalid URL');
    return { title, url, durationSec: dur ?? null, needsTitleFetch: false };
  }

  // ✅ 검색이면: yt-dlp ytsearch로 1개 뽑고 길이 확인
  const info = await ytDlpGetInfo(`ytsearch1:${normalized}`).catch((e) => {
    throw new Error(`검색 실패: ${e?.message ?? e}`);
  });

  const title = safeString(info?.title) || normalized;
  const url = safeString(info?.webpage_url);
  const dur = (typeof info?.duration === 'number') ? info.duration : null;

  enforceDurationLimit(dur);
  if (!isHttpUrl(url)) throw new Error('Invalid URL');

  return { title, url, durationSec: dur ?? null, needsTitleFetch: false };
}

// (옵션) 이제 URL은 info로 제목을 이미 가져오니, titleFetch는 사실상 거의 안 쓰이지만
// 나중에 확장 대비로 남겨둠.
function scheduleTitleFetch(client, guildId, item, updatePanel) {
  if (!item?.needsTitleFetch) return;
  if (!item?.url) return;
  item.needsTitleFetch = false;

  ytDlpGetInfo(item.url)
    .then((info) => {
      const t = safeString(info?.title);
      const u = safeString(info?.webpage_url);
      if (t) item.title = t;
      if (u && isHttpUrl(u)) item.url = u;
      updatePanel(guildId).catch(() => {});
    })
    .catch(() => {});
}

// ===== prefetch =====
async function prefetchNext(state) {
  if (state.prefetch) return;
  const next = state.queue[0];
  if (!next?.url) return;

  try {
    const source = await playdl.stream(next.url, {
      quality: 2,
      discordPlayerCompatibility: true,
    });
    state.prefetch = { url: next.url, source };
  } catch {
    state.prefetch = null;
  }
}

// ===== yt-dlp stream =====
function ytDlpStream(url) {
  return new Promise((resolve, reject) => {
    const args = [
      ...(HAS_DENO ? ['--js-runtimes', 'deno'] : []),
      '-f', 'ba',
      '-o', '-',
      '--no-playlist',
      '--no-warnings',
      '--quiet',
      '--socket-timeout', '10',
    ];

    if (fs.existsSync(YTDLP_COOKIES_TXT)) {
      args.push('--cookies', YTDLP_COOKIES_TXT);
    }

    args.push(url);

    const p = spawn(YTDLP_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let started = false;
    p.stdout.on('data', () => {
      if (!started) {
        started = true;
        resolve({ stream: p.stdout, type: 'opus' });
      }
    });

    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', (e) => reject(e));
    p.on('close', (code) => {
      if (!started && code !== 0) {
        reject(new Error(err || `yt-dlp exited with ${code}`));
      }
    });
  });
}

// ===== voice/player =====
async function ensureVoice(guild, member) {
  const state = getState(guild.id);

  const userVc = member?.voice?.channel;
  if (!userVc) throw new Error('음성 채널에 들어가주세요!');

  const botVcId = guild.members.me?.voice?.channelId;
  if (botVcId && botVcId !== userVc.id) {
    throw new Error('지금 봇이 다른 음성 채널에서 재생 중이에요!');
  }

  if (!state.player) {
    state.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    state.player.on('error', (e) => {
      state.lastError = e?.message ?? String(e);
      console.error('[music] player error:', e);
    });

    state.player.on(AudioPlayerStatus.Idle, async () => {
      state.playing = false;
      state.paused = false;

      // ✅ 타이머 정리
      state.startedAt = null;
      state.pausedMs = 0;
      state.pauseStartedAt = null;

      await playNext(guild.client, guild.id).catch((e) => {
        state.lastError = e?.message ?? String(e);
      });

      await guild.client.music.updatePanel(guild.id);
    });
  }

  if (!state.connection) {
    state.connection = joinVoiceChannel({
      channelId: userVc.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    await entersState(state.connection, VoiceConnectionStatus.Ready, 20_000);
    state.connection.subscribe(state.player);
  }

  return state;
}

async function playUrlOnPlayer(state, url) {
  const u = safeString(url);
  if (!isHttpUrl(u)) throw new Error('Invalid URL');

  try {
    let source;

    if (state.prefetch && state.prefetch.url === u) {
      source = state.prefetch.source;
      state.prefetch = null;
    } else {
      source = await playdl.stream(u, {
        quality: 2,
        discordPlayerCompatibility: true,
      });
    }

    const resource = createAudioResource(source.stream, { inputType: source.type });

    state.player.play(resource);
    state.playing = true;
    state.paused = false;
    state.lastError = null;

    prefetchNext(state).catch(() => {});
    return;
  } catch {
    // fallback
  }

  const { stream: dlStream } = await ytDlpStream(u);
  const probed = await demuxProbe(dlStream);
  const resource = createAudioResource(probed.stream, { inputType: probed.type });

  state.player.play(resource);
  state.playing = true;
  state.paused = false;
  state.lastError = null;

  prefetchNext(state).catch(() => {});
}

async function playNext(client, guildId) {
  const state = getState(guildId);
  if (!state.connection || !state.player) return;

  const next = state.queue.shift() || null;
  state.now = next;
  state.paused = false;
  state.lastError = null;

  if (!next) {
    state.playing = false;
    state.prefetch = null;

    // ✅ 타이머 정리
    state.startedAt = null;
    state.pausedMs = 0;
    state.pauseStartedAt = null;
    return;
  }

  try {
  await playUrlOnPlayer(state, next.url);
} catch (err) {
  console.error('[music] play fail, skipping:', err?.message ?? err);

  // 다음 곡으로 자동 스킵
  return playNext(client, guildId);
}

  // ✅ 새 곡 시작 기준점
  state.startedAt = Date.now();
  state.pausedMs = 0;
  state.pauseStartedAt = null;

  await client.music.updatePanel(guildId);
}

async function playFromText(client, { guildId, member, text }) {
  const musicTextChannelId = client.music.getMusicChannelId(guildId);
  if (!musicTextChannelId) throw new Error('먼저 /채널로 음악 채널을 지정해줘요!');

  const guild = await client.guilds.fetch(guildId);
  const state = getState(guildId);

  await ensureVoice(guild, member);

  if (state.queue.length >= MAX_QUEUE) {
    throw new Error(`대기열이 가득 찼어요! (최대 ${MAX_QUEUE}곡)`);
  }

  const song = await resolveToSong(text);
  const reqBy = member?.user?.tag ?? 'unknown';

  const item = { ...song, requestedBy: reqBy };
  state.queue.push(item);

  scheduleTitleFetch(client, guildId, item, client.music.updatePanel);

  if (state.playing && !state.prefetch) prefetchNext(state).catch(() => {});
  if (!state.playing && !state.paused) await playNext(client, guildId);

  await client.music.updatePanel(guildId);
}

// ===== queue limits =====
function clampByQueueRemaining(state, wanted) {
  const remaining = MAX_QUEUE - state.queue.length;
  if (remaining <= 0) return 0;
  return Math.min(remaining, wanted);
}

// ===== chart / playlist enqueue =====
async function enqueueChartItemsParallel(client, interaction, guildId, items, label, maxAdd) {
  const state = getState(guildId);
  await ensureVoice(interaction.guild, interaction.member);

  const canAdd = clampByQueueRemaining(state, maxAdd);
  if (canAdd <= 0) throw new Error(`대기열이 가득 찼어요! (최대 ${MAX_QUEUE}곡)`);

  const toAdd = items.slice(0, canAdd);
  const reqBy = interaction.member?.user?.tag ?? 'unknown';

  const queries = toAdd.map((it) => `${safeString(it.title)} ${safeString(it.artist)}`.trim());

  const resolved = await mapPool(queries, CHART_RESOLVE_CONCURRENCY, async (q) => {
    return await resolveToSong(q);
  });

  let added = 0;
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    if (!r || r.__error) continue;

    const itemObj = { ...r, requestedBy: `${reqBy} (${label})` };
    state.queue.push(itemObj);
    scheduleTitleFetch(client, guildId, itemObj, client.music.updatePanel);
    added++;
  }

  if (added === 0) throw new Error('차트 곡을 찾지 못했어요. 잠시 후 다시 시도해줘요!');

  if (!state.playing && !state.paused) {
    await playNext(client, guildId);
  } else {
    if (!state.prefetch) prefetchNext(state).catch(() => {});
  }

  await client.music.updatePanel(guildId);
}

async function enqueueOwnerPlaylistSequential(client, interaction, guildId) {
  const pl = loadOwnerPlaylist();
  if (!pl) throw new Error('ownerPlaylist.json이 없거나 tracks가 비어있어요!');

  const state = getState(guildId);
  await ensureVoice(interaction.guild, interaction.member);

  const canAdd = clampByQueueRemaining(state, OWNER_ADD_COUNT);
  if (canAdd <= 0) throw new Error(`대기열이 가득 찼어요! (최대 ${MAX_QUEUE}곡)`);

  const targets = pl.tracks.slice(0, canAdd);
  const reqBy = interaction.member?.user?.tag ?? 'unknown';

  for (const raw of targets) {
    const song = await resolveToSong(raw);
    const itemObj = { ...song, requestedBy: `${reqBy} (owner)` };
    state.queue.push(itemObj);
    scheduleTitleFetch(client, guildId, itemObj, client.music.updatePanel);
  }

  if (!state.playing && !state.paused) {
    await playNext(client, guildId);
  } else {
    if (!state.prefetch) prefetchNext(state).catch(() => {});
  }

  await client.music.updatePanel(guildId);
}

// ===== buttons =====
async function handleToggle(client, guildId) {
  const state = getState(guildId);
  if (!state.player) return;

  if (state.paused) {
    // ✅ resume
    state.player.unpause();
    state.paused = false;
    state.playing = true;

    if (state.pauseStartedAt) {
      state.pausedMs += (Date.now() - state.pauseStartedAt);
      state.pauseStartedAt = null;
    }
  } else {
    // ✅ pause
    state.player.pause(true);
    state.paused = true;
    state.playing = false;

    state.pauseStartedAt = Date.now();
  }

  await client.music.updatePanel(guildId);
}

async function handleSkip(client, guildId) {
  const state = getState(guildId);
  if (!state.player) return;
  state.player.stop(true);
  await client.music.updatePanel(guildId);
}

async function handleStop(client, guildId) {
  const state = getState(guildId);

  state.queue = [];
  state.now = null;
  state.paused = false;
  state.playing = false;
  state.lastError = null;
  state.prefetch = null;

  // ✅ 타이머 정리
  state.startedAt = null;
  state.pausedMs = 0;
  state.pauseStartedAt = null;

  try { state.player?.stop(true); } catch {}
  try { state.connection?.destroy(); } catch {}

  state.connection = null;
  state.player = null;

  await client.music.updatePanel(guildId);
}

// ===== main init =====
function initMusicSystem(client, config, panel) {
  // play-dl cookie
  try {
    if (config.youtubeCookie) {
      playdl.setToken({ youtube: { cookie: config.youtubeCookie } });
      console.log('[music] YouTube cookie applied (play-dl)');
    }
  } catch {
    console.log('[music] cookie load failed (play-dl)');
  }

  writeNetscapeCookiesTxtFromEditThisCookieJson(config.youtubeCookiesFile, YTDLP_COOKIES_TXT);

  // client.music API
  client.music = {
    states,
    getState,
    MAX_QUEUE,
    getMusicChannelId: panel.getMusicChannelId,
    ensurePanelMessage: (guildId) => panel.ensurePanelMessage(client, guildId, getState, MAX_QUEUE),
    updatePanel: (guildId) => panel.updatePanel(client, guildId, getState, MAX_QUEUE),
    playFromText: (payload) => playFromText(client, payload),
  };

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;

    const parts = interaction.customId.split(':');
    const prefix = parts[0];
    const action = parts[1];
    const guildId = parts[parts.length - 1];

    if (prefix !== 'music') return;
    if (!interaction.guild || interaction.guildId !== guildId) return;

    const musicChannelId = panel.getMusicChannelId(guildId);
    if (musicChannelId && interaction.channelId !== musicChannelId) {
      return interaction.reply({
        content: `🎵 음악 조작은 <#${musicChannelId}>에서만 가능해요!`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const memberVc = interaction.member?.voice?.channelId;
    const botVc = interaction.guild.members.me?.voice?.channelId;
    if (botVc && memberVc !== botVc) {
      return interaction.reply({
        content: '같은 음성 채널에 있으셔야 조작할 수 있어요!',
        flags: MessageFlags.Ephemeral,
      });
    }

    const userId = interaction.user?.id || interaction.member?.user?.id;
    if (userId) {
      if (action === 'chart') {
        const remain = checkCooldown('chart', guildId, userId, COOLDOWN_MS_CHART);
        if (remain > 0) {
          const sec = Math.ceil(remain / 1000);
          return interaction.reply({
            content: `⏳ 차트는 너무 빨리 누를 수 없어요! **${sec}초** 후에 다시 눌러줘요.`,
            flags: MessageFlags.Ephemeral,
          });
        }
      }
      if (action === 'plist') {
        const remain = checkCooldown('plist', guildId, userId, COOLDOWN_MS_PLIST);
        if (remain > 0) {
          const sec = Math.ceil(remain / 1000);
          return interaction.reply({
            content: `⏳ 제작자플리는 너무 빨리 누를 수 없어요! **${sec}초** 후에 다시 눌러줘요.`,
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    }

    await interaction.deferUpdate();

    try {
      if (action === 'toggle') return handleToggle(client, guildId);
      if (action === 'skip') return handleSkip(client, guildId);
      if (action === 'stop') return handleStop(client, guildId);

      if (action === 'chart') {
        const type = parts[2];

        if (type === 'billboard') {
          const items = await fetchChartItemsCached(
            'billboard_hot100',
            () => fetchBillboardHot100Top(CHART_ADD_COUNT)
          );
          return enqueueChartItemsParallel(client, interaction, guildId, items, 'billboard', CHART_ADD_COUNT);
        }

        if (type === 'korea') {
          const items = await fetchChartItemsCached(
            'korea_top100',
            () => fetchKoreaTop100(CHART_ADD_COUNT)
          );
          return enqueueChartItemsParallel(client, interaction, guildId, items, 'popular', CHART_ADD_COUNT);
        }
      }

      if (action === 'plist' && parts[2] === 'owner') {
        return enqueueOwnerPlaylistSequential(client, interaction, guildId);
      }
    } catch (e) {
      const msg = e?.message ?? String(e);
      console.error('[music] button error:', e);

      const st = getState(guildId);
      st.lastError = msg;
      await client.music.updatePanel(guildId);
    }
  });

  client.once(Events.ClientReady, async () => {
    cleanupPlayerScriptsOnce();
    writeNetscapeCookiesTxtFromEditThisCookieJson(config.youtubeCookiesFile, YTDLP_COOKIES_TXT);

    for (const [guildId] of client.guilds.cache) {
      await client.music.ensurePanelMessage(guildId);
    }
  });
}

module.exports = { initMusicSystem };