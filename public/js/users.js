(function () {
  // Get a canvas fingerprint by drawing text/shapes and reading its data URL.
  function getCanvasFingerprint() {
    try {
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      // Use some consistent text and styles
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
      return "";
    }
  }

  // Gather minimal device info along with the canvas fingerprint.
  function getDeviceInfo() {
    const userAgent = navigator.userAgent || '';
    const lang = navigator.language || '';
    const timezone = String(new Date().getTimezoneOffset());
    const screenRes = `${screen.width}x${screen.height}`;
    const canvasFP = getCanvasFingerprint();
    // Combine into a single string using a separator.
    return `${userAgent}||${lang}||${timezone}||${screenRes}||${canvasFP}`;
  }

  // A simple hash function (for brevity). In production you might use a robust crypto library.
  function simpleHash(str) {
    let hash = 0, i, chr;
    for (i = 0; i < str.length; i++) {
      chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32bit integer
    }
    // Convert to a hex string and prefix with "GUEST-"
    return 'GUEST-' + Math.abs(hash).toString(16).toUpperCase();
  }

  // Generate the guest ID from the device information.
  function generateGuestId() {
    const deviceInfo = getDeviceInfo();
    return simpleHash(deviceInfo);
  }

  // Expose the function to the global scope so other scripts can call it.
  window.generateGuestId = generateGuestId;
})();
