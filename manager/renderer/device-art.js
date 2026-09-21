'use strict';
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
      ${running ? '<image href="astra-full.svg" x="67" y="109" width="196" height="22"/>' : mode === 'stock' ? '<text x="166" y="129" fill="#b8c5c9" font-size="18" text-anchor="middle" letter-spacing="1">Car Thing</text>' : ''}
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
