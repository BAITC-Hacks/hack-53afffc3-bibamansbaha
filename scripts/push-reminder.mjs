import fs from 'node:fs';
const [statePath, logPath, mode] = process.argv.slice(2);
const test = mode === '--test';
const marks = test ? [0.01, 0.02, 0.03] : [12, 15, 18];
let seen = new Set();
let last = '';
function log(message) { fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`); }
log(`START pid=${process.pid} mode=${test ? 'test' : 'active'}`);
const timer = setInterval(() => {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8').replace(/^\uFEFF/, ''));
    if (last !== state.confirmedAt) { last = state.confirmedAt; seen = new Set(); }
    const minutes = (Date.now() - Date.parse(last)) / 60000;
    for (let i = 0; i < marks.length; i++) if (minutes >= marks[i] && !seen.has(i)) {
      log(`${['PREPARE', 'CHECKPOINT', 'OVERDUE_RISK'][i]} elapsed=${minutes.toFixed(2)}m branch=${state.branch} sha=${state.sha}`);
      seen.add(i);
    }
    if (test && seen.size === marks.length) { clearInterval(timer); log('TEST_OK'); }
  } catch { log('STATE_UNAVAILABLE'); }
}, test ? 200 : 30000);
