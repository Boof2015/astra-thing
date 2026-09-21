'use strict';

const $=id=>document.getElementById(id);
const paths={
  play:'<path d="M8 5v14l11-7z"/>',pause:'<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>',
  previous:'<path d="M6 5v14m12-14L8 12l10 7z"/>',next:'<path d="M18 5v14M6 5l10 7-10 7z"/>',
  shuffle:'<path d="M3 5h2c5 0 9 14 14 14h2m-4-4 4 4-4 4M3 19h2c2 0 4-3 6-7m3-5c2-2 3-2 5-2h2m-4-4 4 4-4 4"/>',
  repeat:'<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  volume:'<path d="m11 5-6 4H2v6h3l6 4zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  back:'<path d="m15 5-7 7 7 7"/>',chevron:'<path d="m9 5 7 7-7 7"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',settings:'<path d="M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6M9 15v6"/>',
  keyboard:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 12h1m3 0h1m3 0h1m3 0h1M7 16h10"/>',
  backspace:'<path d="m8 5-6 7 6 7h13V5zM11 9l6 6m0-6-6 6"/>',
  equalizer:'<path d="M5 6h4v14H5zm10-2h4v16h-4z"/>'
};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.play}</svg>`;
document.querySelectorAll('[data-icon]').forEach(node=>{node.innerHTML=icon(node.dataset.icon);});
const time=seconds=>{const n=Math.max(0,Math.floor(Number(seconds)||0));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;};
const text=(id,value)=>{if($(id).textContent!==value) $(id).textContent=value;};
const ui={view:'playing',settingsIndex:0,data:null,inputReady:false,busy:false,trackRef:null,artKey:null,artRetry:0,artSerial:0,
  receivedAt:0,seenUpdatedAt:null,scrubbing:false,scrubTrack:null,seekPending:null,volumeDraft:null,volumeWanted:null,volumeTimer:null,lastVolumeSent:0,volumeInFlight:false,volumeUntil:0,
  hue:190,hasColor:false,toastTimer:null,overlayTimer:null};
const appearance={surface:'light',albumColor:true};
try {const saved=JSON.parse(localStorage.getItem('astra-thing.appearance'));if(['light','dark'].includes(saved?.surface)) appearance.surface=saved.surface;if(typeof saved?.albumColor==='boolean') appearance.albumColor=saved.albumColor;} catch {}
const settingsButtons=[...document.querySelectorAll('.setting-choices button')];
function applyAppearance() {
  const dark=appearance.surface==='dark',color=appearance.albumColor&&ui.hasColor;
  const tone=(s,l)=>`hsl(${ui.hue.toFixed(1)} ${color?s:0}% ${l}%)`;
  const panel=dark?tone(12,16):'#ede8db',ink=dark?'#ede8db':tone(22,19);
  const values={'--base':tone(12,10),'--panel':panel,'--panel-ink':ink,'--key-dark':ink,'--key-quiet':tone(13,19),'--header-ink':'#ede8db',
    '--key-edge':tone(10,31),'--key-down':dark?'#d6d1c5':tone(24,12),'--panel-line':dark?'#ede8db38':'#20252233','--panel-pressed':dark?tone(13,22):'#ded9cc',
    '--selection-edge':'#ede8db','--accent-a':tone(24,34),'--accent-b':tone(15,24)};
  for(const [key,value] of Object.entries(values)) $('screen').style.setProperty(key,value);
  $('screen').dataset.surface=appearance.surface;$('screen').dataset.albumColor=color?'on':'off';
  settingsButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.surface?button.dataset.surface===appearance.surface:button.dataset.albumColor===String(appearance.albumColor))));
}
function artworkColor(image) {
  // Sample once per cover, rather than blur a full image every frame on the device.
  try {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=20;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,20,20);
    const pixels=context.getImageData(0,0,20,20).data;
    let x=0,y=0,weight=0;
    for(let i=0;i<pixels.length;i+=4) {
      const [r,g,b]=[pixels[i],pixels[i+1],pixels[i+2]].map(n=>n/255),max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
      if(pixels[i+3]<200||delta<.08||max<.15||min>.88) continue;
      const hue=((max===r?(g-b)/delta:max===g?(b-r)/delta+2:(r-g)/delta+4)*60+360)%360;
      x+=Math.cos(hue*Math.PI/180)*delta;y+=Math.sin(hue*Math.PI/180)*delta;weight+=delta;
    }
    ui.hasColor=weight>0&&Math.hypot(x,y)/weight>.08;
    if(ui.hasColor) ui.hue=(Math.atan2(y,x)*180/Math.PI+360)%360;
  } catch {ui.hasColor=false;}
  applyAppearance();
}
function refreshArtwork(track) {
  const key=track?.artworkUrl||null;
  if(key===ui.artKey) return;
  ui.artKey=key;ui.artRetry=0;const serial=++ui.artSerial;
  $('main-art').hidden=true;$('art-placeholder').hidden=false;ui.hasColor=false;applyAppearance();
  if(!key) {$('main-art').removeAttribute('src');return;}
  const image=new Image();
  image.onload=()=>{if(serial!==ui.artSerial) return;$('main-art').src=image.src;$('main-art').hidden=false;$('art-placeholder').hidden=true;artworkColor(image);};
  image.onerror=()=>{if(serial===ui.artSerial) ui.artRetry=Date.now()+5000;};
  image.src='/artwork?path='+encodeURIComponent(key);
}
function online(){return Boolean(ui.data?.controls&&ui.inputReady);}
function renderControls() {
  document.querySelectorAll('.transport button').forEach(button=>{button.disabled=!online();});
  $('seek').disabled=!online()||!ui.data?.playback?.currentTrack||!(ui.data?.playback?.durationSeconds>0);
}
function notify(message) {
  clearTimeout(ui.toastTimer);text('toast',message);$('toast').hidden=false;
  ui.toastTimer=setTimeout(()=>{$('toast').hidden=true;},2400);
}
function showVolume() {
  const volume=ui.volumeDraft??ui.data?.playback?.volume??0;
  text('volume-large',String(Math.round(volume*100)));$('volume-fill').style.width=`${volume*100}%`;
  $('volume-overlay').hidden=false;$('toast').hidden=true;clearTimeout(ui.overlayTimer);
  ui.overlayTimer=setTimeout(()=>{$('volume-overlay').hidden=true;},1400);
}
function discardPending() {
  clearTimeout(ui.volumeTimer);ui.volumeTimer=null;ui.volumeWanted=null;ui.volumeDraft=null;ui.seekPending=null;ui.scrubbing=false;
  $('progress-module').classList.remove('is-scrubbing');$('volume-overlay').hidden=true;
}
function render(data) {
  const before=ui.data?.playback,playback=data.playback||{},track=playback.currentTrack;
  ui.data=data;
  if(!data.controls) discardPending();
  if(playback.updatedAt!==ui.seenUpdatedAt) {ui.receivedAt=performance.now();ui.seenUpdatedAt=playback.updatedAt;}
  if((track?.ref||null)!==ui.trackRef) {
    ui.trackRef=track?.ref||null;ui.seekPending=null;ui.scrubbing=false;ui.scrubTrack=null;
    $('progress-module').classList.remove('is-scrubbing');
    text('track-title',track?.title||(data.connected?'Pick a track in Astra':'Connect to Astra'));
    text('track-artist',track?.artist||(data.connected?'Ready when you are.':'Your music, within reach.'));
  } else if(!track) {text('track-title',data.connected?'Pick a track in Astra':'Connect to Astra');text('track-artist',data.connected?'Ready when you are.':'Your music, within reach.');}
  text('connection',!data.connected?data.message:!ui.inputReady?'Controls reconnecting…':playback.state==='playing'?'Playing':track?'Paused':'Ready to play');
  document.querySelector('.playing-dot').style.opacity=data.connected&&playback.state==='playing'?'1':'.35';
  if(!before||before.state!==playback.state) $('play').innerHTML=icon(playback.state==='playing'?'pause':'play');
  $('play').setAttribute('aria-label',playback.state==='playing'?'Pause':'Play');
  $('shuffle').setAttribute('aria-pressed',String(Boolean(playback.shuffle)));
  $('shuffle').setAttribute('aria-label',playback.shuffle?'Disable shuffle':'Enable shuffle');
  $('repeat').setAttribute('aria-pressed',String(playback.repeat&&playback.repeat!=='none'));
  $('repeat').setAttribute('aria-label',playback.repeat==='one'?'Repeat one; switch to all':playback.repeat==='all'?'Repeat all; switch off':'Repeat off; repeat this track');
  if(!before||before.repeat!==playback.repeat) $('repeat').innerHTML=icon('repeat')+(playback.repeat==='one'?'<span class="repeat-mark" aria-hidden="true">1</span>':'');
  if(ui.volumeWanted===null&&!ui.volumeInFlight&&Date.now()>ui.volumeUntil) ui.volumeDraft=null;
  if(before&&Math.abs((before.volume??0)-(playback.volume??0))>.001&&ui.view==='playing') showVolume();
  if(ui.seekPending&&(Math.abs((playback.positionSeconds||0)-ui.seekPending.position)<2||Date.now()>ui.seekPending.until)) ui.seekPending=null;
  if(ui.artRetry&&Date.now()>ui.artRetry) ui.artKey=null;
  refreshArtwork(track);renderControls();renderPosition();
  renderDevice(data);updateMiniPlayers();
}
function renderPosition() {
  const p=ui.data?.playback||{},duration=Math.max(0,p.durationSeconds||0);
  let position=p.positionSeconds||0;
  if(p.state==='playing'&&ui.data?.connected) position+=Math.min(2,(performance.now()-ui.receivedAt)/1000);
  if(ui.seekPending) position=ui.seekPending.position;
  if(ui.scrubbing) position=Number($('seek').value);
  position=Math.max(0,Math.min(duration,position));
  $('seek').max=duration||1;
  if(!ui.scrubbing) $('seek').value=position;
  $('seek').style.setProperty('--progress',`${duration?position/duration*100:0}%`);
  $('seek').setAttribute('aria-valuetext',`${time(position)} of ${time(duration)}`);
  text('elapsed',time(position));text('duration',time(duration));
}
async function requestAction(body,{volume=false}={}) {
  if(!online()||(!volume&&ui.busy)) return false;
  if(!volume) ui.busy=true;
  try {
    const response=await fetch('/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
    if(!response.ok) {if(response.status===409) notify('Track changed. Try again.');else notify('Could not reach Astra. Try again.');return false;}
    return true;
  } catch {notify('Could not reach Astra. Try again.');return false;}
  finally {if(!volume) ui.busy=false;}
}
async function flushVolume() {
  ui.volumeTimer=null;
  if(!online()) {discardPending();return;}
  if(ui.volumeInFlight||ui.busy) {ui.volumeTimer=setTimeout(flushVolume,100);return;}
  const volume=ui.volumeWanted;if(volume===null) return;
  ui.volumeWanted=null;ui.volumeInFlight=true;ui.lastVolumeSent=performance.now();ui.volumeUntil=Date.now()+1800;
  const ok=await requestAction({action:'set-volume',volume},{volume:true});
  ui.volumeInFlight=false;
  if(!ok) {ui.volumeWanted=null;ui.volumeDraft=null;}
  if(ui.volumeWanted!==null) ui.volumeTimer=setTimeout(flushVolume,Math.max(0,750-(performance.now()-ui.lastVolumeSent)));
}
function turnDial(delta) {
  if(ui.view!=='playing') {
    if(isBrowseView(ui.view)) turnBrowseDial(delta);else turnSystemDial(delta);
    return;
  }
  if(!online()) return;
  ui.volumeDraft=Math.round(Math.max(0,Math.min(1,(ui.volumeDraft??ui.data.playback.volume??0)+delta*.02))*100)/100;
  ui.volumeWanted=ui.volumeDraft;ui.volumeUntil=Date.now()+1800;showVolume();
  if(!ui.volumeTimer&&!ui.volumeInFlight) ui.volumeTimer=setTimeout(flushVolume,Math.max(0,750-(performance.now()-ui.lastVolumeSent)));
}
const feedbackTimers=new WeakMap();
function pressFeedback(button) {clearTimeout(feedbackTimers.get(button));button.classList.add('is-pressed');feedbackTimers.set(button,setTimeout(()=>button.classList.remove('is-pressed'),180));}
settingsButtons.forEach((button,index)=>{
  button.onpointerdown=()=>{ui.settingsIndex=index;settingsButtons.forEach(other=>other.classList.remove('dial-selected'));};
  button.onclick=()=>{ui.settingsIndex=index;if(button.dataset.surface) appearance.surface=button.dataset.surface;else appearance.albumColor=button.dataset.albumColor==='true';try{localStorage.setItem('astra-thing.appearance',JSON.stringify(appearance));}catch{}applyAppearance();savePreferences(appearance);};
});
$('screen-navigation').onclick=()=>headerAction();
$('play').onclick=()=>requestAction({action:'toggle'});
$('previous').onclick=()=>requestAction({action:'previous'});
$('next').onclick=()=>requestAction({action:'next'});
$('shuffle').onclick=()=>requestAction({action:'set-shuffle',enabled:!ui.data?.playback?.shuffle});
$('repeat').onclick=()=>requestAction({action:'set-repeat',mode:ui.data?.playback?.repeat==='none'?'one':ui.data?.playback?.repeat==='one'?'all':'none'});
$('seek').onpointerdown=()=>{if(!online())return;ui.scrubbing=true;ui.scrubTrack=ui.trackRef;$('progress-module').classList.add('is-scrubbing');};
$('seek').oninput=()=>{ui.scrubbing=true;ui.scrubTrack??=ui.trackRef;$('progress-module').classList.add('is-scrubbing');renderPosition();};
$('seek').onchange=async()=>{
  const position=Number($('seek').value),trackRef=ui.scrubTrack;
  ui.scrubbing=false;ui.scrubTrack=null;$('progress-module').classList.remove('is-scrubbing');
  if(!trackRef||trackRef!==ui.trackRef) return;
  ui.seekPending={position,until:Date.now()+2000};
  if(!await requestAction({action:'seek',positionSeconds:position,trackRef})) ui.seekPending=null;
};
window.addEventListener('pointercancel',()=>{ui.scrubbing=false;ui.scrubTrack=null;$('progress-module').classList.remove('is-scrubbing');});
document.addEventListener('click',event=>{const button=event.target.closest('button');if(button&&!button.disabled) pressFeedback(button);});
// Raw evdev is the sole owner of physical buttons, including Enter and M.
document.addEventListener('keydown',event=>{if(['Enter','1','2','3','4','Escape','m','M'].includes(event.key))event.preventDefault();});
const inputs=new EventSource('/input-events');
inputs.addEventListener('ready',()=>{ui.inputReady=true;renderControls();});
inputs.addEventListener('input',event=>{try{hardware(JSON.parse(event.data));}catch{notify('Control unavailable');}});
inputs.onerror=()=>{ui.inputReady=false;discardPending();renderControls();};
let healthReportedAt=0;
async function refresh() {
  try {const response=await fetch('/state',{signal:AbortSignal.timeout(3000)});if(!response.ok)throw new Error();render(await response.json());
    if(!system.booting&&ui.inputReady&&Date.now()-healthReportedAt>5000){healthReportedAt=Date.now();fetch('/ui/ready',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(2000)}).catch(()=>{});}
  }
  catch {discardPending();if(ui.data)ui.data.controls=false;text('connection','Reconnecting…');renderControls();}
  finally {setTimeout(refresh,500);}
}
window.addEventListener('DOMContentLoaded',()=>{initializeBrowse();initializeSystem();applyAppearance();renderControls();refresh();setInterval(renderPosition,200);});
