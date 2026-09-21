// SPDX-License-Identifier: GPL-3.0-only
'use strict';
let state = {step: 'connect', device: 'none', devices: []};
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const button = (label, action, style = 'primary', disabled = false) => `<button type="button" class="${style}" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
const wait = label => `<div class="waiting" role="status"><span class="dot"></span>${escape(label)}</div>`;
const tip = text => `<p class="tip">${text}</p>`;
const facts = rows => `<dl class="fact-list">${rows.map(([a,b]) => `<div><dt>${escape(a)}</dt><dd>${escape(b)}</dd></div>`).join('')}</dl>`;
function progress(title, lead, art) {
  return {eyebrow: 'KEEP YOUR THING CONNECTED', title, lead, art, body: `<div class="progress-readout"><span id="progress-label">${escape(state.stage)}</span><strong id="progress-percent">${state.progress === null ? '' : Math.floor(state.progress) + '%'}</strong></div><progress ${state.progress === null ? '' : 'value="'+state.progress+'"'} max="100" aria-label="${title}"></progress>`, left: '<span class="footer-note">Operation in progress</span>'};
}
function content() {
  switch (state.step) {
    case 'choose': return {eyebrow:'CHOOSE YOUR DEVICE', title:'Which Thing?', lead:'More than one device is connected. Choose the one you want to work with.', art:'off', body:`<div class="device-options">${state.devices.map(d => `<button data-action="select" data-id="${escape(d.id)}">${escape(d.name)} · ${escape(d.mode)}<br><small>${escape(d.id)}</small></button>`).join('')}</div>`};
    case 'connect': return {eyebrow:'WELCOME TO ASTRA THING', title:'A new life for your Car Thing.', lead:'Connect your Car Thing to this computer with a USB data cable. We’ll take it from there.', art:'off', body:wait('Looking for your Car Thing…'), caption:'One device. One USB cable.', right:button('Connection help','help','quiet')};
    case 'welcome': return {eyebrow:'CAR THING CONNECTED', title:'Let’s make it yours.', lead:'We’ll guide you into recovery, save a backup, and install Astra Thing.', art:'stock', body:tip('Keep the cable connected until we ask you to unplug it.'), right:button('Get started','start','accent')};
    case 'unplug': return {eyebrow:'RECOVERY · 1 OF 2', title:'First, unplug your Car Thing.', lead:'Disconnect its USB cable. Leave the other end connected to your computer.', art:'unplug', body:wait('Waiting for you to unplug…'), caption:'Unplug the cable from the back.', right:button('Need a hand?','help','quiet')};
    case 'hold': return {eyebrow:'RECOVERY · 2 OF 2', title:'Hold 1 + 4. Plug it back in.', lead:'Hold the <strong>first and fourth preset buttons</strong> along the top edge, then reconnect the cable. Keep both pressed until we find it.', art:'hold', body:wait('Looking for recovery mode…')+tip('The screen should stay black. We’ll tell you when you can let go.'), caption:'Hold presets 1 + 4.', right:button('Not finding it?','help','quiet')};
    case 'recoveryReady': return {eyebrow:'RECOVERY FOUND', title:'You can let go now.', lead:'Your Car Thing is ready. Keep it connected while we prepare your backup.', art:'recovery', body:wait('Recovery connection confirmed'), caption:'A black screen is expected here.', right:button(state.backup?'Continue to installation':'Continue to backup',state.backup?'review':'backup-choice','accent')};
    case 'backupChoice': return {eyebrow:'A COPY TO KEEP', title:'Save what’s on it first.', lead:'We’ll copy the original software we can read, read it again, and check that the files match.', art:'recovery', body:button(state.folder?escape(state.folder):'Choose a backup folder','choose-folder','folder-choice')+tip('Protected chip data is not included. This is a backup of readable software, not a complete chip clone.'), right:button('Create backup','backup','accent',!state.folder)};
    case 'backupProgress': return progress('Making a copy.','Leave the cable connected while we copy and verify your backup.','recovery');
    case 'backupReady': return {eyebrow:'BACKUP CHECKED', title:'A copy, safely saved.', lead:'Both device reads and the saved files match.', art:'recovery', body:`<div class="file-note">${escape(state.backupFolder)}</div>`+tip('Keep a second copy on another drive if you can.'), right:button('Continue','review','accent')};
    case 'review': return {eyebrow:'READY WHEN YOU ARE', title:'Ready for Astra Thing.', lead:'This replaces the software on your Car Thing and clears its settings. Your backup stays on this computer.', art:'running', body:facts([['Device','Spotify Car Thing'],['Firmware',state.releaseVersion||'Choose a release'],['Backup','Verified']])+button('Check for firmware','check-release','primary')+' '+button('Choose a local release','release','quiet'), right:button('Install Astra Thing','install','accent',!state.releaseVersion)};
    case 'installProgress': return progress('Making it an Astra Thing.','Leave the cable connected. The screen may stay black until installation finishes.','recovery');
    case 'reboot': return {eyebrow:'FIRMWARE WRITTEN', title:'One last reconnect.', lead:'Unplug your Thing, then plug it back in <strong>without holding any buttons</strong>. We’ll check Astra Thing as it starts.', art:state.device==='none'?'off':'unplug', body:wait('Waiting for Astra Thing to start…'), right:button('Not starting?','help','quiet')};
    case 'authorize': return {eyebrow:'ASTRA THING FOUND', title:'Make this your manager.', lead:'Allow this computer to install updates and restart your Thing. You’ll confirm a matching code on the Thing.', art:'running', body:tip('Your music pairing with Astra stays separate.'), right:button('Connect manager','pair','accent')};
    case 'pair': return {eyebrow:'CHECK BOTH SCREENS', title:'Same code? Allow it.', lead:'Check that your Thing shows this code, then tap <strong>Allow</strong> on its screen.', art:'running', body:`<p class="pair-code">${escape((state.code||'').replace(/(.{3})(.{3})/,'$1 $2'))}</p>`+wait('Waiting for approval on your Thing…'), right:button('Cancel','pair-cancel','quiet')};
    case 'done': return {eyebrow:'HELLO, ASTRA THING', title:'Now, bring in your music.', lead:'Open Astra on your computer. On your Thing, choose <strong>Find Astra</strong>, compare the codes, and approve the connection in Astra.', art:'running', body:tip('Firmware startup confirmed. After pairing, your Thing connects directly to Astra.'), right:button('Go to my device','manage','accent')};
    case 'manage': return {eyebrow:'YOUR DEVICE', title:'Astra Thing', lead:'Your music, within reach.', art:'running', body:facts([['Connection','USB · connected'],['Firmware',state.version]])+`<div class="options-row">${button('Restart','restart','quiet')}${button('Save diagnostics','diagnostics','quiet')}${button('Connection help','help','quiet')}</div>`, left:'<span class="footer-note">You can close this app.<br>Your Thing stays connected to Astra.</span>', right:button('Local release','update-review','quiet')+button('Check for updates','check-release','accent')};
    case 'upToDate': return {eyebrow:'FIRMWARE CHECKED', title:'You’re up to date.', lead:'Your Thing already has this release or a newer one.', art:'running', body:facts([['Installed',state.version]])+tip('Your Thing is ready to use.'), right:button('Back to my device','manage','accent')};
    case 'updateReview': return {eyebrow:'FIRMWARE UPDATE', title:'A fresh update. Same Thing.', lead:'We’ll install into the other firmware slot, restart, and check that the new version comes back.', art:'running', body:facts([['Installed',state.version],['Available',state.releaseVersion],['Pairing & settings','Kept']])+tip('Keep the cable connected. Your controls will be unavailable briefly.'), left:button('Back','manage','quiet'), right:button('Update firmware','update','accent')};
    case 'updateProgress': return progress('A little refresh.','Your pairing and appearance settings will be preserved.','running');
    case 'updateRestart': return {eyebrow:'CHECKING YOUR THING', title:'See you in a moment.', lead:'Your Thing is installing and restarting. Leave the cable connected—we’ll confirm when the new firmware is running.', art:'off', body:wait(state.stage||'Waiting for a verified restart…'), right:button('Taking a while?','help','quiet')};
    case 'legacy': return {eyebrow:'USB DEVICE FOUND', title:'Let’s finish connecting.', lead:'We found your Thing, but can’t reach its management service yet.', art:'running', body:tip(state.platform==='darwin'?'Allow Thing Manager access to the local network when macOS asks. Your USB cable uses a network connection.':'Check that your computer has connected to the Thing’s USB network.'), left:button('Save diagnostics','diagnostics','quiet'), right:button('Connection help','help','primary')};
    case 'backupError': return {eyebrow:'BACKUP NOT FINISHED', title:'Let’s finish that backup.', lead:'The backup could not be verified. No installation was started.', art:'off', body:tip('Reconnect in recovery. We’ll create and check a new backup.'), right:button('Reconnect in recovery','restart-guide','accent')};
    case 'error': return {eyebrow:'LET’S CHECK YOUR THING', title:'Back on track.', lead:'The operation did not finish successfully. Reconnect your Thing normally so we can check its running firmware.', art:'off', left:button('Save diagnostics','diagnostics','quiet'), right:button('Check my Thing','recover','accent')};
    case 'recover': return {eyebrow:'CHECKING YOUR THING', title:'Plug it back in normally.', lead:'Reconnect without holding any buttons. If it stays blank, open the recovery guide.', art:'off', body:wait('Looking for your Thing…'), right:button('Recovery guide','repair','primary')};
    default: return {eyebrow:'ASTRA THING', title:'Checking the connection.', lead:'Keep your Thing connected.', art:'off', body:wait('One moment…')};
  }
}
let lastStep, lastView;
function render(next) {
  state=next;
  const view=content(), signature=JSON.stringify([state.step,view,state.device,state.devices]);
  $('#error').hidden=!state.error;$('#error').textContent=state.error||'';
  if(signature===lastView)return; lastView=signature;
  // Progress updates leave controls and focus in place.
  if(lastStep===state.step&&$('#progress-label')&&view.title) {
    $('#progress-label').textContent=state.stage;$('#progress-percent').textContent=state.progress===null?'':Math.floor(state.progress)+'%';
    if(state.progress===null)$('progress').removeAttribute('value');else $('progress').value=state.progress;
    return;
  }
  const focus=lastStep!==undefined&&lastStep!==state.step;lastStep=state.step;
  $('#device-art').innerHTML=deviceArt(view.art);
  $('#visual-caption').textContent=view.caption||'';
  $('#instruction').innerHTML=`<p class="eyebrow">${view.eyebrow}</p><h1 id="step-title" tabindex="-1">${view.title}</h1><p class="lead">${view.lead}</p>${view.body||''}`;
  $('#footer-left').innerHTML=view.left||'';$('#footer-right').innerHTML=view.right||'';
  const index=['connect','welcome','hold','unplug','recoveryReady','choose'].includes(state.step)?0:state.step.startsWith('backup')?1:['review','installProgress'].includes(state.step)?2:3;
  $('#journey').hidden=['manage','authorize','pair','legacy','upToDate','updateReview','updateProgress','updateRestart','recover','error'].includes(state.step);
  $('#journey').innerHTML=['Connect','Back up','Install','Enjoy'].map((label,i)=>`<span class="${i===index?'current':i<index?'complete':''}" ${i===index?'aria-current="step"':''}><i>${i<index?'✓':i+1}</i>${label}</span>`).join('');
  $('#connection-status').dataset.connected=String(state.device!=='none');
  $('#connection-status').innerHTML=`<span class="dot"></span><span>${{none:'Waiting for a device',stock:'Car Thing connected',recovery:'Recovery mode',astra:'Astra Thing connected',fastboot:'Recovery needed'}[state.device]||'Checking device'}</span>`;
  if(focus){$('#announcer').textContent=view.title;$('#step-title').focus({preventScroll:true});}
}
function help() {
  $('#help-copy').innerHTML='<ol><li>Use a USB data cable. A charging-only cable can power the screen without connecting it.</li><li>Try a direct USB port and allow the accessory if your computer asks.</li><li>For recovery, unplug first. Hold presets 1 + 4 as you reconnect. Let go when the manager confirms detection.</li></ol>'+(state.platform==='win32'?tip('On Windows, recovery uses a WinUSB driver. Follow the Windows USB setup guide included with this release.'):state.platform==='linux'?tip('On Linux, install the USB access rule included with this release, then reconnect the device.'):'')+tip('A black screen is expected in recovery. Connection help and platform setup are included in the release guide.');
  $('#help-dialog').showModal();
}
document.addEventListener('click',event=>{const node=event.target.closest('[data-action]');if(!node||node.disabled)return;const action=node.dataset.action;if(action==='help')help();else if(action==='close-help')$('#help-dialog').close();else window.thing.action(action,node.dataset.id);});
window.thing.subscribe(render);
window.thing.snapshot().then(render);
