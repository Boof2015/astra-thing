'use strict';

// These controls belong to the design workbench, not the device UI.
document.querySelectorAll('[data-character-choice]').forEach(button => {
  button.addEventListener('click', () => {
    const panel = button.dataset.characterChoice === 'panel';
    document.getElementById('screen').dataset.character = panel ? 'panel' : 'baseline';
    document.getElementById('character-description').textContent = panel
      ? 'A solid control surface; the same warm finish for volume and selection.'
      : 'The accepted scale, with the previous surface treatment.';
    document.querySelectorAll('[data-character-choice]').forEach(other => {
      other.setAttribute('aria-pressed', String(other === button));
    });
  });
});
