// public/js/fingerprint.js
(function () {
  // Gather minimal device info
  function getDeviceInfo() {
    const userAgent = navigator.userAgent || '';
    const lang = navigator.language || '';
    const timezone = String(new Date().getTimezoneOffset());
    const screenRes = `${screen.width}x${screen.height}`;

    // Combine into a single string
    const rawString = `${userAgent}||${lang}||${timezone}||${screenRes}`;
    return rawString;
  }

  // Simple hash function (for brevity). You could use crypto libraries for stronger hashing.
  function simpleHash(str) {
    let hash = 0, i, chr;
    for (i = 0; i < str.length; i++) {
      chr   = str.charCodeAt(i);
      hash  = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32bit integer
    }
    // Convert to a hex string
    return 'GUEST-' + Math.abs(hash).toString(16).toUpperCase();
  }

  // Generate the fingerprint
  function generateGuestId() {
    const deviceInfo = getDeviceInfo();
    return simpleHash(deviceInfo);
  }

  // Expose the function to the global scope so other scripts can call it
  window.generateGuestId = generateGuestId;
})();
