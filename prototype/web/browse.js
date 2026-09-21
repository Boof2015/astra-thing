'use strict';

const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fallback='/assets/artwork-fallback.svg';
const artUrl=path=>path?'/artwork?path='+encodeURIComponent(path):fallback;
const isBrowseView=view=>['playlists','queue','queue-actions','queue-move','search','search-results','search-actions'].includes(view);
const shelf={pages:[],page:0,selected:0,busy:false,revision:null,request:0,error:null};
const queueUi={items:[],revision:null,selectedId:null,actionId:null,actionIndex:0,move:null,busy:false,request:0};
const searchUi={draft:'',query:'',submitted:false,results:[],selected:0,actionIndex:0,numbers:false,scrollTop:0,request:0,busy:false};
let artTimer;
async function localRequest(path,body) {
  const response=await fetch(path,{...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();
  if(!response.ok) {const error=new Error(result.error||'Request failed');error.status=response.status;throw error;}
  return result;
}
function libraryReady() {return ui.data?.connected&&ui.data?.scopes?.includes('library-search');}
function reportFailure(error) {notify(error.status===409?'That changed in Astra. Try again.':error.status===429?'Give Astra a moment, then try again.':'Could not complete that. Check the connection.');}
function imageMarkup(path) {return `<img src="${fallback}" ${path?`data-art="${escapeHTML(path)}"`:''} alt="">`;}
function scheduleArtwork() {
  clearTimeout(artTimer);
  artTimer=setTimeout(()=>{
    for(const image of document.querySelectorAll('section:not([hidden]) img[data-art]')) {
      const box=image.getBoundingClientRect();
      if(box.bottom>0&&box.top<480) {image.src=artUrl(image.dataset.art);delete image.dataset.art;image.onerror=()=>{image.onerror=null;image.src=fallback;};}
    }
  },140);
}
function updateMiniPlayers() {
  const track=ui.data?.playback?.currentTrack;
  for(const prefix of ['mini','queue-now','search-now']) {
    const image=$(prefix==='mini'?'mini-art':prefix+'-art');
    const path=artUrl(track?.artworkUrl);
    if(image.dataset.source!==path) {image.dataset.source=path;image.src=path;image.onerror=()=>{image.onerror=null;image.src=fallback;};}
    text(prefix==='mini'?'mini-title':prefix+'-title',track?.title||'Nothing playing');
  }
  text('mini-artist',track?.artist||'');
  const playing=ui.data?.playback?.state==='playing';
  for(const node of [document.querySelector('.mini-playing'),$('queue-now-icon'),$('search-now-icon')]) {
    if(node.dataset.playing!==String(playing)) {node.dataset.playing=String(playing);node.innerHTML=icon(playing?'equalizer':'pause');}
  }
  document.querySelector('.mini-hint').textContent=playing?'Playing':'Paused';
}
async function runMusic(body) {
  if(!ui.data?.controls) {notify('Connect with playback controls to use this.');return false;}
  if(ui.busy) return false;
  ui.busy=true;
  try {await localRequest('/music',body);return true;}
  catch(error) {reportFailure(error);return false;}
  finally {ui.busy=false;}
}
function renderShelf() {
  const page=shelf.pages[shelf.page];
  $('shelf-page').textContent=page?`${shelf.page+1} / ${Math.max(1,Math.ceil(page.total/3))}`:'…';
  $('shelf-previous').disabled=shelf.busy||shelf.page===0;
  $('shelf-next').disabled=shelf.busy||!page?.nextCursor;
  $('playlist-grid').replaceChildren();
  if(!page) {shelfMessage(shelf.error||(libraryReady()?'Loading playlists…':'Pair with Astra to browse playlists.'));return;}
  if(!page.items.length) {shelfMessage('No playlists yet. Create one in Astra.');return;}
  page.items.forEach((item,index)=>{
    const button=document.createElement('button');button.className='playlist';
    button.innerHTML=`${imageMarkup(item.artworkUrl)}<strong>${escapeHTML(item.title)}</strong>`;
    button.setAttribute('aria-label',`Play ${item.title}`);
    button.onpointerdown=()=>selectPlaylist(index);
    button.onclick=async()=>{selectPlaylist(index);if(await runMusic({action:'play',ref:item.ref}))showView('playing');};
    $('playlist-grid').append(button);
  });
  selectPlaylist(shelf.selected);scheduleArtwork();
}
function shelfMessage(message) {const paragraph=document.createElement('p');paragraph.className='browse-message';paragraph.textContent=message;$('playlist-grid').replaceChildren(paragraph);}
function selectPlaylist(index) {
  shelf.selected=Math.max(0,Math.min((shelf.pages[shelf.page]?.items.length||1)-1,index));
  [...$('playlist-grid').children].forEach((node,i)=>{node.classList.toggle('selected',i===shelf.selected);node.setAttribute('aria-current',String(i===shelf.selected));});
}
async function loadShelf(pageIndex=0,{reset=false}={}) {
  if(shelf.busy&&!reset) return;
  if(!libraryReady()) {shelf.pages=[];shelfMessage('Pair with Astra to browse playlists.');return;}
  if(!ui.data.features?.playlistListing) {shelfMessage('Update Astra to browse your playlists.');return;}
  if(reset) {shelf.pages=[];shelf.page=0;shelf.selected=0;}
  if(shelf.pages[pageIndex]) {shelf.page=pageIndex;selectPlaylist(0);renderShelf();return;}
  const cursor=pageIndex?shelf.pages[pageIndex-1]?.nextCursor:null;
  if(pageIndex&&!cursor) return;
  const request=++shelf.request;shelf.busy=true;shelf.error=null;
  $('shelf-previous').disabled=$('shelf-next').disabled=true;
  if(!shelf.pages.length)shelfMessage('Loading playlists…');
  try {
    const page=await localRequest('/playlists'+(cursor?'?cursor='+encodeURIComponent(cursor):''));
    if(request!==shelf.request)return;
    shelf.pages[pageIndex]=page;shelf.page=pageIndex;shelf.selected=0;
  } catch(error) {if(request===shelf.request){reportFailure(error);shelf.error='Could not load playlists. Go back and try again.';}}
  finally {if(request===shelf.request){shelf.busy=false;renderShelf();}}
}
function queueOrder() {if(!queueUi.move)return queueUi.items;const items=new Map(queueUi.items.map(item=>[item.id,item]));return queueUi.move.order.map(id=>items.get(id)).filter(Boolean);}
function renderQueueRows({reveal=false}={}) {
  const items=queueOrder(),list=$('queue-list');
  if(!items.some(item=>item.id===queueUi.selectedId))queueUi.selectedId=items[0]?.id||null;
  const selected=items.findIndex(item=>item.id===queueUi.selectedId);
  list.hidden=!items.length;$('queue-empty').hidden=Boolean(items.length);
  $('queue-position').innerHTML=items.length?`<strong>${selected+1}</strong> / ${items.length}`:'0 songs';
  $('queue-move-up').disabled=selected<=0;$('queue-move-down').disabled=selected<0||selected>=items.length-1;
  // Keep a short DOM window even when Astra's upcoming queue contains thousands of entries.
  if(reveal&&selected>=0) {
    const top=selected*110;
    if(top<list.scrollTop)list.scrollTop=top;
    else if(top+104>list.scrollTop+list.clientHeight)list.scrollTop=top+104-list.clientHeight;
  }
  const start=Math.max(0,Math.floor(list.scrollTop/110)-2),end=Math.min(items.length,start+9);
  const spacer=document.createElement('div');spacer.className='queue-spacer';spacer.style.height=`${items.length*110}px`;
  for(let index=start;index<end;index++) {
    const item=items[index],track=item.track,wrapper=document.createElement('div');wrapper.className='queue-item virtual-row';wrapper.style.top=`${index*110}px`;wrapper.setAttribute('role','listitem');
    const button=document.createElement('button');button.className='queue-track';button.classList.toggle('selected',item.id===queueUi.selectedId);button.classList.toggle('is-moving',item.id===queueUi.move?.id);
    button.innerHTML=`${imageMarkup(track.artworkUrl)}<span class="queue-track-copy"><strong>${escapeHTML(track.title)}</strong><small>${escapeHTML(track.artist)}</small></span><span class="queue-duration">${track.durationSeconds?time(track.durationSeconds):''}</span>${icon('chevron')}`;
    button.setAttribute('aria-label',`${index+1}. ${track.title}, ${track.artist}`);
    button.onclick=()=>{if(queueUi.move)return;queueUi.selectedId=item.id;queueUi.actionId=item.id;showView('queue-actions');};
    wrapper.append(button);spacer.append(wrapper);
  }
  const scroll=list.scrollTop;list.replaceChildren(spacer);list.scrollTop=scroll;scheduleArtwork();
}
async function refreshQueue({force=false}={}) {
  if(queueUi.busy||!ui.data?.connected)return;
  if(!force&&queueUi.revision===ui.data.queueRevision)return;
  queueUi.busy=true;const request=++queueUi.request;
  try {
    const data=await localRequest('/queue');if(request!==queueUi.request)return;
    const previousIndex=queueUi.items.findIndex(item=>item.id===queueUi.selectedId);
    queueUi.items=data.items;queueUi.revision=data.revision;
    if(!data.items.some(item=>item.id===queueUi.selectedId))queueUi.selectedId=data.items[Math.max(0,Math.min(previousIndex,data.items.length-1))]?.id||null;
    if(queueUi.move) {
      if(!data.items.some(item=>item.id===queueUi.move.id)){queueUi.move=null;showView('queue');notify('That track is no longer upcoming.');}
      else {const ids=new Set(data.items.map(item=>item.id));queueUi.move.order=queueUi.move.order.filter(id=>ids.has(id));for(const item of data.items)if(!queueUi.move.order.includes(item.id))queueUi.move.order.push(item.id);}
    }
    if(ui.view==='queue-actions'&&!data.items.some(item=>item.id===queueUi.actionId)){showView('queue');notify('That track is no longer upcoming.');}
    if(ui.view==='queue-actions')renderQueueActions();
    if(['queue','queue-move'].includes(ui.view))renderQueueRows();
  }catch(error){if(ui.view.startsWith('queue'))reportFailure(error);}
  finally {queueUi.busy=false;}
}
function renderQueueActions() {
  const item=queueUi.items.find(item=>item.id===queueUi.actionId);if(!item)return;
  $('queue-action-art').src=artUrl(item.track.artworkUrl);text('queue-action-title',item.track.title);text('queue-action-artist',item.track.artist);
  const next=queueUi.items[0]?.id===item.id;
  $('queue-play-next').disabled=next;text('queue-play-next-label',next?'Already up next':'Play next');
  $('queue-start-move').disabled=queueUi.items.length<2;
}
function stepQueueMove(delta) {
  const move=queueUi.move;if(!move)return;
  const from=move.order.indexOf(move.id),to=Math.max(0,Math.min(move.order.length-1,from+Math.sign(delta)));
  move.order.splice(from,1);move.order.splice(to,0,move.id);queueUi.selectedId=move.id;renderQueueRows({reveal:true});
}
async function editQueue(action) {
  const move=queueUi.move,id=move?.id||queueUi.actionId;
  const body={action,id};if(action==='move')body.beforeId=move.order[move.order.indexOf(id)+1]||null;
  if(!await runMusic(body))return;
  if(action==='remove')queueUi.items=queueUi.items.filter(item=>item.id!==id);
  else {const item=queueUi.items.find(item=>item.id===id),rest=queueUi.items.filter(item=>item.id!==id);if(item){const index=action==='play-next'?0:body.beforeId?rest.findIndex(item=>item.id===body.beforeId):rest.length;rest.splice(Math.max(0,index),0,item);queueUi.items=rest;}}
  queueUi.move=null;showView('queue');notify(action==='remove'?'Removed from queue.':'Queue updated.');
  setTimeout(()=>refreshQueue({force:true}),400);
}
function activeActionButtons() {return [...$(ui.view==='queue-actions'?'queue-actions-view':'search-actions-view').querySelectorAll('button')];}
function renderKeyboard() {
  const rows=searchUi.numbers?['1234567890','-/:;()&@"',".,?!'_"]:['qwertyuiop','asdfghjkl','zxcvbnm'];
  $('search-keyboard').innerHTML=rows.map((row,index)=>`<div class="search-key-row">${[...row].map(key=>`<button class="search-key" data-character="${escapeHTML(key)}">${escapeHTML(key.toUpperCase())}</button>`).join('')}${index===2?`<button class="search-key wide" data-search-key="delete" aria-label="Backspace">${icon('backspace')}</button>`:''}</div>`).join('')+`<div class="search-key-row"><button class="search-key mode" data-search-key="mode">${searchUi.numbers?'ABC':'123'}</button><button class="search-key space" data-character=" " aria-label="Space">space</button><button class="search-key submit" data-search-key="submit">Search</button></div>`;
  updateSearchEntry();
}
function updateSearchEntry() {$('search-clear').hidden=!searchUi.draft;$('search-keyboard').querySelector('[data-search-key=submit]').disabled=!searchUi.draft.trim()||searchUi.busy;}
function typeSearch(value,remove=false) {
  const input=$('search-input');let start=input.selectionStart??input.value.length,end=input.selectionEnd??start;
  if(remove&&start===end&&start>0)start-=Array.from(input.value.slice(0,start)).at(-1).length;
  if(input.value.length-(end-start)+value.length>64)return;
  input.setRangeText(value,start,end,'end');searchUi.draft=input.value;updateSearchEntry();input.focus({preventScroll:true});
}
async function submitSearch() {
  const query=searchUi.draft.trim();if(!query||searchUi.busy)return;
  if(!libraryReady()){notify('Pair with Astra to search for songs.');return;}
  const request=++searchUi.request;searchUi.busy=true;updateSearchEntry();
  try {
    const data=await localRequest('/search?q='+encodeURIComponent(query));if(request!==searchUi.request)return;
    searchUi.query=query;searchUi.submitted=true;searchUi.results=data.results;searchUi.selected=0;searchUi.scrollTop=0;
    if(ui.view==='search')showView('search-results');text('search-announcement',`${data.results.length} songs found.`);
  }catch(error){reportFailure(error);}
  finally{searchUi.busy=false;if(ui.view==='search')updateSearchEntry();}
}
function selectSearch(index,{reveal=false}={}) {
  searchUi.selected=Math.max(0,Math.min(searchUi.results.length-1,index));
  const rows=[...$('search-results').children];rows.forEach((row,i)=>row.firstElementChild.classList.toggle('selected',i===searchUi.selected));
  if(reveal)rows[searchUi.selected]?.scrollIntoView({block:'nearest'});scheduleArtwork();
}
function renderSearchResults() {
  const list=$('search-results');list.replaceChildren();
  searchUi.results.forEach((track,index)=>{
    const row=document.createElement('div');row.className='queue-item';row.setAttribute('role','listitem');
    const button=document.createElement('button');button.className='queue-track';
    button.innerHTML=`${imageMarkup(track.artworkUrl)}<span class="queue-track-copy"><strong>${escapeHTML(track.title)}</strong><small>${escapeHTML(track.subtitle||'')}</small></span>${icon('chevron')}`;
    button.onclick=()=>{selectSearch(index);showView('search-actions');};row.append(button);list.append(row);
  });
  list.hidden=!searchUi.results.length;$('search-empty').hidden=Boolean(searchUi.results.length);list.scrollTop=searchUi.scrollTop;selectSearch(searchUi.selected);scheduleArtwork();
}
async function searchAction(action,position) {
  const track=searchUi.results[searchUi.selected];if(!track)return;
  if(await runMusic({action,ref:track.ref,position:position||'end'})){showView(action==='play'?'playing':'search-results');if(action==='enqueue')notify(position==='next'?'Playing next.':'Added to queue.');}
}
function renderBrowse(view) {
  if(view==='playlists') {if(!shelf.pages.length)loadShelf();else renderShelf();}
  if(view==='queue'||view==='queue-move') {$('queue-now-playing').hidden=view==='queue-move';$('queue-move-toolbar').hidden=view!=='queue-move';renderQueueRows({reveal:true});refreshQueue();}
  if(view==='queue-actions') {queueUi.actionIndex=0;renderQueueActions();}
  if(view==='search') {$('search-input').value=searchUi.draft;renderKeyboard();$('search-input').focus();$('search-input').setSelectionRange(searchUi.draft.length,searchUi.draft.length);}
  if(view==='search-results') {text('view-label',searchUi.query);renderSearchResults();}
  if(view==='search-actions') {const track=searchUi.results[searchUi.selected];if(!track){showView('search-results');return;}$('search-action-art').src=artUrl(track.artworkUrl);text('search-action-title',track.title);text('search-action-artist',track.subtitle||'');searchUi.actionIndex=0;}
}
function turnBrowseDial(delta) {
  const step=Math.sign(delta);
  if(ui.view==='playlists') {const next=shelf.selected+step;if(next<0&&shelf.page>0)loadShelf(shelf.page-1);else if(next>=(shelf.pages[shelf.page]?.items.length||0))loadShelf(shelf.page+1);else selectPlaylist(next);}
  else if(ui.view==='queue-move')stepQueueMove(step);
  else if(ui.view==='queue') {const index=queueUi.items.findIndex(item=>item.id===queueUi.selectedId);queueUi.selectedId=queueUi.items[Math.max(0,Math.min(queueUi.items.length-1,index+step))]?.id;renderQueueRows({reveal:true});}
  else if(ui.view.endsWith('-actions')) {const model=ui.view==='queue-actions'?queueUi:searchUi,buttons=activeActionButtons();let index=model.actionIndex+step;while(index>=0&&index<buttons.length&&buttons[index].disabled)index+=step;if(index>=0&&index<buttons.length)model.actionIndex=index;buttons.forEach((button,i)=>button.classList.toggle('dial-selected',i===model.actionIndex));}
  else if(ui.view==='search-results')selectSearch(searchUi.selected+step,{reveal:true});
}
function pressBrowseDial() {
  if(ui.view==='playlists')$('playlist-grid').children[shelf.selected]?.click();
  else if(ui.view==='queue-move')editQueue('move');
  else if(ui.view==='queue'){if(!queueUi.items.length){showView('playlists');return;}queueUi.actionId=queueUi.selectedId;showView('queue-actions');}
  else if(ui.view==='search')submitSearch();
  else if(ui.view==='search-results')showView(searchUi.results.length?'search-actions':'search');
  else activeActionButtons()[ui.view==='queue-actions'?queueUi.actionIndex:searchUi.actionIndex]?.click();
}
function clearBrowseData() {shelf.request++;shelf.pages=[];shelf.page=0;shelf.busy=false;queueUi.request++;queueUi.items=[];queueUi.revision=null;queueUi.move=null;searchUi.request++;searchUi.results=[];searchUi.submitted=false;searchUi.query=searchUi.draft='';}
function initializeBrowse() {
  $('shelf-previous').onclick=()=>loadShelf(shelf.page-1);$('shelf-next').onclick=()=>loadShelf(shelf.page+1);
  for(const id of ['mini-player','queue-now-playing','search-now-playing'])$(id).onclick=()=>showView('playing');
  $('queue-browse').onclick=()=>showView('playlists');$('queue-play-next').onclick=()=>editQueue('play-next');$('queue-remove').onclick=()=>editQueue('remove');
  $('queue-start-move').onclick=()=>{queueUi.move={id:queueUi.actionId,order:queueUi.items.map(item=>item.id)};queueUi.selectedId=queueUi.actionId;showView('queue-move');};
  $('queue-move-up').onclick=()=>stepQueueMove(-1);$('queue-move-down').onclick=()=>stepQueueMove(1);$('queue-move-confirm').onclick=()=>editQueue('move');$('queue-move-cancel').onclick=()=>backAction();
  let queueScrollFrame=0;$('queue-list').addEventListener('scroll',()=>{if(queueScrollFrame)return;queueScrollFrame=requestAnimationFrame(()=>{queueScrollFrame=0;renderQueueRows();});},{passive:true});
  $('search-input').oninput=()=>{searchUi.draft=$('search-input').value;updateSearchEntry();};
  $('search-clear').onclick=()=>{searchUi.draft='';$('search-input').value='';updateSearchEntry();};
  $('search-try-again').onclick=()=>showView('search');
  $('search-keyboard').onpointerdown=event=>event.preventDefault();
  $('search-keyboard').onclick=event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.character!==undefined)typeSearch(button.dataset.character);else if(button.dataset.searchKey==='delete')typeSearch('',true);else if(button.dataset.searchKey==='mode'){searchUi.numbers=!searchUi.numbers;renderKeyboard();}else submitSearch();};
  $('search-play-now').onclick=()=>searchAction('play');$('search-play-next').onclick=()=>searchAction('enqueue','next');$('search-add-queue').onclick=()=>searchAction('enqueue','end');
  $('search-results').addEventListener('scroll',()=>{searchUi.scrollTop=$('search-results').scrollTop;scheduleArtwork();},{passive:true});
}
