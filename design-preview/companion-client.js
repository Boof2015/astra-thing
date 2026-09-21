'use strict';

const $ = id => document.getElementById(id);
const paths = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>',
  previous: '<path d="M6 5v14m12-14L8 12l10 7z"/>',
  next: '<path d="M18 5v14M6 5l10 7-10 7z"/>',
  shuffle: '<path d="M3 5h2c5 0 9 14 14 14h2m-4-4 4 4-4 4M3 19h2c2 0 4-3 6-7m3-5c2-2 3-2 5-2h2m-4-4 4 4-4 4"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  settings: '<path d="M3 7h10m4 0h4M3 17h4m4 0h10"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  volume: '<path d="m11 5-6 4H2v6h3l6 4zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  equalizer: '<path d="M4 10v4m5-8v12m5-15v18m5-13v8"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  backspace: '<path d="M9 5h12v14H9L2 12zM12 9l6 6m0-6-6 6"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.play}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });

// Deliberately fictional fixtures. No Astra API or device connection is made.
const tracks = [
  { title: 'Tidal Memory', artist: 'Low Season', album: 'Soft Landing', art: 'tidal', duration: 244, colors: ['#426673','#524332'] },
  { title: 'Somewhere, Slowly', artist: 'Sunday Service', album: 'Sundial', art: 'sundial', duration: 213, colors: ['#7b5035','#473a35'] },
  { title: 'Still in Motion', artist: 'Parallel Lines', album: 'Form / Function', art: 'form', duration: 287, colors: ['#4f633a','#253b36'] },
  { title: 'The Space Between', artist: 'April Radio', album: 'In Bloom', art: 'bloom', duration: 198, colors: ['#624b63','#453435'] },
  { title: 'Almost Home', artist: 'Quiet Company', album: 'Open Country', art: 'country', duration: 261, colors: ['#596656','#3d443d'] },
  { title: 'Everything in Its Place', artist: 'Small Hours', album: 'Monochrome', art: 'mono', duration: 232, colors: ['#475258','#383b3b'] }
];
const playlists = [
  {name: 'After hours', detail: '32 songs · 2 hr 14 min', track: 0},
  {name: 'Sunday slow', detail: '24 songs · 1 hr 36 min', track: 1},
  {name: 'In the zone', detail: '48 songs · 3 hr 08 min', track: 2},
  {name: 'On repeat', detail: '18 songs · 1 hr 12 min', track: 3},
  {name: 'Out of office', detail: '36 songs · 2 hr 27 min', track: 4},
  {name: 'Quiet company', detail: '27 songs · 1 hr 49 min', track: 5}
];
const state = {view: 'playing', track: 0, selected: 0, playlist: 0, playing: false, position: 87, volume: 64, dial: 0, repeat: false, scrubbing: false};
const preferenceKey = 'astra-thing.study05.appearance';
const appearance = {surface:'light', albumColor:true};
try {
  const saved = JSON.parse(localStorage.getItem(preferenceKey) || localStorage.getItem('astra-thing.study04.appearance'));
  if (saved?.surface === 'light' || saved?.surface === 'dark') appearance.surface = saved.surface;
  if (typeof saved?.albumColor === 'boolean') appearance.albumColor = saved.albumColor;
} catch { /* The preview also works when browser storage is unavailable. */ }
let settingsReturnView = 'playing', settingsIndex = 0;
const settingButtons = [...document.querySelectorAll('.setting-choices button')];
const descriptions = {
  atmosphere: 'Soft album color, open space, and rounded controls.',
  studio: 'Crisp geometry, precise labels, and a warm signal color.',
  gallery: 'Warm neutral surfaces, expressive type, and quiet contrast.'
};
let volumeTimeout, toastTimeout;
let pendingShelfPage = null, shelfSettleTimer, scrubTimer;
let seekPointerDown = false;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const unified = () => $('screen').dataset.language === 'unified';
const keyReleaseTimers = new WeakMap();
function pressFeedback(button) {
  if (!button || !unified()) return;
  clearTimeout(keyReleaseTimers.get(button));
  button.classList.add('is-pressed');
  keyReleaseTimers.set(button, setTimeout(() => button.classList.remove('is-pressed'), 110));
}
const formatTime = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2,'0')}`;

function paletteHue(hex) {
  const [r,g,b] = hex.slice(1).match(/../g).map(part => parseInt(part,16) / 255);
  const max = Math.max(r,g,b), min = Math.min(r,g,b), delta = max - min;
  if (!delta) return 0;
  const sector = max === r ? (g-b)/delta : max === g ? (b-r)/delta+2 : (r-g)/delta+4;
  return (sector*60+360)%360;
}

function applyAppearance() {
  // Fixture palettes stand in for live artwork analysis. Constrain tonal roles
  // instead of putting arbitrary cover RGB values directly behind text.
  const colors = tracks[state.track].colors;
  const hue = paletteHue(colors[0]);
  const dark = appearance.surface === 'dark';
  const tone = (s,l) => `hsl(${hue.toFixed(1)} ${appearance.albumColor ? s : 0}% ${l}%)`;
  const panel = dark ? tone(12,16) : '#ede8db';
  const ink = dark ? '#ede8db' : tone(22,19);
  const values = {
    '--accent-a':colors[0], '--accent-b':colors[1],
    '--base':tone(12,10), '--panel':panel, '--panel-ink':ink,
    '--key-dark':ink, '--key-quiet':tone(13,19), '--header-ink':'#ede8db',
    '--key-edge':tone(10,31), '--key-down':dark ? '#d6d1c5' : tone(24,12),
    '--panel-line':dark ? '#ede8db38' : '#20252233',
    '--panel-pressed':dark ? tone(13,22) : '#ded9cc',
    '--selection-edge':dark ? '#ede8db' : panel
  };
  for (const [name,value] of Object.entries(values)) $('screen').style.setProperty(name,value);
  $('screen').dataset.surface = appearance.surface;
  $('screen').dataset.albumColor = appearance.albumColor ? 'on' : 'off';
  document.querySelectorAll('[data-surface]').forEach(button => {
    if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', String(button.dataset.surface === appearance.surface));
  });
  document.querySelectorAll('button[data-album-color]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.albumColor === String(appearance.albumColor)));
  });
}

function saveAppearance() {
  try { localStorage.setItem(preferenceKey, JSON.stringify(appearance)); } catch { /* Session-only fallback. */ }
  applyAppearance();
}

settingButtons.forEach((button,index) => button.addEventListener('click', () => {
  settingsIndex = index;
  if (button.dataset.surface) appearance.surface = button.dataset.surface;
  else appearance.albumColor = button.dataset.albumColor === 'true';
  settingButtons.forEach(other => other.classList.remove('dial-selected'));
  saveAppearance();
}));

function updatePlayback() {
  $('play').innerHTML = icon(state.playing ? 'pause' : 'play');
  $('play').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  document.querySelector('.mini-hint').textContent = state.playing ? 'Playing' : 'Paused';
  document.querySelector('.mini-playing').innerHTML = icon(state.playing ? 'equalizer' : 'pause');
  document.querySelector('.playing-dot').style.opacity = state.playing ? '1' : '.35';
  updateQueueNowPlaying();
  updateSearchNowPlaying();
  updatePosition();
}

function updatePosition() {
  const duration = tracks[state.track].duration;
  $('seek').max = duration;
  $('seek').value = state.position;
  $('seek').style.setProperty('--progress', `${state.position / duration * 100}%`);
  $('seek').setAttribute('aria-valuetext', `${formatTime(state.position)} of ${formatTime(duration)}`);
  $('elapsed').textContent = formatTime(state.position);
  $('duration').textContent = formatTime(duration);
}

function renderTrack() {
  const track = tracks[state.track];
  $('main-art').src = `assets/${track.art}.svg`;
  $('main-art').alt = `${track.album} sample album artwork`;
  $('mini-art').src = `assets/${track.art}.svg`;
  $('track-title').textContent = $('mini-title').textContent = track.title;
  $('track-artist').textContent = $('mini-artist').textContent = track.artist;
  $('track-album').textContent = track.album;
  $('playlist-context').textContent = $('context-label').textContent = state.playbackContext || playlists[state.playlist].name;
  applyAppearance();
  document.querySelectorAll('[data-sample]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.sample) === state.track)));
  updatePlayback();
  if (unified() && !reduceMotion.matches) {
    for (const element of [$('main-art'), document.querySelector('.track-copy')]) {
      element.classList.remove('track-arrives');
      requestAnimationFrame(() => element.classList.add('track-arrives'));
    }
  }
}

function selectPlaylist(index, {reveal = true, animate = true} = {}) {
  state.selected = Math.max(0, Math.min(playlists.length - 1, index));
  document.querySelectorAll('.playlist').forEach((button, i) => {
    button.classList.toggle('selected', i === state.selected);
    if (i === state.selected) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  if (state.view === 'playlists' && reveal) {
    const page = Math.floor(state.selected / 3);
    const target = page * 764;
    const smooth = animate && unified() && !reduceMotion.matches && Math.abs($('playlist-grid').scrollLeft - target) > 1;
    clearTimeout(shelfSettleTimer);
    pendingShelfPage = smooth ? page : null;
    $('playlist-grid').scrollTo({left: target, behavior: smooth ? 'smooth' : 'instant'});
    updateShelfPage(page);
    if (smooth) shelfSettleTimer = setTimeout(finishShelfTravel, 650);
  }
}

function finishShelfTravel() {
  clearTimeout(shelfSettleTimer);
  pendingShelfPage = null;
  if (state.view !== 'playlists') return;
  const page = $('playlist-grid').scrollLeft > 375 ? 1 : 0;
  updateShelfPage(page);
  if (Math.floor(state.selected / 3) !== page) selectPlaylist(page * 3, {reveal:false});
}

function updateShelfPage(page) {
  $('shelf-page').textContent = `${page + 1} / 2`;
  $('shelf-previous').disabled = page === 0;
  $('shelf-next').disabled = page === 1;
}

playlists.forEach((playlist, index) => {
  const button = document.createElement('button');
  button.className = 'playlist';
  button.setAttribute('aria-label', `Play ${playlist.name}, ${playlist.detail}`);
  button.innerHTML = `<img src="assets/${tracks[playlist.track].art}.svg" alt=""><span class="playlist-copy"><strong>${playlist.name}</strong><small>${playlist.detail}</small></span><span class="playlist-arrow">${icon('play')}</span>`;
  button.addEventListener('pointerdown', () => selectPlaylist(index, {reveal:false}));
  button.addEventListener('focus', () => selectPlaylist(index));
  button.addEventListener('click', () => startPlaylist(index));
  $('playlist-grid').append(button);
});

function setView(view) { navigate(view==='search' ? searchHome() : view); }
function goBack() { systemBack(); }
function toggleSettings() { openSettings(); }

function toast(message) {
  clearTimeout(toastTimeout);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimeout = setTimeout(() => { $('toast').hidden = true; }, 1600);
}

function startPlaylist(index) {
  selectPlaylist(index);
  state.playlist = index;
  state.playbackContext=playlists[index].name;
  state.track = playlists[index].track;
  state.position = 0;
  state.playing = true;
  resetPreviewQueue(state.track);
  renderTrack();
  setView('playing');
  toast(`Playing ${playlists[index].name}`);
}

function turnDial(direction) {
  state.dial += direction * 8;
  $('dial').style.setProperty('--dial-angle', `${state.dial}deg`);
  if (isQueuePage(state.view)) { turnQueueDial(direction); return; }
  if (isSearchPage(state.view)) { turnSearchDial(direction); return; }
  if (!['playing','playlists'].includes(state.view)) { turnSystemDial(direction); return; }
  if (state.view === 'playlists') {
    selectPlaylist(state.selected + direction);
    return;
  }
  state.volume = Math.max(0, Math.min(100, state.volume + direction * 2));
  $('volume-small').textContent = $('volume-large').textContent = state.volume;
  $('volume-fill').style.width = `${state.volume}%`;
  $('volume-overlay').hidden = false;
  $('toast').hidden = true;
  clearTimeout(volumeTimeout);
  volumeTimeout = setTimeout(() => { $('volume-overlay').hidden = true; }, 1400);
}

function pressDial() {
  if (isQueuePage(state.view)) pressQueueDial();
  else if (isSearchPage(state.view)) pressSearchDial();
  else if (!['playing','playlists'].includes(state.view)) pressSystemDial();
  else if (state.view === 'playlists') startPlaylist(state.selected);
  else { pressFeedback($('play')); state.playing = !state.playing; updatePlayback(); }
}

document.querySelectorAll('[data-theme]').forEach(button => {
  if (button.tagName !== 'BUTTON') return;
  button.addEventListener('click', () => {
    $('screen').dataset.theme = button.dataset.theme;
    $('direction-description').textContent = descriptions[button.dataset.theme];
    document.querySelectorAll('.directions button').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  });
});
document.querySelectorAll('button[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-sample]').forEach(button => button.addEventListener('click', () => {
  state.track = Number(button.dataset.sample);
  state.playlist = state.track;
  state.playbackContext=playlists[state.playlist].name;
  state.position = 87;
  resetPreviewQueue(state.track);
  renderTrack();
}));
$('screen-navigation').onclick = handleHeaderAction;
$('device-settings').onclick = toggleSettings;
$('open-playlists').onclick = () => setView('playlists');
$('mini-player').onclick = () => setView('playing');
$('back').onclick = goBack;
$('play').onclick = () => { state.playing = !state.playing; updatePlayback(); };
$('dial').onclick = pressDial;
$('dial-left').onclick = () => turnDial(-1);
$('dial-right').onclick = () => turnDial(1);
let lastWheelAt = 0;
$('dial').addEventListener('wheel', event => {
  event.preventDefault();
  if (Date.now() - lastWheelAt < 65 || event.deltaY === 0) return;
  lastWheelAt = Date.now();
  turnDial(event.deltaY > 0 ? 1 : -1);
}, {passive:false});
$('seek').oninput = () => { state.position = Number($('seek').value); updatePosition(); };
function beginScrub() {
  clearTimeout(scrubTimer);
  if (!unified()) return;
  state.scrubbing = true;
  $('progress-module').classList.add('is-scrubbing');
  $('volume-overlay').hidden = true;
  $('toast').hidden = true;
}
function endScrub() {
  clearTimeout(scrubTimer);
  state.scrubbing = false;
  seekPointerDown = false;
  $('progress-module').classList.remove('is-scrubbing');
}
$('seek').addEventListener('pointerdown', () => { seekPointerDown = true; beginScrub(); });
$('seek').addEventListener('input', () => {
  beginScrub();
  if (!seekPointerDown) scrubTimer = setTimeout(endScrub, 350);
});
$('seek').addEventListener('blur', endScrub);
$('seek').addEventListener('change', endScrub);
window.addEventListener('pointerup', endScrub);
window.addEventListener('pointercancel', endScrub);
window.addEventListener('blur', endScrub);
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button?.closest('#screen')) pressFeedback(button);
});
$('next').onclick = () => advancePreviewTrack();
$('previous').onclick = previousPreviewTrack;
$('shuffle').onclick = () => {
  const enabled = $('shuffle').getAttribute('aria-pressed') !== 'true';
  $('shuffle').setAttribute('aria-pressed', String(enabled));
  $('shuffle').setAttribute('aria-label', enabled ? 'Disable shuffle' : 'Enable shuffle');
  if (enabled) { previewQueue.shuffle(); refreshQueue(); }
  if (!unified()) toast(enabled ? 'Shuffle on' : 'Shuffle off');
};
$('repeat').onclick = () => {
  state.repeat = !state.repeat;
  $('repeat').setAttribute('aria-pressed', String(state.repeat));
  $('repeat').setAttribute('aria-label', state.repeat ? 'Disable track repeat' : 'Repeat this track');
  if (!unified()) toast(state.repeat ? 'Repeating this track' : 'Repeat off');
};
$('shelf-previous').onclick = () => selectPlaylist(0);
$('shelf-next').onclick = () => selectPlaylist(3);
$('playlist-grid').addEventListener('scroll', () => {
  if (pendingShelfPage === null) updateShelfPage($('playlist-grid').scrollLeft > 375 ? 1 : 0);
}, {passive:true});
$('playlist-grid').addEventListener('scrollend', finishShelfTravel);
$('playlist-grid').addEventListener('pointerdown', () => {
  clearTimeout(shelfSettleTimer);
  pendingShelfPage = null;
});

function setPreviewSize(percent) {
  $('preview-scale').value = percent;
  $('scale-label').textContent = `${percent}%`;
  $('rig-stage').style.maxWidth = `${1040 * percent / 100}px`;
  $('compact-size').setAttribute('aria-pressed', String(percent === 52));
  $('large-size').setAttribute('aria-pressed', String(percent === 100));
}
$('compact-size').onclick = () => setPreviewSize(52);
$('large-size').onclick = () => setPreviewSize(100);
$('preview-scale').oninput = () => setPreviewSize(Number($('preview-scale').value));
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (handleSearchTyping(event) || event.target instanceof HTMLInputElement) return;
  if (event.key === '1') setView('playing');
  else if (event.key === '2') setView('queue');
  else if (event.key === '3') setView('playlists');
  else if (event.key === '4') { event.preventDefault();setView('search'); }
  else if (event.key === 'Escape') goBack();
  else if (event.key.toLowerCase() === 'm') toggleSettings();
  else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
    const forward=isQueuePage(state.view) || isSearchPage(state.view) ? ['ArrowRight','ArrowDown'] : ['ArrowRight','ArrowUp'];
    event.preventDefault(); turnDial(forward.includes(event.key) ? 1 : -1); $('dial').focus({preventScroll:true});
  }
  else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); pressDial(); }
});
setInterval(() => {
  if (!state.playing || state.scrubbing || !system.connected) return;
  state.position += 1;
  if (state.position >= tracks[state.track].duration) {
    advancePreviewTrack({natural:true});
  }
  updatePosition();
}, 1000);
new ResizeObserver(entries => {
  const scale = Math.min(1, entries[0].contentRect.width / 1040);
  document.querySelector('.device').style.transform = `scale(${scale})`;
  $('rig-stage').style.height = `${540 * scale}px`;
}).observe($('rig-stage'));
selectPlaylist(0);
updateShelfPage(0);
renderTrack();

document.addEventListener('DOMContentLoaded', () => { initializeQueue(); initializeSearch(); initializeSystem(); });
