(function () {
  // Gather minimal device info plus a canvas fingerprint
  function getDeviceInfo() {
    const userAgent = navigator.userAgent || '';
    const lang = navigator.language || '';
    const timezone = String(new Date().getTimezoneOffset());
    const screenRes = `${screen.width}x${screen.height}`;
    const canvasFp = getCanvasFingerprint();
    // Combine all info into a single string
    const rawString = `${userAgent}||${lang}||${timezone}||${screenRes}||${canvasFp}`;
    return rawString;
  }

  // Create a canvas fingerprint by drawing text with specific styles.
  function getCanvasFingerprint() {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      // Set canvas properties and draw text
      ctx.textBaseline = "top";
      ctx.font = "14px 'Arial'";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#f60";
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("Hello, world!", 2, 15);
      ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
      ctx.fillText("Hello, world!", 4, 17);
      return canvas.toDataURL();
    } catch (e) {
      return '';
    }
  }

  // Simple hash function (for brevity).
  function simpleHash(str) {
    let hash = 0, i, chr;
    for (i = 0; i < str.length; i++) {
      chr   = str.charCodeAt(i);
      hash  = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32bit integer
    }
    // Convert to a hex string and prefix with "GUEST-"
    return 'GUEST-' + Math.abs(hash).toString(16).toUpperCase();
  }

  // Generate the guest ID from the device info string.
  function generateGuestId() {
    const deviceInfo = getDeviceInfo();
    return simpleHash(deviceInfo);
  }

  // Expose the generateGuestId function to the global scope.
  window.generateGuestId = generateGuestId;
})();
