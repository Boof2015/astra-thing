'use strict';

// Identity belongs to a queue entry, not a song: the same song may appear twice.
class PreviewQueue {
  constructor(tracks=[]) {
    this.serial=0;
    this.reset(tracks);
  }
  reset(tracks) {
    this.items=tracks.map(track => ({id:`queue-${++this.serial}`,track}));
    this.selectedId=this.items[0]?.id || null;
    this.move=null;
  }
  visibleItems() {
    if (!this.move) return this.items;
    const byId=new Map(this.items.map(item => [item.id,item]));
    return this.move.order.map(id => byId.get(id)).filter(Boolean);
  }
  select(id) {
    if (this.items.some(item => item.id === id)) this.selectedId=id;
  }
  step(direction) {
    const index=this.items.findIndex(item => item.id === this.selectedId);
    this.selectedId=this.items[Math.max(0,Math.min(this.items.length-1,index+direction))]?.id || null;
  }
  beginMove(id) {
    if (!this.items.some(item => item.id === id)) return false;
    this.select(id);
    this.move={id,order:this.items.map(item => item.id)};
    return true;
  }
  stepMove(direction) {
    if (!this.move) return;
    const order=this.move.order;
    const from=order.indexOf(this.move.id);
    const to=Math.max(0,Math.min(order.length-1,from+direction));
    order.splice(from,1);
    order.splice(to,0,this.move.id);
  }
  commitMove() {
    if (!this.move) return false;
    const {id,order}=this.move;
    const entry=this.items.find(item => item.id === id);
    if (!entry) { this.move=null; return false; }
    const rest=this.items.filter(item => item.id !== id);
    const nextId=order.slice(order.indexOf(id)+1).find(candidate => rest.some(item => item.id === candidate));
    const destination=nextId ? rest.findIndex(item => item.id === nextId) : rest.length;
    rest.splice(destination,0,entry);
    this.items=rest;
    this.move=null;
    return true;
  }
  cancelMove() { this.move=null; }
  remove(id) {
    const index=this.items.findIndex(item => item.id === id);
    if (index < 0) return null;
    const [removed]=this.items.splice(index,1);
    if (this.move?.id === id) this.move=null;
    else if (this.move) this.move.order=this.move.order.filter(candidate => candidate !== id);
    if (this.selectedId === id) this.selectedId=this.items[Math.min(index,this.items.length-1)]?.id || null;
    return removed;
  }
  playNext(id) {
    const from=this.items.findIndex(item => item.id === id);
    if (from < 0) return false;
    const [item]=this.items.splice(from,1);
    this.items.unshift(item);
    this.selectedId=id;
    this.move=null;
    return true;
  }
  consumeNext() { return this.items.length ? this.remove(this.items[0].id) : null; }
  prepend(track) {
    const item={id:`queue-${++this.serial}`,track};
    this.items.unshift(item);
    if (this.move) this.move.order.unshift(item.id);
    this.selectedId ||= item.id;
    return item;
  }
  append(track) {
    const item={id:`queue-${++this.serial}`,track};
    this.items.push(item);
    if (this.move) this.move.order.push(item.id);
    this.selectedId ||= item.id;
    return item;
  }
  shuffle(random=Math.random) {
    for (let i=this.items.length-1;i>0;i--) {
      const j=Math.floor(random()*(i+1));
      [this.items[i],this.items[j]]=[this.items[j],this.items[i]];
    }
    this.move=null;
  }
}

if (typeof module !== 'undefined') module.exports={PreviewQueue};
