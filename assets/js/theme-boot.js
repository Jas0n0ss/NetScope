(function () {
  'use strict';
  try {
    var preference = localStorage.getItem('netscope:theme') || 'auto';
    var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved = preference === 'auto' ? (dark ? 'dark' : 'light') : preference;
    if (resolved !== 'dark' && resolved !== 'light') resolved = 'dark';
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = resolved;
  } catch (error) {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.themePreference = 'auto';
  }

  try {
    var lang = localStorage.getItem('netscope:lang');
    if (lang !== 'zh' && lang !== 'en') {
      lang = String(navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
    }
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  } catch (langError) {
    document.documentElement.lang = 'en';
  }

  if (window.location.protocol === 'file:') {
    document.addEventListener('DOMContentLoaded', function () {
      var warning = document.getElementById('file-warning');
      if (warning) warning.hidden = false;
    });
  }
})();
