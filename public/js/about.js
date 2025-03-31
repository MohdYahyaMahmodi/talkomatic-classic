/**
 * Talkomatic About Page JavaScript
 * ============================
 * Handles FAQ accordion functionality
 * Last updated: 2025
 */

document.addEventListener('DOMContentLoaded', function() {
  // FAQ accordion functionality
  const faqItems = document.querySelectorAll('.faq-item');
  
  faqItems.forEach(item => {
      const question = item.querySelector('.faq-question');
      
      question.addEventListener('click', () => {
          // Toggle active class on the clicked item
          const isActive = item.classList.contains('active');
          
          // Close all items first
          faqItems.forEach(faq => {
              faq.classList.remove('active');
          });
          
          // If the clicked item wasn't active, make it active
          if (!isActive) {
              item.classList.add('active');
          }
      });
  });
  
  // Activate the first FAQ item by default
  if (faqItems.length > 0) {
      faqItems[0].classList.add('active');
  }
  
  // Smooth scrolling for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
          e.preventDefault();
          
          const targetId = this.getAttribute('href');
          const targetElement = document.querySelector(targetId);
          
          if (targetElement) {
              window.scrollTo({
                  top: targetElement.offsetTop - 20,
                  behavior: 'smooth'
              });
          }
      });
  });
});