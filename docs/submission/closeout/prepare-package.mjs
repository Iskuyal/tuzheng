import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCandidate, verifyCandidate, writeNewJson } from '../../../scripts/candidate-preflight.ts';
import { printMaterialCheck, verifySubmissionMaterials } from '../../../scripts/submission-materials.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
process.chdir(root);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
const usage = 'node --import tsx docs/submission/closeout/prepare-package.mjs --check-materials [--json] | --prepare | --verify <package-directory>';
const args = process.argv.slice(2);
const legacyMaterials = [
  'README.md', 'docs/submission/web-match-competition-report.pdf',
  'docs/submission/competition-report.html', 'docs/submission/tuzheng-product-demo-90s.mp4',
  'docs/submission/tuzheng-product-demo-uncut.webm', 'docs/submission/demo-video-script.md',
  'docs/submission/closeout-2026-10-15.md', 'docs/submission/closeout/README.md',
  'docs/submission/closeout/accounting-handoff.md', 'docs/submission/closeout/acceptance-receipt.json',
  'docs/submission/closeout/verify-windows.mjs',
];
function inside(directory, path) {
  if (isAbsolute(path)) throw new Error('Manifest paths must be relative.');
  const target = resolve(directory, path);
  if (!target.startsWith(resolve(directory) + sep)) throw new Error('Manifest path escapes package directory.');
  return target;
}
async function verify(directory) {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
  if (manifest.kind !== 'tuzheng-local-handoff' || ![1, 2].includes(manifest.schemaVersion) || !/^[a-f0-9]{40}$/.test(manifest.sourceSha)) throw new Error('Invalid package manifest.');
  if (manifest.sourceSha !== git('rev-parse', 'HEAD') || git('status', '--porcelain')) throw new Error('Package verification requires its original clean checkout.');
  const materials = manifest.schemaVersion === 1 ? legacyMaterials : (await verifySubmissionMaterials(root)).files.map(file => file.path);
  const required = ['source.zip', 'candidate.json', ...materials.map(path => `materials/${path}`)];
  if (JSON.stringify(manifest.files.map(item => item.path).sort()) !== JSON.stringify(required.sort())) throw new Error('Missing or unexpected package files.');
  for (const item of manifest.files) {
    const bytes = readFileSync(inside(directory, item.path));
    if (bytes.length !== item.bytes || hash(bytes) !== item.sha256) throw new Error(`Package integrity failed: ${item.path}`);
    if (item.sourcePath) {
      const original = execFileSync('git', ['show', `${manifest.sourceSha}:${item.sourcePath}`], { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
      if (hash(original) !== item.sha256) throw new Error(`Material differs from source commit: ${item.sourcePath}`);
    }
  }
  const candidate = await verifyCandidate(JSON.parse(readFileSync(resolve(directory, 'candidate.json'), 'utf8')));
  if (hash(JSON.stringify(candidate)) !== manifest.candidateHash || candidate.provenance.code.dirty) throw new Error('Candidate provenance mismatch.');
  console.log(`Package verified: ${manifest.sourceSha}; ${manifest.files.length} files; no model requests.`);
}
if (args[0] === '--check-materials' && (args.length === 1 || args.length === 2 && args[1] === '--json')) {
  printMaterialCheck(await verifySubmissionMaterials(root), args.includes('--json'));
} else if (args[0] === '--verify' && args.length === 2) {
  await verify(resolve(args[1]));
} else if (args[0] === '--prepare' && args.length === 1) {
  if (git('status', '--porcelain')) throw new Error('Commit all intended changes before preparing a handoff package.');
  const checked = await verifySubmissionMaterials(root);
  const materials = checked.files.map(file => file.path);
  const sourceSha = git('rev-parse', 'HEAD');
  const directory = resolve(root, '.cache/closeout-packages', sourceSha);
  mkdirSync(dirname(directory), { recursive: true });
  mkdirSync(directory); // Refuse to overwrite a previous package, including incomplete attempts.
  const files = [];
  const record = (path, sourcePath) => {
    const bytes = readFileSync(resolve(directory, path));
    files.push({ path, ...(sourcePath ? { sourcePath } : {}), bytes: bytes.length, sha256: hash(bytes) });
  };
  execFileSync('git', ['archive', '--format=zip', `--output=${resolve(directory, 'source.zip')}`, sourceSha], { windowsHide: true });
  record('source.zip');
  for (const sourcePath of materials) {
    const target = inside(directory, `materials/${sourcePath}`);
    mkdirSync(dirname(target), { recursive: true });
    const original = execFileSync('git', ['show', `${sourceSha}:${sourcePath}`], { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    writeFileSync(target, original, { flag: 'wx' });
    record(relative(directory, target).split(sep).join('/'), sourcePath);
  }
  const candidate = await prepareCandidate();
  await writeNewJson(resolve(directory, 'candidate.json'), candidate);
  record('candidate.json');
  await writeNewJson(resolve(directory, 'manifest.json'), {
    schemaVersion: 2, kind: 'tuzheng-local-handoff', sourceSha, createdAt: new Date().toISOString(),
    candidateHash: hash(JSON.stringify(candidate)), modelRequests: 0,
    acceptance: checked.acceptance,
    note: 'Local handoff only. Current silent formal video and voiceover material included; Mandarin audio and final human acceptance remain pending. GitHub retains Git history.', files,
  });
  await verify(directory);
  console.log(directory);
} else {
  throw new Error(usage);
}
