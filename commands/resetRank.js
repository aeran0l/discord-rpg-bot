const fs = require('fs');
const { EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const DATA_PATH = './data.json';

// 삭제할 티어 역할 이름들
const ROLE_NAMES = [
  'Iron',
  'Bronze',
  'Silver',
  'Gold',
  'Platinum',
  'Diamond',
  'Ascendant',
  'Immortal',
  'Radiant',
];

module.exports = (client) => {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'reset') return;

    if (!interaction.inGuild()) {
      return interaction.reply({
        content: '서버에서만 사용해주세요!.',
        flags: MessageFlags.Ephemeral,
      });
    }


    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: '역할 관리 권한이 필요합니다.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const targetUser = interaction.options.getUser('user', true);

    await interaction.deferReply();

    const guild = interaction.guild;
    const member = await guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      return interaction.editReply('유저를 찾을 수 없습니다.');
    }

    let removedRoles = 0;

    const roles = guild.roles.cache.filter(r =>
      ROLE_NAMES.includes(r.name)
    );

    for (const role of roles.values()) {
      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role);
        removedRoles++;
      }
    }


    let data = {};
    try {
      data = fs.existsSync(DATA_PATH)
        ? JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'))
        : {};
    } catch {
      data = {};
    }

    if (data[targetUser.id]) {
      data[targetUser.id].totalMinutes = 0;
    }

    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');

    // ===== 결과 임베드 =====
    const embed = new EmbedBuilder()
      .setColor(0xF59E0B)
      .setTitle('RANK RESET')
      .setDescription(
        `👤 대상자 │ ${targetUser}\n` +
        `🧹 제거된 역할 │ ${removedRoles}개\n` +
        `⏱ 음성시간 │ 초기화 완료♡`
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  });
};