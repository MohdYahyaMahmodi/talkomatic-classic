// Themes.js - Polished version with uploaded theme saving
// =======================================================

// DOM Elements
const curatedContent = document.getElementById("curatedContent");
const importContent = document.getElementById("importContent");
const themeGrid = document.getElementById("themeGrid");

// Navigation buttons
const curatedThemesButton = document.getElementById("curatedThemesButton");
const importThemeButton = document.getElementById("importThemeButton");

// Theme application elements
const quickImportInput = document.getElementById("quickImportInput");
const quickApplyButton = document.getElementById("quickApplyButton");
const importThemeInput = document.getElementById("importThemeInput");
const themeNameInput = document.getElementById("themeNameInput");
const importApplyButton = document.getElementById("importApplyButton");

// Modal elements
const themeModal = document.getElementById("themeModal");
const modalThemeNameInput = document.getElementById("modalThemeNameInput");
const modalCancelButton = document.getElementById("modalCancelButton");
const modalSaveButton = document.getElementById("modalSaveButton");

// Search functionality
const searchInput = document.getElementById("searchTheme");

// Theme content storage
let quickThemeContent = "";
let importThemeContent = "";
let pendingSaveData = null;

// Configure toastr notifications
toastr.options = {
  closeButton: true,
  debug: false,
  newestOnTop: true,
  progressBar: true,
  positionClass: "toast-bottom-right",
  preventDuplicates: true,
  showDuration: "300",
  hideDuration: "1000",
  timeOut: "2500",
  extendedTimeOut: "1000",
  showEasing: "swing",
  hideEasing: "linear",
  showMethod: "fadeIn",
  hideMethod: "fadeOut",
};

// =================================================================
// Local Storage Management for Uploaded Themes
// =================================================================

/**
 * Get uploaded themes from localStorage
 */
function getUploadedThemes() {
  try {
    const stored = localStorage.getItem("uploadedThemes");
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error("Error reading uploaded themes:", error);
    return [];
  }
}

/**
 * Save uploaded themes to localStorage
 */
function saveUploadedThemes(themes) {
  try {
    localStorage.setItem("uploadedThemes", JSON.stringify(themes));
  } catch (error) {
    console.error("Error saving uploaded themes:", error);
    toastr.error("Failed to save theme locally", "Storage Error");
  }
}

/**
 * Add a new uploaded theme
 */
function addUploadedTheme(name, content) {
  const themes = getUploadedThemes();
  const newTheme = {
    id: Date.now(),
    name: name,
    content: content,
    dateAdded: new Date().toISOString(),
  };

  themes.push(newTheme);
  saveUploadedThemes(themes);
  return newTheme;
}

/**
 * Delete an uploaded theme
 */
function deleteUploadedTheme(id) {
  const themes = getUploadedThemes();
  const filtered = themes.filter((theme) => theme.id !== id);
  saveUploadedThemes(filtered);
}

// =================================================================
// Theme Display Functions
// =================================================================

/**
 * Create a theme card element
 */
function createThemeCard(theme) {
  const card = document.createElement("div");
  card.className = "theme-card";

  if (theme.type === "uploaded") {
    card.dataset.uploadedId = theme.id;
    card.innerHTML = `
            <div class="theme-badge uploaded">
                <i class="fas fa-upload"></i> Uploaded
            </div>
            <div class="imported-thumbnail">IMPORTED</div>
            <div class="theme-name">${theme.name}</div>
            <div class="theme-author">You</div>
        `;
  } else {
    card.dataset.file = theme.file || "";
    card.innerHTML = `
            <div class="theme-badge ${
              theme.badge === "official" ? "official" : "user-made"
            }">
                <i class="fas fa-${
                  theme.badge === "official" ? "star" : "users"
                }"></i> ${theme.badge === "official" ? "Official" : "User-made"}
            </div>
            <img src="${theme.thumbnail}" alt="${
      theme.name
    }" class="theme-thumbnail">
            <div class="theme-name">${theme.name}</div>
            <div class="theme-author">${theme.author}</div>
        `;
  }

  return card;
}

/**
 * Render all themes in the grid
 */
function renderThemes() {
  // Clear existing uploaded themes but keep curated ones
  const curatedCards = themeGrid.querySelectorAll(
    ".theme-card:not([data-uploaded-id])"
  );
  themeGrid.innerHTML = "";

  // Re-add curated themes
  curatedCards.forEach((card) => themeGrid.appendChild(card));

  // Add uploaded themes
  const uploadedThemes = getUploadedThemes();
  uploadedThemes.forEach((theme) => {
    const themeData = {
      type: "uploaded",
      id: theme.id,
      name: theme.name,
      content: theme.content,
    };
    const card = createThemeCard(themeData);
    themeGrid.appendChild(card);
  });
}

// =================================================================
// Navigation Functions
// =================================================================

/**
 * Switch to curated themes view
 */
function showCuratedThemes() {
  curatedContent.style.display = "block";
  importContent.style.display = "none";

  curatedThemesButton.classList.add("active");
  importThemeButton.classList.remove("active");
}

/**
 * Switch to import theme view
 */
function showImportThemes() {
  curatedContent.style.display = "none";
  importContent.style.display = "block";

  curatedThemesButton.classList.remove("active");
  importThemeButton.classList.add("active");
}

// =================================================================
// Theme Application Functions
// =================================================================

/**
 * Apply a theme to localStorage
 */
function applyTheme(themeContent, themeName = "theme") {
  try {
    localStorage.setItem("theme", themeContent);
    toastr.success(
      `${themeName} applied! Return to lobby to see changes.`,
      "Theme Applied"
    );
  } catch (error) {
    console.error("Error applying theme:", error);
    toastr.error("Failed to apply theme. Please try again.", "Error");
  }
}

/**
 * Apply a curated theme
 */
async function applyCuratedTheme(filename, themeName, cardElement) {
  try {
    cardElement.style.opacity = "0.7";

    if (filename === "") {
      applyTheme("", "Default Theme");
    } else {
      const response = await fetch(`themes/${filename}`);

      if (!response.ok) {
        throw new Error(`Failed to load theme: ${response.statusText}`);
      }

      const themeContent = await response.text();
      applyTheme(themeContent, themeName);
    }

    // Visual feedback
    cardElement.animate(
      [
        {
          transform: "scale(1)",
          backgroundColor: "var(--card-background-color)",
        },
        { transform: "scale(1.02)", backgroundColor: "rgba(76, 175, 80, 0.2)" },
        {
          transform: "scale(1)",
          backgroundColor: "var(--card-background-color)",
        },
      ],
      {
        duration: 500,
        easing: "ease-out",
      }
    );
  } catch (error) {
    console.error("Error applying curated theme:", error);
    toastr.error(`Failed to load ${themeName}`, "Error");
  } finally {
    cardElement.style.opacity = "1";
  }
}

/**
 * Apply an uploaded theme
 */
function applyUploadedTheme(themeId, cardElement) {
  const themes = getUploadedThemes();
  const theme = themes.find((t) => t.id === themeId);

  if (theme) {
    cardElement.style.opacity = "0.7";
    applyTheme(theme.content, theme.name);

    // Visual feedback
    cardElement.animate(
      [
        {
          transform: "scale(1)",
          backgroundColor: "var(--card-background-color)",
        },
        { transform: "scale(1.02)", backgroundColor: "rgba(76, 175, 80, 0.2)" },
        {
          transform: "scale(1)",
          backgroundColor: "var(--card-background-color)",
        },
      ],
      {
        duration: 500,
        easing: "ease-out",
      }
    );

    setTimeout(() => (cardElement.style.opacity = "1"), 500);
  }
}

/**
 * Read file content from file input
 */
function readFileContent(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("No file selected"));
      return;
    }

    if (!file.name.toLowerCase().endsWith(".css")) {
      reject(new Error("Please select a valid CSS file"));
      return;
    }

    if (file.size > 1024 * 1024) {
      reject(new Error("File too large (max 1MB)"));
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

// =================================================================
// Modal Functions
// =================================================================

/**
 * Show theme naming modal
 */
function showThemeModal(themeContent, defaultName = "") {
  pendingSaveData = { content: themeContent };
  modalThemeNameInput.value = defaultName;
  themeModal.classList.add("show");
  modalThemeNameInput.focus();
}

/**
 * Hide theme naming modal
 */
function hideThemeModal() {
  themeModal.classList.remove("show");
  pendingSaveData = null;
  modalThemeNameInput.value = "";
}

/**
 * Save theme from modal
 */
function saveThemeFromModal() {
  const themeName = modalThemeNameInput.value.trim();

  if (!themeName) {
    toastr.warning("Please enter a theme name", "Name Required");
    modalThemeNameInput.focus();
    return;
  }

  if (pendingSaveData) {
    const newTheme = addUploadedTheme(themeName, pendingSaveData.content);
    renderThemes();
    applyTheme(pendingSaveData.content, themeName);
    hideThemeModal();

    toastr.success(`Theme "${themeName}" saved and applied!`, "Success");
  }
}

// =================================================================
// Event Listeners
// =================================================================

// Navigation
curatedThemesButton.addEventListener("click", showCuratedThemes);
importThemeButton.addEventListener("click", showImportThemes);

// Quick import
quickImportInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];

  try {
    quickThemeContent = await readFileContent(file);
    quickApplyButton.disabled = false;
    quickApplyButton.innerHTML = `<i class="fas fa-palette"></i> Apply "${file.name}"`;
    toastr.info(`File "${file.name}" ready`, "File Loaded");
  } catch (error) {
    quickThemeContent = "";
    quickApplyButton.disabled = true;
    quickApplyButton.innerHTML = '<i class="fas fa-palette"></i> Apply Theme';
    toastr.error(error.message, "File Error");
  }
});

quickApplyButton.addEventListener("click", () => {
  if (quickThemeContent) {
    const fileName =
      quickImportInput.files[0]?.name.replace(".css", "") || "Quick Theme";
    showThemeModal(quickThemeContent, fileName);

    // Reset form
    quickImportInput.value = "";
    quickThemeContent = "";
    quickApplyButton.disabled = true;
    quickApplyButton.innerHTML = '<i class="fas fa-palette"></i> Apply Theme';
  }
});

// Import theme section
importThemeInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];

  try {
    importThemeContent = await readFileContent(file);
    if (!themeNameInput.value) {
      themeNameInput.value = file.name.replace(".css", "");
    }
    updateImportButton();
    toastr.info(`File "${file.name}" loaded`, "Ready to Save");
  } catch (error) {
    importThemeContent = "";
    updateImportButton();
    toastr.error(error.message, "File Error");
  }
});

themeNameInput.addEventListener("input", updateImportButton);

function updateImportButton() {
  const hasContent = !!importThemeContent;
  const hasName = !!themeNameInput.value.trim();
  importApplyButton.disabled = !(hasContent && hasName);
}

importApplyButton.addEventListener("click", () => {
  const themeName = themeNameInput.value.trim();

  if (importThemeContent && themeName) {
    const newTheme = addUploadedTheme(themeName, importThemeContent);
    renderThemes();
    applyTheme(importThemeContent, themeName);

    // Reset form
    importThemeInput.value = "";
    themeNameInput.value = "";
    importThemeContent = "";
    updateImportButton();

    toastr.success(`Theme "${themeName}" saved and applied!`, "Success");
  }
});

// Modal events
modalCancelButton.addEventListener("click", hideThemeModal);
modalSaveButton.addEventListener("click", saveThemeFromModal);

modalThemeNameInput.addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
    saveThemeFromModal();
  } else if (event.key === "Escape") {
    hideThemeModal();
  }
});

// Close modal on background click
themeModal.addEventListener("click", (event) => {
  if (event.target === themeModal) {
    hideThemeModal();
  }
});

// Search functionality
searchInput.addEventListener("input", (event) => {
  const searchTerm = event.target.value.toLowerCase().trim();
  const themeCards = document.querySelectorAll(".theme-card");
  let visibleCount = 0;

  themeCards.forEach((card) => {
    const themeName =
      card.querySelector(".theme-name")?.textContent?.toLowerCase() || "";
    const themeAuthor =
      card.querySelector(".theme-author")?.textContent?.toLowerCase() || "";

    if (themeName.includes(searchTerm) || themeAuthor.includes(searchTerm)) {
      card.style.display = "block";
      visibleCount++;
    } else {
      card.style.display = "none";
    }
  });

  if (searchTerm && visibleCount === 0) {
    toastr.warning(`No themes found for "${event.target.value}"`, "No Results");
  }
});

// Theme card clicks
document.addEventListener("click", (event) => {
  const themeCard = event.target.closest(".theme-card");

  if (themeCard && curatedContent.style.display !== "none") {
    // Handle uploaded theme
    if (themeCard.dataset.uploadedId) {
      const themeId = parseInt(themeCard.dataset.uploadedId);
      applyUploadedTheme(themeId, themeCard);
    }
    // Handle curated theme
    else if (themeCard.dataset.file !== undefined) {
      const filename = themeCard.dataset.file;
      const themeName =
        themeCard.querySelector(".theme-name")?.textContent || "Theme";
      applyCuratedTheme(filename, themeName, themeCard);
    }
  }
});

// Delete uploaded themes (right-click context)
document.addEventListener("contextmenu", (event) => {
  const themeCard = event.target.closest(".theme-card");

  if (themeCard && themeCard.dataset.uploadedId) {
    event.preventDefault();

    const themeName =
      themeCard.querySelector(".theme-name")?.textContent || "this theme";
    if (confirm(`Delete "${themeName}"?`)) {
      const themeId = parseInt(themeCard.dataset.uploadedId);
      deleteUploadedTheme(themeId);
      renderThemes();
      toastr.info(`Theme "${themeName}" deleted`, "Deleted");
    }
  }
});

// =================================================================
// Initialization
// =================================================================

document.addEventListener("DOMContentLoaded", () => {
  showCuratedThemes();
  renderThemes();
  updateImportButton();

  // Welcome message
  setTimeout(() => {
    toastr.info(
      "Choose a theme to customize your Talkomatic experience!",
      "Welcome"
    );
  }, 500);

  console.log("Talkomatic Themes initialized");
});
