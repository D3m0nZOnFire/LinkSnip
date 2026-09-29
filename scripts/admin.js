#!/usr/bin/env node
/**
 * Admin account tool.
 *
 *   npm run admin                     interactive menu
 *   npm run admin -- create [name]    create an admin account
 *   npm run admin -- promote [name]   make an existing user an admin
 *   npm run admin -- reset [name]     set a new password for a user
 *
 * In Docker: docker compose exec linksnip npm run admin
 * Uses the same DATA_DIR as the app, so run it where the app's database lives.
 */
require('dotenv').config({ quiet: true });
const readline = require('readline');

// Keep migration and SQL logging out of the prompts.
const log = console.log;
console.log = () => {};
const adminCommands = require('../services/adminCommands');
const { DB_PATH } = require('../config/paths');
console.log = log;

const COMMANDS = {
  create: 'Create an admin account',
  promote: 'Make an existing user an admin',
  reset: "Reset a user's password"
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let muted = false;
rl._writeToOutput = (text) => { if (!muted) rl.output.write(text); };

// Buffer lines ourselves: with piped input (docker compose exec -T, scripts) readline
// emits every line at once and rl.question() would drop the ones not yet asked for.
const lines = [];
const waiters = [];
let inputEnded = false;
rl.on('line', line => (waiters.length ? waiters.shift().resolve(line) : lines.push(line)));
rl.on('close', () => {
  inputEnded = true;
  while (waiters.length) waiters.shift().reject(new Error('Input ended before all questions were answered.'));
});

async function ask(question, { hidden = false } = {}) {
  rl.output.write(question);
  if (hidden && process.stdin.isTTY) muted = true;
  try {
    const answer = await new Promise((resolve, reject) => {
      if (lines.length) return resolve(lines.shift());
      if (inputEnded) return reject(new Error('Input ended before all questions were answered.'));
      waiters.push({ resolve, reject });
    });
    return answer.trim();
  } finally {
    if (muted) {
      muted = false;
      rl.output.write('\n');
    }
  }
}

async function askNewPassword() {
  const password = await ask('New password: ', { hidden: true });
  const confirm = await ask('Repeat password: ', { hidden: true });
  if (password !== confirm) throw new Error('Passwords do not match.');
  return password;
}

async function run(command, username) {
  if (!command) {
    console.log(`LinkSnip admin tool (database: ${DB_PATH})\n`);
    Object.entries(COMMANDS).forEach(([name, text], i) => console.log(`  ${i + 1}) ${text}`));
    const choice = await ask('\nChoose 1-3: ');
    command = Object.keys(COMMANDS)[Number(choice) - 1];
    if (!command) throw new Error('Nothing chosen.');
  }
  if (!COMMANDS[command]) {
    throw new Error(`Unknown command "${command}". Use one of: ${Object.keys(COMMANDS).join(', ')}.`);
  }

  username = username || await ask('Username: ');

  if (command === 'create') {
    const user = await adminCommands.createAdmin(username, await askNewPassword());
    console.log(`✅ Admin "${user.username}" created.`);
  } else if (command === 'promote') {
    const user = adminCommands.promote(username);
    console.log(`✅ "${user.username}" is now an admin.`);
  } else {
    const user = await adminCommands.resetPassword(username, await askNewPassword());
    console.log(`✅ Password for "${user.username}" updated.`);
  }
}

run(process.argv[2], process.argv[3])
  .then(() => { rl.close(); process.exit(0); })
  .catch(error => { console.error(`❌ ${error.message}`); rl.close(); process.exit(1); });
