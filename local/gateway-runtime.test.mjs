import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const {resolveGatewayRuntime,getGatewayProcessEntries}=createRequire(import.meta.url)('./gateway-runtime.cjs');
const files=['node.exe','wrapper.node','QQNT.dll','crypto.dll','ssl.dll','broadcast_ipc.dll','libvips-42.dll','libglib-2.0-0.dll','libgobject-2.0-0.dll'];
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-runtime-')),base=path.join(dir,'napcat');fs.mkdirSync(base);
 const bundle=(dest,version)=>{fs.mkdirSync(dest,{recursive:true});for(const name of files)fs.writeFileSync(path.join(dest,name),'fixture');fs.writeFileSync(path.join(dest,'package.json'),JSON.stringify({version}));fs.writeFileSync(path.join(dest,'config.json'),JSON.stringify({curVersion:version}));};
 bundle(base,'9.9.31-49738');bundle(path.join(base,'runtimes/qq-9.9.35-52892'),'9.9.35-52892');
 fs.writeFileSync(path.join(base,'index.js'),'');fs.writeFileSync(path.join(dir,'start-native.cjs'),'');
 const desktop=()=>{
  const qq=path.join(dir,'qq-desktop'),app=path.join(qq,'versions/9.9.35-52892/resources/app');
  const write=(file,body='fixture')=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);};
  for(const file of ['QQ.exe','versions/9.9.35-52892/QQNT.dll','versions/9.9.35-52892/resources/app/wrapper.node','versions/9.9.35-52892/resources/app/major.node','versions/9.9.35-52892/resources/app/application.asar'])write(path.join(qq,file));
  write(path.join(qq,'versions/config.json'),JSON.stringify({curVersion:'9.9.35-52892'}));
  const pkg={version:'9.9.35-52892',buildVersion:'52892',main:'./application.asar/app_launcher/index.js'};
  write(path.join(app,'package.json.original'),JSON.stringify(pkg));
  write(path.join(app,'package.json'),JSON.stringify({...pkg,main:'./loadNapCat.js'}));write(path.join(app,'loadNapCat.js'));
  write(path.join(dir,'desktop-package.json'),JSON.stringify({...pkg,main:'./loadNapCat.js'}));write(path.join(dir,'desktop-bootstrap.cjs'));
  for(const file of ['napcat.cjs','napcat.mjs','native/napi2native/napi2native.win32.x64.node','native/packet/MoeHoo.win32.x64.node'])write(path.join(dir,'napcat-framework',file));
  for(const file of ['NapCatWinBootMain.exe','NapCatWinBootHook.dll'])write(path.join(base,'napcat',file));
  return {qq,app,dir};
 };
 return {base,desktop,profile:(value,extra={})=>fs.writeFileSync(path.join(base,'runtime-profile.json'),JSON.stringify({profile:value,...extra})),cleanup(){assert.equal(path.dirname(dir),os.tmpdir());assert(path.basename(dir).startsWith('qq-runtime-'));fs.rmSync(dir,{recursive:true,force:true});}};
}
test('no profile preserves the original launcher; selection uses a complete separate native bundle',()=>{
 const f=fixture();try{const old=resolveGatewayRuntime(f.base);assert.equal(old.profile,'bundled');assert.equal(old.version,'9.9.31-49738');
 f.profile('qq-9.9.35-52892');const next=resolveGatewayRuntime(f.base);assert.equal(next.version,'9.9.35-52892');assert.equal(path.dirname(next.node),next.nativeDir);assert.notEqual(next.nativeDir,old.nativeDir);assert(next.processEntries.some(p=>p.node===old.node));
 f.profile('bundled');assert.equal(resolveGatewayRuntime(f.base).node,old.node);
 }finally{f.cleanup();}
});
test('unknown profiles, path injection, incomplete bundles and mismatched QQ metadata fail closed',()=>{
 const f=fixture();try{
 for(const profile of ['../../external',null,{},'qq-0']){f.profile(profile);assert.throws(()=>resolveGatewayRuntime(f.base));}
 f.profile('qq-9.9.35-52892');const next=resolveGatewayRuntime(f.base);fs.writeFileSync(path.join(next.nativeDir,'config.json'),JSON.stringify({curVersion:'9.9.31-49738'}));assert.throws(()=>resolveGatewayRuntime(f.base),/metadata/);
 fs.writeFileSync(path.join(next.nativeDir,'config.json'),JSON.stringify({curVersion:next.version}));fs.unlinkSync(path.join(next.nativeDir,'wrapper.node'));assert.throws(()=>resolveGatewayRuntime(f.base));
 }finally{f.cleanup();}
});
test('desktop Framework uses the project QQ clone and official waiting launcher without changing native profiles',()=>{
 const f=fixture();try{
  const d=f.desktop();f.profile('desktop-framework');const r=resolveGatewayRuntime(f.base);
  assert.equal(r.kind,'desktop-framework');assert.equal(r.entry,path.join(d.qq,'QQ.exe'));
  assert.equal(r.node,path.join(f.base,'napcat/NapCatWinBootMain.exe'));
  assert.equal(r.injectPath,path.join(f.base,'napcat/NapCatWinBootHook.dll'));
  assert.equal(r.originalMain,path.join(d.app,'application.asar/app_launcher/index.js'));
  assert.equal(r.workDir,path.join(f.base,'napcat'));
  assert.equal(r.frameworkDir,path.join(d.dir,'napcat-framework'));
  assert.deepEqual(r.processEntries.find(p=>p.profile==='desktop-framework').requiredArguments,[r.entry,r.injectPath]);
  f.profile('bundled');assert.equal(resolveGatewayRuntime(f.base).kind,'node');
  f.profile('qq-9.9.35-52892');assert.equal(resolveGatewayRuntime(f.base).kind,'node');
 }finally{f.cleanup();}
});
test('desktop Framework refuses missing native dependencies, wrong metadata and an unrelated entry',()=>{
 const f=fixture();try{
  const d=f.desktop();f.profile('desktop-framework');
  const descriptor=path.join(d.dir,'desktop-package.json');const valid=fs.readFileSync(descriptor,'utf8');
  fs.writeFileSync(descriptor,JSON.stringify({...JSON.parse(valid),version:'9.9.22-40990'}));assert.throws(()=>resolveGatewayRuntime(f.base),/metadata/);
  fs.writeFileSync(descriptor,JSON.stringify({...JSON.parse(valid),main:'./other.js'}));assert.throws(()=>resolveGatewayRuntime(f.base),/metadata/);
  fs.writeFileSync(descriptor,valid);const native=path.join(d.dir,'napcat-framework/native/packet/MoeHoo.win32.x64.node');fs.unlinkSync(native);assert.throws(()=>resolveGatewayRuntime(f.base));
 }finally{f.cleanup();}
});
test('process ownership entries remain available when selected runtime metadata is damaged',()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.base,'runtime-profile.json'),'{broken');
  assert.throws(()=>resolveGatewayRuntime(f.base));
  const entries=getGatewayProcessEntries(f.base);assert.equal(entries.length,3);
  assert.equal(entries.find(e=>e.profile==='desktop-framework').requiredArguments.length,2);
 }finally{f.cleanup();}
});
test('desktop requires a real bootstrap entry and reversible matching original QQ package',()=>{
 const f=fixture();try{
  const d=f.desktop();f.profile('desktop-framework');
  const original=path.join(d.app,'package.json.original'),current=path.join(d.app,'package.json'),entry=path.join(d.app,'loadNapCat.js');
  const originalText=fs.readFileSync(original,'utf8'),currentText=fs.readFileSync(current,'utf8');
  fs.writeFileSync(current,originalText);assert.throws(()=>resolveGatewayRuntime(f.base),/metadata/);fs.writeFileSync(current,currentText);
  fs.writeFileSync(original,JSON.stringify({...JSON.parse(originalText),version:'9.9.31-49738'}));assert.throws(()=>resolveGatewayRuntime(f.base),/metadata/);
  fs.writeFileSync(original,JSON.stringify({...JSON.parse(originalText),main:'./loadNapCat.js'}));assert.throws(()=>resolveGatewayRuntime(f.base),/metadata/);
  fs.writeFileSync(original,originalText);fs.unlinkSync(entry);assert.throws(()=>resolveGatewayRuntime(f.base));fs.writeFileSync(entry,'fixture');
  fs.unlinkSync(original);assert.throws(()=>resolveGatewayRuntime(f.base));
 }finally{f.cleanup();}
});
test('explicit installed QQ root preserves its original main and adds only exact launcher ownership',()=>{
 const f=fixture(),external=fs.mkdtempSync(path.join(os.tmpdir(),'qq-external-'));
 try{
  const d=f.desktop();fs.cpSync(d.qq,external,{recursive:true});
  const app=path.join(external,'versions/9.9.35-52892/resources/app');
  fs.copyFileSync(path.join(app,'package.json.original'),path.join(app,'package.json'));fs.unlinkSync(path.join(app,'package.json.original'));
  f.profile('desktop-framework',{desktopRoot:external});const r=resolveGatewayRuntime(f.base);
  assert.equal(r.externalDesktop,true);assert.equal(r.entry,path.join(fs.realpathSync(external),'QQ.exe'));
  assert.equal(r.frameworkDir,path.join(d.dir,'napcat-framework'));
  assert.equal(r.processEntries.length,4);assert(r.processEntries.some(e=>e.entry===path.join(d.qq,'QQ.exe')));
  const owned=r.processEntries.find(e=>e.externalDesktop);assert.deepEqual(owned.requiredArguments,[r.entry,r.injectPath]);
  assert.equal(getGatewayProcessEntries(f.base).filter(e=>e.externalDesktop).length,1);
 }finally{f.cleanup();assert(path.basename(external).startsWith('qq-external-'));fs.rmSync(external,{recursive:true,force:true});}
});
test('external QQ root requires explicit desktop profile, absolute non-traversing path and matching metadata',()=>{
 const f=fixture();try{
  const d=f.desktop();
  for(const root of ['relative-qq',d.qq+path.sep+'..'+path.sep+'qq-desktop',null,{},d.qq+'"']){
   f.profile('desktop-framework',{desktopRoot:root});assert.throws(()=>resolveGatewayRuntime(f.base));
  }
  f.profile('bundled',{desktopRoot:d.qq});assert.throws(()=>resolveGatewayRuntime(f.base),/require desktop-framework/);
  f.profile('desktop-framework',{desktopRoot:d.qq});fs.writeFileSync(path.join(d.qq,'versions/config.json'),JSON.stringify({curVersion:'../../other'}));assert.throws(()=>resolveGatewayRuntime(f.base),/metadata/);
 }finally{f.cleanup();}
});
test('PowerShell startup and stop identity checks reject personal QQ, other hooks and path-prefix impostors',{skip:process.platform!=='win32'},()=>{
 const local=fileURLToPath(new URL('.',import.meta.url));
 const q=value=>"'"+value.replaceAll("'","''")+"'";
 const script=`$ErrorActionPreference='Stop'
 $taskRuntime=[pscustomobject]@{processEntries=@([pscustomobject]@{node='./local-resources';entry='./local-resources';requiredArguments=@('./local-resources','./local-resources')})}
 $taskEntries=$taskRuntime.processEntries
 foreach($name in @('gateway.ps1','stop.ps1')){
  $errors=$null;$tokens=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path ${q(local)} $name),[ref]$tokens,[ref]$errors)
  if($errors.Count -gt 0){throw ($errors | Out-String)}
  foreach($fn in $ast.FindAll({param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -in @('Test-TaskGatewayProcess','Test-TaskGateway','Test-TaskArgument')},$true)){Invoke-Expression $fn.Extent.Text}
 }
 $good=[pscustomobject]@{ExecutablePath='./local-resources';CommandLine='"./local-resources" "./local-resources" "./local-resources"'}
 if(-not (Test-TaskGatewayProcess $good) -or -not (Test-TaskGateway $good)){throw 'Valid project launcher rejected'}
 foreach($bad in @(
  [pscustomobject]@{ExecutablePath='./local-resources';CommandLine=$good.CommandLine},
  [pscustomobject]@{ExecutablePath=$good.ExecutablePath;CommandLine='"./local-resources" "./local-resources" "./local-resources"'},
  [pscustomobject]@{ExecutablePath=$good.ExecutablePath;CommandLine='"./local-resources" "./local-resources" "./local-resources"'},
  [pscustomobject]@{ExecutablePath=$good.ExecutablePath;CommandLine='"./local-resources" "./local-resources" "./local-resources"'}
 )){if((Test-TaskGatewayProcess $bad) -or (Test-TaskGateway $bad)){throw 'Unrelated process matched'}}
 Write-Output 'safe-process-matching-passed'`;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',timeout:15000,windowsHide:true});
 assert.equal(result.status,0,result.stderr||result.stdout);assert.match(result.stdout,/safe-process-matching-passed/);
});
test('desktop health requires its live QQ child and rejects a stale Boot or reused parent PID',{skip:process.platform!=='win32'},()=>{
 const file=fileURLToPath(new URL('./gateway.ps1',import.meta.url));
 const q=value=>"'"+value.replaceAll("'","''")+"'";
 const script=`$ErrorActionPreference='Stop'
 $e=$null;$t=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile(${q(file)},[ref]$t,[ref]$e)
 if($e.Count -gt 0){throw ($e | Out-String)}
 foreach($fn in $ast.FindAll({param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -in @('Test-TaskDesktopGatewayChild','Test-TaskGatewayProcess')},$true)){Invoke-Expression $fn.Extent.Text}
 $entry=[pscustomobject]@{profile='desktop-framework';node='./local-resources';entry='./local-resources';requiredArguments=@('./local-resources','./local-resources')}
 $taskRuntime=[pscustomobject]@{processEntries=@($entry)}
 $boot=[pscustomobject]@{ProcessId=700;CreationDate=[datetime]'2026-10-25T00:01:00';ExecutablePath=$entry.node;CommandLine='"./local-resources" "./local-resources" "./local-resources"'}
 $script:taskMockChildren=@()
 function Get-CimInstance {param($Filter,$ErrorAction) return $script:taskMockChildren}
 if(Test-TaskGatewayProcess $boot){throw 'Stale Boot reported healthy'}
 if(-not (Test-TaskGatewayProcess $boot -IdentityOnly)){throw 'Stale Boot lost ownership identity'}
 $valid=[pscustomobject]@{ParentProcessId=700;CreationDate=$boot.CreationDate.AddSeconds(1);ExecutablePath=$entry.entry}
 $script:taskMockChildren=@($valid)
 if(-not (Test-TaskGatewayProcess $boot)){throw 'Live exact QQ child not detected'}
 foreach($bad in @(
  [pscustomobject]@{ParentProcessId=701;CreationDate=$valid.CreationDate;ExecutablePath=$entry.entry},
  [pscustomobject]@{ParentProcessId=700;CreationDate=$boot.CreationDate.AddSeconds(-1);ExecutablePath=$entry.entry},
  [pscustomobject]@{ParentProcessId=700;CreationDate=$valid.CreationDate;ExecutablePath='./local-resources'},
  [pscustomobject]@{ParentProcessId=700;CreationDate=$null;ExecutablePath=$entry.entry}
 )){$script:taskMockChildren=@($bad);if(Test-TaskGatewayProcess $boot){throw 'Unrelated child reported healthy'}}
 $script:taskMockChildren=@();if(Test-TaskDesktopGatewayChild $boot $entry @()){throw 'Empty child list reported healthy'}
 Write-Output 'desktop-child-health-passed'`;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',timeout:15000,windowsHide:true});
 assert.equal(result.status,0,result.stderr||result.stdout);assert.match(result.stdout,/desktop-child-health-passed/);
});
test('shutdown stops only the proved external QQ descendants and protects ordinary QQ and reused PIDs',{skip:process.platform!=='win32'},()=>{
 const file=fileURLToPath(new URL('./stop.ps1',import.meta.url));
 const q=value=>"'"+value.replaceAll("'","''")+"'";
 const script=`$ErrorActionPreference='Stop'
 $e=$null;$t=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile(${q(file)},[ref]$t,[ref]$e)
 if($e.Count -gt 0){throw ($e | Out-String)}
 foreach($fn in $ast.FindAll({param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)){Invoke-Expression $fn.Extent.Text}
 $taskPrefix='./local-resources'
 $taskEntries=@([pscustomobject]@{profile='desktop-framework';externalDesktop=$true;desktopDir='./local-resources';node='./local-resources';entry='./local-resources';requiredArguments=@('./local-resources','./local-resources')})
 $at=[datetime]'2026-10-25T00:10:00Z'
 $boot=[pscustomobject]@{ProcessId=900;ParentProcessId=1;CreationDate=$at;ExecutablePath='./local-resources';CommandLine='"./local-resources" "./local-resources" "./local-resources"'}
 $owned=[pscustomobject]@{ProcessId=901;ParentProcessId=900;CreationDate=$at.AddSeconds(1);ExecutablePath='./local-resources'}
 $renderer=[pscustomobject]@{ProcessId=902;ParentProcessId=901;CreationDate=$at.AddSeconds(2);ExecutablePath='./local-resources'}
 $ordinary=[pscustomobject]@{ProcessId=910;ParentProcessId=999;CreationDate=$at.AddSeconds(1);ExecutablePath='./local-resources'}
 $script:mockProcesses=@{900=$boot;901=$owned;902=$renderer;910=$ordinary};$script:killed=@()
 function Get-CimInstance {param($Filter,$ErrorAction)
  if($Filter -match '^ParentProcessId=(\\d+)$'){return @($script:mockProcesses.Values | Where-Object {$_.ParentProcessId -eq [int]$Matches[1]})}
  if($Filter -match '^ProcessId=(\\d+)$'){return $script:mockProcesses[[int]$Matches[1]]}
  throw 'Unexpected mock query'
 }
 function Stop-Process {param($Id,[switch]$Force,$ErrorAction) $script:killed+=$Id;$script:mockProcesses.Remove([int]$Id)}
 Stop-TaskVerifiedTree $boot
 foreach($id in @(900,901,902)){if($script:killed -notcontains $id){throw 'Owned process left behind'}}
 if($script:killed -contains 910 -or -not $script:mockProcesses.ContainsKey(910)){throw 'Ordinary QQ was stopped'}
 $receipt=[pscustomobject]@{pid=901;creationDate=$owned.CreationDate.ToUniversalTime().ToString('o');executablePath=$owned.ExecutablePath}
 if(-not (Test-TaskDesktopReceipt $owned $receipt)){throw 'Valid recorded identity rejected'}
 if(Test-TaskDesktopReceipt $ordinary $receipt){throw 'Unrelated QQ accepted by receipt'}
 $reused=[pscustomobject]@{ProcessId=901;ParentProcessId=999;CreationDate=$at.AddMinutes(1);ExecutablePath=$owned.ExecutablePath}
 if(Test-TaskDesktopReceipt $reused $receipt){throw 'Reused PID accepted by receipt'}
 if(Test-TaskTreeChild $boot $ordinary './local-resources'){throw 'Unrelated QQ accepted as child'}
 Write-Output 'external-qq-shutdown-safety-passed'`;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',timeout:15000,windowsHide:true});
 assert.equal(result.status,0,result.stderr||result.stdout);assert.match(result.stdout,/external-qq-shutdown-safety-passed/);
});
