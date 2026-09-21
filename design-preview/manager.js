'use strict';
// Visual prototype only. There is no USB, network, filesystem, or firmware adapter.
(() => {
  const $ = selector => document.querySelector(selector);
  const check = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4 10-10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const folder = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7V5h7l2 3h9v12H3V7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  let state = { step: 'connect', device: 'none', backup: false, folder: false, progress: 0, intent: 'install', updated: false, platform: 'macOS' };
  let job;
  let restoreFocus;

  const button = (label, action, style = 'primary', disabled = false) => `<button type="button" class="${style}" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  const wait = label => `<div class="waiting" role="status"><span class="dot"></span>${label}</div>`;
  const success = label => `<div class="success-line">${check}${label}</div>`;
  const tip = text => `<p class="tip">${text}</p>`;
  const facts = rows => `<dl class="fact-list">${rows.map(([a,b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>`;
  const busy = () => ['backupProgress', 'installProgress', 'updateProgress'].includes(state.step);
  const stepNumber = () => ['connect','welcome','unplug','hold','recoveryReady'].includes(state.step) ? 0 : ['backupChoice','backupProgress','backupReady'].includes(state.step) ? 1 : ['review','installProgress','error'].includes(state.step) ? 2 : 3;

  function deviceArt(mode) {
    const held = mode === 'hold';
    const running = mode === 'running';
    const plugged = state.device !== 'none';
    return `<svg class="thing-art" viewBox="0 -55 420 370" fill="none" role="img" aria-label="${held ? 'Front of Car Thing, with presets 1 and 4 highlighted. ' : 'Car Thing. '}The detail below shows the USB-C port in the center of the back, opening toward the device’s left side. The cable inserts from the left.">
      <defs>
        <linearGradient id="case" x1="210" y1="29" x2="210" y2="222" gradientUnits="userSpaceOnUse"><stop stop-color="#687174"/><stop offset=".09" stop-color="#343b3e"/><stop offset=".8" stop-color="#1b2022"/><stop offset="1" stop-color="#3d494d"/></linearGradient>
        <linearGradient id="dial" x1="300" y1="50" x2="382" y2="142" gradientUnits="userSpaceOnUse"><stop stop-color="#505b60"/><stop offset=".6" stop-color="#303b40"/><stop offset="1" stop-color="#252e32"/></linearGradient>
        <linearGradient id="glass" x1="34" y1="51" x2="299" y2="199" gradientUnits="userSpaceOnUse"><stop stop-color="#284951"/><stop offset="1" stop-color="#172c32"/></linearGradient>
      </defs>
      <ellipse cx="210" cy="233" rx="175" ry="8" fill="#080c0e" opacity=".65"/>
      <g fill="#3e494e" stroke="#88999f" stroke-width="1.1">
        <rect class="${held ? 'held-button' : ''}" x="81" y="20" width="35" height="9" rx="3" ${held ? 'fill="#47baff" stroke="#a0ddff"' : ''}/><rect x="145" y="20" width="35" height="9" rx="3"/><rect x="209" y="20" width="35" height="9" rx="3"/><rect class="${held ? 'held-button' : ''}" x="273" y="20" width="35" height="9" rx="3" ${held ? 'fill="#47baff" stroke="#a0ddff"' : ''}/><rect x="345" y="22" width="24" height="7" rx="3"/>
      </g>
      <rect x="9" y="29" width="402" height="193" rx="25" fill="url(#case)" stroke="#809299" stroke-width="1.7"/>
      <rect x="16" y="35" width="388" height="180" rx="20" fill="#111719" stroke="#3b494e"/>
      <rect x="34" y="51" width="265" height="148" rx="6" fill="${running ? 'url(#glass)' : '#080c0e'}"/>
      <path d="M40 53h252" stroke="#b0dce4" opacity=".12"/>
      ${running ? '<image href="../branding/astra-full.svg" x="67" y="109" width="196" height="22"/>' : mode === 'stock' ? '<text x="166" y="129" fill="#b8c5c9" font-size="18" text-anchor="middle" letter-spacing="1">Car Thing</text>' : ''}
      <circle cx="347" cy="100" r="57" fill="#070b0d"/>
      <circle cx="345" cy="94" r="54" fill="url(#dial)" stroke="#839399" stroke-width="1.2"/>
      <circle cx="345" cy="94" r="50.5" stroke="#8c9ca1" stroke-width=".8" opacity=".19"/>
      <circle cx="345" cy="180" r="18" fill="url(#dial)" stroke="#70848b"/>
      ${held ? [98.5,290.5].map((x,i) => `<g fill="#47baff"><rect x="${x-14}" y="-43" width="28" height="28" rx="8"/><text x="${x}" y="-23" fill="#0b2838" font-size="18" font-weight="650" text-anchor="middle">${i ? 4 : 1}</text><path d="M${x} -8v17m-5-5 5 5 5-5" stroke="#47baff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>`).join('') : ''}
      <g aria-hidden="true">
        <path d="M210 222v19" stroke="#647b86" stroke-width="1" stroke-dasharray="3 4"/>
        <rect x="174" y="244" width="137" height="43" rx="12" fill="#192328" stroke="#566d78" stroke-dasharray="4 4"/>
        <path d="M297 249h-70a11 11 0 0 0-11 11v11a11 11 0 0 0 11 11h70" fill="#27383f" stroke="#71868f" stroke-width="1.2"/>
        <rect x="213" y="257" width="6" height="17" rx="2.8" fill="#080e11" stroke="#93a6ae"/>
        <g transform="translate(${plugged ? 0 : -32} 0)">
          <path d="M88 265.5h92" stroke="#14232a" stroke-width="9"/>
          <path d="M88 265.5h92" stroke="${plugged ? '#5d91ab' : '#61808e'}" stroke-width="5"/>
          <rect x="170" y="261" width="13" height="9" rx="3" fill="#314b58"/>
          ${plugged ? '' : '<path d="M212 259h14q2 0 2 2v9q0 2-2 2h-14Z" fill="#a1b4bc" stroke="#c4d3d9" stroke-width=".7"/><path d="M215 261h10" stroke="#637d88" stroke-width=".7"/>'}
          <path d="M187 255h27v21h-27a9 9 0 0 1-9-9v-3a9 9 0 0 1 9-9Z" fill="#314b58" stroke="${plugged ? '#75c4ef' : '#78919b'}" stroke-width="1.3"/>
        </g>
        ${['unplug','hold'].includes(mode) ? `<path class="cable-arrow" d="M${mode === 'unplug' ? '140 242h-25m6-5-6 5 6 5' : '115 242h25m-6-5 6 5-6 5'}" stroke="#47baff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
        <text x="210" y="306" fill="#a8b4b7" font-size="11" text-anchor="middle">Rear port · faces left</text>
      </g>
    </svg>`;
  }

  function content() {
    switch (state.step) {
      case 'connect': return {
        eyebrow:'WELCOME TO ASTRA THING', title:'A new life for your Car Thing.',
        lead:'Connect your Car Thing to this computer with a USB data cable. We’ll take it from there.', art:'off',
        body:wait('Looking for your Car Thing…'), caption:'One device. One USB cable.', right:button('Connection help','help','quiet'),
        event:'Connect stock device', eventText:'Stand in for connecting a stock Car Thing.'
      };
      case 'welcome': return {
        eyebrow:'CAR THING CONNECTED', title:'Let’s make it yours.',
        lead:'We’ll guide you into recovery, save a backup, and install Astra Thing. Keep the cable connected until we ask you to unplug it.', art:'stock',
        body:tip('You’ll need a little space on your computer for the backup. We’ll check before starting.'), caption:'Spotify Car Thing',
        left:button('Back','home','quiet'), right:button('Get started','start','accent'), eventText:'The device is connected. Start the guided installation.'
      };
      case 'unplug': return {
        eyebrow:'RECOVERY · 1 OF 2', title:'First, unplug your Car Thing.',
        lead:'Disconnect its USB cable. Leave the other end connected to your computer.', art:'unplug',
        body:wait('Waiting for you to unplug…'), caption:'Unplug the cable from the back.',
        left:button('Back','home','quiet'), right:button('Need a hand?','help','quiet'), event:'Unplug USB', eventText:'The finished tool detects this automatically.'
      };
      case 'hold': return {
        eyebrow:'RECOVERY · 2 OF 2', title:'Hold 1 + 4. Plug it back in.',
        lead:'Hold the <strong>first and fourth preset buttons</strong> along the top edge, then reconnect the cable. Keep both pressed until we find it.', art:'hold',
        body:wait('Looking for recovery mode…') + tip('<strong>The screen should stay black.</strong> We’ll tell you when you can let go.'),
        caption:'<span class="key">1</span><span>+</span><span class="key">4</span><span>Keep both held down.</span>',
        left:button('Start this step again','restart-guide','quiet'), right:button('Not finding it?','help','quiet'), event:'Detect recovery mode', eventText:'Stand in for the computer detecting recovery over USB.'
      };
      case 'recoveryReady': return {
        eyebrow:'RECOVERY FOUND', title:'You can let go now.',
        lead:'Your Car Thing is ready. Keep it connected while we prepare your backup.', art:'recovery',
        body:success('Recovery connection confirmed'), caption:'A black screen is expected here.',
        right:button(state.backup ? 'Continue to installation' : 'Continue to backup',state.backup ? 'review' : 'backup-choice','accent'), eventText:'Recovery is confirmed. Nothing has been written to the device.'
      };
      case 'backupChoice': return {
        eyebrow:'A COPY TO KEEP', title:'Save what’s on it first.',
        lead:'We’ll copy the original software we can read and check the saved files before installing anything.', art:'recovery',
        body:button(`${folder}<span>${state.folder ? 'Documents / Astra Thing backups' : 'Choose a backup folder'}</span><span>›</span>`,'choose-folder','folder-choice') + '<p class="subnote">Keep this copy somewhere safe. Some protected chip data cannot be backed up.</p>',
        caption:'Your Car Thing stays in recovery.', left:button('Back','recovery-ready','quiet'), right:button('Create backup','backup','accent',!state.folder), eventText:'Choosing a folder uses a sample location in this concept.'
      };
      case 'backupProgress': return progressContent('SAVING YOUR BACKUP','Making a copy.', 'Keep your Car Thing connected. We’ll check the files as part of the backup.', 'recovery', state.progress < 75 ? 'Copying original software' : 'Checking saved files');
      case 'backupReady': return {
        eyebrow:'BACKUP CHECKED', title:'A copy, safely saved.',
        lead:'The files we read match your saved backup. You’re ready to install Astra Thing.', art:'recovery',
        body:success('Backup verified') + '<div class="file-note"><strong>Astra Thing backups / Car Thing backup</strong><br>Keep a second copy on another drive if you can.</div>', caption:'Still connected. Ready for the next step.',
        right:button('Continue','review','accent'), eventText:'The backup and verification are simulated.'
      };
      case 'review': return {
        eyebrow:'READY WHEN YOU ARE', title:state.intent === 'repair' ? 'Let’s reinstall Astra Thing.' : 'Ready for Astra Thing.',
        lead:state.intent === 'repair' ? 'We’ll install a fresh copy. Reinstallation clears the device’s pairing and settings.' : 'This replaces the Spotify software on your Car Thing. Your backup stays on this computer.', art:'running',
        body:facts([['Device','Spotify Car Thing'],['Software','Astra Thing · release preview'],['Backup',state.backup ? 'Verified' : 'Not available']]) + tip('Keep your computer awake and the USB cable connected during installation.'), caption:'A preview of what comes next.',
        left:button('Back','recovery-ready','quiet'), right:button('Install Astra Thing','install','accent'), eventText:'Install runs a visual simulation. It cannot write to USB.'
      };
      case 'installProgress': return progressContent('INSTALLING ASTRA THING','Making it an Astra Thing.', 'Leave the cable connected. The screen may stay black until installation finishes.', 'recovery', state.progress < 18 ? 'Verifying firmware package' : state.progress < 78 ? 'Installing firmware' : 'Checking the installation');
      case 'reboot': return {
        eyebrow:'INSTALLATION CHECKED', title:'One last reconnect.',
        lead:'Unplug your Car Thing, then plug it back in <strong>without holding any buttons</strong>. We’ll look for Astra Thing as it starts.', art:state.device === 'none' ? 'off' : 'unplug',
        body:wait(state.device === 'none' ? 'Waiting for Astra Thing to start…' : 'Waiting for you to unplug…'), caption:'Reconnect normally. No buttons this time.',
        right:button('Not starting?','help','quiet'), event:state.device === 'none' ? 'Astra Thing boots' : 'Unplug USB', eventText:'Completion waits for the new firmware to report itself.'
      };
      case 'done': return {
        eyebrow:'HELLO, ASTRA THING', title:'Now, bring in your music.',
        lead:'Open Astra on your computer. On your Thing, choose <strong>Find Astra</strong>, compare the codes, and approve the connection in Astra.', art:'running',
        body:success('Astra Thing started successfully') + '<p class="subnote">After pairing, you can close this manager. Your Thing connects directly to Astra.</p>', caption:'Installed. Ready to pair.',
        right:button('Go to my device','manage','accent'), eventText:'Pairing happens in Astra and on the Thing; this concept does not launch either.'
      };
      case 'manage': return {
        eyebrow:'YOUR DEVICE', title:'Astra Thing', lead:'Your music, within reach.', art:'running',
        body:facts([['Connection','USB · connected'],['Firmware',state.updated ? 'Release preview 2' : 'Release preview 1']]) + (state.updated ? success('You’re up to date') : '<div class="update-card"><p><strong>A new version is ready.</strong></p><p>Release preview 2 · your pairing and settings stay with you.</p></div>') + `<div class="options-row">${button('About this device','about','quiet')}${button('Connection help','help','quiet')}</div>`, caption:'Astra Thing',
        left:'<span class="footer-note">You can close this app.<br>Your Thing stays connected to Astra.</span>', right:state.updated ? '' : button('View update','update-review','accent'), eventText:'This is the returning-device home screen. Version labels are illustrative.'
      };
      case 'updateReview': return {
        eyebrow:'FIRMWARE UPDATE', title:'A fresh update. Same Thing.', lead:'We’ll install the new version, restart your Thing, and check that it comes back.', art:'running',
        body:facts([['Installed','Release preview 1'],['Available','Release preview 2'],['Pairing & settings','Kept']]) + tip('Keep the cable connected. Your controls will be unavailable briefly during the update.'), caption:'Updates start from here. No recovery buttons.',
        left:button('Back','manage','quiet'), right:button('Update firmware','update','accent'), eventText:'The normal update uses the inactive firmware slot.'
      };
      case 'updateProgress': return progressContent('UPDATING YOUR THING','A little refresh.', 'Keep it connected. Your pairing and appearance settings will be preserved.', 'running', state.progress < 20 ? 'Verifying firmware package' : state.progress < 80 ? 'Installing the update' : 'Checking the new firmware');
      case 'updateRestart': return {
        eyebrow:'UPDATE INSTALLED', title:'See you in a moment.', lead:'Your Thing is restarting. Leave the cable connected—we’ll confirm when the new version is running.', art:'off',
        body:wait('Waiting for your Thing to return…'), caption:'A brief black screen is normal.', right:button('Taking a while?','help','quiet'), event:'Updated Thing returns', eventText:'Simulate a reconnect that reports the expected new firmware version.'
      };
      case 'error': return {
        eyebrow:'CONNECTION INTERRUPTED', title:'Let’s get you back on track.', lead:'The USB connection was lost. Installation hasn’t been confirmed, so we’ll check your Thing before deciding what to do next.', art:'off',
        body:tip(state.backup ? 'Your verified backup is still on this computer. Start by reconnecting the USB cable normally.' : 'The existing firmware may still start. Begin by reconnecting the USB cable normally.'), caption:'We’ll guide you from here.',
        left:button('Connection help','help','quiet'), right:button('Check my Thing','recover','accent'), eventText:'This is a sample interrupted install with a saved backup.'
      };
      case 'backupError': return {
        eyebrow:'BACKUP INTERRUPTED', title:'Let’s finish that backup.', lead:'The USB connection was lost before we could verify your backup. Nothing has been installed on your Car Thing.', art:'off',
        body:tip('Reconnect in recovery mode. We’ll create and check the backup again before offering installation.'), caption:'Your original software has not been changed.',
        right:button('Reconnect in recovery','restart-guide','accent'), eventText:'A partial backup is never treated as a verified backup.'
      };
      case 'recover': return {
        eyebrow:'CHECKING YOUR THING', title:'Plug it back in normally.', lead:'Reconnect the USB cable without holding any buttons. If Astra Thing starts, we’ll check its version. If it stays blank, use the recovery guide.', art:'off',
        body:wait('Looking for your Thing…'), caption:'We check the result before offering a reinstall.', left:button('Connection help','help','quiet'), right:button('Use recovery guide','repair','primary'), event:'Astra Thing responds', eventText:'Try a successful reconnect, or open the recovery guide.'
      };
    }
  }

  function progressContent(eyebrow,title,lead,art,label) {
    return {eyebrow,title,lead,art,body:`<div class="progress-readout"><span id="progress-label">${label}</span><strong id="progress-percent">${state.progress}%</strong></div><progress value="${state.progress}" max="100" aria-label="${title}"></progress><p class="subnote">Please keep the cable connected.</p>`,caption:'We’ll let you know when it’s ready.',left:'<span class="footer-note">Operation in progress</span>',eventText:'Progress is simulated. You can test a cable interruption below.'};
  }

  function render(focus = false) {
    const view = content();
    $('#device-art').innerHTML = deviceArt(view.art);
    $('#visual-caption').innerHTML = view.caption || '';
    $('#instruction').innerHTML = `<p class="eyebrow">${view.eyebrow}</p><h1 id="step-title" tabindex="-1">${view.title}</h1><p class="lead">${view.lead}</p>${view.body || ''}`;
    $('#footer-left').innerHTML = view.left || '';
    $('#footer-right').innerHTML = view.right || '';
    const current = stepNumber();
    $('#journey').hidden = ['manage','updateReview','updateProgress','updateRestart','recover'].includes(state.step);
    $('#journey').innerHTML = ['Connect','Back up','Install','Enjoy'].map((label,i) => `<span class="${i === current ? 'current' : i < current ? 'complete' : ''}" ${i === current ? 'aria-current="step"' : ''}><i>${i < current ? '✓' : i+1}</i>${label}</span>`).join('');
    const status = {none:'Waiting for a device',stock:'Car Thing connected',recovery:'Recovery mode',astra:'Astra Thing connected'}[state.device];
    $('#connection-status').dataset.connected = String(state.device !== 'none');
    $('#connection-status').innerHTML = `<span class="dot"></span><span>${status}</span>`;
    $('#event-description').textContent = view.eventText;
    $('#simulate-event').hidden = !view.event;
    $('#simulate-event').textContent = view.event || '';
    $('#simulate-disconnect').hidden = !busy();
    $('#announcer').textContent = `${view.eyebrow}. ${view.title}`;
    if (focus) $('#step-title').focus({preventScroll:true});
  }

  function stopJob() { clearInterval(job); job = undefined; }
  function go(step, focus = true) { stopJob(); state.step = step; render(focus); }
  function startProgress(step, next) {
    go(step); state.progress = 0;
    render();
    job = setInterval(() => {
      state.progress = Math.min(100,state.progress + 5);
      // Keep buttons, focus, and live regions steady while progress advances.
      const view = content();
      $('#progress-percent').textContent = `${state.progress}%`;
      $('progress').value = state.progress;
      const template = document.createElement('template'); template.innerHTML = view.body;
      $('#progress-label').textContent = template.content.querySelector('#progress-label').textContent;
      if (state.progress === 100) {
        if (step === 'backupProgress') state.backup = true;
        if (step === 'updateProgress') state.device = 'none';
        go(next, false);
      }
    }, 300);
  }

  function openHelp(kind = 'help') {
    restoreFocus = document.activeElement;
    $('#help-title').textContent = kind === 'about' ? 'Astra Thing' : 'Let’s get connected.';
    const platform = {macOS:'Try a direct USB port while troubleshooting. If your computer asks to allow the accessory, choose Allow.',Windows:'Try a direct USB port while troubleshooting. Check that the connection is allowed if your computer asks for permission.',Linux:'Try a direct USB port while troubleshooting. Check that the connection is allowed if your computer asks for permission.'}[state.platform];
    $('#help-copy').innerHTML = kind === 'about' ? facts([['Hardware','Spotify Car Thing'],['Connection','USB'],['Firmware',state.updated ? 'Release preview 2' : 'Release preview 1']]) : `<ol><li>Use a USB cable that carries data. A charging-only cable can power the screen without connecting the device.</li><li>${platform}</li><li>For recovery, unplug first. Hold presets 1 + 4 as you reconnect, and keep holding until the manager confirms detection.</li></ol><p>A black screen is expected in recovery. The USB connection is what confirms it.</p>`;
    $('#help-dialog').showModal();
  }

  function act(action) {
    switch(action) {
      case 'home': return go(state.device === 'none' ? 'connect' : 'welcome');
      case 'start': return go(state.device === 'recovery' ? 'recoveryReady' : state.device === 'none' ? 'hold' : 'unplug');
      case 'restart-guide': return go(state.device === 'none' ? 'hold' : 'unplug');
      case 'recovery-ready': return go('recoveryReady');
      case 'backup-choice': return go('backupChoice');
      case 'choose-folder': state.folder = true; return render();
      case 'backup': if(state.folder && state.device === 'recovery') return startProgress('backupProgress','backupReady'); return;
      case 'review': if(state.backup && state.device === 'recovery') return go('review'); return;
      case 'install': if(state.backup && state.device === 'recovery') return startProgress('installProgress','reboot'); return;
      case 'manage': return go('manage');
      case 'update-review': return go('updateReview');
      case 'update': if(state.device === 'astra') return startProgress('updateProgress','updateRestart'); return;
      case 'recover': return go('recover');
      case 'repair': state.intent = 'repair'; return go(state.device === 'none' ? 'hold' : 'unplug');
      case 'help': return openHelp();
      case 'about': return openHelp('about');
      case 'close-help': return $('#help-dialog').close();
    }
  }

  document.addEventListener('click', event => {const control=event.target.closest('[data-action]');if(control && !control.disabled) act(control.dataset.action)});
  $('#help-dialog').addEventListener('close', () => restoreFocus?.isConnected && restoreFocus.focus());
  $('#preview-platform').addEventListener('change',event => {state.platform=event.target.value});
  $('#preview-scene').addEventListener('change',event => {
    stopJob(); const scene=event.target.value;
    state = {step:scene, device:scene === 'manage' ? 'astra' : 'none', backup:scene === 'error', folder:scene === 'error', progress:0, intent:'install', updated:false, platform:state.platform};
    render();
  });
  $('#simulate-event').addEventListener('click', () => {
    switch(state.step) {
      case 'connect': state.device='stock'; return go('welcome',false);
      case 'unplug': state.device='none'; return go('hold',false);
      case 'hold': state.device='recovery'; return go('recoveryReady',false);
      case 'reboot': if(state.device !== 'none') {state.device='none';return render()} state.device='astra';return go('done',false);
      case 'updateRestart': state.device='astra';state.updated=true;return go('manage',false);
      case 'recover': state.device='astra';return go('manage',false);
    }
  });
  $('#simulate-disconnect').addEventListener('click', () => {
    const wasBackup=state.step === 'backupProgress';
    state.device='none';
    if(wasBackup) {state.backup=false;go('backupError',false)} else go('error',false);
  });
  render();
})();
