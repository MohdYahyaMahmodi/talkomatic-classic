/**
 * Talkomatic Sponsors Page JavaScript
 * ==================================
 * 
 * This script handles the interactive elements on the sponsors page,
 * including tier information modals and smooth scrolling.
 * 
 * Last updated: 2025
 */
document.addEventListener('DOMContentLoaded', function() {
    // Modal elements
    const modalContainer = document.getElementById('modal-container');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalClose = document.querySelector('.modal-close');
    
    // Tier information button elements
    const tierButtons = document.querySelectorAll('.tier-info-button');
    
    // Tier information content
    const tierInfo = {
        platinum: {
            title: "Platinum Sponsor Tier",
            content: createModalContent({
                intro: "Our highest tier for organizations that want to make a significant impact on Talkomatic's development.",
                benefits: [
                    "Priority placement at the top of our Sponsors page",
                    "Your organization's logo, name, and website link",
                    "A custom description (up to 200 characters)",
                    "Ability to request tailored promotions or additional recognition opportunities"
                ],
                cost: "$100 per month or $1,000 one-time (1 year of recognition)",
                howTo: "You can contribute directly through Open Collective or contact us at sponsors@talkomatic.co to set up your sponsor profile.",
                notes: "Platinum sponsors play a vital role in the growth and sustainability of Talkomatic. Your generous support directly funds new feature development, platform enhancements, and a better experience for all our users."
            })
        },
        gold: {
            title: "Gold Sponsor Tier",
            content: createModalContent({
                intro: "A great option for organizations that want to show substantial support for the Talkomatic project.",
                benefits: [
                    "Prominent placement in the Gold section of our Sponsors page",
                    "Your organization's logo, name, and website link",
                    "Ability to request tailored promotions or additional recognition opportunities"
                ],
                cost: "$75 per month or $750 one-time (1 year of recognition)",
                howTo: "You can contribute directly through Open Collective, Github Sponsors, or Buy Me a Coffee. Contact us at sponsors@talkomatic.co to set up your sponsor profile.",
                notes: "Gold sponsors are instrumental in helping Talkomatic stay free, accessible, and continually improving. Your support ensures the platform remains open to all and continues evolving for the community."
            })
        },
        silver: {
            title: "Silver Sponsor Tier",
            content: createModalContent({
                intro: "Perfect for small businesses and organizations that want to support open source projects like Talkomatic.",
                benefits: [
                    "Listed in the Silver section of our Sponsors page",
                    "Your organization's logo, name, and website link"
                ],
                cost: "$50 per month or $500 one-time (1 year of recognition)",
                howTo: "You can contribute directly through Open Collective or contact us at sponsors@talkomatic.co to set up your sponsor profile.",
                notes: "Silver sponsors help support the core infrastructure and daily operations of Talkomatic. Your contribution keeps the platform running smoothly and reliably for everyone."
            })
        },
        bronze: {
            title: "Bronze Sponsor Tier",
            content: createModalContent({
                intro: "An accessible option for small teams, startups, or individuals who want to support the project and gain recognition.",
                benefits: [
                    "Listed in the Bronze section of our Sponsors page",
                    "Your organization's name, logo, and website link"
                ],
                cost: "$25 per month or $250 one-time (1 year of recognition)",
                howTo: "You can contribute directly through Open Collective or contact us at sponsors@talkomatic.co to set up your sponsor profile.",
                notes: "Bronze sponsors make a meaningful difference in keeping Talkomatic online and accessible. Every contribution helps us maintain and grow the platform for our global community."
            })
        },
        community: {
            title: "Community Supporter",
            content: createModalContent({
                intro: "We welcome one-time contributions of any amount. Your support—big or small—helps us keep Talkomatic online, ad-free, and open to everyone.",
                benefits: [
                    "Your name listed in the Community Supporters section",
                    "Optional link to your personal website or project",
                    "Every contribution helps improve and grow Talkomatic"
                ],
                cost: [
                    "$1–$249: Community Supporter",
                    "$250–$499: Bronze Sponsor (1 year)",
                    "$500–$749: Silver Sponsor (1 year)",
                    "$750–$999: Gold Sponsor (1 year)",
                    "$1,000 or more: Platinum Sponsor (1 year)"
                ],
                howTo: "You can contribute directly through our Open Collective page. Select a one-time amount that matches the tier you'd like to be recognized in.",
                notes: "All tiers include public recognition on our website. Bronze and higher include sponsor placement with your logo, name, and link. Platinum sponsors receive top placement and additional custom promotion options."
            })
        }
    };
    
    // Function to create modal content safely without innerHTML
    function createModalContent(data) {
        const container = document.createElement('div');
        
        // Introduction paragraph
        const introPara = document.createElement('p');
        introPara.textContent = data.intro;
        container.appendChild(introPara);
        
        // Benefits section
        const benefitsHeading = document.createElement('h3');
        benefitsHeading.textContent = 'Benefits:';
        container.appendChild(benefitsHeading);
        
        const benefitsList = document.createElement('ul');
        data.benefits.forEach(benefit => {
            const item = document.createElement('li');
            item.textContent = benefit;
            benefitsList.appendChild(item);
        });
        container.appendChild(benefitsList);
        
        // Cost section
        const costHeading = document.createElement('h3');
        costHeading.textContent = 'Cost:';
        container.appendChild(costHeading);
        
        if (Array.isArray(data.cost)) {
            const costList = document.createElement('ul');
            data.cost.forEach(c => {
                const item = document.createElement('li');
                item.textContent = c;
                costList.appendChild(item);
            });
            container.appendChild(costList);
        } else {
            const costPara = document.createElement('p');
            costPara.textContent = data.cost;
            container.appendChild(costPara);
        }
        
        // How to become a sponsor section
        const howToHeading = document.createElement('h3');
        howToHeading.textContent = 'How to Become a Sponsor:';
        container.appendChild(howToHeading);
        
        const howToPara = document.createElement('p');
        if (data.howTo.includes('@')) {
            const emailParts = data.howTo.split(/sponsors@talkomatic\.com/);
            howToPara.textContent = emailParts[0];
            if (emailParts.length > 1) {
                const emailLink = document.createElement('a');
                emailLink.href = 'mailto:sponsors@talkomatic.co';
                emailLink.textContent = 'sponsors@talkomatic.co';
                howToPara.appendChild(emailLink);
                const remainingText = document.createTextNode(emailParts[1]);
                howToPara.appendChild(remainingText);
            }
        } else {
            howToPara.textContent = data.howTo;
        }
        container.appendChild(howToPara);
        
        // Notes section
        const notesHeading = document.createElement('h3');
        notesHeading.textContent = 'Notes:';
        container.appendChild(notesHeading);
        
        const notesPara = document.createElement('p');
        notesPara.textContent = data.notes;
        container.appendChild(notesPara);
        
        return container;
    }
    
    // Add event listeners to tier info buttons
    tierButtons.forEach(button => {
        button.addEventListener('click', function() {
            const tier = this.getAttribute('data-tier');
            if (tierInfo[tier]) {
                openModal(tierInfo[tier].title, tierInfo[tier].content);
            }
        });
    });
    
    // Function to open modal
    function openModal(title, contentElement) {
        // Clear existing content
        while (modalBody.firstChild) {
            modalBody.removeChild(modalBody.firstChild);
        }
        
        // Set title and content
        modalTitle.textContent = title;
        if (contentElement instanceof Node) {
            modalBody.appendChild(contentElement);
        } else {
            const textNode = document.createTextNode(contentElement);
            modalBody.appendChild(textNode);
        }
        
        // Show modal
        modalContainer.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Prevent scrolling while modal is open
    }
    
    // Close modal when X is clicked
    modalClose.addEventListener('click', closeModal);
    
    // Close modal when clicking outside content area
    modalContainer.addEventListener('click', function(event) {
        if (event.target === modalContainer) {
            closeModal();
        }
    });
    
    // Function to close modal
    function closeModal() {
        modalContainer.style.display = 'none';
        document.body.style.overflow = ''; // Restore scrolling
    }
    
    // Close modal with Escape key
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && modalContainer.style.display === 'flex') {
            closeModal();
        }
    });
    
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
    
    // Handle image loading errors
    function handleImageErrors() {
        const images = document.querySelectorAll('.logo-image');
        images.forEach(img => {
            img.onerror = function() {
                this.src = 'images/sponsors/placeholder-logo.png';
                this.alt = 'Sponsor Logo (Placeholder)';
            };
        });
    }
    
    // Add visual effects
    function addVisualEffects() {
        const categoryTitles = document.querySelectorAll('.category-title');
        categoryTitles.forEach(title => {
            title.classList.add('scan-line-effect');
        });
    }
    
    // Initialize page features
    function init() {
        handleImageErrors();
        addVisualEffects();
    }
    
    init();
});