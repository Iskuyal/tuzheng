"""从已验证的干净提交生成正式网盘包；只在本机打包，不上传或提交表单。"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile
from urllib.parse import urlparse

root = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--date', required=True, help='材料日期，例如2026-11-11')
parser.add_argument('--public-video-url', help='已核对的公开视频HTTPS播放页，可省略')
args = parser.parse_args()
from datetime import date
date.fromisoformat(args.date)
if args.public_video_url:
    video_url = urlparse(args.public_video_url)
    if video_url.scheme != 'https' or not video_url.netloc:
        raise SystemExit('公开视频链接必须为有效的HTTPS播放页。')


def git(*arguments):
    return subprocess.check_output(['git', *arguments], cwd=root, text=True, encoding='utf-8').strip()


def digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(block)
    return checksum.hexdigest()


if git('status', '--porcelain'):
    raise SystemExit('请先提交本轮全部改动；正式包必须来自干净的同一提交。')
sha = git('rev-parse', 'HEAD')
handoff = root / '.cache/closeout-packages' / sha
subprocess.run(['node', '--import', 'tsx', 'docs/submission/closeout/prepare-package.mjs',
                '--verify', str(handoff)], cwd=root, check=True)
base = json.loads((handoff / 'manifest.json').read_text(encoding='utf-8'))
if base['sourceSha'] != sha:
    raise SystemExit('固定交付包的提交与当前源码不一致。')
registry = json.loads((root / 'docs/submission/materials.json').read_text(encoding='utf-8'))
directory = root / f'.cache/submission-ready-{args.date}' / sha
directory.mkdir(parents=True, exist_ok=False)
files = directory / 'files'
files.mkdir()
mapping = {
    '01_图证作品介绍.pdf': 'docs/submission/tuzheng-project-introduction.pdf',
    '02_图证技术报告.pdf': registry['technicalReport']['path'],
    '03_图证演示视频.mp4': registry['formalVideo']['path'],
    '04_图证完整源码.zip': None,
    '05_运行与提交说明.md': f'docs/submission/formal-submit-guide-{args.date}.md',
    '06_评审意见落实说明.md': f'docs/submission/reviewer-feedback-{args.date}.md',
}
entries = []
for name, source in mapping.items():
    artifact_path = f'materials/{source}' if source else 'source.zip'
    expected = next(item for item in base['files'] if item['path'] == artifact_path)
    shutil.copyfile(handoff / artifact_path, files / name)
    if digest(files / name) != expected['sha256'] or (files / name).stat().st_size != expected['bytes']:
        raise SystemExit(f'复制后文件校验失败：{name}')
    entries.append({'path': name, 'sourcePath': source or 'git archive HEAD',
                    'bytes': expected['bytes'], 'sha256': expected['sha256']})
if (files / '01_图证作品介绍.pdf').stat().st_size >= 100_000_000:
    raise SystemExit('作品介绍达到或超过100MB，请减小后再提交。')
manifest = {
    'kind': 'tuzheng-formal-submission-package', 'date': args.date, 'sourceSha': sha,
    'candidateHash': base['candidateHash'], 'gitHistoryUrl': 'https://github.com/Iskuyal/tuzheng',
    'sourceCommitUrl': f'https://github.com/Iskuyal/tuzheng/commit/{sha}',
    'submissionFormUrl': 'https://f.kdocs.cn/ksform/w/write/SltUAlpn',
    'deadline': '2026-11-18T15:00:00+08:00', 'readyForCloudUpload': True,
    'formSubmitted': False, 'netdiskLink': None, 'publicVideoLink': args.public_video_url,
    'videoIncludesShareFeature': False, 'acceptance': base['acceptance'],
    'files': entries, 'manifestSelfHashExcluded': True, 'modelRequests': 0,
}
(files / '07_文件校验.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
archive = directory / f'岭南凤翔团队_图证_C组_正式省赛材料_{args.date.replace("-", "")}.zip'
with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_STORED, allowZip64=True) as bundle:
    for item in sorted(files.iterdir()):
        bundle.write(item, item.name)
with zipfile.ZipFile(archive) as bundle:
    if bundle.testzip() is not None or set(bundle.namelist()) != {*mapping, '07_文件校验.json'}:
        raise SystemExit('ZIP目录或CRC校验失败。')
    for entry in entries:
        with bundle.open(entry['path']) as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != entry['sha256']:
                raise SystemExit(f'ZIP内部文件校验失败：{entry["path"]}')
archive_hash = digest(archive)
(directory / 'ZIP-SHA256.txt').write_text(f'{archive_hash}  {archive.name}\n', encoding='utf-8')
print(json.dumps({'path': str(archive), 'bytes': archive.stat().st_size, 'sha256': archive_hash,
                  'sourceSha': sha, 'files': 7, 'formSubmitted': False}, ensure_ascii=False, indent=2))
