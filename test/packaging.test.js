const test = require('node:test');
const assert = require('node:assert');
const { dependencies } = require('../package.json');

// electron-builder packs only declared dependencies, so a required peer missing here breaks the installed app.
// Baileys needs sharp only for media thumbnails; Focus sends text.
const UNUSED_PEERS = { baileys: ['sharp'] };

test('required peer dependencies are declared as dependencies', () => {
  for (const name of Object.keys(dependencies)) {
    const { peerDependencies = {}, peerDependenciesMeta = {} } = require(`${name}/package.json`);
    const required = Object.keys(peerDependencies).filter(
      (peer) => !peerDependenciesMeta[peer]?.optional && !UNUSED_PEERS[name]?.includes(peer),
    );
    for (const peer of required) assert.ok(dependencies[peer], `${name} needs ${peer} in dependencies`);
  }
});
