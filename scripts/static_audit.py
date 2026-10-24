"""Release-only checks. Does not import/execute the bot, install packages or use the network.

Node is invoked exclusively with --check (syntax parsing); Python uses ast.parse.
Reports contain paths, line numbers and risk categories, never matched values.
"""
from pathlib import Path
import argparse
import ast
import json
import os
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
PARSER = argparse.ArgumentParser(description=__doc__)
PARSER.add_argument('--json', action='store_true', help='print machine-readable results')
ARGS = PARSER.parse_args()
issues, checks = [], {}

def add(path, kind, line=None):
    issues.append({'file': str(path), 'risk': kind, **({'line': line} if line else {})})

forbidden_dirs = {'.git', 'node_modules', 'data', 'state', 'logs', 'cache', '.cache',
                  'backups', 'fixtures', '_runtime', '.downloads', 'gateway', 'vendor', '__pycache__', '.venv'}
forbidden_ext = {'.exe','.dll','.node','.wasm','.so','.zip','.7z','.db','.sqlite','.png','.jpg',
                 '.jpeg','.gif','.webp','.mp3','.wav','.silk','.mp4','.pdf','.docx','.xlsx','.pptx','.pyc'}
files = []
required = ['README.md','LICENSE','.gitignore','.env.example','package.json',
            'ai-companion-kit/packages/companion/config.example.json',
            'ai-companion-kit/packages/companion/role.example.md',
            'local/features.mjs','local/autonomy.mjs','local/qzone-adapter.mjs',
            'docs/CONFIGURATION.md','docs/QZONE.md','docs/THIRD_PARTY_NOTICES.md']
for rel in required:
    if not (ROOT/rel).is_file():add(rel,'required release file missing')
for d, dirs, names in os.walk(ROOT, followlinks=False):
    for name in list(dirs):
        p = Path(d) / name
        if p.is_symlink() or name in forbidden_dirs:
            add(p.relative_to(ROOT), 'forbidden runtime/history directory or symlink')
            dirs.remove(name)
    for name in names:
        p = Path(d) / name
        rel = p.relative_to(ROOT).as_posix()
        if p.is_symlink():
            add(rel, 'symlink'); continue
        if name in {'_prepare_release.py','_source_manifest.json','_preparation_summary.json'}:
            add(rel, 'preparation artifact must be removed'); continue
        files.append(p)
        if p.suffix.lower() in forbidden_ext or name in {'.env','config.json','role.md','features-settings.json'} or (name.startswith('.env.') and name != '.env.example'):
            add(rel, 'private configuration, binary or user media')

patterns = [
    ('credential-shaped value', r'\bsk-[A-Za-z0-9_-]{12,}|\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    ('JWT-shaped token', r'\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'),
    ('absolute user/machine path', r'(?<![\w])[A-Za-z]:[\\/]|/(?:home|Users)/[A-Za-z0-9_.-]+'),
    ('non-loopback private network endpoint', r'(?:https?|wss?)://(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)'),
    ('URL credential or query secret', r'(?:https?|wss?)://[^\s/@]+:[^\s/@]+@|[?&](?:access_token|api_key|secret|password)=[A-Za-z0-9_%.-]{8,}'),
]
js, json_count, python_count = [], 0, 0
for p in files:
    rel = p.relative_to(ROOT).as_posix()
    try: s = p.read_text('utf-8')
    except (UnicodeError, OSError):
        add(rel, 'non-UTF8/unreviewed binary file'); continue
    if '\0' in s: add(rel, 'NUL/binary content')
    # Audit rule definitions are source patterns, not matching data.
    if rel != 'scripts/static_audit.py':
        for kind, pattern in patterns:
            for i, line in enumerate(s.splitlines(), 1):
                if re.search(pattern, line): add(rel, kind, i)
        for i,line in enumerate(s.splitlines(),1):
            for match in re.finditer(r'''(?:["']?(?:apiKey|accessToken|authToken|password|secret|cookie|sessionKey)["']?\s*[:=]\s*["'])([^"'\n]+)["']''',line,re.I):
                value = match.group(1)
                if len(value)>=8 and not re.search(r'REPLACE|YOUR_|EXAMPLE|redact|\$\{|\bBearer\b|process\.|this\.|cfg\.',value,re.I):
                    add(rel,'nonempty literal credential field; manual review required',i)
    if p.suffix == '.json':
        try:
            value = json.loads(s)
            json_count += 1
            if p.name.endswith('.example.json'):
                def inspect_template(item, key=''):
                    if isinstance(item,dict):
                        for k,v in item.items():inspect_template(v,k)
                    elif isinstance(item,list):
                        for v in item:inspect_template(v,key)
                    elif isinstance(item,str) and item:
                        if re.fullmatch(r'apiKey|accessToken|authToken|password|secret|cookie|phoneSerial',key,re.I):
                            add(rel,'example contains nonempty secret/device field')
                        if re.fullmatch(r'ownerIds|botQQ|private|groups|ownerQQ|uin',key,re.I) and not re.fullmatch(r'100000000[1-9]',item):
                            add(rel,'example contains non-synthetic account identifier')
                inspect_template(value)
        except ValueError: add(rel, 'invalid JSON')
    if p.name == '.env.example':
        for i,line in enumerate(s.splitlines(),1):
            if '=' not in line or line.lstrip().startswith('#'):continue
            key,value=line.split('=',1)
            if re.search(r'KEY|TOKEN|SECRET|PASSWORD|COOKIE|SERIAL',key) and value.strip():
                add(rel,'environment example contains nonempty credential/device value',i)
    if p.suffix == '.py':
        try: ast.parse(s,filename=rel); python_count += 1
        except SyntaxError: add(rel, 'Python syntax error')
    if p.suffix in {'.js','.mjs','.cjs'}:
        js.append(p)
        # Only statically declared imports and literal dynamic imports. No modules are loaded.
        for spec in re.findall(r'''(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']''',s):
            if not spec.startswith('.') or 'node_modules/' in spec: continue
            target = (p.parent/spec).resolve()
            if not target.is_relative_to(ROOT) or not target.is_file():
                add(rel, 'missing/outside relative module import')

node = shutil.which('node')
if node:
    for p in js:
        result = subprocess.run([node,'--check',str(p)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=30)
        if result.returncode: add(p.relative_to(ROOT),'JavaScript syntax error')
else:
    add('environment','node unavailable: JavaScript syntax checks incomplete')
checks.update(files=len(files), json_parsed=json_count, python_ast_parsed=python_count, javascript_syntax_parsed=len(js) if node else 0)
template_path=ROOT/'ai-companion-kit/packages/companion/config.example.json'
template=json.loads(template_path.read_text('utf-8'))
for key in ['toolModule','autonomyModule']:
    target=(template_path.parent/template[key]).resolve()
    if not target.is_relative_to(ROOT) or not target.is_file():add(template_path.relative_to(ROOT),'missing configured runtime module: '+key)
if template.get('ownerIds') or template.get('botQQ') or template.get('allow',{}).get('private') or template.get('allow',{}).get('groups'):
    add(template_path.relative_to(ROOT),'default deployment template must leave accounts and allowlists empty')
checks['required_files']=len(required)

# Verify installed-module imports refer to declared dependencies. Installation is not performed.
kit = json.loads((ROOT/'ai-companion-kit/package-lock.json').read_text('utf-8'))
media = json.loads((ROOT/'local/media-runtime/package-lock.json').read_text('utf-8'))
for rel,lock in [('ai-companion-kit/package-lock.json',kit),('local/media-runtime/package-lock.json',media)]:
    for key,entry in lock['packages'].items():
        if entry.get('link') and not (ROOT/rel).parent.joinpath(entry['resolved']).is_dir(): add(rel,'missing lockfile workspace')
        if key.startswith('node_modules/') and not entry.get('link'):
            if entry.get('license') not in {'MIT','ISC','BSD-2-Clause','BSD-3-Clause','Python-2.0'}: add(rel,'unknown/restricted dependency license')
            resolved = entry.get('resolved','')
            if resolved and not resolved.startswith('https://registry.npmjs.org/'): add(rel,'nonstandard dependency registry')
            if '@snowluma/' in key: add(rel,'restricted/unresolved third-party dependency')
for p in js:
    for spec in re.findall(r'''(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']''',p.read_text('utf-8')):
        if '/node_modules/' not in spec: continue
        dep = spec.split('/node_modules/',1)[1]
        name = '/'.join(dep.split('/')[:2]) if dep.startswith('@') else dep.split('/')[0]
        lock = media if 'media-runtime/' in spec else kit
        if 'node_modules/'+name not in lock['packages']: add(p.relative_to(ROOT),'undeclared installed-module import')

# Test .gitignore with real Git matching in disposable metadata inside this release.
git = shutil.which('git')
ignored = ['.env','.env.production','ai-companion-kit/packages/companion/config.json',
           'ai-companion-kit/packages/companion/role.md','local/features-settings.json','data/person.json',
           'ai-companion-kit/packages/companion/data/sessions/private-1000000001/turns.jsonl',
           'logs/chat.log','state/session.json','local/backups/config.json','gateway/onebot.json',
           '.downloads/archive.zip','node_modules/ws/index.js','local/media-runtime/node_modules/silk-wasm/lib/silk.wasm',
           'media/private.png','local/role.private.md','secret.pem','private.db','private.db-wal',
           '.npmrc','.netrc','.ssh/id_ed25519','local/config.production.json','chat.log.1']
published = ['.env.example','README.md','LICENSE','package.json','ai-companion-kit/package-lock.json',
             'local/media-runtime/package-lock.json','ai-companion-kit/packages/companion/config.example.json',
             'ai-companion-kit/packages/companion/role.example.md','local/features-settings.example.json',
             'examples/sticker-library.example.json','local/features.mjs']
if git:
    with tempfile.TemporaryDirectory(prefix='.audit-git-',dir=ROOT) as temp:
        subprocess.run([git,'init','--quiet',temp],check=True,capture_output=True)
        command=[git,'-C',str(ROOT),'--git-dir='+str(Path(temp)/'.git'),'--work-tree='+str(ROOT),'check-ignore','--no-index','--',*ignored,*published]
        result=subprocess.run(command,capture_output=True,text=True)
        found=set(result.stdout.splitlines())
        for rel in ignored:
            if rel not in found:add('.gitignore','private/runtime path not ignored: '+rel)
        for rel in published:
            if rel in found:add('.gitignore','required distribution file ignored: '+rel)
        if result.returncode not in (0,1):add('.gitignore','git matching failed')
    checks['gitignore_cases']=len(ignored+published)
else:add('environment','git unavailable: ignore verification incomplete')

result={'status':'PASS' if not issues else 'FAIL','checks':checks,'issues':issues,
        'scope':'static file parsing only; no project execution, installation or network access'}
if ARGS.json:print(json.dumps(result,ensure_ascii=False,indent=2))
else:
    print(result['status'],json.dumps(checks,ensure_ascii=False))
    for issue in issues: print(json.dumps(issue,ensure_ascii=False))
raise SystemExit(1 if issues else 0)
