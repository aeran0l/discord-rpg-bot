// utils/logFilter.js
module.exports = function enableMusicLogFilter() {

  const QUIET_MUSIC_LOGS = true;
  if (!QUIET_MUSIC_LOGS) return;

  const _warn = console.warn.bind(console);
  const _log = console.log.bind(console);

  const shouldMute = (msg) => {
    const m = String(msg || '');

    return (
      m.includes('[music] play-dl stream failed') ||
      m.includes('Could not parse decipher function') ||
      m.includes('Could not parse n transform function') ||
      m.includes('Stream URLs will be missing') ||
      m.includes('player-script.js')
    );
  };

  console.warn = (...args) => {
    const joined = args.map(a => (typeof a === 'string' ? a : (a?.message ?? String(a)))).join(' ');
    if (shouldMute(joined)) return;
    _warn(...args);
  };

  console.log = (...args) => {
    const joined = args.map(a => (typeof a === 'string' ? a : (a?.message ?? String(a)))).join(' ');
    if (shouldMute(joined)) return;
    _log(...args);
  };

  // ===============================
  // ✅ 여기 추가 (TimeoutNegativeWarning 필터)
  // ===============================
  process.on('warning', (w) => {
    if (w?.name === 'TimeoutNegativeWarning') return;
    _warn(w);
  });

  console.log('[music] log filter enabled');
};