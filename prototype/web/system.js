'use strict';

const systemPages=new Set(['settings','connection','appearance','display','device','info']);
const pairingPages=new Set(['discover','chooser','approval','declined','expired','not-found','pair-error']);
const system={origin:'playing',pairOrigin:'setup',dialIndex:0,editingBrightness:false,confirmation:null,
  booting:true,initialized:false,lastSignature:'',lastPairState:null,lastHost:null,wasConnected:false,
  brightness:100,idle:120,preferencesPending:null,preferencesBusy:false,preferencesTimer:null,preferencesUntil:0,migrated:false,
  consumeUntil:0,lastWake:0,reconnectView:'playing'};
const systemKey=(action,label,classes='')=>`<button class="system-key ${classes}" data-action="${action}">${label}</button>`;
const menuRow=(action,label,detail='',classes='')=>`<button class="menu-row ${classes}" data-action="${action}"><span>${label}</span>${detail?`<small>${escapeHTML(detail)}</small>`:''}${icon('chevron')}</button>`;
const systemCopy=(title,body,extra='',classes='')=>`<div class="system-copy ${classes}">${extra}<h2>${title}</h2>${body?`<p>${body}</p>`:''}</div>`;
const actions=content=>`<div class="system-actions">${content}</div>`;
const statusLabel=(label,waiting=false)=>`<p class="status-label"><span class="signal-mark ${waiting?'waiting':''}"></span>${label}</p>`;
const homeView=()=>ui.data?.paired?ui.data.connected?'playing':'reconnect':'setup';

function showView(requested) {
  let view=ui.data?.management ? 'manager-approval' : requested;
  if((view==='playing'||isBrowseView(view))&&!ui.data?.connected)view=homeView();
  const previous=ui.view;
  if(previous==='search-results')searchUi.scrollTop=$('search-results').scrollTop;
  if(previous==='queue-move'&&view!==previous)queueUi.move=null;
  if(view==='settings'&&!systemPages.has(previous)&&previous!=='confirm')system.origin=previous.endsWith('-actions')?previous.startsWith('queue')?'queue':'search-results':previous;
  ui.view=view;system.dialIndex=0;system.editingBrightness=false;system.lastSignature='';
  $('screen').dataset.view=view;$('screen').dataset.page=view;$('screen').dataset.system=String(!['playing','playlists'].includes(view));
  $('playing-view').hidden=view!=='playing';$('playlists-view').hidden=view!=='playlists';$('settings-view').hidden=view!=='appearance';
  $('queue-view').hidden=!['queue','queue-move'].includes(view);$('queue-actions-view').hidden=view!=='queue-actions';$('queue-position').hidden=!['queue','queue-move'].includes(view);
  $('search-view').hidden=view!=='search';$('search-results-view').hidden=view!=='search-results';$('search-actions-view').hidden=view!=='search-actions';
  $('system-view').hidden=['playing','playlists','appearance'].includes(view)||isBrowseView(view);
  const labels={playing:'Playing',playlists:'Your playlists',queue:'Queue','queue-actions':'Track actions','queue-move':'Move track',search:'Search','search-results':'Search','search-actions':'Track actions',settings:'Settings',appearance:'Appearance',connection:'Connection',display:'Display',device:'Device',info:'Info',setup:'Astra Thing',reconnect:'Connection',confirm:'Device',discover:'Pairing',chooser:'Pairing',approval:'Pairing',approved:'Connected',declined:'Pairing',expired:'Pairing','not-found':'Pairing','pair-error':'Pairing',boot:'Starting up'};
  text('view-label',labels[view]||'Astra Thing');
  const nav=$('screen-navigation');nav.hidden=['boot','approved','confirm','queue','queue-move','manager-approval'].includes(view);nav.disabled=false;
  text('navigation-label',view==='playing'?'Playlists':view==='search-results'?'Edit':['setup','reconnect'].includes(view)?'Settings':'Back');
  nav.lastElementChild.innerHTML=icon(view==='playing'?'grid':view==='search-results'?'keyboard':['setup','reconnect'].includes(view)?'settings':'back');
  nav.setAttribute('aria-label',view==='playing'?'Open playlists':view==='search-results'?'Edit search':['setup','reconnect'].includes(view)?'Open settings':'Back');
  document.querySelectorAll('.dial-selected').forEach(node=>node.classList.remove('dial-selected'));
  $('volume-overlay').hidden=$('toast').hidden=true;ui.scrubbing=false;$('progress-module').classList.remove('is-scrubbing');
  if(!$('system-view').hidden)renderSystemPage();
  if(isBrowseView(view))renderBrowse(view);
  if(view!=='search')document.activeElement?.blur();
}
function renderSystemPage() {
  const data=ui.data||{},host=escapeHTML(data.host||'Astra'),pair=data.pairing||{};
  let html='';
  switch(ui.view) {
    case 'manager-approval': {
      const manager=data.management;if(!manager)break;
      html=`<div class="system-copy pairing-copy"><p class="pair-host">${escapeHTML(manager.label)}</p><h2>Allow maintenance?</h2><p class="pair-code">${escapeHTML(manager.code.replace(/(.{3})(.{3})/,'$1 $2'))}</p><p>Check this code in Thing Manager.</p></div>`+actions(systemKey('manager-reject','Cancel','primary')+systemKey('manager-approve','Allow'));break;
    }
    case 'settings':html=`<div class="system-panel system-menu">${menuRow('connection','Connection',data.paired?data.connected?'Connected':'Offline':'Not paired')}${menuRow('appearance','Appearance',appearance.surface==='light'?'Light':'Dark')}${menuRow('display','Display',system.brightness+'%')}${menuRow('device','Device')}${menuRow('info','Info')}</div>`;break;
    case 'connection':html=systemCopy(data.paired?host:'Not paired yet.',data.paired?data.connected?'Your Thing remembers this computer.':'':'Connect to Astra to get started.',statusLabel(data.paired?data.connected?'Connected':'Offline':'Ready to connect'),`connection-copy ${data.paired&&!data.connected?'connection-offline-copy':''}`)+`<div class="system-panel connection-menu ${data.paired&&!data.connected?'connection-offline-menu':''}">${data.paired&&!data.connected?menuRow('reconnect-now','Reconnect'):''}${menuRow('begin-pair',data.paired?'Pair with Astra again':'Pair with Astra')}${data.paired?menuRow('forget','Forget pairing','','danger'):''}</div>`;break;
    case 'display':html=`<div class="system-panel display-panel"><label class="brightness-heading" for="brightness"><span>Brightness</span><output id="brightness-value">${system.brightness}%</output></label><input id="brightness" class="display-range" type="range" min="25" max="100" step="5" value="${system.brightness}" aria-label="Screen brightness"><div class="setting-row"><div class="setting-copy"><h2 id="idle-label">Dim when idle</h2><p>Tap or turn to wake</p></div><div class="setting-choices" role="group" aria-labelledby="idle-label">${[[0,'Off'],[30,'30 sec'],[120,'2 min']].map(([seconds,label])=>`<button data-idle="${seconds}" aria-pressed="${system.idle===seconds}">${label}</button>`).join('')}</div></div><p class="display-hint" id="brightness-hint">Select the rail to adjust with the dial.</p></div>`;break;
    case 'device':html=`<div class="system-panel device-menu">${menuRow('restart','Restart')}${menuRow('manager-forget','Forget managers')}${menuRow('factory-reset','Factory reset','','danger')}<p class="device-note">Restart keeps your pairing and settings.<br>Factory reset takes you back to setup.</p></div>`;break;
    case 'info':html=systemCopy('Astra Thing.','Car Thing · '+escapeHTML(data.softwareVersion||'Development'),'', 'info-copy')+`<div class="credit-panel"><p>Made with <img class="pixel-heart" src="/assets/pixel-heart.svg" alt="love"></p><strong>by Boof2015</strong></div>`;break;
    case 'setup':html=systemCopy('Meet Astra Thing.','Plug into your computer and open Astra.<br>Let’s get your music over here.')+actions(systemKey('begin-pair',`Find Astra ${icon('chevron')}`,'primary'));break;
    case 'discover':html=systemCopy('Looking for Astra…','Keep Astra open on your computer.',statusLabel('Finding your computer',true))+actions(`<p class="action-note">Connected by USB</p>${systemKey('cancel-pair','Cancel','cancel-key')}`);break;
    case 'chooser':html=systemCopy('Which computer?','Choose the Astra you want to control.','','host-copy')+`<div class="system-panel host-menu">${(pair.hosts||[]).map(host=>`<button class="menu-row" data-host="${escapeHTML(host.id)}"><span>${escapeHTML(host.name)}<small>Astra is open</small></span>${icon('chevron')}</button>`).join('')}</div>`;break;
    case 'approval': {
      const code=(pair.code||'').replace(/(.{3})(.{3})/,'$1 $2');
      html=`<div class="system-copy pairing-copy"><p class="pair-host">${escapeHTML(pair.host||'Astra')}</p><h2>Approve in Astra.</h2><p class="pair-code" aria-label="Pairing code ${escapeHTML(code)}">${escapeHTML(code)}</p><p>Check that the code matches.</p></div>`+actions(`<span class="approval-status"><span class="signal-mark waiting"></span>Waiting for approval</span>${systemKey('cancel-pair','Cancel','cancel-key')}`);break;
    }
    case 'approved':html=systemCopy('You’re connected.',`${host} is ready.`,statusLabel('Paired'))+actions(systemKey('playing',`Let’s play ${icon('chevron')}`,'primary'));break;
    case 'declined':html=systemCopy('Pairing declined.','Astra didn’t approve this connection.<br>You can try again when you’re ready.')+actions(systemKey('cancel-pair','Back')+systemKey('begin-pair','Try again','primary'));break;
    case 'expired':html=systemCopy('That code expired.','Request a new code, then approve it in Astra.')+actions(systemKey('cancel-pair','Back')+systemKey('begin-pair','New code','primary'));break;
    case 'pair-error':html=systemCopy('Couldn’t pair yet.','Check Astra on your computer.<br>Give it a moment, then try again.')+actions(systemKey('cancel-pair','Back')+systemKey('begin-pair','Try again','primary'));break;
    case 'not-found':html=systemCopy('No Astra found.','Open Astra and enable companion connections in its settings.')+actions(systemKey('cancel-pair','Back')+systemKey('begin-pair','Try again','primary'));break;
    case 'reconnect':html=systemCopy(`Waiting for ${host}.`,escapeHTML(data.message||'Open Astra on your computer.'),statusLabel('Reconnecting',true),'reconnect-copy')+actions(systemKey('begin-pair','Pair with Astra')+systemKey('settings','Settings','primary'));break;
    case 'confirm':html=systemCopy(system.confirmation.title,system.confirmation.body)+actions(systemKey('cancel-confirm',system.confirmation.cancel||'Cancel','primary')+systemKey('accept-confirm',system.confirmation.accept,system.confirmation.danger?'danger':''));break;
    case 'boot':html='<div class="boot-screen"><img src="/assets/astra-full.svg" alt="Astra"><p>Starting up…</p></div>';break;
  }
  $('system-view').innerHTML=html;
  if(ui.view==='display'){$('brightness').oninput=()=>setBrightness(Number($('brightness').value));updateDisplayControls();}
}
function renderDevice(data) {
  if(!system.initialized) {
    system.initialized=true;
    if(!data.preferencesSaved&&!system.migrated){system.migrated=true;savePreferences(appearance);}
  }
  if(Date.now()>system.preferencesUntil&&!system.preferencesBusy&&!system.preferencesPending) {
    Object.assign(appearance,{surface:data.preferences.surface,albumColor:data.preferences.albumColor});
    system.brightness=data.preferences.brightness;system.idle=data.preferences.idle;applyAppearance();
  }
  // Backlight dimming is native. The display overlay is only a wake hint.
  $('screen').dataset.dimmed=String(data.dimmed);
  if(system.booting)return;
  if(data.management){if(ui.view!=='manager-approval'||system.managementId!==data.management.id){system.managementId=data.management.id;localRequest('/wake',{}).catch(()=>{});showView('manager-approval');}return;}
  if(ui.view==='manager-approval'){system.managementId=null;showView(homeView());}
  if(system.lastHost!==null&&system.lastHost!==data.host)clearBrowseData();
  system.lastHost=data.host;
  const pair=data.pairing||{},state=pair.state;
  if(state!==system.lastPairState) {
    system.lastPairState=state;
    if(pairingPages.has(ui.view)) {
      if(state==='choose') {if(pair.hosts?.length===1)startPairing(pair.hosts[0].id);else showView('chooser');}
      else if(state==='approval')showView('approval');
      else if(state==='approved'){clearBrowseData();showView('approved');}
      else if(['declined','expired','not-found','error'].includes(state))showView(state==='error'?'pair-error':state);
    }
  }
  if(!data.connected&&system.wasConnected&&(ui.view==='playing'||isBrowseView(ui.view))) {system.reconnectView=ui.view.endsWith('-actions')?ui.view.startsWith('queue')?'queue':'search-results':ui.view;showView(homeView());}
  if(data.connected&&!system.wasConnected&&ui.view==='reconnect')showView(system.reconnectView);
  system.wasConnected=data.connected;
  if(data.connected&&isBrowseView(ui.view)&&ui.view.startsWith('queue'))refreshQueue();
  if(shelf.revision!==data.libraryRevision){const had=shelf.revision!==null;shelf.revision=data.libraryRevision;shelf.pages=[];if(had&&ui.view==='playlists')loadShelf(0,{reset:true});}
  const signature=JSON.stringify([ui.view,data.host,data.connected,data.paired,state,pair.code,appearance.surface]);
  if(!$('system-view').hidden&&signature!==system.lastSignature){system.lastSignature=signature;renderSystemPage();}
}
function headerAction() {if(ui.view==='playing')showView('playlists');else if(ui.view==='search-results')showView('search');else if(['setup','reconnect'].includes(ui.view))openSettings();else backAction();}
function openSettings() {
  if(system.booting)return;
  if(pairingPages.has(ui.view)){localRequest('/pair/cancel',{}).catch(()=>{});}
  if(systemPages.has(ui.view))showView(system.origin);else if(ui.view==='confirm')backAction();else showView('settings');
}
function backAction() {
  if(system.booting)return;
  if(ui.view==='queue-actions'||ui.view==='queue-move'){queueUi.move=null;showView('queue');}
  else if(ui.view==='search-actions')showView('search-results');
  else if(ui.view==='search'&&searchUi.submitted){searchUi.draft=searchUi.query;showView('search-results');}
  else if(ui.view==='confirm'){const target=system.confirmation.returnView;system.confirmation=null;showView(target);}
  else if(pairingPages.has(ui.view))cancelPairing();
  else if(ui.view==='settings')showView(system.origin);
  else if(systemPages.has(ui.view))showView('settings');
  else showView(homeView());
}
async function beginPairing() {
  system.pairOrigin=ui.view==='connection'?'connection':homeView();system.lastPairState=null;
  showView('discover');
  try{await localRequest('/pair/discover',{});}catch(error){reportFailure(error);showView('pair-error');}
}
async function startPairing(hostId) {showView('discover');try{await localRequest('/pair/start',{hostId});}catch(error){reportFailure(error);showView('pair-error');}}
async function cancelPairing() {try{await localRequest('/pair/cancel',{});showView(system.pairOrigin);}catch(error){reportFailure(error);}}
function confirmAction(kind) {
  const base={kind,returnView:ui.view};
  if(kind==='restart')system.confirmation={...base,title:'Restart Astra Thing?',body:'Your pairing and settings will be here<br>when it starts again.',accept:'Restart'};
  else if(kind==='forget')system.confirmation={...base,title:'Forget this computer?',body:'You’ll need to pair with Astra again.<br>Your appearance settings will stay.',accept:'Forget pairing',danger:true};
  else system.confirmation={...base,title:'Reset Astra Thing?',body:'This clears your pairing and settings.<br>Astra Thing stays installed.',accept:'Continue',danger:true};
  showView('confirm');
}
async function acceptConfirmation() {
  const confirm=system.confirmation;if(!confirm||ui.busy)return;
  if(confirm.kind==='factory-reset'){system.confirmation={...confirm,kind:'reset-final',title:'Start fresh?',body:'This Thing will return to first-time setup.<br>Your music in Astra stays untouched.',accept:'Reset Thing',cancel:'Keep my setup'};showView('confirm');return;}
  if(confirm.kind==='manager-forget'){try{await localRequest('/manager/forget',{});system.confirmation=null;showView('device');notify('Managers forgotten');}catch(error){reportFailure(error);}return;}
  const action=confirm.kind==='reset-final'?'factory-reset':confirm.kind;ui.busy=true;
  try{
    clearTimeout(system.preferencesTimer);
    await flushPreferences();
    while(system.preferencesBusy)await new Promise(resolve=>setTimeout(resolve,20));
    await localRequest('/device',{action,confirmation:action});system.confirmation=null;
    if(action==='restart'){system.booting=true;showView('boot');setTimeout(()=>location.reload(),6500);return;}
    clearBrowseData();discardPending();
    if(action==='factory-reset'){Object.assign(appearance,{surface:'light',albumColor:true});system.brightness=100;system.idle=120;localStorage.removeItem('astra-thing.appearance');applyAppearance();}
    ui.data.paired=false;ui.data.connected=false;ui.data.host=null;ui.data.playback=null;system.origin='setup';showView('setup');
  }catch(error){reportFailure(error);}finally{ui.busy=false;}
}
function savePreferences(patch) {
  system.preferencesPending={...system.preferencesPending,...patch};system.preferencesUntil=Date.now()+1500;
  clearTimeout(system.preferencesTimer);system.preferencesTimer=setTimeout(flushPreferences,180);
}
async function flushPreferences() {
  if(system.preferencesBusy)return;
  const patch=system.preferencesPending;if(!patch)return;system.preferencesPending=null;system.preferencesBusy=true;
  try{await localRequest('/preferences',patch);}
  catch(error){reportFailure(error);}
  finally{system.preferencesBusy=false;system.preferencesUntil=Date.now()+600;if(system.preferencesPending)flushPreferences();}
}
function setBrightness(value) {system.brightness=Math.max(25,Math.min(100,Math.round(value/5)*5));savePreferences({brightness:system.brightness});updateDisplayControls();}
function updateDisplayControls() {if(!$('brightness'))return;$('brightness').value=system.brightness;$('brightness').style.setProperty('--progress',`${(system.brightness-25)/75*100}%`);$('brightness-value').textContent=system.brightness+'%';}
function systemControls() {return [...$(ui.view==='appearance'?'settings-view':'system-view').querySelectorAll('button:not(:disabled),input')];}
function markSystemDial() {systemControls().forEach((node,index)=>node.classList.toggle('dial-selected',index===system.dialIndex));}
function turnSystemDial(delta) {
  if(ui.view==='display'&&system.editingBrightness){setBrightness(system.brightness+Math.sign(delta)*5);return;}
  system.dialIndex=Math.max(0,Math.min(systemControls().length-1,system.dialIndex+Math.sign(delta)));markSystemDial();
}
function pressSystemDial() {
  const control=systemControls()[system.dialIndex];if(!control)return;
  if(control.id==='brightness'){system.editingBrightness=!system.editingBrightness;control.classList.toggle('is-editing',system.editingBrightness);$('brightness-hint').textContent=system.editingBrightness?'Turn to adjust. Press to finish.':'Select the rail to adjust with the dial.';markSystemDial();}
  else {const previous=ui.view;control.click();if(ui.view===previous)markSystemDial();}
}
function hardware(data) {
  if(system.booting)return;
  if(ui.data?.management){
    if(data.type==='dial')turnSystemDial(data.delta);
    else if(data.key==='press')pressSystemDial();
    else if(data.key==='back')managerAction('reject');
    return;
  }
  if(data.type==='dial'){turnDial(data.delta);return;}
  if(data.key==='settings')openSettings();
  else if(data.key==='back')backAction();
  else if(['playing','playlists','queue','search'].includes(data.key)){if(pairingPages.has(ui.view))return;showView(data.key==='search'&&searchUi.submitted?'search-results':data.key);}
  else if(data.key==='press'){if(ui.view==='playing'){pressFeedback($('play'));requestAction({action:'toggle'});}else if(isBrowseView(ui.view))pressBrowseDial();else pressSystemDial();}
}
function initializeSystem() {
  showView('boot');
  setTimeout(()=>{system.booting=false;showView(homeView());},1100);
  $('system-view').onclick=event=>{
    const button=event.target.closest('button');if(!button)return;
    const index=systemControls().indexOf(button);if(index>=0)system.dialIndex=index;
    if(button.dataset.host){startPairing(button.dataset.host);return;}
    if(button.dataset.idle!==undefined){system.idle=Number(button.dataset.idle);savePreferences({idle:system.idle});document.querySelectorAll('[data-idle]').forEach(node=>node.setAttribute('aria-pressed',String(Number(node.dataset.idle)===system.idle)));return;}
    const action=button.dataset.action;
    if(action==='manager-approve'||action==='manager-reject')managerAction(action.slice(8));
    else if(action==='manager-forget') {system.confirmation={kind:'manager-forget',returnView:'device',title:'Forget managers?',body:'Computers will need approval again<br>to maintain this Thing.',accept:'Forget',danger:true};showView('confirm');}
    else if(systemPages.has(action)||action==='playing')showView(action);
    else if(action==='begin-pair')beginPairing();else if(action==='cancel-pair')cancelPairing();
    else if(action==='reconnect-now'){localRequest('/reconnect',{}).catch(reportFailure);showView('reconnect');}
    else if(['restart','forget','factory-reset'].includes(action))confirmAction(action);
    else if(action==='cancel-confirm')backAction();else if(action==='accept-confirm')acceptConfirmation();
  };
  for(const id of ['system-view','settings-view','queue-actions-view','search-actions-view'])$(id).addEventListener('pointerdown',event=>{
    const button=event.target.closest('button,input');if(!button)return;
    $(id).querySelectorAll('.dial-selected').forEach(node=>node.classList.remove('dial-selected'));
    if(id==='system-view'||id==='settings-view')system.dialIndex=systemControls().indexOf(button);
    else {const model=id==='queue-actions-view'?queueUi:searchUi;model.actionIndex=activeActionButtons().indexOf(button);}
  });
  document.addEventListener('pointerdown',event=>{
    if(ui.data?.dimmed){system.consumeUntil=Date.now()+600;event.preventDefault();event.stopImmediatePropagation();localRequest('/wake',{}).catch(()=>{});return;}
    if(Date.now()-system.lastWake>2000){system.lastWake=Date.now();localRequest('/wake',{}).catch(()=>{});}
  },true);
  document.addEventListener('click',event=>{if(Date.now()<system.consumeUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
}

async function managerAction(action) {
  const manager=ui.data?.management;if(!manager||ui.busy)return;ui.busy=true;
  try{await localRequest('/manager/'+action,{id:manager.id,code:manager.code});ui.data.management=null;showView(homeView());}
  catch(error){reportFailure(error);}finally{ui.busy=false;}
}
