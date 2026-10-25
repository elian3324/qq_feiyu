const fs=require('node:fs');
const path=require('node:path');

const ORIGINAL_MAIN='./application.asar/app_launcher/index.js';
const DESKTOP_MAIN='./loadNapCat.js';
const LOADER_SOURCE='require(process.env.NAPCAT_LOAD_PATH);\n';

function assertWithin(file,root){
  const relative=path.relative(fs.realpathSync(root),fs.realpathSync(file));
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('Desktop entry path escapes its selected root');
}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function prepareDesktopEntry(projectRoot){
  const root=path.resolve(projectRoot),gateway=path.join(root,'gateway');
  assertWithin(gateway,root);
  const selectorFile=path.join(gateway,'napcat/runtime-profile.json');
  const selector=fs.existsSync(selectorFile)?readJson(selectorFile):{profile:'desktop-framework'};
  const external=selector.desktopRoot!==undefined;
  let desktopRoot=path.join(gateway,'qq-desktop');
  if(external){
    if(selector.profile!=='desktop-framework'||typeof selector.desktopRoot!=='string'||!path.isAbsolute(selector.desktopRoot)||/[\x00-\x1f"]/.test(selector.desktopRoot)||selector.desktopRoot.split(/[\\/]/).includes('..'))throw new Error('Explicit desktopRoot requires an absolute desktop-framework path without traversal');
    desktopRoot=fs.realpathSync(selector.desktopRoot);
  }
  const versionFile=path.join(desktopRoot,'versions/config.json');
  assertWithin(versionFile,external?desktopRoot:gateway);
  const version=readJson(versionFile).curVersion;
  if(typeof version!=='string'||!/^\d+\.\d+\.\d+-\d+$/.test(version))throw new Error('Selected QQ version metadata is invalid');
  const app=path.join(desktopRoot,'versions',version,'resources/app');
  const packageFile=path.join(app,'package.json'),backup=packageFile+'.original',entry=path.join(app,'loadNapCat.js');
  assertWithin(packageFile,desktopRoot);
  const current=readJson(packageFile);
  if(current.version!==version||String(current.buildVersion)!==version.split('-')[1])throw new Error('QQ package and selected version metadata do not match');
  let original=current;
  if(external){
    if(current.main!==ORIGINAL_MAIN)throw new Error('Installed QQ package main was modified; refusing to change or infer its original entry');
  }else{
    if(current.main!==ORIGINAL_MAIN&&current.main!==DESKTOP_MAIN)throw new Error('Project QQ package has an unrelated entry');
    if(fs.existsSync(backup)){assertWithin(backup,desktopRoot);original=readJson(backup);}
    else if(current.main!==ORIGINAL_MAIN)throw new Error('Project QQ original package backup is missing');
    if(original.version!==version||original.buildVersion!==current.buildVersion||original.main!==ORIGINAL_MAIN)throw new Error('Original QQ package backup does not match the selected version');
  }
  const entryExists=fs.existsSync(entry);
  if(entryExists){
    assertWithin(entry,desktopRoot);
    if(!fs.statSync(entry).isFile()||!fs.readFileSync(entry).equals(Buffer.from(LOADER_SOURCE)))throw new Error('Existing loadNapCat.js is unrelated; refusing to overwrite it');
  }
  const descriptorFile=path.join(gateway,'desktop-package.json');
  if(fs.existsSync(descriptorFile))assertWithin(descriptorFile,gateway);
  const descriptor=JSON.stringify({...original,main:DESKTOP_MAIN},null,2)+'\n';
  // Validate every pre-existing file before making any reversible deployment writes.
  if(!external&&!fs.existsSync(backup))fs.copyFileSync(packageFile,backup,fs.constants.COPYFILE_EXCL);
  if(!entryExists)fs.writeFileSync(entry,LOADER_SOURCE,{flag:'wx'});
  fs.writeFileSync(descriptorFile,descriptor);
  if(!external)fs.writeFileSync(packageFile,descriptor);
  return {desktopRoot,version,externalDesktop:external,packagePatched:!external,loaderCreated:!entryExists,descriptorFile};
}
module.exports={prepareDesktopEntry,ORIGINAL_MAIN,DESKTOP_MAIN,LOADER_SOURCE};
