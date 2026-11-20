(function () {
  try {
    var svgIcon =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="%231e1b4b"/><polygon points="32,10 52,21 32,32 12,21" fill="%23818cf8"/><polygon points="12,21 32,32 32,53 12,42" fill="%234338ca"/><polygon points="32,32 52,21 52,42 32,53" fill="%23312e81"/><circle cx="32" cy="21" r="5" fill="%2310b981"/></svg>';
    var dataUrl = 'data:image/svg+xml;utf8,' + svgIcon;

    var links = document.querySelectorAll("link[rel='icon'], link[rel='shortcut icon']");
    links.forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });

    var link = document.createElement('link');
    link.type = 'image/svg+xml';
    link.rel = 'icon';
    link.href = dataUrl;
    var head = document.getElementsByTagName('head')[0];
    if (head) head.appendChild(link);
  } catch (e) {}

  try {
    var buildInfoUrl =
      window.location && window.location.protocol === 'file:'
        ? './build-info.json'
        : '/build-info.json';
    fetch(buildInfoUrl, { cache: 'no-store' })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (d && d.version) {
          document.title = 'JUWEI WAREHOUSE MANAGEMENT SYSTEM v' + d.version;
        }
      })
      .catch(function () {});
  } catch (e) {}

  if ('serviceWorker' in navigator) {
    if ('caches' in window) {
      caches.keys().then(function (keys) {
        keys.forEach(function (k) {
          if (k.startsWith('juwei-wms-') && k !== 'juwei-wms-v7') {
            caches.delete(k);
          }
        });
      });
    }

    var isDev = window.location.hostname === 'localhost';
    if (isDev) {
      navigator.serviceWorker.getRegistrations().then(function (registrations) {
        registrations.forEach(function (reg) {
          reg.unregister();
        });
      });
    } else if (window.location.protocol.startsWith('http')) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js').catch(function (err) {
          console.log('SW registration notice: ', err);
        });
      });
    }
  }
})();
