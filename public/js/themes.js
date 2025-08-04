const curatedThemesDiv = document.getElementById("curatedThemes");
const importThemeDiv = document.getElementById("importTheme");

// ===========
// Toggle Curated Themes and Import Theme tabs
// ===========
document
.getElementById("curatedThemesButton")
.addEventListener("click", () => {
    curatedThemesDiv.style.display = "block";
    importThemeDiv.style.display = "none";
});

document
.getElementById("importThemeButton")
.addEventListener("click", () => {
    curatedThemesDiv.style.display = "none";
    importThemeDiv.style.display = "block";
});


// Search for themes that match using the theme's name and author
const searchBar = document.getElementById("searchTheme");
searchBar.addEventListener("input", _ => {
    let text = searchBar.value;
    [...document.querySelectorAll(".themeWidget")].forEach(widget => {
        if (widget
            .querySelector(".themeName")
            .textContent
            .toLowerCase()
            .includes(text.toLowerCase())
        ||
            widget
            .querySelector(".themeAuthor")
            .textContent
            .toLowerCase()
            .includes(text.toLowerCase())) {
            widget.style.display = "block";
        } else {
            widget.style.display = "none";
        }
    });
});

// Every widget that is clicked will fetch the corresponding theme .css file,
// and will set that to the local storage as theme, and will trigger a background flash animation
[...document
.querySelectorAll(".themeWidget")]
.forEach(widget => {
    widget.addEventListener("click", async () => {
        if (widget.dataset.file === "") {
            // No theme
            localStorage.setItem("theme", "");
        } else {
            let file = "themes/" + widget.dataset.file;
            let res = await fetch(file);
            if (!res.ok) {
                console.error(res.statusText);
                return;
            }
            let contents = await res.text();
            localStorage.setItem("theme", contents);
        }
        
        widget.animate([
            {background: "#009900"},
            {background: "linear-gradient(45deg, #ff980033, #ff980007, transparent)"}
        ], {
            duration: 1500,
            iterations: 1
        });
    });
});

let themeContents = "";

// When a theme is opened, we read it, and we store the contents in themeContents
document
.getElementById("openThemeInput")
.addEventListener("change", event => {
    let file = event.target.files[0];
    let reader = new FileReader();
    reader.onload = res => {
        themeContents = res.target.result;
    };
    reader.readAsText(file);
});

let openThemeButton = document.getElementById("openThemeButton");

// When we click on a button, we set our theme contents to the theme css that will be used in local storage
openThemeButton.addEventListener("click", () => {
    // Ensure we did import a theme
    if (themeContents == "") {
        openThemeButton.outerText = "You must import a .css file to apply the theme.";
        return;
    }
    localStorage.setItem("theme", themeContents);
});

