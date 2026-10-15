import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { arch, release } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
process.chdir(root);
const args = process.argv.slice(2);
if (args.some(arg => !['--install', '--local-rehearsal'].includes(arg)) || new Set(args).size !== args.length) throw new Error('Use --install to run npm ci; --local-rehearsal labels a first-machine rehearsal.');
if (process.platform !== 'win32') throw new Error('This acceptance entry requires Windows.');
const npmCli = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
if (!existsSync(npmCli)) throw new Error('npm CLI was not found next to Node; use the standard Node 24 installation.');
if (!args.includes('--install') && !existsSync('node_modules')) throw new Error('Run again with --install to install the locked dependencies.');
for (const port of [3001, 5173, 3107, 5187]) {
  await new Promise((done, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is occupied; this script will not stop other processes or reuse their server.`)));
    server.listen(port, '127.0.0.1', () => server.close(done));
  });
}
const directory = resolve('.cache/windows-acceptance', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(directory, { recursive: true });
const report = {
  schemaVersion: 1, kind: 'offline-windows-checks', startedAt: new Date().toISOString(),
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
  environment: { platform: process.platform, windowsRelease: release(), arch: arch(), node: process.version },
  context: args.includes('--local-rehearsal') ? 'local-rehearsal' : 'operator-must-confirm-second-machine',
  secondMachineAttested: false, modelRequests: 0, humanProductWalkthrough: 'pending', steps: [], state: 'running',
};
const save = () => writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
save();
const steps = [
  ...(args.includes('--install') ? [['ci']] : []),
  ['run', 'docs:check'], ['test'], ['run', 'test:recording'], ['run', 'eval:samples'],
  ['run', 'eval:holdout', '--', '--verify'], ['run', 'eval:source-audit', '--', '--check-only'],
  ['run', 'build'], ['run', 'verify:model-config'], ['run', 'test:e2e'],
];
for (const [index, command] of steps.entries()) {
  console.log(`Offline check ${index + 1}/${steps.length}: npm ${command.join(' ')}`);
  const result = spawnSync(process.execPath, [npmCli, ...command], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 12 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
  // Logs stay in the local cache; no settings, environment dump or model request is collected.
  writeFileSync(resolve(directory, `step-${index + 1}.txt`), (result.stdout ?? '') + (result.stderr ?? ''));
  report.steps.push({ command: ['npm', ...command], exitCode: result.status, signal: result.signal, passed: result.status === 0 && !result.error });
  save();
  if (result.status !== 0 || result.error) { report.state = 'failed'; report.completedAt = new Date().toISOString(); save(); console.error(`Stopped; inspect ${directory}`); process.exit(1); }
}
report.state = 'offline-checks-passed'; report.completedAt = new Date().toISOString(); save();
console.log(`Offline checks passed: ${directory}. Second-machine identity and manual product walkthrough remain pending.`);
