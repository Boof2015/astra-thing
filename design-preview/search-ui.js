'use strict';

const searchUi={draft:'',query:'',submitted:false,results:[],selected:0,actionIndex:0,numbers:false,scrollTop:0,manualScroll:false,scrollTimer:null};
const isSearchPage=view => ['search','search-results','search-actions'].includes(view);
const searchActionButtons=() => [...$('search-actions-view').querySelectorAll('button')];

function searchHome() { return searchUi.submitted ? 'search-results' : 'search'; }
function updateSearchNowPlaying() {
  const track=tracks[state.track];
  $('search-now-art').src=`assets/${track.art}.svg`;
  $('search-now-title').textContent=track.title;
  $('search-now-icon').innerHTML=icon(state.playing ? 'equalizer' : 'pause');
  $('search-now-playing').setAttribute('aria-label',`${state.playing ? 'Playing' : 'Paused'}: ${track.title}. Return to now playing`);
}
function renderSearchKeyboard() {
  const rows=searchUi.numbers ? ['1234567890','-/:;()&@"',".,?!'_"] : ['qwertyuiop','asdfghjkl','zxcvbnm'];
  $('search-keyboard').innerHTML=rows.map((row,index) => `<div class="search-key-row">${[...row].map(key => `<button class="search-key" data-character="${escapeHTML(key)}" aria-label="${escapeHTML(key)}">${escapeHTML(key.toUpperCase())}</button>`).join('')}${index===2 ? `<button class="search-key wide" data-search-key="delete" aria-label="Backspace">${icon('backspace')}</button>` : ''}</div>`).join('') + `<div class="search-key-row"><button class="search-key mode" data-search-key="mode">${searchUi.numbers ? 'ABC' : '123'}</button><button class="search-key space" data-character=" " aria-label="Space">space</button><button class="search-key submit" data-search-key="submit">Search</button></div>`;
  updateSearchEntry();
}
function updateSearchEntry() {
  $('search-clear').hidden=!searchUi.draft;
  $('search-keyboard').querySelector('[data-search-key=submit]').disabled=!normalizeSearch(searchUi.draft);
}
function editSearchText(text,{remove=false}={}) {
  const input=$('search-input');
  let start=input.selectionStart ?? input.value.length;
  const end=input.selectionEnd ?? start;
  if (remove && start===end && start>0) start-=Array.from(input.value.slice(0,start)).at(-1).length;
  if (input.value.length-(end-start)+text.length>64) return;
  input.setRangeText(text,start,end,'end');
  searchUi.draft=input.value;updateSearchEntry();
  input.focus({preventScroll:true});
}
function submitSearch() {
  const query=searchUi.draft.trim();
  if (!normalizeSearch(query)) return;
  searchUi.query=query;searchUi.submitted=true;
  searchUi.results=findPreviewTracks(tracks,query);
  searchUi.selected=0;searchUi.scrollTop=0;
  $('search-announcement').textContent=`${searchUi.results.length} ${searchUi.results.length===1 ? 'song' : 'songs'} found for ${query}.`;
  navigate('search-results');
}
function updateSearchSelection({reveal=false,smooth=false}={}) {
  const rows=[...$('search-results').querySelectorAll('.queue-track')];
  rows.forEach((button,index) => {
    button.classList.toggle('selected',index===searchUi.selected);
    if (index===searchUi.selected) button.setAttribute('aria-current','true');
    else button.removeAttribute('aria-current');
  });
  const row=rows[searchUi.selected]?.parentElement,list=$('search-results');
  if (!reveal || !row) return;
  let top=list.scrollTop;
  if (row.offsetTop<top+4) top=row.offsetTop-4;
  else if (row.offsetTop+row.offsetHeight>top+list.clientHeight-4) top=row.offsetTop+row.offsetHeight-list.clientHeight+4;
  if (Math.abs(top-list.scrollTop)>1) list.scrollTo({top,behavior:smooth && !reduceMotion.matches ? 'smooth' : 'instant'});
}
function renderSearchResults() {
  const list=$('search-results');
  list.replaceChildren();
  searchUi.results.forEach((trackIndex,index) => {
    const track=tracks[trackIndex],wrapper=document.createElement('div');
    wrapper.className='queue-item';wrapper.setAttribute('role','listitem');
    const button=document.createElement('button');button.className='queue-track';
    button.setAttribute('aria-label',`${track.title}, ${track.artist}. Track actions`);
    button.innerHTML=`<img src="assets/${track.art}.svg" alt=""><span class="queue-track-copy"><strong>${escapeHTML(track.title)}</strong><small>${escapeHTML(track.artist)}</small></span><span class="queue-duration">${formatTime(track.duration)}</span>${icon('chevron')}`;
    button.onpointerdown=() => { searchUi.selected=index;updateSearchSelection(); };
    button.onfocus=() => { searchUi.selected=index;updateSearchSelection({reveal:!searchUi.manualScroll}); };
    button.onclick=() => { searchUi.selected=index;openSearchActions(); };
    wrapper.append(button);list.append(wrapper);
  });
  list.hidden=!searchUi.results.length;
  $('search-empty').hidden=Boolean(searchUi.results.length);
  list.scrollTop=searchUi.scrollTop;
  updateSearchSelection({reveal:true});
  updateSearchNowPlaying();
}
function renderSearchPage(view) {
  searchUi.manualScroll=false;clearTimeout(searchUi.scrollTimer);
  if (view==='search') {
    $('search-input').value=searchUi.draft;
    renderSearchKeyboard();
    $('search-input').focus({preventScroll:true});
    $('search-input').setSelectionRange(searchUi.draft.length,searchUi.draft.length);
  } else if (view==='search-results') {
    $('view-label').textContent=searchUi.query;
    $('view-label').setAttribute('title',`Results for ${searchUi.query}`);
    renderSearchResults();
    if (!searchUi.results.length) $('dial').setAttribute('aria-label','Press dial: edit search');
  } else {
    const track=tracks[searchUi.results[searchUi.selected]];
    if (!track) { navigate(searchHome());return; }
    $('search-action-art').src=`assets/${track.art}.svg`;
    $('search-action-title').textContent=track.title;
    $('search-action-artist').textContent=track.artist;
    searchUi.actionIndex=0;
    searchActionButtons().forEach(button => button.classList.remove('dial-selected'));
  }
}
function openSearchActions() {
  if (!searchUi.results.length) return;
  navigate('search-actions');
}
function turnSearchDial(direction) {
  if (state.view==='search') return;
  if (state.view==='search-actions') {
    const buttons=searchActionButtons();
    searchUi.actionIndex=Math.max(0,Math.min(buttons.length-1,searchUi.actionIndex+direction));
    buttons.forEach((button,index) => button.classList.toggle('dial-selected',index===searchUi.actionIndex));
  } else {
    searchUi.manualScroll=false;
    searchUi.selected=Math.max(0,Math.min(searchUi.results.length-1,searchUi.selected+direction));
    updateSearchSelection({reveal:true,smooth:true});
  }
}
function pressSearchDial() {
  if (state.view==='search') submitSearch();
  else if (state.view==='search-actions') searchActionButtons()[searchUi.actionIndex]?.click();
  else if (searchUi.results.length) openSearchActions();
  else navigate('search');
}
function handleSearchTyping(event) {
  if (state.view!=='search') return false;
  if (event.key==='Escape') { event.preventDefault();systemBack();return true; }
  if (event.key==='Enter' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault();submitSearch();return true; }
  if (event.target instanceof HTMLInputElement) return true;
  if (event.key.length===1 || event.key==='Backspace') {
    event.preventDefault();editSearchText(event.key==='Backspace' ? '' : event.key,{remove:event.key==='Backspace'});return true;
  }
  return false;
}
function runSearchAction(action) {
  if (!system.connected || state.view!=='search-actions') return;
  const trackIndex=searchUi.results[searchUi.selected];
  if (!Number.isInteger(trackIndex)) return;
  if (action==='now') {
    queueUi.history.push(state.track);
    state.track=trackIndex;state.position=0;state.playing=true;state.playbackContext='Search';
    renderTrack();navigate('playing');
  } else {
    if (action==='next') previewQueue.prepend(trackIndex);
    else previewQueue.append(trackIndex);
    refreshQueue();navigate('search-results');
    toast(action==='next' ? 'Playing next' : 'Added to queue');
  }
}
function settleSearchScroll() {
  if (!searchUi.manualScroll || state.view!=='search-results') return;
  searchUi.manualScroll=false;
  const list=$('search-results'),rows=[...list.children];
  const visible=row => row && row.offsetTop>=list.scrollTop-1 && row.offsetTop+row.offsetHeight<=list.scrollTop+list.clientHeight+1;
  if (visible(rows[searchUi.selected])) return;
  const index=rows.findIndex(visible);
  if (index>=0) { searchUi.selected=index;updateSearchSelection(); }
}
function resetPreviewSearch() {
  Object.assign(searchUi,{draft:'',query:'',submitted:false,results:[],selected:0,numbers:false,scrollTop:0});
  $('search-announcement').textContent='';
}
function initializeSearch() {
  $('search-input').oninput=() => { searchUi.draft=$('search-input').value;updateSearchEntry(); };
  $('search-clear').onclick=() => {
    $('search-input').value=searchUi.draft='';updateSearchEntry();$('search-input').focus({preventScroll:true});
  };
  $('search-keyboard').onmousedown=event => event.preventDefault();
  $('search-keyboard').onclick=event => {
    const key=event.target.closest('button');
    if (!key || key.disabled) return;
    if (key.dataset.character!==undefined) editSearchText(key.dataset.character);
    else if (key.dataset.searchKey==='delete') editSearchText('',{remove:true});
    else if (key.dataset.searchKey==='mode') { searchUi.numbers=!searchUi.numbers;renderSearchKeyboard(); }
    else submitSearch();
  };
  $('search-now-playing').onclick=() => navigate('playing');
  $('search-try-again').onclick=() => navigate('search');
  $('search-play-now').onclick=() => runSearchAction('now');
  $('search-play-next').onclick=() => runSearchAction('next');
  $('search-add-queue').onclick=() => runSearchAction('append');
  for (const type of ['focusin','pointerdown']) $('search-actions-view').addEventListener(type,event => {
    const index=searchActionButtons().indexOf(event.target.closest('button'));
    if (index<0) return;
    searchUi.actionIndex=index;
    searchActionButtons().forEach(button => button.classList.remove('dial-selected'));
  });
  const list=$('search-results');
  list.addEventListener('pointerdown',() => { searchUi.manualScroll=true; });
  list.addEventListener('wheel',() => { searchUi.manualScroll=true; },{passive:true});
  list.addEventListener('scrollend',settleSearchScroll);
  list.addEventListener('scroll',() => {
    searchUi.scrollTop=list.scrollTop;
    if (!searchUi.manualScroll) return;
    clearTimeout(searchUi.scrollTimer);searchUi.scrollTimer=setTimeout(settleSearchScroll,180);
  },{passive:true});
}
