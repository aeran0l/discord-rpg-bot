// commands/channel.js
const fs = require('fs');
const path = require('path');
const { PermissionsBitField } = require('discord.js');

const FILE = path.join(process.cwd(), 'channelConfig.json');

function load() {
  try {
    return fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  } catch (e) {
    console.error('[channel] channelConfig.json read fail:', e);
    return {};
  }
}

function save(obj) {
  fs.writeFileSync(FILE, JSON.stringify(obj, null, 2), 'utf8');
}

module.exports = (client) => {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== '채널') return;

    if (!interaction.guild) {
      return interaction.reply({ content: '서버에서만 사용 가능해요!', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({
        content: '이 명령어는 **서버 관리(Manage Server)** 권한이 필요해요!',
        ephemeral: true,
      });
    }

    const ch = interaction.options.getChannel('채널', true);
    const purpose = interaction.options.getString('용도', true); // 'rankup' / 'music'

    const data = load();
    if (!data[interaction.guild.id]) data[interaction.guild.id] = {};
    data[interaction.guild.id][purpose] = ch.id;
    save(data);

    // ✅ music 채널이면: 음악 패널 생성/갱신
    if (purpose === 'music') {
      await client.music?.updatePanel(interaction.guild.id);
    }

    return interaction.reply({
      content: `채널 설정 완료!♡\n- 용도: **${purpose}**\n- 채널: ${ch}`,
      ephemeral: true,
    });
  });
};