'use strict';

const previewQueue=new PreviewQueue();
const queueUi={actionId:null,actionIndex:0,history:[],pointerScroll:false,scrollTimer:null};
const queueNodes=new Map();
const isQueuePage=view => ['queue','queue-actions','queue-move'].includes(view);
const queueActions=() => [...$('queue-actions-view').querySelectorAll('button')];

function announceQueue(message) { $('queue-announcement').textContent=message; }
function resetPreviewQueue(track=state.track) {
  previewQueue.reset(Array.from({length:8},(_,index) => (track+index+1)%tracks.length));
  if ($('shuffle').getAttribute('aria-pressed') === 'true') previewQueue.shuffle();
  queueUi.history=[];
  queueUi.actionId=null;
  refreshQueue();
}
function updateQueueNowPlaying() {
  const track=tracks[state.track];
  $('queue-now-art').src=`assets/${track.art}.svg`;
  $('queue-now-title').textContent=track.title;
  $('queue-now-icon').innerHTML=icon(state.playing ? 'equalizer' : 'pause');
  $('queue-now-playing').setAttribute('aria-label',`${state.playing ? 'Playing' : 'Paused'}: ${track.title}. Return to now playing`);
}
function updateQueueSelection() {
  const visible=previewQueue.visibleItems();
  for (const item of visible) {
    const button=queueNodes.get(item.id)?.firstElementChild;
    if (!button) continue;
    const selected=item.id === previewQueue.selectedId;
    button.classList.toggle('selected',selected);
    button.classList.toggle('is-moving',item.id === previewQueue.move?.id);
    button.disabled=Boolean(previewQueue.move);
    if (selected) button.setAttribute('aria-current','true');
    else button.removeAttribute('aria-current');
  }
  const index=visible.findIndex(item => item.id === previewQueue.selectedId);
  $('queue-position').innerHTML=visible.length ? `<strong>${index+1}</strong> / ${visible.length}` : '0 songs';
  $('queue-position').setAttribute('aria-label',visible.length ? `Position ${index+1} of ${visible.length}` : 'Queue empty');
  $('queue-move-up').disabled=index <= 0;
  $('queue-move-down').disabled=index < 0 || index >= visible.length-1;
}
function revealQueueSelection(smooth=false) {
  const row=queueNodes.get(previewQueue.selectedId);
  const list=$('queue-list');
  if (!row || list.hidden) return;
  let top=list.scrollTop;
  if (row.offsetTop < top+4) top=row.offsetTop-4;
  else if (row.offsetTop+row.offsetHeight > top+list.clientHeight-4) top=row.offsetTop+row.offsetHeight-list.clientHeight+4;
  if (Math.abs(top-list.scrollTop)>1) list.scrollTo({top,behavior:smooth && !reduceMotion.matches ? 'smooth' : 'instant'});
}
function selectQueue(id,{reveal=true,smooth=false}={}) {
  if (previewQueue.move) return;
  previewQueue.select(id);
  updateQueueSelection();
  if (reveal) revealQueueSelection(smooth);
}
function renderQueueRows({preserveAnchor=true}={}) {
  const list=$('queue-list');
  const selectedNode=queueNodes.get(previewQueue.selectedId);
  const anchored=preserveAnchor && !list.hidden && ['queue','queue-move'].includes(state.view) && selectedNode;
  const previousOffset=anchored ? selectedNode.offsetTop-list.scrollTop : 0;
  const live=previewQueue.visibleItems();
  const ids=new Set(live.map(item => item.id));
  for (const [id,node] of queueNodes) {
    if (!ids.has(id)) { node.remove();queueNodes.delete(id); }
  }
  let cursor=list.firstElementChild;
  live.forEach((item,index) => {
    const track=tracks[item.track];
    let wrapper=queueNodes.get(item.id);
    if (!wrapper) {
      wrapper=document.createElement('div');
      wrapper.className='queue-item';wrapper.setAttribute('role','listitem');
      const button=document.createElement('button');button.className='queue-track';button.dataset.queueId=item.id;
      button.innerHTML=`<img src="assets/${track.art}.svg" alt=""><span class="queue-track-copy"><strong>${escapeHTML(track.title)}</strong><small>${escapeHTML(track.artist)}</small></span><span class="queue-duration">${formatTime(track.duration)}</span>${icon('chevron')}`;
      button.addEventListener('pointerdown',() => selectQueue(item.id,{reveal:false}));
      button.addEventListener('focus',() => selectQueue(item.id,{reveal:!queueUi.pointerScroll}));
      button.addEventListener('click',() => openQueueActions(item.id));
      wrapper.append(button);queueNodes.set(item.id,wrapper);
    }
    wrapper.firstElementChild.setAttribute('aria-label',`${index+1}. ${track.title}, ${track.artist}. Track actions`);
    if (wrapper !== cursor) list.insertBefore(wrapper,cursor);
    cursor=wrapper.nextElementSibling;
  });
  list.hidden=!live.length;
  $('queue-empty').hidden=Boolean(live.length);
  if (anchored && selectedNode.isConnected) list.scrollTop=selectedNode.offsetTop-previousOffset;
  updateQueueSelection();
}
function renderQueuePage(view,previousView) {
  queueUi.pointerScroll=false;
  clearTimeout(queueUi.scrollTimer);
  if (view === 'queue-actions') {
    if (!previewQueue.items.some(item => item.id === queueUi.actionId)) { navigate('queue'); return; }
    queueActions().forEach(button => button.classList.remove('dial-selected'));
    renderQueueActions();
    queueUi.actionIndex=queueActions().findIndex(button => !button.disabled);
    return;
  }
  if (view === 'queue-move' && !previewQueue.move) { navigate('queue');return; }
  $('queue-now-playing').hidden=view === 'queue-move';
  $('queue-move-toolbar').hidden=view !== 'queue-move';
  renderQueueRows({preserveAnchor:previousView === view});
  updateQueueNowPlaying();
  revealQueueSelection();
}
function openQueueActions(id=previewQueue.selectedId) {
  if (state.view !== 'queue' || !previewQueue.items.some(item => item.id === id)) return;
  previewQueue.select(id);queueUi.actionId=id;
  navigate('queue-actions');
}
function renderQueueActions() {
  const entry=previewQueue.items.find(item => item.id === queueUi.actionId);
  if (!entry) return;
  const track=tracks[entry.track];
  $('queue-action-art').src=`assets/${track.art}.svg`;
  $('queue-action-title').textContent=track.title;
  $('queue-action-artist').textContent=track.artist;
  const alreadyNext=previewQueue.items[0]?.id === entry.id;
  $('queue-play-next').disabled=alreadyNext;
  $('queue-play-next-label').textContent=alreadyNext ? 'Already up next' : 'Play next';
  $('queue-start-move').disabled=previewQueue.items.length<2;
  // Keep the same action under the knob if playback changes its availability.
  // A disabled action becomes a no-op until the user turns to another action.
}
function turnQueueDial(direction) {
  queueUi.pointerScroll=false;
  if (state.view === 'queue-move') {
    previewQueue.stepMove(direction);
    renderQueueRows({preserveAnchor:false});revealQueueSelection(true);
  } else if (state.view === 'queue-actions') {
    const buttons=queueActions();
    let index=queueUi.actionIndex+direction;
    while (index>=0 && index<buttons.length && buttons[index].disabled) index+=direction;
    if (index>=0 && index<buttons.length) queueUi.actionIndex=index;
    buttons.forEach((button,index) => button.classList.toggle('dial-selected',index === queueUi.actionIndex));
  } else {
    previewQueue.step(direction);updateQueueSelection();revealQueueSelection(true);
  }
}
function pressQueueDial() {
  if (state.view === 'queue-move') finishQueueMove();
  else if (state.view === 'queue-actions') queueActions()[queueUi.actionIndex]?.click();
  else if (previewQueue.items.length) openQueueActions();
  else navigate('playlists');
}
function finishQueueMove() {
  const moved=previewQueue.commitMove();
  navigate('queue');
  if (moved) {
    const index=previewQueue.items.findIndex(item => item.id === previewQueue.selectedId);
    announceQueue(`Track moved to position ${index+1}.`);
  }
}
function refreshQueue({consumedId=null}={}) {
  updateQueueNowPlaying();
  if ((state.view === 'queue-actions' && !previewQueue.items.some(item => item.id === queueUi.actionId)) || (state.view === 'queue-move' && !previewQueue.move)) {
    navigate('queue');
    announceQueue(consumedId ? 'That track is playing now.' : 'The queue changed.');
    return;
  }
  if (state.view === 'queue-actions') renderQueueActions();
  renderQueueRows();
}
function advancePreviewTrack({natural=false}={}) {
  if (!system.connected) return;
  if (natural && state.repeat) { state.position=0;updatePosition();return; }
  const next=previewQueue.consumeNext();
  if (!next) { state.playing=false;state.position=tracks[state.track].duration;updatePlayback();return; }
  queueUi.history.push(state.track);
  state.track=next.track;state.position=0;state.playbackContext='Queue';
  renderTrack();refreshQueue({consumedId:next.id});
}
function previousPreviewTrack() {
  if (state.position<=3 && queueUi.history.length) {
    previewQueue.prepend(state.track);
    state.track=queueUi.history.pop();
    state.playbackContext='Queue';
  }
  state.position=0;renderTrack();refreshQueue();
}
function finishQueueScroll() {
  clearTimeout(queueUi.scrollTimer);
  if (!queueUi.pointerScroll || state.view !== 'queue') return;
  queueUi.pointerScroll=false;
  const list=$('queue-list'),selected=queueNodes.get(previewQueue.selectedId);
  const isVisible=node => node && node.offsetTop>=list.scrollTop-1 && node.offsetTop+node.offsetHeight<=list.scrollTop+list.clientHeight+1;
  if (isVisible(selected)) return;
  const entry=previewQueue.items.find(item => isVisible(queueNodes.get(item.id)));
  if (entry) selectQueue(entry.id,{reveal:false});
}
function initializeQueue() {
  resetPreviewQueue();
  $('queue-now-playing').onclick=() => navigate('playing');
  $('queue-browse').onclick=() => navigate('playlists');
  $('queue-play-next').onclick=() => {
    if (!previewQueue.playNext(queueUi.actionId)) return;
    navigate('queue');announceQueue('Moved to up next.');
  };
  $('queue-start-move').onclick=() => { if (previewQueue.beginMove(queueUi.actionId)) navigate('queue-move'); };
  $('queue-remove').onclick=() => {
    const removed=previewQueue.remove(queueUi.actionId);
    navigate('queue');
    if (removed) announceQueue(`${tracks[removed.track].title} removed from queue.`);
  };
  $('queue-move-up').onclick=() => turnQueueDial(-1);
  $('queue-move-down').onclick=() => turnQueueDial(1);
  $('queue-move-confirm').onclick=finishQueueMove;
  $('queue-move-cancel').onclick=() => systemBack();
  for (const type of ['focusin','pointerdown']) $('queue-actions-view').addEventListener(type,event => {
    const index=queueActions().indexOf(event.target.closest('button'));
    if (index<0) return;
    queueUi.actionIndex=index;
    queueActions().forEach(button => button.classList.remove('dial-selected'));
  });
  $('queue-list').addEventListener('pointerdown',() => { queueUi.pointerScroll=true; });
  $('queue-list').addEventListener('wheel',() => { queueUi.pointerScroll=true; },{passive:true});
  $('queue-list').addEventListener('scrollend',finishQueueScroll);
  $('queue-list').addEventListener('scroll',() => {
    if (!queueUi.pointerScroll) return;
    clearTimeout(queueUi.scrollTimer);queueUi.scrollTimer=setTimeout(finishQueueScroll,180);
  },{passive:true});
  $('queue-demo-refill').onclick=() => { resetPreviewQueue();if (system.connected) navigate('queue'); };
  $('queue-demo-advance').onclick=() => advancePreviewTrack({natural:true});
  $('queue-demo-empty').onclick=() => { previewQueue.reset([]);refreshQueue();if (system.connected) navigate('queue'); };
}
