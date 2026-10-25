import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const {prepareDesktopEntry,ORIGINAL_MAIN,LOADER_SOURCE}=createRequire(import.meta.url)('./prepare-desktop-entry.cjs');

function fixture({external=false,version='9.9.36-53644'}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-entry-test-')),root=path.join(dir,'project'),gateway=path.join(root,'gateway');
 const qq=external?path.join(dir,'installed-qq'):path.join(gateway,'qq-desktop'),app=path.join(qq,'versions',version,'resources/app');
 fs.mkdirSync(path.join(gateway,'napcat'),{recursive:true});fs.mkdirSync(app,{recursive:true});
 const pkg={name:'qq-chat',version,buildVersion:version.split('-')[1],main:ORIGINAL_MAIN,customMetadata:'preserved'};
 fs.writeFileSync(path.join(qq,'QQ.exe'),'unchanged-qq-binary');fs.writeFileSync(path.join(qq,'versions/config.json'),JSON.stringify({curVersion:version}));
 const packageFile=path.join(app,'package.json'),raw=JSON.stringify(pkg,null,4)+'\n';fs.writeFileSync(packageFile,raw);
 const selectorFile=path.join(gateway,'napcat/runtime-profile.json');
 fs.writeFileSync(selectorFile,JSON.stringify({profile:'desktop-framework',...(external?{desktopRoot:qq}:{})}));
 return {root,gateway,qq,app,pkg,raw,packageFile,selectorFile,entry:path.join(app,'loadNapCat.js'),cleanup(){assert.equal(path.dirname(dir),os.tmpdir());assert(path.basename(dir).startsWith('qq-entry-test-'));fs.rmSync(dir,{recursive:true,force:true});}};
}
test('installed QQ deployment uses selected version without a clone and preserves package and binary bytes',()=>{
 const f=fixture({external:true});try{
  assert.equal(fs.existsSync(path.join(f.gateway,'qq-desktop')),false);
  const before=fs.readFileSync(f.packageFile),binary=fs.readFileSync(path.join(f.qq,'QQ.exe'));
  const first=prepareDesktopEntry(f.root);assert.equal(first.externalDesktop,true);assert.equal(first.packagePatched,false);assert.equal(first.loaderCreated,true);assert.equal(first.version,'9.9.36-53644');
  assert.deepEqual(fs.readFileSync(f.packageFile),before);assert.deepEqual(fs.readFileSync(path.join(f.qq,'QQ.exe')),binary);assert.equal(fs.existsSync(f.packageFile+'.original'),false);
  assert.equal(fs.readFileSync(f.entry,'utf8'),LOADER_SOURCE);
  const descriptor=JSON.parse(fs.readFileSync(first.descriptorFile,'utf8'));assert.equal(descriptor.version,f.pkg.version);assert.equal(descriptor.main,'./loadNapCat.js');assert.equal(descriptor.customMetadata,'preserved');
  assert.equal(prepareDesktopEntry(f.root).loaderCreated,false);assert.deepEqual(fs.readFileSync(f.packageFile),before);
 }finally{f.cleanup();}
});
test('legacy project clone patch is reversible, version aware and repeatable',()=>{
 const f=fixture();try{
  const before=fs.readFileSync(f.packageFile);const first=prepareDesktopEntry(f.root);
  assert.equal(first.externalDesktop,false);assert.equal(first.packagePatched,true);
  assert.deepEqual(fs.readFileSync(f.packageFile+'.original'),before);assert.equal(JSON.parse(fs.readFileSync(f.packageFile,'utf8')).main,'./loadNapCat.js');
  const descriptor=fs.readFileSync(first.descriptorFile);prepareDesktopEntry(f.root);
  assert.deepEqual(fs.readFileSync(f.packageFile+'.original'),before);assert.deepEqual(fs.readFileSync(first.descriptorFile),descriptor);
 }finally{f.cleanup();}
});
test('unrelated same-name loader is refused before writing package, backup or descriptor',()=>{
 for(const external of [false,true]){
  const f=fixture({external});try{
   const unrelated='console.log("another loader");\n';fs.writeFileSync(f.entry,unrelated);
   const descriptor=path.join(f.gateway,'desktop-package.json');fs.writeFileSync(descriptor,'existing-project-descriptor');
   assert.throws(()=>prepareDesktopEntry(f.root),/refusing to overwrite/);
   assert.equal(fs.readFileSync(f.entry,'utf8'),unrelated);assert.equal(fs.readFileSync(f.packageFile,'utf8'),f.raw);assert.equal(fs.existsSync(f.packageFile+'.original'),false);assert.equal(fs.readFileSync(descriptor,'utf8'),'existing-project-descriptor');
  }finally{f.cleanup();}
 }
});
test('unexpected version, modified external main and invalid selectors fail without creating an entry',()=>{
 const f=fixture({external:true});try{
  fs.writeFileSync(f.packageFile,JSON.stringify({...f.pkg,version:'9.9.35-52892'}));assert.throws(()=>prepareDesktopEntry(f.root),/metadata/);
  fs.writeFileSync(f.packageFile,JSON.stringify({...f.pkg,main:'./another-loader.js'}));assert.throws(()=>prepareDesktopEntry(f.root),/package main was modified/);
  fs.writeFileSync(f.packageFile,f.raw);
  for(const selector of [{profile:'bundled',desktopRoot:f.qq},{profile:'desktop-framework',desktopRoot:'relative'},{profile:'desktop-framework',desktopRoot:f.qq+path.sep+'..'+path.sep+'installed-qq'}]){
   fs.writeFileSync(f.selectorFile,JSON.stringify(selector));assert.throws(()=>prepareDesktopEntry(f.root),/absolute desktop-framework path/);
  }
  assert.equal(fs.existsSync(f.entry),false);assert.equal(fs.existsSync(path.join(f.gateway,'desktop-package.json')),false);assert.equal(fs.readFileSync(f.packageFile,'utf8'),f.raw);
 }finally{f.cleanup();}
});
test('mismatched clone rollback backup is preserved and rejected',()=>{
 const f=fixture();try{
  const backup=JSON.stringify({...f.pkg,buildVersion:'99999'});fs.writeFileSync(f.packageFile+'.original',backup);
  assert.throws(()=>prepareDesktopEntry(f.root),/backup does not match/);
  assert.equal(fs.readFileSync(f.packageFile+'.original','utf8'),backup);assert.equal(fs.readFileSync(f.packageFile,'utf8'),f.raw);assert.equal(fs.existsSync(f.entry),false);
 }finally{f.cleanup();}
});
