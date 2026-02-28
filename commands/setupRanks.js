// commands/setupRanks.js
// ✅ 완성본: /랭크세팅 동작(설치/제거) 하나로 통합
// ✅ 최신 discord.js: RoleManager#create / Role#edit 에서 colors는 객체로 넣기 (primaryColor)
// ✅ 옵션 캐시 방어(동작/action), fetchMe 사용, 역할 정렬은 setPositions로 한번에

const {
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');

const ROLE_DEFS = [
  { name: 'Iron',      color: 0x6B7280 },
  { name: 'Bronze',    color: 0xB87333 },
  { name: 'Silver',    color: 0xC0C7CF },
  { name: 'Gold',      color: 0xFBBF24 },
  { name: 'Platinum',  color: 0x2DD4BF },
  { name: 'Diamond',   color: 0x60A5FA },
  { name: 'Ascendant', color: 0x22C55E },
  { name: 'Immortal',  color: 0xEF4444 },
  { name: 'Radiant',   color: 0xF59E0B },
];

function norm(s) {
  return String(s ?? '').trim().toLowerCase();
}

module.exports = (client) => {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== '랭크세팅') return;

    if (!interaction.inGuild()) {
      return interaction.reply({
        content: '서버에서만 사용 가능해요!',
        flags: MessageFlags.Ephemeral,
      });
    }

    // ✅ 옵션 캐시 꼬여도 안 터지게 (동작/ action 둘 다 지원 + 기본값)
    const action =
      interaction.options.getString('동작') ??
      interaction.options.getString('action') ??
      'install';

    const guild = interaction.guild;

    // ✅ 봇 멤버 안정적으로
    const me = await guild.members.fetchMe().catch(() => null);
    if (!me) {
      return interaction.reply({
        content: '봇 멤버 정보를 불러오지 못했어요. 잠깐 후 다시 시도해주세요.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const member = interaction.member;

    // 유저 권한
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: '당신에게 **역할 관리(Manage Roles)** 권한이 없습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // 봇 권한
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: '저에게 **역할 관리(Manage Roles)** 권한이 없어 실행할 수 없어요.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // 역할 캐시 최신화
    try { await guild.roles.fetch(); } catch {}

    const nameSet = new Set(ROLE_DEFS.map(d => norm(d.name)));

    // =========================
    // ✅ 제거 모드
    // =========================
    if (action === 'remove') {
      let deleted = 0;
      const failed = [];

      const targetRoles = guild.roles.cache.filter(r => nameSet.has(norm(r.name)));

      for (const role of targetRoles.values()) {
        try {
          await role.delete('Rank setup roles removed');
          deleted++;
        } catch (e) {
          failed.push(`${role.name} (${e?.message ?? e})`);
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0xEF4444)
        .setTitle('RANK ROLES REMOVED')
        .setDescription(`삭제된 티어 역할 │ ${deleted}개`)
        .setTimestamp();

      const extra = failed.length
        ? `\n\n- 실패: ${failed.join(' / ')}`
        : '';

      return interaction.editReply({
        content: extra ? `삭제는 했는데 일부 실패가 있어요.${extra}` : null,
        embeds: [embed],
      });
    }

    // =========================
    // ✅ 설치 모드
    // =========================
    const botTopRole = me.roles.highest;

    const created = [];
    const updated = [];
    const failed = [];

    // 1) 생성/정규화
    for (const def of ROLE_DEFS) {
      const wanted = norm(def.name);
      let role = guild.roles.cache.find((r) => norm(r.name) === wanted);

      try {
        if (!role) {
          role = await guild.roles.create({
            name: def.name,
            // ✅ 최신 discord.js: colors는 객체 형태(Primary)
            colors: { primaryColor: def.color },
            mentionable: false,
            hoist: false,
            reason: 'Voice rank roles setup',
          });
          created.push(role);
        } else {
          const patch = {};
          if (role.name !== def.name) patch.name = def.name;

          // ✅ 기존 색상 읽기(신형 colors 우선, 구형 color fallback)
          const currentPrimary = role.colors?.primaryColor ?? role.color;
          if (currentPrimary !== def.color) patch.colors = { primaryColor: def.color };

          if (Object.keys(patch).length) {
            await role.edit({ ...patch, reason: 'Voice rank roles normalize' });
            updated.push(role);
          }
        }
      } catch (e) {
        failed.push(`${def.name} (${e?.message ?? e})`);
      }
    }

    // 2) 정렬: 봇의 최고 역할 바로 아래에 Radiant -> Iron 순으로
    // ✅ setPositions로 한 번에(레이트리밋/꼬임 최소화)
    try {
      await guild.roles.fetch();

      const desiredHighToLow = [...ROLE_DEFS].reverse()
        .map(d => guild.roles.cache.find(r => norm(r.name) === norm(d.name)))
        .filter(Boolean);

      const basePos = botTopRole?.position - 1;

      if (Number.isFinite(basePos)) {
        const updates = [];
        let pos = basePos;

        for (const role of desiredHighToLow) {
          // 봇 역할보다 위로 올리려 하면 실패하니까 스킵
          if (role.position >= botTopRole.position) continue;

          updates.push({ role: role.id, position: pos });
          pos -= 1;
        }

        if (updates.length) {
          await guild.roles.setPositions(updates, { reason: 'Rank roles ordering' });
        }
      }
    } catch {
      // 정렬 실패는 치명적이진 않아서 무시
    }

    // 3) 결과 안내
    const lines = [];
    lines.push('랭크 역할 세팅 완료했습니다!♡');
    if (created.length) lines.push(`- 생성됨: ${created.map(r => r.name).join(', ')}`);
    if (updated.length) lines.push(`- 업데이트됨: ${updated.map(r => r.name).join(', ')}`);
    if (failed.length) lines.push(`- 실패: ${failed.join(' / ')}`);
    lines.push('');
    lines.push('주의!: **봇의 역할이** 티어 역할들보다 **위**에 있어야 역할 부여/제거가 정상 작동해요!');

    return interaction.editReply({ content: lines.join('\n') });
  });
};