// Apply the stored theme before first paint to avoid a flash of the wrong
// colour scheme. Kept as an external file (rather than an inline <script>) so
// the Content-Security-Policy can disallow inline script entirely.
(function () {
  try {
    var stored = localStorage.getItem('ciphernote.theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var useDark = stored ? stored === 'dark' : prefersDark;
    document.documentElement.classList.toggle('dark', useDark);
    document.documentElement.style.colorScheme = useDark ? 'dark' : 'light';
  } catch (error) {
    /* localStorage unavailable - keep the default dark theme */
  }
})();
