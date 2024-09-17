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
const leftPanel = document.getElementById('leftPanel'); // Reference to the left panel (menu)
const toggleButton = document.getElementById('toggleButton'); // Button to toggle the panel
const hideMenuButton = document.getElementById('hideMenuButton'); // Button to hide the panel

/**
 * Toggles the left panel open/closed state
 * ----------------------------------------------------------------------------
 * This function toggles the 'open' class on the left panel. When the panel is
 * open, the toggle button becomes invisible, and when it's closed, the button
 * becomes visible again.
 */
function toggleLeftPanel() {
    leftPanel.classList.toggle('open'); // Toggle the 'open' class
    toggleButton.style.opacity = leftPanel.classList.contains('open') ? '0' : '1'; // Hide/show toggle button
}

/**
 * Hides the left panel
 * ----------------------------------------------------------------------------
 * This function closes the left panel by removing the 'open' class. After a
 * short delay (300ms) to allow for the close animation, the toggle button is
 * made visible again.
 */
function hideLeftPanel() {
    leftPanel.classList.remove('open'); // Remove the 'open' class
    setTimeout(() => {
        toggleButton.style.opacity = '1'; // Show the toggle button after panel closes
    }, 300); // Delay to allow panel animation to complete
}

/**
 * Handles window resize events
 * ----------------------------------------------------------------------------
 * This function adjusts the visibility of the left panel and buttons based on
 * the window size. On larger screens (>992px), the left panel is hidden, and
 * the toggle button is also hidden. On smaller screens, the toggle button is
 * shown if the panel is not open.
 */
function handleResize() {
    if (window.innerWidth > 992) {
        leftPanel.classList.remove('open'); // Close panel on large screens
        toggleButton.style.opacity = '0'; // Hide toggle button on large screens
        hideMenuButton.style.display = 'none'; // Hide the "Hide Menu" button
    } else {
        if (!leftPanel.classList.contains('open')) {
            toggleButton.style.opacity = '1'; // Show toggle button on smaller screens if panel is closed
        }
        hideMenuButton.style.display = 'block'; // Show the "Hide Menu" button on smaller screens
    }
}

/**
 * Handles clicks outside the left panel to close it
 * ----------------------------------------------------------------------------
 * This function checks if the user clicked outside the left panel or the toggle
 * button. If a click occurs outside the panel and the panel is open, it will
 * close the panel.
 * @param {Event} event - The click event
 */
function handleOutsideClick(event) {
    const isClickInside = leftPanel.contains(event.target) || toggleButton.contains(event.target); // Check if the click is inside the panel or toggle button
    if (!isClickInside && leftPanel.classList.contains('open')) {
        hideLeftPanel(); // Close panel if click is outside
    }
}

// Event Listeners
document.addEventListener('click', handleOutsideClick); // Listen for clicks anywhere on the page
window.addEventListener('resize', handleResize); // Listen for window resize events
hideMenuButton.addEventListener('click', hideLeftPanel); // Listen for clicks on the "Hide Menu" button
toggleButton.addEventListener('click', toggleLeftPanel); // Listen for clicks on the toggle button

/**
 * Initial Setup
 * ----------------------------------------------------------------------------
 * This function sets the initial state when the page loads. If the window is
 * smaller than or equal to 992px, the toggle button is made visible.
 */
function init() {
    if (window.innerWidth <= 992) {
        toggleButton.style.opacity = '1'; // Show toggle button if screen is small
    }
}

// Run initial setup
init(); // Initialize when the page loads
