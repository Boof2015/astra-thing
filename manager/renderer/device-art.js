'use strict';
// The Thing is drawn once and kept for the whole session. Each step picks a pose (camera, screen, cable,
// demo, data flow) and manager.css moves between poses, so a new step never cuts to a new picture.
const thingPoses = {
  off: {}, recovery: {}, stock: {screen: 'stock'}, running: {screen: 'astra'}, restart: {plugged: true},
  connect: {camera: 'port', demo: 'plug'},
  unplug: {camera: 'port', demo: 'unplug'},
  replug: {camera: 'port', demo: 'replug'},
  hold: {demo: 'hold'},
  backup: {camera: 'cable', plugged: true, flow: 'out'},
  install: {camera: 'cable', plugged: true, flow: 'in'},
  update: {camera: 'cable', plugged: true, flow: 'in', screen: 'astra'},
  pair: {camera: 'screen', plugged: true, screen: 'pair'}
};
function thingScene(container, logo) {
  container.innerHTML = `<svg class="thing-art" viewBox="0 0 420 425" fill="none" role="img">
    <defs>
      <linearGradient id="thing-case" x1="210" y1="29" x2="210" y2="222" gradientUnits="userSpaceOnUse"><stop stop-color="#6b6b6b"/><stop offset=".09" stop-color="#383838"/><stop offset=".8" stop-color="#1d1d1d"/><stop offset="1" stop-color="#444444"/></linearGradient>
      <linearGradient id="thing-dial" x1="300" y1="50" x2="382" y2="142" gradientUnits="userSpaceOnUse"><stop stop-color="#555555"/><stop offset=".6" stop-color="#353535"/><stop offset="1" stop-color="#282828"/></linearGradient>
      <linearGradient id="thing-glass" x1="34" y1="51" x2="299" y2="199" gradientUnits="userSpaceOnUse"><stop stop-color="#1f2426"/><stop offset="1" stop-color="#141617"/></linearGradient>
      <pattern id="thing-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" stroke="#f0f0f0" stroke-opacity=".05"/></pattern>
      <clipPath id="thing-screen"><rect x="34" y="51" width="265" height="148" rx="6"/></clipPath>
      <linearGradient id="thing-plate" x1="0" y1="36" x2="0" y2="218" gradientUnits="userSpaceOnUse"><stop stop-color="#4a4a4a"/><stop offset=".1" stop-color="#2e2e2e"/><stop offset=".85" stop-color="#232323"/><stop offset="1" stop-color="#333333"/></linearGradient>
      <clipPath id="thing-back-window"><rect x="150" y="80" width="242" height="92" rx="14"/></clipPath>
      <clipPath id="thing-outside-port"><rect x="236" y="60" width="1200" height="140"/></clipPath>
    </defs>
    <g class="camera">
      <rect x="-1000" y="-1000" width="2420" height="2370" fill="url(#thing-grid)"/>
      <g transform="translate(0 55)">
        <ellipse cx="210" cy="233" rx="175" ry="8" fill="#000" opacity=".6"/>
        <g class="badges">${[98.5, 290.5].map((x, i) => `<rect x="${x - 14}" y="-43" width="28" height="28" rx="8" fill="#38bdf8"/><text x="${x}" y="-23" fill="#0f0f0f" font-size="18" font-weight="650" text-anchor="middle">${i ? 4 : 1}</text><path class="badge-arrow" d="M${x} -8v17m-5-5 5 5 5-5" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</g>
        <g fill="#404040" stroke="#999999" stroke-width="1.1">
          <rect class="preset-held" x="81" y="20" width="35" height="9" rx="3"/><rect x="145" y="20" width="35" height="9" rx="3"/><rect x="209" y="20" width="35" height="9" rx="3"/><rect class="preset-held" x="273" y="20" width="35" height="9" rx="3"/><rect x="345" y="22" width="24" height="7" rx="3"/>
        </g>
        <rect x="9" y="29" width="402" height="193" rx="25" fill="url(#thing-case)" stroke="#8a8a8a" stroke-width="1.7"/>
        <rect x="16" y="35" width="388" height="180" rx="20" fill="#121212" stroke="#3a3a3a"/>
        <rect x="34" y="51" width="265" height="148" rx="6" fill="#080808"/>
        <g class="screen-content" clip-path="url(#thing-screen)">
          <rect class="screen-glass" x="34" y="51" width="265" height="148" fill="url(#thing-glass)"/>
          <text class="screen-layer screen-stock" x="166" y="129" fill="#c4c4c4" font-size="18" text-anchor="middle" letter-spacing="1">Car Thing</text>
          <image class="screen-layer screen-astra" href="${logo}" x="76" y="109" width="180" height="31"/>
          <g class="screen-layer screen-pair">
            <text x="46" y="86" fill="#f0f0f0" font-size="13" font-weight="600">Allow maintenance?</text>
            <text class="pair-digits" x="46" y="118" fill="#f0f0f0" font-size="27" font-weight="600" letter-spacing="3"></text>
            <text x="46" y="135" fill="#9a9a9a" font-size="8">Check this code in Thing Manager.</text>
            <path d="M34 164a6 6 0 0 1 6-6h253a6 6 0 0 1 6 6v35H34Z" fill="#1f1f1f"/>
            <rect x="44" y="166" width="62" height="23" rx="5" fill="#3a3a3a"/><text x="75" y="181" fill="#f0f0f0" font-size="9" font-weight="600" text-anchor="middle">Cancel</text>
            <rect x="112" y="166" width="177" height="23" rx="5" stroke="#8a8a8a"/><text x="200.5" y="181" fill="#f0f0f0" font-size="9" font-weight="600" text-anchor="middle">Allow</text>
            <rect class="allow-ring" x="112" y="166" width="177" height="23" rx="5" stroke="#38bdf8" stroke-width="1.5"/>
          </g>
        </g>
        <path d="M40 53h252" stroke="#ffffff" opacity=".08"/>
        <circle cx="347" cy="100" r="57" fill="#080808"/>
        <circle cx="345" cy="94" r="54" fill="url(#thing-dial)" stroke="#8f8f8f" stroke-width="1.2"/>
        <circle cx="345" cy="94" r="50.5" stroke="#9a9a9a" stroke-width=".8" opacity=".19"/>
        <circle cx="345" cy="180" r="18" fill="url(#thing-dial)" stroke="#777777"/>
        <!-- A window onto the back, mirrored as seen when turned around: the port is recessed in the raised plate's
             side wall and the cable lies flat on the lower pad. The cable parts sit in a mirror so "out" still means away from the port. -->
        <g transform="translate(-33.9 186) scale(.9)">
          <rect x="150" y="80" width="242" height="92" rx="14" fill="#141414"/>
          <g clip-path="url(#thing-back-window)">
            <rect x="9" y="29" width="402" height="193" rx="25" fill="url(#thing-case)" stroke="#8a8a8a" stroke-width="1.7"/>
            <rect x="247" y="38" width="152" height="176" rx="16" fill="#1c1c1c" stroke="#333333"/>
            <path d="M39 36h205v182H39a20 20 0 0 1-20-20V56a20 20 0 0 1 20-20Z" fill="url(#thing-plate)" stroke="#5a5a5a"/>
            <path d="M244 108h-14v36h14" fill="#0a0a0a" stroke="#5a5a5a"/>
            <rect x="232" y="118" width="5" height="16" rx="2.5" fill="#000000" stroke="#9a9a9a" stroke-width=".8"/><path d="M234.5 121.5v9" stroke="#6a6a6a" stroke-width="1.4" stroke-linecap="round"/>
          </g>
          <rect x="150" y="80" width="242" height="92" rx="14" stroke="#3d3d3d"/>
          <g clip-path="url(#thing-outside-port)">
            <g transform="matrix(-1 0 0 1 450 -139.5)">
              <g class="cable">
                <path d="M-400 265.5H180" stroke="#111111" stroke-width="9"/>
                <path d="M-400 265.5H180" stroke="#4f4f4f" stroke-width="5"/>
                <rect x="170" y="261" width="13" height="9" rx="3" fill="#3a3a3a"/>
                <path d="M212 259h14q2 0 2 2v9q0 2-2 2h-14Z" fill="#a8a8a8" stroke="#cfcfcf" stroke-width=".7"/><path d="M215 261h10" stroke="#6a6a6a" stroke-width=".7"/>
                <path class="plug-housing" d="M187 255h27v21h-27a9 9 0 0 1-9-9v-3a9 9 0 0 1 9-9Z" fill="#3a3a3a" stroke-width="1.3"/>
              </g>
            </g>
          </g>
          <g transform="matrix(-1 0 0 1 450 -139.5)">
            <g class="flow" stroke="#38bdf8"><path class="flow-glow" d="M-190 265.5H176" stroke-width="8" stroke-opacity=".22"/><path class="flow-core" d="M-190 265.5H176" stroke-width="2.2" stroke-opacity=".8"/></g>
            <path class="cue cue-out" d="M140 242h-25m6-5-6 5 6 5" stroke="#38bdf8" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
            <path class="cue cue-in" d="M115 242h25m-6-5 6 5-6 5" stroke="#38bdf8" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
          </g>
          <text class="port-label" x="271" y="191" fill="#9a9a9a" font-size="12.5" text-anchor="middle">Back</text>
        </g>
      </g>
    </g>
  </svg>`;
  const svg = container.firstElementChild, moving = svg.querySelectorAll('.cable, .plug-housing, .preset-held, .badge-arrow, .cue, .screen-content');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  return {
    show(mode, device, code) {
      const pose = {camera: 'full', screen: 'off', demo: '', flow: '', plugged: device !== 'none', ...thingPoses[mode]};
      // Pulling the cable powers a stock Car Thing down, so its screen goes dark in the demo.
      if (mode === 'unplug' && device === 'stock') pose.screen = 'stock';
      // A new demo picks up each part from wherever the previous pose left it.
      const handoff = 'demo' in svg.dataset && pose.demo !== svg.dataset.demo && !reduce.matches ? [...moving].map(el => {const style = getComputedStyle(el); return [el, {offset: 0, transform: style.transform, opacity: style.opacity, fill: style.fill, stroke: style.stroke}];}) : [];
      // Transitions would restart from the resting pose, not the demo's, so the handoff alone moves these parts.
      if (handoff.length) moving.forEach(el => {el.style.transition = 'none';});
      Object.assign(svg.dataset, pose);
      if (handoff.length) moving.forEach(el => {getComputedStyle(el).transform; el.style.transition = '';});
      handoff.forEach(([el, from]) => el.animate([from], {duration: 450, easing: 'cubic-bezier(.65,0,.35,1)'}));
      svg.querySelector('.pair-digits').textContent = String(code || '').replace(/(.{3})(.{3})/, '$1 $2');
      svg.setAttribute('aria-label', (pose.demo === 'hold' ? 'Front of Car Thing, with presets 1 and 4 highlighted. ' : pose.screen === 'pair' ? 'Car Thing screen asking to allow maintenance, with the pairing code. ' : 'Car Thing. ') + 'Below it, a close-up of the back: the USB-C port is recessed in the side of the raised center plate, and the cable lies flat along the back and slides in from the side.');
    }
  };
}
