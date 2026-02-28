// commands/commandsData.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = [
  new SlashCommandBuilder()
    .setName('랭킹')
    .setDescription('서버 음성 채팅 랭킹 확인'),

  new SlashCommandBuilder()
    .setName('내티어')
    .setDescription('현재 내 티어 확인'),

  new SlashCommandBuilder()
    .setName('랭크세팅')
    .setDescription('티어 역할 설치/제거')
    .addStringOption(opt =>
      opt
        .setName('action')
        .setNameLocalizations({ ko: '선택' })
        .setDescription('설치 또는 제거')
        .setDescriptionLocalizations({ ko: '설치 또는 제거' })
        .setRequired(true)
        .addChoices(
          { name: '설치', value: 'install' },
          { name: '제거', value: 'remove' }
        )
    ),

  new SlashCommandBuilder()
    .setName('reset')
    .setNameLocalizations({ ko: '초기화' })
    .setDescription('해당 유저의 랭크를 초기화합니다')
    .addUserOption(opt =>
      opt
        .setName('user')
        .setNameLocalizations({ ko: '유저' })
        .setDescription('초기화할 대상')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('채널')
    .setDescription('봇 기능에 사용할 채널을 설정합니다')
    .addChannelOption(opt =>
      opt
        .setName('채널')
        .setDescription('설정할 채널')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('용도')
        .setDescription('채널 용도 선택')
        .setRequired(true)
        .addChoices(
          { name: '승급', value: 'rankup' },
          { name: '음악', value: 'music' } // ✅ 추가
        )
    ),
].map(cmd => cmd.toJSON());