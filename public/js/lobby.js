// ============================================================================
// Talkomatic Lobby Menu Functionality
// ----------------------------------------------------------------------------
// This JavaScript file handles the functionality for the left-side panel (menu)
// in the Talkomatic lobby page. It includes toggle functionality to open/close
// the menu, handles responsiveness for different screen sizes, and listens for
// clicks outside the menu to close it.
//
// Key Functionalities:
// - Toggling the left panel (menu) open/closed.
// - Hiding the menu on larger screens.
// - Detecting clicks outside the menu to close it.
// - Handling window resize events to ensure proper behavior across devices.
// ============================================================================

// DOM Element References
const leftPanel = document.getElementById('leftPanel');
const toggleButton = document.getElementById('toggleButton');
const hideMenuButton = document.getElementById('hideMenuButton');

// Modal functionality
const roomInfoModal = document.getElementById('roomInfoModal');
const learnMoreBtn = document.querySelector('.learn-more');
const closeRoomInfoBtn = document.querySelector('.close-modal');

/**
 * Toggles the left panel open/closed state
 */
function toggleLeftPanel() {
    leftPanel.classList.toggle('open');
    toggleButton.style.opacity = leftPanel.classList.contains('open') ? '0' : '1';
}

/**
 * Hides the left panel
 */
function hideLeftPanel() {
    leftPanel.classList.remove('open');
    setTimeout(() => {
        toggleButton.style.opacity = '1';
    }, 300);
}

/**
 * Handles window resize events
 */
function handleResize() {
    if (window.innerWidth > 992) {
        leftPanel.classList.remove('open');
        toggleButton.style.opacity = '0';
        hideMenuButton.style.display = 'none';
    } else {
        if (!leftPanel.classList.contains('open')) {
            toggleButton.style.opacity = '1';
        }
        hideMenuButton.style.display = 'block';
    }
}

/**
 * Handles clicks outside the left panel to close it
 * @param {Event} event - The click event
 */
function handleOutsideClick(event) {
    const isClickInside = leftPanel.contains(event.target) || toggleButton.contains(event.target);
    if (!isClickInside && leftPanel.classList.contains('open')) {
        hideLeftPanel();
    }
}

// Event Listeners for the panel
document.addEventListener('click', handleOutsideClick);
window.addEventListener('resize', handleResize);
hideMenuButton.addEventListener('click', hideLeftPanel);
toggleButton.addEventListener('click', toggleLeftPanel);

/**
 * Initial Setup
 */
function init() {
    if (window.innerWidth <= 992) {
        toggleButton.style.opacity = '1';
    }
}

/**
 * Opens the room info modal with a fade-in animation
 */
function openRoomInfoModal() {
    roomInfoModal.style.display = 'flex';
    // Trigger reflow
    roomInfoModal.offsetHeight;
    roomInfoModal.classList.add('show');
}

/**
 * Closes the room info modal with a fade-out animation
 */
function closeRoomInfoModal() {
    roomInfoModal.classList.remove('show');
    setTimeout(() => {
        roomInfoModal.style.display = 'none';
    }, 300);
}

// Event listeners for room info modal
learnMoreBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openRoomInfoModal();
});
closeRoomInfoBtn.addEventListener('click', closeRoomInfoModal);
roomInfoModal.addEventListener('click', (e) => {
    if (e.target === roomInfoModal) {
        closeRoomInfoModal();
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && roomInfoModal.classList.contains('show')) {
        closeRoomInfoModal();
    }
});

/**
 * Helper: setCookie
 * Sets a cookie with given name, value, and expiration in days
 */
function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + d.toUTCString();
    document.cookie = name + "=" + value + ";" + expires + ";path=/";
}

/**
 * Helper: getCookie
 * Returns the cookie value or an empty string if not found
 */
function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i].trim();
        if (c.indexOf(nameEQ) === 0) {
            return c.substring(nameEQ.length, c.length);
        }
    }
    return "";
}

let dbPromise;
async function initDB() {
  dbPromise = idb.openDB('talkomatic-themes', 2, {
    upgrade(db, oldVersion, newVersion, transaction) {
      if (oldVersion < 1) {
        const store = db.createObjectStore('themes', { keyPath: 'id' });
        store.createIndex('by-date', 'dateAdded');
      }
      if (oldVersion < 2) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    }
  });
}

async function getCurrentTheme() {
  const db = await dbPromise;
  return db.get('settings', 'currentTheme');
}

/**
 * Show a Toastr notification inviting the user to join Discord,
 * once every 14 days or until they dismiss it.
 */
function showDiscordInviteNotification() {
    // If cookie says "true", means user previously dismissed
    if (getCookie('dismissedDiscordInvite') === 'true') {
        return; // Do not show again
    }

    // Configure Toastr for a sticky notification (until closed)
    toastr.options = {
        closeButton: true,
        positionClass: "toast-top-right",
        timeOut: 0,
        extendedTimeOut: 0,
        tapToDismiss: false,
        preventDuplicates: false,
        showDuration: 300,
        hideDuration: 300,
        showEasing: "swing",
        hideEasing: "linear",
        showMethod: "fadeIn",
        hideMethod: "fadeOut"
    };

    const titleText = "Join Our Discord!";

    // Build a small DOM fragment for the toast content
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '8px';

    // A short description
    const desc = document.createElement('div');
    desc.textContent = "For community help, support, bug reports, or just to meet others!";
    container.appendChild(desc);

    // A styled button to open Discord
    const button = document.createElement('button');
    button.textContent = "Join Discord";
    button.style.backgroundColor = '#5865F2';
    button.style.color = '#FFF';
    button.style.border = 'none';
    button.style.padding = '6px 12px';
    button.style.borderRadius = '4px';
    button.style.cursor = 'pointer';
    button.style.fontWeight = 'bold';

    // Click => open the Discord link in new tab
    button.addEventListener('click', (e) => {
        e.stopPropagation(); // So clicking button won't also trigger toast click
        window.open('https://discord.gg/N7tJznESrE', '_blank');
    });
    container.appendChild(button);

    // Convert container to HTML for Toastr
    const contentHTML = container.outerHTML;

    // Show an info toast
    const $toast = toastr.info(contentHTML, titleText);

    // If the user clicks anywhere on the toast (except the close button),
    // open the Discord link in a new tab
    if ($toast) {
        $toast.on('click', function(e) {
            // If user didn't click the close button, open the link
            if (!$(e.target).hasClass('toast-close-button')) {
                window.open('https://discord.gg/N7tJznESrE', '_blank');
            }
        });
    }

    // When user clicks the X, set cookie for 14 days
    if ($toast && $toast.find('.toast-close-button')) {
        $toast.find('.toast-close-button').on('click', function() {
            setCookie('dismissedDiscordInvite', 'true', 14);
        });
    }
}

// Run after DOM is fully loaded
document.addEventListener('DOMContentLoaded', async () => {
    // Basic Toastr options (some overridden above)
    toastr.options = {
        closeButton: true,
        newestOnTop: true,
        positionClass: "toast-top-right",
        timeOut: 0,
        extendedTimeOut: 0,
        tapToDismiss: true,
        preventDuplicates: false,
        showDuration: 300,
        hideDuration: 300,
        showEasing: "swing",
        hideEasing: "linear",
        showMethod: "fadeIn",
        hideMethod: "fadeOut"
    };

    // Show the Discord invite after a brief delay
    setTimeout(() => {
        showDiscordInviteNotification();
    }, 2000);

    await initDB();
    const saved = await getCurrentTheme();
    if (saved && saved.content) {
        const styleEl = document.createElement("style");
        (document.head || document.getElementsByTagName('head')[0])
          .appendChild(styleEl);
        if (styleEl.styleSheet) {
            styleEl.styleSheet.cssText = saved.content;
        } else {
            styleEl.appendChild(document.createTextNode(saved.content));
        }
    }
});

// Run initial setup
init();