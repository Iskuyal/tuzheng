"""按干净提交生成预指导网盘包；不上传、不填表，不含本机密钥或缓存。"""
import hashlib
import json
import pathlib
import shutil
import subprocess
import zipfile

root = pathlib.Path(__file__).resolve().parents[3]
def git(*args):
    return subprocess.check_output(['git', *args], cwd=root, text=True, encoding='utf-8').strip()
def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

if git('status', '--porcelain'):
    raise SystemExit('请先提交本轮材料，不能把工作区文件混入固定版本包。')
sha = git('rev-parse', 'HEAD')
handoff = root / '.cache/closeout-packages' / sha
subprocess.run(['node', '--import', 'tsx', 'docs/submission/closeout/prepare-package.mjs', '--verify', str(handoff)], cwd=root, check=True)
base_manifest = json.loads((handoff / 'manifest.json').read_text(encoding='utf-8'))
if base_manifest['sourceSha'] != sha:
    raise SystemExit('固定交付包与当前提交不一致。')
directory = root / '.cache/submission-ready-2026-10-29' / sha
directory.mkdir(parents=True, exist_ok=False)
files = directory / 'files'
files.mkdir()
mapping = {
    '01_图证作品介绍.pdf': 'docs/submission/tuzheng-project-introduction.pdf',
    '02_图证技术报告.pdf': 'docs/submission/web-match-competition-report.pdf',
    '03_图证演示视频.mp4': 'docs/submission/tuzheng-competition-demo-2026-10-28.mp4',
}
entries = []
for name, source in mapping.items():
    shutil.copyfile(handoff / 'materials' / source, files / name)
    expected = next(item for item in base_manifest['files'] if item.get('sourcePath') == source)
    if digest(files / name) != expected['sha256']:
        raise SystemExit('材料复制后指纹不一致：' + name)
    entries.append({'path': name, 'sourcePath': source, 'bytes': (files / name).stat().st_size, 'sha256': expected['sha256']})
shutil.copyfile(handoff / 'source.zip', files / '04_图证完整源码.zip')
source_hash = digest(files / '04_图证完整源码.zip')
if source_hash != next(item['sha256'] for item in base_manifest['files'] if item['path'] == 'source.zip'):
    raise SystemExit('源码ZIP复制后指纹不一致。')
entries.append({'path': '04_图证完整源码.zip', 'bytes': (files / '04_图证完整源码.zip').stat().st_size, 'sha256': source_hash})
repo = 'https://github.com/Iskuyal/tuzheng'
(files / '05_运行与提交说明.md').write_text(f'''# 图证预指导材料

固定源码提交：{sha}
公开仓库及完整Git历史：{repo}
本包为预指导材料，不代表已提交表单。

01为表单第6项附件，最多一个、单个100MB以内；02为完整技术报告；03须另行上传B站、抖音等公开视频平台，再把播放页链接填入第7项；04是完整源码快照，解压后包含README、环境说明、依赖、样例和证据。源码ZIP不含.git历史，完整历史在上述公开仓库。

Windows安装Node.js 24和npm，在源码根目录运行npm ci、npm run dev，打开http://127.0.0.1:5173。预置图内样例不调用模型；主动模型操作需要自己的合法配置和预算，包中没有真实Key。参考README及docs/DEVELOPMENT.md、docs/MODEL-CONFIG.md。

将本ZIP上传主流网盘，分享有效链接至第5项，建议长期有效并附提取码。不能把本ZIP传到第6项，也不能用百度网盘视频链接填第7项。预指导截止页面显示为2026-10-31 15:00:00，每队由指定一人提交一次；预指导后仍需于2026-11-18前按个人中心正式入口另行提交省赛作品。

本轮未登录WPS、上传网盘或视频平台、填写UID/手机号或点击提交。提交前由指定成员核对两类真实链接，保存成功回执。h09口径已在holdout-v2中澄清，v1及原判保留；代理复核不是人工签字或正式模型成绩。
''', encoding='utf-8')
(files / '07_表单填写参考.txt').write_text('''1.成员UID：由指定提交人填写实际赛事UID
2.团队名称：岭南凤翔团队
3.学校：岭南职业技术学院（清远校区）
4.联系人手机号：由指定提交人填写已核对的实际号码
5.完整作品链接：待将本完整ZIP上传网盘后填写，附实际提取码（如有）
6.作品介绍文档：上传01_图证作品介绍.pdf
7.演示视频地址：待将03_图证演示视频.mp4上传公开平台、审核并确认能播放后填写

团队已确认：此前未发表、未获奖；团队原创，仅使用开源依赖。
以上空缺不是已提交结果，不得用示例URL或猜测的UID替代。
''', encoding='utf-8')
for name in ['05_运行与提交说明.md', '07_表单填写参考.txt']:
    entries.append({'path': name, 'bytes': (files / name).stat().st_size, 'sha256': digest(files / name)})
manifest = {'kind': 'tuzheng-pre-guidance-cloud-upload-package', 'date': '2026-10-29', 'sourceSha': sha,
            'candidateHash': base_manifest['candidateHash'], 'gitHistoryUrl': repo,
            'guideUrl': f'{repo}/blob/{sha}/docs/submission/pre-guidance-submit-guide.md',
            'readyForCloudUpload': True, 'formSubmitted': False, 'netdiskLink': None, 'publicVideoLink': None,
            'namingIsProjectSuggestion': True, 'fullZipSizeLimitFoundOnPages': False,
            'files': entries, 'manifestSelfHashExcluded': True, 'modelRequests': 0}
(files / '06_文件校验.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
archive = directory / '岭南凤翔团队_图证_C组_预指导材料_20261029.zip'
with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_STORED, allowZip64=True) as z:
    for item in sorted(files.iterdir()):
        z.write(item, item.name)
with zipfile.ZipFile(archive) as z:
    if z.testzip() is not None or len(z.namelist()) != 7:
        raise SystemExit('ZIP完整性检查失败。')
archive_hash = digest(archive)
(directory / 'ZIP-SHA256.txt').write_text(archive_hash + '  ' + archive.name + '\n', encoding='utf-8')
print(json.dumps({'path': str(archive), 'bytes': archive.stat().st_size, 'sha256': archive_hash,
                  'sourceSha': sha, 'files': 7, 'formSubmitted': False}, ensure_ascii=False, indent=2))
