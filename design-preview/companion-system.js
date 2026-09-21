'use strict';

// Local interaction study only. Hosts and approvals below are fictional fixtures.
// No discovery, credentials, OS settings, device commands, or network requests.
const hosts = [
  {id:'studio', name:'Studio Mac', detail:'Astra is open'},
  {id:'desk', name:'Desk Mac', detail:'Astra is open'}
];
const connectionKey = 'astra-thing.study05.connection';
const displayKey = 'astra-thing.study05.display';
const system = {
  host:null, connected:false, origin:'playing', pairOrigin:'setup', candidate:null,
  timer:null, expiry:null, deadline:0, code:'', confirmation:null,
  dialIndex:0, editingBrightness:false, dimmed:false, lastInput:Date.now(),
  brightness:100, idle:120, bootNext:'setup'
};
const systemPages = new Set(['settings','connection','appearance','display','device','info']);
const pairingPages = new Set(['discover','chooser','approval','declined','expired','not-found']);
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const systemKey = (action,label,classes='') => `<button class="system-key ${classes}" data-action="${action}">${label}</button>`;
const menuRow = (action,label,detail='',classes='') => `<button class="menu-row ${classes}" data-action="${action}"><span>${label}</span>${detail ? `<small>${detail}</small>` : ''}${icon('chevron')}</button>`;
const systemCopy = (title,body,extra='',classes='') => `<div class="system-copy ${classes}">${extra}<h2>${title}</h2>${body ? `<p>${body}</p>` : ''}</div>`;
const actions = content => `<div class="system-actions">${content}</div>`;
const statusLabel = (label,waiting=false) => `<p class="status-label"><span class="signal-mark ${waiting ? 'waiting' : ''}"></span>${label}</p>`;

function storeConnection() {
  try { localStorage.setItem(connectionKey, JSON.stringify({hostId:system.host?.id || null})); } catch { /* Session-only preview. */ }
}
function storeDisplay() {
  try { localStorage.setItem(displayKey, JSON.stringify({brightness:system.brightness,idle:system.idle})); } catch { /* Session-only preview. */ }
}
function cancelTransitions() {
  clearTimeout(system.timer); clearTimeout(system.expiry);
  system.timer = system.expiry = null;
}
function later(view,delay) {
  clearTimeout(system.timer);
  const from = state.view;
  system.timer = setTimeout(() => { if (state.view === from) navigate(view); },delay);
}
function homeView() { return system.host ? system.connected ? 'playing' : 'reconnect' : 'setup'; }

function navigate(requested) {
  let view = requested;
  if ((['playing','playlists'].includes(view) || isQueuePage(view) || isSearchPage(view)) && !system.connected) view = homeView();
  const previousView = state.view;
  if (previousView==='search-results') searchUi.scrollTop=$('search-results').scrollTop;
  if (previousView === 'queue-move' && view !== previousView) previewQueue.cancelMove();
  cancelTransitions(); endScrub(); clearTimeout(shelfSettleTimer); pendingShelfPage = null;
  if (view === 'settings' && !systemPages.has(previousView) && previousView !== 'confirm') {
    system.origin = isSearchPage(previousView) ? previousView==='search-actions' ? 'search-results' : previousView : isQueuePage(previousView) ? 'queue' : ['playing','playlists','setup','reconnect'].includes(previousView) ? previousView : homeView();
  }
  state.view = view;
  system.dialIndex = 0;
  system.editingBrightness = false;
  const isSystem = !['playing','playlists'].includes(view);
  $('screen').dataset.system = String(isSystem);
  $('screen').dataset.page = view;
  $('playing-view').hidden = view !== 'playing';
  $('playlists-view').hidden = view !== 'playlists';
  $('queue-view').hidden = !['queue','queue-move'].includes(view);
  $('queue-actions-view').hidden = view !== 'queue-actions';
  $('queue-position').hidden = !['queue','queue-move'].includes(view);
  $('search-view').hidden = view !== 'search';
  $('search-results-view').hidden = view !== 'search-results';
  $('search-actions-view').hidden = view !== 'search-actions';
  $('settings-view').hidden = view !== 'appearance';
  $('system-view').hidden = !isSystem || view === 'appearance' || isQueuePage(view) || isSearchPage(view);
  const labels = {search:'Search','search-results':'Search','search-actions':'Track actions',queue:'Queue','queue-actions':'Track actions','queue-move':'Move track',settings:'Settings',appearance:'Appearance',connection:'Connection',display:'Display',device:'Device',info:'Info',setup:'Astra Thing',reconnect:'Connection',confirm:system.confirmation?.kind === 'forget' ? 'Connection' : 'Device',discover:'Pairing',chooser:'Pairing',approval:'Pairing',approved:'Connected',declined:'Pairing',expired:'Pairing','not-found':'Pairing',boot:'Starting up'};
  $('view-label').removeAttribute('title');
  $('view-label').textContent = view === 'playlists' ? 'Your playlists' : labels[view] || 'Playing';
  $('navigation-label').textContent = view === 'playing' ? 'Playlists' : ['setup','reconnect'].includes(view) ? 'Settings' : 'Back';
  $('screen-navigation').hidden = ['boot','approved','confirm','queue','queue-move'].includes(view);
  $('screen-navigation').setAttribute('aria-label', view === 'playing' ? 'Open playlists' : ['setup','reconnect'].includes(view) ? 'Open settings' : 'Back');
  $('screen-navigation').lastElementChild.innerHTML = icon(view === 'playing' ? 'grid' : ['setup','reconnect'].includes(view) ? 'settings' : 'back');
  if (view==='search-results') {
    $('navigation-label').textContent='Edit';
    $('screen-navigation').setAttribute('aria-label','Edit search');
    $('screen-navigation').lastElementChild.innerHTML=icon('keyboard');
  }
  $('device-settings').disabled = view === 'boot';
  $('device-settings').setAttribute('aria-pressed', String(systemPages.has(view)));
  $('device-settings').setAttribute('aria-label', systemPages.has(view) ? 'Close settings' : 'Open settings');
  $('dial').setAttribute('aria-label', view === 'queue-move' ? 'Press dial: place track here' : view === 'queue' ? 'Press dial: track actions' : isSystem ? 'Press dial: select' : view === 'playlists' ? 'Press dial: play selected playlist' : 'Press dial: play or pause');
  if (isSearchPage(view)) $('dial').setAttribute('aria-label',view==='search' ? 'Press dial: search' : view==='search-results' ? 'Press dial: track actions' : 'Press dial: select');
  settingButtons.forEach(button => button.classList.remove('dial-selected'));
  document.querySelectorAll('button[data-view]').forEach(button => {
    button.disabled = !system.connected || view === 'boot';
    const active=button.dataset.view === view || (button.dataset.view === 'queue' && isQueuePage(view)) || (button.dataset.view === 'search' && isSearchPage(view));
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('volume-overlay').hidden = $('toast').hidden = true;
  if (view !== 'appearance' && isSystem && !isQueuePage(view) && !isSearchPage(view)) renderSystemPage();
  else $('system-view').replaceChildren();
  if (isQueuePage(view)) renderQueuePage(view,previousView);
  if (isSearchPage(view)) renderSearchPage(view);
  selectPlaylist(state.selected,{animate:previousView === view});
  $('pairing-simulation').hidden = view !== 'approval';
  $('discovery-simulation').hidden = !['discover','chooser','not-found'].includes(view);
  $('reconnect-simulation').hidden = view !== 'reconnect';
  applyDisplay();
  if (view === 'discover') later('chooser',1800);
  if (view === 'approval') {
    $('desktop-code').textContent = system.code;
    system.expiry = setTimeout(() => finishPairing('expired'),Math.max(0,system.deadline-Date.now()));
  }
  if (view === 'approved') later('playing',1500);
  if (view === 'boot') later(system.bootNext,1600);
  // A transition may remove the focused key; keep keyboard interaction on the device.
  if (document.activeElement === document.body || document.activeElement?.closest('[hidden]')) $('dial').focus({preventScroll:true});
}

function renderSystemPage() {
  let html = '';
  const hostName = escapeHTML(system.host?.name || 'Astra');
  switch (state.view) {
    case 'settings':
      html = `<div class="system-panel system-menu">${menuRow('connection','Connection',system.host ? system.connected ? 'Connected' : 'Offline' : 'Not paired')}${menuRow('appearance','Appearance',appearance.surface === 'light' ? 'Light' : 'Dark')}${menuRow('display','Display',`${system.brightness}%`)}${menuRow('device','Device')}${menuRow('info','Info')}</div>`;
      break;
    case 'connection':
      html = systemCopy(system.host ? hostName : 'Not paired yet.',system.host ? system.connected ? 'Your Thing remembers this computer.' : '' : 'Connect to Astra to get started.',statusLabel(system.host ? system.connected ? 'Connected' : 'Offline' : 'Ready to connect'),`connection-copy ${system.host && !system.connected ? 'connection-offline-copy' : ''}`);
      html += `<div class="system-panel connection-menu ${system.host && !system.connected ? 'connection-offline-menu' : ''}">${system.host && !system.connected ? menuRow('reconnect','Reconnect') : ''}${menuRow('begin-pair',system.host ? 'Pair another computer' : 'Pair with Astra')}${system.host ? menuRow('forget','Forget pairing','','danger') : ''}</div>`;
      break;
    case 'display':
      html = `<div class="system-panel display-panel"><label class="brightness-heading" for="brightness"><span>Brightness</span><output id="brightness-value">${system.brightness}%</output></label><input id="brightness" class="display-range" type="range" min="25" max="100" step="5" value="${system.brightness}" aria-label="Screen brightness"><div class="setting-row"><div class="setting-copy"><h2 id="idle-label">Dim when idle</h2><p>Tap or turn to wake</p></div><div class="setting-choices" role="group" aria-labelledby="idle-label">${[[0,'Off'],[30,'30 sec'],[120,'2 min']].map(([seconds,label]) => `<button data-idle="${seconds}" aria-pressed="${system.idle === seconds}">${label}</button>`).join('')}</div></div><p class="display-hint" id="brightness-hint">Select the rail to adjust with the dial.</p></div>`;
      break;
    case 'device':
      html = `<div class="system-panel device-menu">${menuRow('restart','Restart')}${menuRow('factory-reset','Factory reset','','danger')}<p class="device-note">Restart keeps your pairing and settings.<br>Factory reset takes you back to setup.</p></div>`;
      break;
    case 'info':
      html = systemCopy('Astra Thing.','Car Thing · Interface preview 05','', 'info-copy') + `<div class="credit-panel"><p>Made with <img class="pixel-heart" src="assets/pixel-heart.svg" alt="love"></p><strong>by Boof2015</strong></div>`;
      break;
    case 'setup':
      html = systemCopy('Meet Astra Thing.','Plug into your computer and open Astra.<br>Let’s get your music over here.') + actions(systemKey('begin-pair',`Find Astra ${icon('chevron')}`,'primary'));
      break;
    case 'discover':
      html = systemCopy('Looking for Astra…','Keep Astra open on your computer.',statusLabel('Finding your computer',true)) + actions(`<p class="action-note">Connected by USB</p>${systemKey('cancel-pair','Cancel','cancel-key')}`);
      break;
    case 'chooser':
      html = systemCopy('Which computer?','Choose the Astra you want to control.','','host-copy') + `<div class="system-panel host-menu">${hosts.map(host => `<button class="menu-row" data-host="${host.id}"><span>${host.name}<small>${host.detail}</small></span>${icon('chevron')}</button>`).join('')}</div>`;
      break;
    case 'approval':
      html = `<div class="system-copy pairing-copy"><p class="pair-host">${escapeHTML(system.candidate.name)}</p><h2>Approve in Astra.</h2><p class="pair-code" aria-label="Pairing code ${system.code.split('').join(' ')}">${system.code}</p><p>Check that the code matches.</p></div>` + actions(`<span class="approval-status"><span class="signal-mark waiting"></span>Waiting for approval</span>${systemKey('cancel-pair','Cancel','cancel-key')}`);
      break;
    case 'approved':
      html = systemCopy('You’re connected.',`${hostName} is ready.`,statusLabel('Paired')) + actions(systemKey('playing',`Let’s play ${icon('chevron')}`,'primary'));
      break;
    case 'declined':
      html = systemCopy('Pairing declined.','Astra didn’t approve this connection.<br>You can try again when you’re ready.') + actions(systemKey('cancel-pair','Back')+systemKey('retry-pair','Try again','primary'));
      break;
    case 'expired':
      html = systemCopy('That code expired.','Request a new code, then approve it in Astra.') + actions(systemKey('cancel-pair','Back')+systemKey('retry-pair','New code','primary'));
      break;
    case 'not-found':
      html = systemCopy('No Astra found.','Open Astra on your computer and check the USB connection.') + actions(systemKey('cancel-pair','Back')+systemKey('scan-again','Try again','primary'));
      break;
    case 'reconnect':
      html = systemCopy(`Waiting for ${hostName}.`,'We’ll reconnect when Astra is available.',statusLabel('Connection lost',true)) + actions(systemKey('connection','Connection settings','primary'));
      break;
    case 'confirm': {
      const confirm = system.confirmation;
      html = systemCopy(confirm.title,confirm.body) + actions(systemKey('cancel-confirm',confirm.cancel || 'Cancel','primary')+systemKey('accept-confirm',confirm.accept,confirm.danger ? 'danger' : ''));
      break;
    }
    case 'boot':
      html = `<div class="boot-screen"><img src="assets/astra-wordmark.svg" alt="Astra"><p>Starting up…</p></div>`;
      break;
  }
  $('system-view').innerHTML = html;
  $('system-view').setAttribute('aria-label', state.view === 'confirm' ? system.confirmation.title : $('view-label').textContent);
  if (state.view === 'display') {
    $('brightness').addEventListener('input',() => setBrightness(Number($('brightness').value)));
  }
}

function handleHeaderAction() {
  if (state.view === 'search-results') navigate('search');
  else if (state.view === 'playing') navigate('playlists');
  else if (['setup','reconnect'].includes(state.view)) openSettings();
  else systemBack();
}
function openSettings() {
  if (state.view === 'boot') return;
  if (state.view === 'confirm') { systemBack(); return; }
  if (systemPages.has(state.view)) { navigate(system.origin); return; }
  if (pairingPages.has(state.view)) system.candidate = null;
  navigate('settings');
}
function systemBack() {
  if (state.view === 'boot') return;
  if (state.view==='search-actions') { navigate('search-results');return; }
  if (state.view==='search' && searchUi.submitted) { searchUi.draft=searchUi.query;navigate('search-results');return; }
  if (['queue-actions','queue-move'].includes(state.view)) { navigate('queue'); return; }
  if (state.view === 'confirm') { const target=system.confirmation.returnView; system.confirmation=null; navigate(target); return; }
  if (pairingPages.has(state.view)) { cancelPairing(); return; }
  if (state.view === 'settings') { navigate(system.origin); return; }
  if (systemPages.has(state.view)) { navigate('settings'); return; }
  if (state.view === 'setup') return;
  navigate(homeView());
}
function startPairing() {
  system.pairOrigin = state.view === 'connection' ? 'connection' : homeView();
  system.candidate = null;
  navigate('discover');
}
function requestPairing(host) {
  system.candidate = host;
  // Display-only mock code. A real handshake must supply its own verification code.
  const value = String(Math.floor(100000+Math.random()*900000));
  system.code = `${value.slice(0,3)} ${value.slice(3)}`;
  system.deadline = Date.now()+120000;
  navigate('approval');
}
function finishPairing(result) {
  if (state.view !== 'approval' || !system.candidate) return;
  if (Date.now() >= system.deadline) result='expired';
  if (result === 'approved') {
    system.host = system.candidate;
    system.connected = true;
    system.candidate = null;
    storeConnection();
    navigate('approved');
  } else navigate(result);
}
function cancelPairing() {
  system.candidate=null;
  navigate(system.pairOrigin);
}
function confirmAction(kind) {
  const base = {kind,returnView:state.view};
  if (kind === 'restart') system.confirmation={...base,title:'Restart Astra Thing?',body:'Your pairing and settings will be here<br>when it starts again.',accept:'Restart'};
  else if (kind === 'forget') system.confirmation={...base,title:'Forget this computer?',body:`You’ll need to pair with ${escapeHTML(system.host.name)} again.<br>Your appearance settings will stay.`,accept:'Forget pairing',danger:true};
  else system.confirmation={...base,title:'Reset Astra Thing?',body:'This clears your pairing and settings.<br>Astra Thing stays installed.',accept:'Continue',danger:true};
  navigate('confirm');
}
function acceptConfirmation() {
  const confirm = system.confirmation;
  if (!confirm) return;
  if (confirm.kind === 'factory-reset') {
    system.confirmation={...confirm,kind:'reset-final',title:'Start fresh?',body:'This Thing will return to first-time setup.<br>Your music in Astra stays untouched.',accept:'Reset Thing',cancel:'Keep my setup',danger:true};
    navigate('confirm');
    return;
  }
  system.confirmation=null;
  if (confirm.kind === 'restart') { system.bootNext=homeView(); navigate('boot'); return; }
  system.host=null; system.connected=false; system.candidate=null;
  storeConnection();
  if (confirm.kind === 'reset-final') {
    appearance.surface='light'; appearance.albumColor=true; saveAppearance();
    system.brightness=100; system.idle=120; storeDisplay();
    state.playing=false; state.position=87; state.track=state.playlist=state.selected=0;
    state.playbackContext='After hours';resetPreviewSearch();
    state.volume=64; state.repeat=false;
    $('volume-small').textContent=$('volume-large').textContent='64'; $('volume-fill').style.width='64%';
    $('shuffle').setAttribute('aria-pressed','false'); $('shuffle').setAttribute('aria-label','Enable shuffle');
    $('repeat').setAttribute('aria-pressed','false'); $('repeat').setAttribute('aria-label','Repeat this track');
    resetPreviewQueue();
    renderTrack();
  }
  system.origin='setup'; navigate('setup');
}

function setBrightness(value) {
  system.brightness=Math.max(25,Math.min(100,Math.round(value/5)*5));
  storeDisplay(); applyDisplay();
}
function applyDisplay() {
  $('screen').style.filter=`brightness(${system.brightness/100})`;
  $('screen').dataset.dimmed=String(system.dimmed);
  if ($('brightness')) {
    $('brightness').value=system.brightness;
    $('brightness').style.setProperty('--progress',`${(system.brightness-25)/75*100}%`);
    $('brightness-value').textContent=`${system.brightness}%`;
    $('brightness').setAttribute('aria-valuetext',`${system.brightness} percent`);
  }
}
function activeSystemControls() {
  const container = state.view === 'appearance' ? $('settings-view') : $('system-view');
  return [...container.querySelectorAll('button:not(:disabled),input')];
}
function markDialControl() {
  const buttons=activeSystemControls();
  buttons.forEach((button,index) => button.classList.toggle('dial-selected',index === system.dialIndex));
}
function turnSystemDial(direction) {
  if (state.view === 'display' && system.editingBrightness) { setBrightness(system.brightness+direction*5); return; }
  const controls=activeSystemControls();
  system.dialIndex=Math.max(0,Math.min(controls.length-1,system.dialIndex+direction));
  markDialControl();
}
function pressSystemDial() {
  const control=activeSystemControls()[system.dialIndex];
  if (!control) return;
  if (control.id === 'brightness') {
    system.editingBrightness=!system.editingBrightness;
    control.classList.toggle('is-editing',system.editingBrightness);
    $('brightness-hint').textContent=system.editingBrightness ? 'Turn to adjust. Press to finish.' : 'Select the rail to adjust with the dial.';
    markDialControl();
  } else {
    const previous=state.view;
    control.click();
    if (state.view === previous) markDialControl();
  }
}
function handleSystemAction(action) {
  if (systemPages.has(action) || ['playing','reconnect'].includes(action)) { navigate(action); return; }
  if (action === 'begin-pair') startPairing();
  else if (action === 'cancel-pair') cancelPairing();
  else if (action === 'retry-pair') system.candidate ? requestPairing(system.candidate) : navigate('discover');
  else if (action === 'scan-again') navigate('discover');
  else if (['restart','forget','factory-reset'].includes(action)) confirmAction(action);
  else if (action === 'cancel-confirm') systemBack();
  else if (action === 'accept-confirm') acceptConfirmation();
}

function initializeSystem() {
  try {
    const saved=JSON.parse(localStorage.getItem(connectionKey));
    system.host=hosts.find(host => host.id === saved?.hostId) || null;
    system.connected=Boolean(system.host);
    const display=JSON.parse(localStorage.getItem(displayKey));
    if (Number.isFinite(display?.brightness)) system.brightness=Math.max(25,Math.min(100,display.brightness));
    if ([0,30,120].includes(display?.idle)) system.idle=display.idle;
  } catch { /* Invalid or unavailable storage returns to safe preview defaults. */ }
  // Switching from the dial to touch or Tab leaves a single navigation target.
  for (const eventName of ['pointerdown','focusin']) {
    $('system-view').addEventListener(eventName,event => {
      const row=event.target.closest('.menu-row');
      if (!row) return;
      const controls=activeSystemControls();
      const index=controls.indexOf(row);
      if (index < 0) return;
      system.dialIndex=index;
      controls.forEach(control => control.classList.remove('dial-selected'));
    });
  }
  $('system-view').addEventListener('click',event => {
    const button=event.target.closest('button');
    if (!button) return;
    const index=activeSystemControls().indexOf(button);
    if (index >= 0) system.dialIndex=index;
    if (button.dataset.action) handleSystemAction(button.dataset.action);
    if (button.dataset.host) requestPairing(hosts.find(host => host.id === button.dataset.host));
    if (button.dataset.idle !== undefined) {
      system.idle=Number(button.dataset.idle);storeDisplay();
      document.querySelectorAll('[data-idle]').forEach(other => other.setAttribute('aria-pressed',String(Number(other.dataset.idle) === system.idle)));
    }
  });
  $('settings-view').addEventListener('click',event => {
    const index=activeSystemControls().indexOf(event.target.closest('button'));
    if (index >= 0) system.dialIndex=index;
  });
  document.querySelectorAll('[data-pair-result]').forEach(button => button.onclick=() => finishPairing(button.dataset.pairResult));
  document.querySelectorAll('[data-discovery]').forEach(button => button.onclick=() => {
    if (!['discover','chooser','not-found'].includes(state.view)) return;
    if (button.dataset.discovery === 'one') requestPairing(hosts[0]);
    else navigate(button.dataset.discovery === 'many' ? 'chooser' : 'not-found');
  });
  $('simulate-reconnect').onclick=() => {
    if (!system.host || state.view !== 'reconnect') return;
    system.connected=true;navigate('playing');
  };
  document.querySelectorAll('[data-scenario]').forEach(button => button.onclick=() => {
    system.dimmed=false;system.candidate=null;system.confirmation=null;
    const scenario=button.dataset.scenario;
    if (scenario === 'setup') { system.host=null;system.connected=false;storeConnection();navigate('setup'); }
    else if (scenario === 'connected') { system.host=hosts[0];system.connected=true;storeConnection();navigate('playing'); }
    else if (scenario === 'reconnect') { system.host ||= hosts[0];system.connected=false;storeConnection();navigate('reconnect'); }
    else if (scenario === 'boot') { system.bootNext=homeView();navigate('boot'); }
    else { system.dimmed=true;applyDisplay(); }
  });
  // Waking consumes the first gesture, so it cannot accidentally activate a key.
  for (const eventName of ['pointerdown','wheel','keydown']) {
    document.addEventListener(eventName,event => {
      system.lastInput=Date.now();
      if (!system.dimmed) return;
      system.dimmed=false;applyDisplay();event.preventDefault();event.stopImmediatePropagation();
      system.wakeConsumedAt=Date.now();
    },{capture:true,passive:false});
  }
  document.addEventListener('click',event => {
    if (Date.now()-(system.wakeConsumedAt || 0)<450) { event.preventDefault();event.stopImmediatePropagation(); }
  },true);
  setInterval(() => {
    if (system.idle && !system.dimmed && state.view === 'playing' && !state.scrubbing && Date.now()-system.lastInput > system.idle*1000) { system.dimmed=true;applyDisplay(); }
  },1000);
  navigate(homeView());
}
