// systems/musicChatInput.js
const { Events } = require('discord.js');
const fs = require('fs');
const path = require('path');

const FILE = path.join(process.cwd(), 'channelConfig.json');

function loadCfg() {
  try {
    return fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  } catch (e) {
    console.error('[musicChatInput] channelConfig.json read fail:', e);
    return {};
  }
}
function getMusicChannelId(guildId) {
  const cfg = loadCfg();
  return cfg[guildId]?.music || null;
}

module.exports = (client) => {
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const musicChannelId = getMusicChannelId(message.guild.id);
    if (!musicChannelId) return;
    if (message.channelId !== musicChannelId) return;

    const text = (message.content || '').trim();
    if (!text) return;
    if (text.startsWith('```')) return;
    if (text.startsWith('/')) return;


    await message.delete().catch(() => {});

    try {
      await client.music.playFromText({
        guildId: message.guild.id,
        member: message.member,
        text,
      });
    } catch (e) {
      const msg = await message.channel.send(`❌ ${e?.message ?? '오류가 났어!'}`).catch(() => null);
      if (msg) setTimeout(() => msg.delete().catch(() => {}), 4000);
    }
  });
};