const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PreviewQueue}=require('../design-preview/queue-model.js');
const order=q => q.items.map(item => item.track);
const draft=q => q.visibleItems().map(item => item.track);

test('a move is a draft until confirmed; cancelling leaves playback order alone',() => {
  const q=new PreviewQueue([1,2,3,4]);
  q.beginMove(q.items[1].id);
  q.stepMove(1);q.stepMove(1);
  assert.deepEqual(draft(q),[1,3,4,2]);
  assert.deepEqual(order(q),[1,2,3,4]);
  q.cancelMove();
  assert.deepEqual(order(q),[1,2,3,4]);
  q.beginMove(q.items[1].id);q.stepMove(1);q.commitMove();
  assert.deepEqual(order(q),[1,3,2,4]);
});

test('duplicate songs remain separate entries when moving and removing',() => {
  const q=new PreviewQueue([1,2,1]);
  const first=q.items[0].id,last=q.items[2].id;
  q.playNext(last);
  assert.equal(q.items[0].id,last);
  q.remove(first);
  assert.deepEqual(q.items.map(item => item.id),[last,'queue-2']);
});

test('advancing playback preserves selection and never resurrects a consumed entry on move commit',() => {
  const q=new PreviewQueue([1,2,3,4]);
  const selected=q.items[2].id;
  q.beginMove(selected);q.stepMove(-1);
  assert.equal(q.consumeNext().track,1);
  assert.equal(q.selectedId,selected);
  assert.deepEqual(draft(q),[3,2,4]);
  q.commitMove();
  assert.deepEqual(order(q),[3,2,4]);
});

test('cancelling during playback retains current live order, not an old snapshot',() => {
  const q=new PreviewQueue([1,2,3]);
  q.beginMove(q.items[2].id);q.stepMove(-1);
  q.consumeNext();q.cancelMove();
  assert.deepEqual(order(q),[2,3]);
});

test('if the moving song starts playing, its edit expires safely',() => {
  const q=new PreviewQueue([1,2,3]);
  q.beginMove(q.items[0].id);q.stepMove(1);
  assert.equal(q.consumeNext().track,1);
  assert.equal(q.move,null);
  assert.equal(q.commitMove(),false);
  assert.deepEqual(order(q),[2,3]);
});

test('removal selects an adjacent entry and an empty queue stays empty',() => {
  const q=new PreviewQueue([1,2]);
  q.select(q.items[1].id);q.remove(q.selectedId);
  assert.equal(q.selectedId,q.items[0].id);
  q.consumeNext();q.step(1);q.step(-1);
  assert.equal(q.selectedId,null);
  assert.equal(q.consumeNext(),null);
});

test('move boundaries and shuffle preserve the entry set and selected identity',() => {
  const q=new PreviewQueue([1,2,3,4]);
  const ids=q.items.map(item => item.id).sort();
  q.beginMove(q.items[0].id);q.stepMove(-1);
  assert.deepEqual(draft(q),[1,2,3,4]);
  q.stepMove(99);q.commitMove();
  assert.deepEqual(order(q),[2,3,4,1]);
  const selected=q.selectedId;
  q.shuffle(() => 0);
  assert.deepEqual(q.items.map(item => item.id).sort(),ids);
  assert.equal(q.selectedId,selected);
});
