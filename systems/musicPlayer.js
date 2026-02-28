// systems/musicPlayer.js
const config = require('../config.json');

const panel = require('./music/musicPanel');
const { initMusicSystem } = require('./music/musicSystem');

module.exports = (client) => {
  initMusicSystem(client, config, panel);
};