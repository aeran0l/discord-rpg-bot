//로그 필터
//process.removeAllListeners('warning');
//require('./utils/logFilter')();

const { Client, Events, GatewayIntentBits } = require('discord.js');
const { token } = require('./config.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,

    // 음성 추적
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`서버 실행 성공♡ ${readyClient.user.tag}`);
});

client.on('messageCreate', (message) => {
  if (message.content === '메이야') {
    message.reply('네 주인님♡ 도움이 필요하신가요?');
  }
});

client.on('error', console.error);
process.on('unhandledRejection', console.error);

require('./systems/autoRegisterCommands')(client);
require('./systems/voiceRank')(client);
require('./systems/musicPlayer')(client);
require('./systems/musicChatInput')(client);

require('./commands/channel')(client);
require('./commands/resetRank')(client);
require('./commands/setupRanks')(client);
require('./commands/ranking')(client);
require('./commands/myTier')(client);

client.login(token);