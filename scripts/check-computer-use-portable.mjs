#!/usr/bin/env node
// Deterministic archive composition proof. Engine/host/CLI bytes are fixtures;
// native signatures are mocked and no executable or provider is launched.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { packageSquadPortable } from './package-squad-portable.mjs';
import { stageComputerUse } from './stage-computer-use.mjs';
import { COMPUTER_USE_HOST } from './computer-use-host.mjs';
import { tarCreateArgs } from './release-archive.mjs';
const root=await mkdtemp(join(tmpdir(),'squad-portable-component-'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function run(command,args,options={}){const r=spawnSync(command,args,{encoding:'utf8',...options});if(r.status!==0)throw new Error(`${command}: ${r.stderr}`);return r.stdout;}
async function file(path,text='fixture bytes'){await mkdir(join(path,'..'),{recursive:true});await writeFile(path,text);}
const os=process.platform,arch=process.arch,version='1.2.3-fixture',exe=os==='win32'?'.exe':'';
const names={'darwin/arm64':'autohand-macos-arm64','darwin/x64':'autohand-macos-x64','linux/x64':'autohand-linux-x64','linux/arm64':'autohand-linux-arm64','win32/x64':'autohand-windows-x64.exe'};
try{
 for(const name of ['squad','autohand-squad-daemon','autohand-squad-analytics','autohand-squad-tray','autohand-squad-ui'])await file(join(root,'daemon','target','release',name+exe));
 const web=join(root,'web');for(const name of ['server.mjs','package.json','bun.lock','README.md','dist/index.html','server/harness/index.mjs','server/control-plane/mcp-server.mjs','server/connectors/web-research-mcp.mjs'])await file(join(web,name));
 await file(join(web,'package.json'),JSON.stringify({type:'module'}));
 await cp(new URL('../src/lib/',import.meta.url),join(web,'src/lib'),{recursive:true});
 await file(join(web,'server/routes/workflows.route.mjs'),await readFile(new URL('../server/routes/workflows.route.mjs',import.meta.url),'utf8'));
 for(const name of ['@autohandai/agent-sdk/package.json','@autohandai/agent-sdk/dist/index.js','toml/package.json','yaml/package.json'])await file(join(root,'node_modules',name));
 const cliName=names[`${os}/${arch}`];assert.ok(cliName,'fixture needs a supported native portable target');const cli='pinned CLI fixture';await file(join(root,'vendor/autohand-cli',cliName),cli);const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));await file(join(root,'vendor/autohand-cli/BUILD_INFO.json'),JSON.stringify({version:pkg.autohand.cliVersion,sha256:{[cliName]:digest(cli)}}));
 const engine=join(root,'engine-input'),vendor=join(root,'vendor/computer-use');await mkdir(vendor,{recursive:true});
 await file(join(engine,'cua-driver'+exe),'engine fixture');await file(join(engine,'LICENSE-CUA.md'),'Fixture component notice; not a real license proof.');
 if(os==='darwin')for(const name of ['cua-cursor-theme','libcua_driver_sdk.dylib','cua_driver_node_runtime.node'])await file(join(engine,name));
 const archive=join(vendor,'fixture-engine.tar.gz');run('tar',tarCreateArgs('fixture-engine.tar.gz',engine,'.',os),{cwd:vendor});const archiveDigest=digest(await readFile(archive));
 const host=join(vendor,COMPUTER_USE_HOST.bundleName);if(os==='darwin'){await file(join(host,'Contents/Info.plist'));await file(join(host,'Contents/MacOS',COMPUTER_USE_HOST.executable));await file(join(host,'Contents/Resources/BUILD_PROVENANCE.json'),JSON.stringify({sourceCommit:'1'.repeat(40),branding:{...COMPUTER_USE_HOST}}));await file(join(host,'Contents/Resources/LICENSE-Apache-2.0.txt'),'fixture license');}
 let stageCalls=0;const nativeCheck=(command,args)=>command.endsWith('PlistBuddy')?`${COMPUTER_USE_HOST.bundleId}\n`:command.endsWith('codesign')||command.endsWith('lipo')?'':run(command,args);
 const stageComponent=async(options)=>{stageCalls++;assert.equal(options.platform,os);assert.equal(options.arch,arch);return stageComputerUse({...options,sourceDir:vendor,hostPath:host,assets:{[`${os}/${arch}`]:{name:'fixture-engine.tar.gz',sha256:archiveDigest}},runCommand:nativeCheck});};
 const options={rootDir:root,releaseVersion:version,webRuntimeDir:web,stageComputerComponent:stageComponent};const result=await packageSquadPortable(options);assert.equal(stageCalls,1);
 const unpack=join(root,'unpack');await mkdir(unpack);run('tar',['-xzf',basename(result.archivePath),'-C',os==='win32'?unpack.replace(/\\/g,'/'):unpack],{cwd:dirname(result.archivePath)});const bundled=join(unpack,result.bundleName),component=join(bundled,'vendor/computer-use');
 const workflowRoute=await import(pathToFileURL(join(bundled,'server/routes/workflows.route.mjs')));
 assert.equal(workflowRoute.name,'workflows','Extracted route must resolve its shared runtime imports.');
 const profiles=await import(pathToFileURL(join(bundled,'src/lib/member-profiles.js')));
 assert.equal(profiles.roleTemplates.length,16,'Extracted runtime must include existing member profiles.');
 assert.equal(await readFile(join(component,'cua-driver'+exe),'utf8'),'engine fixture');assert.ok((await readFile(join(component,'LICENSE-CUA.md'),'utf8')).includes('Fixture component notice'));
 const info=JSON.parse(await readFile(join(component,'BUILD_INFO.json'),'utf8'));assert.equal(info.archive.sha256,archiveDigest);assert.equal(info.driver.sha256,digest(await readFile(join(component,info.driver.path))));for(const item of info.files)assert.equal(digest(await readFile(join(component,item.path))),item.sha256,item.path);
 if(os==='darwin'){assert.equal(info.host.sha256,digest(await readFile(join(component,info.host.path))));assert.equal(info.host.bundleId,COMPUTER_USE_HOST.bundleId);assert.deepEqual(info.host.branding,{...COMPUTER_USE_HOST});assert.equal(info.host.path,`${COMPUTER_USE_HOST.bundleName}/Contents/MacOS/${COMPUTER_USE_HOST.executable}`);}assert.equal(await readFile(join(bundled,'vendor/autohand-cli',cliName),'utf8'),cli,'Code CLI and Computer Use must ship together');
 const checksum=await readFile(join(root,'release',`${os}-${arch}`,`checksums-${os}-${arch}.txt`),'utf8');assert.ok(checksum.includes(digest(await readFile(result.archivePath))),'checksum must describe the archive after native component staging');
 const previous=digest(await readFile(result.archivePath));
 if(os==='darwin'){const receipt=join(host,'Contents/Resources/BUILD_PROVENANCE.json');const bytes=await readFile(receipt,'utf8');const bad=JSON.parse(bytes);bad.branding.bundleId='ai.autohand.computer-use';await writeFile(receipt,JSON.stringify(bad));await assert.rejects(packageSquadPortable(options),/unverified branding provenance/);assert.equal(digest(await readFile(result.archivePath)),previous,'shared host identity cannot replace a valid Squad package');await writeFile(receipt,bytes);}
 await writeFile(archive,'corrupt archive');await assert.rejects(packageSquadPortable(options),/immutable component checksum/);assert.equal(digest(await readFile(result.archivePath)),previous,'bad native input must not replace a valid portable archive');
 console.log('Portable Computer Use fixture passed: actual package pipeline/archive contains engine, license, host where required, component manifest and pinned Code CLI; all recorded byte hashes verified; corrupt input fails before publication. Native signatures mocked; no installed/provider/permission proof.');
}finally{await rm(root,{recursive:true,force:true});}
