const {test}=require('node:test');
const assert=require('node:assert/strict');
const {findPreviewTracks}=require('../design-preview/search-model.js');
const {PreviewQueue}=require('../design-preview/queue-model.js');
const catalog=[
  {title:'Memory Lane',artist:'Café Radio'},
  {title:'Tidal Memory',artist:'Low Season'},
  {title:'Memory',artist:'Artist Name'},
  {title:'A Different Song',artist:'Memory'},
  {title:'L’été',artist:'Quiet Company'}
];
test('search ranks song titles before artist matches',() => {
  assert.deepEqual(findPreviewTracks(catalog,'memory'),[2,0,1,3]);
});
test('title and artist tokens work together, ignoring accents, case and punctuation',() => {
  assert.deepEqual(findPreviewTracks(catalog,' CAFE   lane '),[0]);
  assert.deepEqual(findPreviewTracks(catalog,"l'ete"),[4]);
  assert.deepEqual(findPreviewTracks(catalog,'LOW tidal'),[1]);
});
test('empty or unmatched input does not expose a library listing',() => {
  for (const query of ['', '   ', '---', 'missing title']) assert.deepEqual(findPreviewTracks(catalog,query),[]);
});
test('search additions preserve queued entries, their selection, and duplicate identities',() => {
  const q=new PreviewQueue([1,2]);
  const selected=q.selectedId,original=q.items.map(item => item.id);
  const last=q.append(1),next=q.prepend(1);
  assert.deepEqual(q.items.map(item => item.track),[1,1,2,1]);
  assert.equal(q.selectedId,selected);
  assert.deepEqual(q.items.slice(1,3).map(item => item.id),original);
  assert.notEqual(last.id,next.id);
});
test('adding to an empty queue establishes a selected entry',() => {
  const q=new PreviewQueue();
  const item=q.append(4);
  assert.equal(q.selectedId,item.id);
  assert.equal(q.consumeNext(),item);
});
test('new additions survive committing a pending queue move',() => {
  const q=new PreviewQueue([1,2,3]);
  q.beginMove(q.items[1].id);q.stepMove(1);
  q.prepend(4);q.append(5);q.commitMove();
  assert.deepEqual(q.items.map(item => item.track),[4,1,3,2,5]);
});
