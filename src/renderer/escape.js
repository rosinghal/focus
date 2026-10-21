// An open <dialog> takes Escape for itself, so only close the window when none is open.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) window.close();
});
