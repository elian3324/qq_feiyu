// A selectable, coherent native bundle. The original bundle is kept for rollback.
const fs = require('node:fs');
const path = require('node:path');

function readSelection(base) {
  const file=path.join(base,'runtime-profile.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : {profile:'bundled'};
}

function explicitDesktopRoot(selection) {
  if (selection.desktopRoot === undefined) return undefined;
  if (selection.profile !== 'desktop-framework') throw new Error('External QQ roots require desktop-framework');
  const root=selection.desktopRoot;
  if (typeof root !== 'string' || !path.isAbsolute(root) || /[\x00-\x1f"]/.test(root) || root.split(/[\\/]/).includes('..')) {
    throw new Error('QQ desktopRoot must be an explicit absolute path without traversal');
  }
  if (!fs.statSync(root).isDirectory()) throw new Error('QQ desktopRoot is not a directory');
  return fs.realpathSync(root);
}

function getGatewayProcessEntries(gatewayDir,selection) {
  const base = path.resolve(gatewayDir);
  const boot = path.join(base, 'napcat', 'NapCatWinBootMain.exe');
  const hook = path.join(base, 'napcat', 'NapCatWinBootHook.dll');
  const qq = path.resolve(base, '../qq-desktop/QQ.exe');
  const entries=[
    {profile:'bundled',node:path.join(base,'node.exe'),entry:path.join(base,'index.js'),requiredArguments:[path.join(base,'index.js')]},
    {profile:'qq-9.9.35-52892',node:path.join(base,'runtimes/qq-9.9.35-52892/node.exe'),entry:path.resolve(base,'../start-native.cjs'),requiredArguments:[path.resolve(base,'../start-native.cjs')]},
    {profile:'desktop-framework',node:boot,entry:qq,requiredArguments:[qq,hook],desktopDir:path.dirname(qq)}
  ];
  if (selection === undefined) {
    try {selection=readSelection(base);} catch {return entries;}
  }
  const external=explicitDesktopRoot(selection);
  if (external) {
    const configFile=path.join(external,'versions/config.json');
    requireContainedFile(path.join(external,'QQ.exe'),external);
    requireContainedFile(configFile,external);
    const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
    if (!/^\d+\.\d+\.\d+-\d+$/.test(config.curVersion)) throw new Error('QQ desktop version metadata does not match');
    const packageFile=path.join(external,'versions',config.curVersion,'resources/app/package.json');
    requireContainedFile(packageFile,external);
    if (JSON.parse(fs.readFileSync(packageFile,'utf8')).version !== config.curVersion) throw new Error('QQ desktop version metadata does not match');
    if (path.normalize(external).toLowerCase() !== path.normalize(path.dirname(qq)).toLowerCase()) {
      entries.push({profile:'desktop-framework',node:boot,entry:path.join(external,'QQ.exe'),requiredArguments:[path.join(external,'QQ.exe'),hook],desktopDir:external,externalDesktop:true});
    }
  }
  return entries;
}

function requireContainedFile(file, root) {
  if (!fs.statSync(file).isFile()) throw new Error('QQ desktop runtime is incomplete');
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(file));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('QQ desktop runtime file escapes its selected root');
  }
}
const requireProjectFile=requireContainedFile;

function resolveGatewayRuntime(gatewayDir) {
  const base = path.resolve(gatewayDir);
  const selection=readSelection(base);
  const profile=selection.profile;
  if (!['bundled', 'qq-9.9.35-52892','desktop-framework'].includes(profile)) throw new Error('Unsupported QQ runtime profile');
  const processEntries = getGatewayProcessEntries(base,selection);
  if (profile === 'desktop-framework') {
    const gatewayRoot = path.dirname(base);
    const external=explicitDesktopRoot(selection);
    const selected = processEntries.find(item=>item.profile === profile && (!external || path.normalize(item.desktopDir).toLowerCase() === path.normalize(external).toLowerCase()));
    const nativeDir = selected.desktopDir;
    const configFile = path.join(nativeDir,'versions/config.json');
    if(!external)requireProjectFile(configFile,gatewayRoot);
    requireContainedFile(configFile,nativeDir);
    const config = JSON.parse(fs.readFileSync(configFile,'utf8'));
    if (!/^\d+\.\d+\.\d+-\d+$/.test(config.curVersion)) throw new Error('QQ desktop version metadata does not match');
    const appDir = path.join(nativeDir,'versions',config.curVersion,'resources/app');
    const packageFile = path.join(appDir,'package.json');
    const originalPackageFile = path.join(appDir,'package.json.original');
    const packageDescriptor = path.join(gatewayRoot,'desktop-package.json');
    const bootstrap = path.join(gatewayRoot,'desktop-bootstrap.cjs');
    const frameworkDir = path.join(gatewayRoot,'napcat-framework');
    const originalMain = path.join(appDir,'application.asar/app_launcher/index.js');
    const required = [selected.node,selected.requiredArguments[1],packageDescriptor,bootstrap,
      path.join(frameworkDir,'napcat.cjs'),path.join(frameworkDir,'napcat.mjs'),path.join(frameworkDir,'native/napi2native/napi2native.win32.x64.node'),
      path.join(frameworkDir,'native/packet/MoeHoo.win32.x64.node')];
    for (const file of required) requireProjectFile(file,gatewayRoot);
    for(const file of [selected.entry,packageFile,path.join(appDir,'loadNapCat.js'),path.join(nativeDir,'versions',config.curVersion,'QQNT.dll'),path.join(appDir,'wrapper.node'),path.join(appDir,'major.node'),path.join(appDir,'application.asar')])requireContainedFile(file,nativeDir);
    const pkg = JSON.parse(fs.readFileSync(packageFile,'utf8'));
    let originalPkg;
    if(external && pkg.main === './application.asar/app_launcher/index.js')originalPkg=pkg;
    else {requireContainedFile(originalPackageFile,nativeDir);originalPkg=JSON.parse(fs.readFileSync(originalPackageFile,'utf8'));}
    const descriptor = JSON.parse(fs.readFileSync(packageDescriptor,'utf8'));
    if (pkg.version !== config.curVersion || originalPkg.version !== pkg.version || originalPkg.buildVersion !== pkg.buildVersion || originalPkg.main !== './application.asar/app_launcher/index.js' ||
        !(pkg.main === './loadNapCat.js' || external && pkg.main === './application.asar/app_launcher/index.js') || descriptor.version !== pkg.version || descriptor.buildVersion !== pkg.buildVersion || descriptor.main !== './loadNapCat.js') {
      throw new Error('QQ desktop version metadata does not match');
    }
    return {profile,kind:'desktop-framework',externalDesktop:!!external,version:pkg.version,nativeDir,node:selected.node,entry:selected.entry,
      injectPath:selected.requiredArguments[1],packageDescriptor,bootstrap,frameworkDir,originalMain,
      workDir:path.join(base,'napcat'),authAuditFile:path.resolve(gatewayRoot,'../logs/qq-auth-events.jsonl'),processEntries};
  }
  const nativeDir = profile === 'bundled' ? base : path.join(base, 'runtimes', profile);
  const entry = profile === 'bundled' ? path.join(base, 'index.js') : path.resolve(base, '../start-native.cjs');
  for (const name of ['node.exe','wrapper.node','QQNT.dll','package.json','config.json','crypto.dll','ssl.dll','broadcast_ipc.dll','libvips-42.dll','libglib-2.0-0.dll','libgobject-2.0-0.dll']) {
    if (!fs.statSync(path.join(nativeDir, name)).isFile()) throw new Error('QQ native bundle is incomplete');
  }
  if (!fs.statSync(entry).isFile()) throw new Error('QQ runtime launcher is missing');
  const pkg = JSON.parse(fs.readFileSync(path.join(nativeDir, 'package.json'), 'utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(nativeDir, 'config.json'), 'utf8'));
  if (pkg.version !== config.curVersion || profile !== 'bundled' && pkg.version !== profile.slice(3)) throw new Error('QQ native version metadata does not match');
  return {profile,kind:'node',version:pkg.version,nativeDir,node:path.join(nativeDir,'node.exe'),entry,processEntries};
}
module.exports = {resolveGatewayRuntime,getGatewayProcessEntries};
if (require.main === module) {
  try {console.log(JSON.stringify(process.argv[3] === '--process-entries' ? getGatewayProcessEntries(process.argv[2]) : resolveGatewayRuntime(process.argv[2])));}
  catch {console.error('QQ runtime profile is invalid or incomplete; original files were preserved.');process.exitCode=1;}
}
