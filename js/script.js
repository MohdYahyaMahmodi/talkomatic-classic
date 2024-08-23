// DOM Element References
const leftPanel = document.getElementById('leftPanel');
const toggleButton = document.querySelector('.toggle-button');
const hideMenuButton = document.querySelector('.hide-menu-button');

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

// Event Listeners
document.addEventListener('click', handleOutsideClick);
window.addEventListener('resize', handleResize);
hideMenuButton.addEventListener('click', hideLeftPanel);

// Initial Setup
function init() {
    if (window.innerWidth <= 992) {
        toggleButton.style.opacity = '1';
    }
}

// Run initial setup
init();