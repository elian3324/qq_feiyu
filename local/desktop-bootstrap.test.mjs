import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../gateway/desktop-bootstrap.cjs',import.meta.url),'utf8');
test('desktop bootstrap loads the adapter before the unchanged official application and limits its account',()=>{
 const root=path.resolve('mock-project'),framework=path.join(root,'gateway/napcat-framework'),original=path.join(root,'QQ/application.asar/app_launcher/index.js'),loaded=[];
 const process={env:{COMPANION_FRAMEWORK_DIR:framework,COMPANION_ORIGINAL_MAIN:original}};
 const require=name=>{if(name==='node:path')return path;if(name==='node:fs')return {readFileSync:file=>{assert.equal(file,path.join(root,'ai-companion-kit/packages/companion/config.json'));return JSON.stringify({botQQ:'90009',apiKey:'EXAMPLE_bc97f50395bb'});}};loaded.push(name);};
 vm.runInNewContext(source,{process,require});
 assert.deepEqual(loaded,[path.join(framework,'napcat.cjs'),original]);assert.equal(process.env.COMPANION_EXPECTED_QQ,'90009');
 assert(!('apiKey' in process.env));
});
test('missing launcher configuration stops before loading any application or creating a login',()=>{
 assert.throws(()=>vm.runInNewContext(source,{process:{env:{}},require:name=>{if(name==='node:path')return path;if(name==='node:fs')return fs;throw new Error('Application must not load');}}),/configuration is incomplete/);
});
