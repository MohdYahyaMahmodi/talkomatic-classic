/**
 * Talkomatic Room JavaScript
 * This script handles dynamic updates and layout adjustments for the Talkomatic chat room.
 */

// DOM elements
const dateTimeElement = document.querySelector('#dateTime');
const chatContainer = document.querySelector('.chat-container');
const topNavbar = document.querySelector('.top-navbar');
const secondNavbar = document.querySelector('.second-navbar');
const inviteSection = document.querySelector('.invite-section');

/**
 * Updates the date and time display in the navbar.
 */
function updateDateTime() {
  const now = new Date();
  const dateOptions = { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric'
  };
  const timeOptions = {
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: true 
  };
  
  const formattedDate = now.toLocaleDateString('en-US', dateOptions);
  const formattedTime = now.toLocaleTimeString('en-US', timeOptions);
  
  dateTimeElement.querySelector('.date').textContent = formattedDate;
  dateTimeElement.querySelector('.time').textContent = formattedTime;
}

/**
 * Adjusts the layout of the chat container and chat rows based on available screen space.
 */
function adjustLayout() {
  // Calculate available height for the chat container
  const availableHeight = window.innerHeight - 
                          topNavbar.offsetHeight - 
                          secondNavbar.offsetHeight - 
                          inviteSection.offsetHeight;
  
  // Set the height of the chat container
  chatContainer.style.height = `${availableHeight}px`;
  
  const chatRows = document.querySelectorAll('.chat-row');
  const rowGap = 10; // Gap between chat rows in pixels
  const totalGap = (chatRows.length - 1) * rowGap;
  const chatRowHeight = Math.floor((availableHeight - totalGap) / chatRows.length);
  
  // Adjust height of each chat row and its input area
  chatRows.forEach(row => {
    row.style.height = `${chatRowHeight}px`;
    const userInfo = row.querySelector('.user-info');
    const chatInput = row.querySelector('.chat-input');
    const inputHeight = chatRowHeight - userInfo.offsetHeight - 2; // 2px for borders
    chatInput.style.height = `${inputHeight}px`;
  });
}

/**
 * Initializes the page by setting up initial states and event listeners.
 */
function initializePage() {
  // Perform initial updates
  updateDateTime();
  adjustLayout();

  // Set up interval for date/time update (every second)
  setInterval(updateDateTime, 1000);

  // Adjust layout on window resize
  window.addEventListener('resize', adjustLayout);
}

// Initialize the page when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializePage);