'use strict';
// Step changes fade the old instructions out and the new ones in. Updates that arrive mid-fade
// replace the pending content, so only the latest state is shown once the fade completes.
const panels = (() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let fading = false, apply;
  return {
    get busy() {return fading;},
    swap(elements, update, animate) {
      apply = update;
      if (fading) return;
      if (!animate || reduce.matches) {apply(); return;}
      fading = true;
      elements.forEach(el => {el.inert = true;});
      Promise.all(elements.map(el => {
        const from = getComputedStyle(el).opacity;
        el.getAnimations().forEach(animation => animation.cancel());
        return el.animate([{opacity: from}, {opacity: 0}], {duration: 110, easing: 'ease-in', fill: 'forwards'}).finished;
      })).then(() => {
        fading = false;
        elements.forEach(el => {el.inert = false; el.getAnimations().forEach(animation => animation.cancel());});
        apply();
        elements.forEach(el => el.animate([{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'none'}], {duration: 260, easing: 'cubic-bezier(.2,0,0,1)'}));
      });
    }
  };
})();
