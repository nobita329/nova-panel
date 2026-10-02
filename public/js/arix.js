/**
 * Arix Theme v2.1.3 - Client-side Interactive Manager
 */
(function() {
  // Theme Manager (Dark / Light Mode)
  function initTheme() {
    const savedTheme = localStorage.getItem('arix_theme') || 'dark';
    if (savedTheme === 'light') {
      document.documentElement.classList.add('lightmode');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('lightmode');
    }
  }

  window.toggleArixTheme = function() {
    const isDark = document.documentElement.classList.contains('dark');
    if (isDark) {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('lightmode');
      localStorage.setItem('arix_theme', 'light');
    } else {
      document.documentElement.classList.remove('lightmode');
      document.documentElement.classList.add('dark');
      localStorage.setItem('arix_theme', 'dark');
    }
  };

  // Sound Effects Player
  const sounds = {
    online: new Audio('/arix/online.mp3'),
    offline: new Audio('/arix/offline.mp3'),
    copy: new Audio('/arix/copy.mp3')
  };

  window.playArixSound = function(type) {
    try {
      const snd = sounds[type];
      if (snd) {
        snd.currentTime = 0;
        snd.volume = 0.5;
        snd.play().catch(() => {});
      }
    } catch (e) {}
  };

  // Copy to clipboard with sound & feedback
  window.copyToClipboard = function(text, buttonElement) {
    navigator.clipboard.writeText(text).then(() => {
      window.playArixSound('copy');
      if (buttonElement) {
        const originalHtml = buttonElement.innerHTML;
        buttonElement.innerHTML = '<i class="fa-solid fa-check text-emerald-400"></i> Copied!';
        setTimeout(() => {
          buttonElement.innerHTML = originalHtml;
        }, 2000);
      }
    });
  };

  // Mobile menu toggle
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();

    const mobileToggle = document.getElementById('mobile-menu-toggle');
    const mobileSidebar = document.getElementById('mobile-sidebar');
    if (mobileToggle && mobileSidebar) {
      mobileToggle.addEventListener('click', () => {
        mobileSidebar.classList.toggle('hidden');
      });
    }

    // Initialize Lucide icons if loaded
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  });
})();
