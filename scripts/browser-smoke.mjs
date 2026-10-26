// Browser smoke test: Node built-ins + installed headless Chrome, no runtime deps.
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {spawn} from 'node:child_process';

const root=process.cwd();
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png'};
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const server=createServer(async(req,res)=>{
 const relative=new URL(req.url,'http://localhost').pathname.replace(/^\/survival-game\/?/, '')||'index.html';
 const file=resolve(root,relative);
 if(!file.startsWith(root+'/')||!existsSync(file)){res.writeHead(404);res.end('not found');return;}
 try{const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});res.end(bytes);}
 catch(err){res.writeHead(500);res.end(String(err));}
});
await new Promise(done=>server.listen(8765,'127.0.0.1',done));
const profile=await mkdtemp(join(tmpdir(),'survival-chrome-'));
const chrome=spawn(process.env.CHROME_BIN||'google-chrome',[
 '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
 '--no-first-run','--no-default-browser-check',
 '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'
],{stdio:['ignore','ignore','pipe']});
let chromeLogs='';chrome.stderr.on('data',chunk=>{chromeLogs+=chunk.toString().slice(0,1000)});
let socket;
const failures=[];
try {
 let port=null;
 for(let i=0;i<80;i++){
  const active=join(profile,'DevToolsActivePort');
  if(existsSync(active)){port=Number(readFileSync(active,'utf8').split('\n')[0]);break;}
  if(chrome.exitCode!==null)throw Error('Chrome exited: '+chromeLogs);
  await sleep(100);
 }
 if(!port)throw Error('Chrome did not launch: '+chromeLogs);
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const tab=tabs.find(item=>item.type==='page');
 if(!tab)throw Error('No page target');
 socket=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((ok,no)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',no,{once:true});});
 const callbacks=new Map();let counter=0;
 socket.addEventListener('message',event=>{
  const msg=JSON.parse(event.data);
  if(msg.id&&callbacks.has(msg.id)){
   const pair=callbacks.get(msg.id);callbacks.delete(msg.id);
   msg.error?pair.reject(Error(msg.error.message)):pair.resolve(msg.result);
  }
  if(msg.method==='Runtime.exceptionThrown'){
   const d=msg.params.exceptionDetails;failures.push('EXCEPTION '+d.text+' '+(d.exception?.description||''));
  }
  if(msg.method==='Runtime.consoleAPICalled'&&msg.params.type==='error')
   failures.push('CONSOLE '+msg.params.args.map(a=>a.value||a.description||'').join(' '));
  if(msg.method==='Network.loadingFailed')
   failures.push('NETWORK '+msg.params.errorText+' '+(msg.params.blockedReason||''));
 });
 const send=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++counter;callbacks.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
  setTimeout(()=>{if(callbacks.has(id)){callbacks.delete(id);reject(Error(method+' timeout'))}},20000).unref();
 });
 for(const method of ['Page.enable','Runtime.enable','Log.enable','Network.enable'])await send(method);
 await send('Page.navigate',{url:'http://127.0.0.1:8765/survival-game/'});
 let state=null;
 const expression='({ready:Boolean(window.game?.scene && window.game?.engine && window.game?.playerSystem), title:document.title, loading:document.getElementById("loadingText")?.textContent||"", sceneReady:Boolean(window.game?.scene?.isReady?.()), chunks:window.game?.terrainSystem?.chunkMap?.size||0,meshes:window.game?.scene?.meshes?.length||0,paused:window.game?.paused})';
 for(let i=0;i<100;i++){
  await sleep(160);
  const result=await send('Runtime.evaluate',{expression,returnByValue:true});
  state=result.result?.value;
  if(state?.ready&&state?.sceneReady)break;
 }
 await sleep(1200);
 const details=await send('Runtime.evaluate',{expression:'({loadingVisible:getComputedStyle(document.getElementById("loadingScreen")).display!=="none",touchEnabled:Boolean(window.game?.touchControls?.enabled),bodyClass:document.body.className,gamePaused:window.game?.paused})',returnByValue:true});
 console.log('BROWSER_RESULT '+JSON.stringify({state,details:details.result?.value,failures:failures.slice(0,25)}));
 if(details.result?.value?.loadingVisible)throw Error('Loading screen still visible despite ready scene');
 // Resume actual gameplay and capture frame-time exceptions.
 await send('Runtime.evaluate',{expression:'window.game.uiSystem.closePanel()'});
 await sleep(1300);
 const started=await send('Runtime.evaluate',{expression:'({paused:window.game.paused, dayTime:window.game.dayTime, health:window.game.playerSystem.health})',returnByValue:true});
 console.log('PLAYING_RESULT '+JSON.stringify(started.result?.value));
 if(started.result?.value?.paused)throw Error('Game failed to resume after title menu');
 if(!state?.ready||!state?.sceneReady||failures.some(s=>s.startsWith('EXCEPTION')||s.startsWith('CONSOLE Error initializing')))
  throw Error('Browser startup smoke test failed');
 console.log('PASS: Browser loaded Babylon, generated chunks and initialized game.');
 // Simulate an Android-size touchscreen with Chrome's built-in emulation.
 await send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2,mobile:true});
 await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
 await send('Runtime.evaluate',{expression:'window.game=undefined'});
 await send('Page.navigate',{url:'http://127.0.0.1:8765/survival-game/?mobile=1'});
 let touchState=null;
 for(let i=0;i<85;i++){
  await sleep(160);
  const result=await send('Runtime.evaluate',{expression:'({ready:Boolean(window.game?.scene?.isReady?.()),touch:Boolean(window.game?.touchControls?.enabled),visible:Boolean(window.game?.touchControls?.controls),coarse:matchMedia("(pointer: coarse)").matches,joystick:getComputedStyle(document.getElementById("touch-controls")||document.body).display})',returnByValue:true});
  touchState=result.result?.value;
  if(touchState?.ready&&touchState?.touch)break;
 }
 console.log('MOBILE_RESULT '+JSON.stringify(touchState));
 if(!touchState?.ready||!touchState?.touch||!touchState?.visible)
  throw Error('Mobile viewport failed to initialize touchscreen controls');
 console.log('PASS: Android-emulated touchscreen game controls were initialized.');
 await send('Runtime.evaluate',{expression:'window.game.uiSystem.closePanel()'});
 await sleep(500);
 const mobilePlaying=await send('Runtime.evaluate',{expression:'({paused:window.game.paused,stickDisplay:getComputedStyle(document.getElementById("touch-controls")).display,stickHidden:document.getElementById("touch-controls").hidden,joystickPointer:getComputedStyle(document.getElementById("touch-stick")).pointerEvents,menuVisible:getComputedStyle(document.getElementById("modal")).display,anyCoarse:matchMedia("(any-pointer: coarse)").matches})',returnByValue:true});
 console.log('MOBILE_PLAYING '+JSON.stringify(mobilePlaying.result?.value));
 if(mobilePlaying.result?.value?.paused||mobilePlaying.result?.value?.stickDisplay==='none')
  throw Error('Touch controls are hidden when mobile gameplay resumes');
}finally{
 if(socket)socket.close();
 chrome.kill('SIGKILL');server.close();
 // Chromium briefly keeps profile files open during shutdown.
 if(chrome.exitCode===null)await new Promise(done=>{chrome.once('exit',done);setTimeout(done,2500).unref()});
 await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:120});
}
