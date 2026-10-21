(() => {
  'use strict';
  const video = document.getElementById('hero-video');
  const button = document.getElementById('video-toggle');
  const hero = document.getElementById('hero');
  if (!video || !button || !hero) return;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = motion.matches;
  let visible = true;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.controls = false;
  video.autoplay = !userPaused;
  function updateControl() {
    const paused = video.paused;
    const label = paused ? 'Play background video' : 'Pause background video';
    button.setAttribute('aria-label',label);
    button.title = label;
    // Lucide icons, matching the homepage preview; see images/test/LUCIDE-LICENSE.txt.
    button.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paused ? '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>' : '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>'}</svg>`;
  }
  async function syncPlayback() {
    if (userPaused || document.hidden || !visible) { video.pause(); return; }
    try { await video.play(); }
    catch { updateControl(); }
  }
  button.addEventListener('click',() => {
    userPaused = !video.paused;
    if (userPaused) video.pause(); else syncPlayback();
  });
  video.addEventListener('play',updateControl);
  video.addEventListener('pause',updateControl);
  video.addEventListener('error',updateControl);
  video.addEventListener('loadeddata',syncPlayback);
  document.addEventListener('visibilitychange',syncPlayback);
  window.addEventListener('pageshow',syncPlayback);
  // Some mobile power/data modes require a gesture even for muted inline playback.
  const retryOnGesture = event => {
    if (button.contains(event.target) || !video.paused || userPaused) return;
    syncPlayback();
  };
  document.addEventListener('pointerdown',retryOnGesture,{passive:true});
  document.addEventListener('keydown',retryOnGesture);
  motion.addEventListener('change',event => { if (event.matches) { userPaused = true; video.pause(); } });
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => { visible = entries[0].isIntersecting; syncPlayback(); }).observe(hero);
  updateControl();
  syncPlayback();
})();
