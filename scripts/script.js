// ===============================
// TAB SWITCHING
// ===============================
const tabs = Array.from(document.querySelectorAll(".tab"));
const contents = Array.from(document.querySelectorAll(".tab-content"));

const setActiveTab = (activeTab) => {
  tabs.forEach(t => t.classList.toggle("active", t === activeTab));
  contents.forEach(c => c.classList.toggle("active", c.id === activeTab.dataset.tab));
};

tabs.forEach(tab => {
  tab.addEventListener("click", () => setActiveTab(tab));
});

// ===============================
// RANDOM NAME GENERATOR BUTTON
// ===============================
const nameGenButton = document.getElementById("openNameGen");
const nameOutput = document.getElementById("generatedName");

function generatePokemonName() {
  const starts = [
    "ka", "zu", "mi", "ra", "to", "shi", "no", "li", "py", "fi",
    "dra", "ze", "cha", "lu", "sa", "ve", "tri", "mo", "glu",
    "e", "pha", "ny", "u", "a"
  ];

  const middles = [
    "ra", "zu", "mi", "lo", "ka", "shi", "la", "ne", "ri", "do",
    "ma", "ta", "vi", "xo", "ni", "ga"
  ];

  const ends = [
    "mon", "chu", "lin", "fy", "no", "ra", "tar", "zor",
    "ling", "gon", "rex", "dle", "bit", "mite"
  ];

  function random(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  let name = "";

  const isLegendary = Math.random() < 0.05;

  if (isLegendary) {
    name = random(starts) + random(middles) + random(middles) + random(ends);
  } else {
    name = random(starts);

    if (Math.random() < 0.5) {
      name += random(middles);
    }

    name += random(ends);
  }

  // Clean repeated vowels
  name = name.replace(/([aeiou])\1+/g, "$1");

  // Prevent extreme consonant stacking
  name = name.replace(/([^aeiou])\1{2,}/g, "$1$1");

  // 🔥 Hard cap at 8 letters
  if (name.length > 8) {
    name = name.slice(0, 8);
  }

  // Ensure we don't end mid-consonant cluster after slicing
  name = name.replace(/[^aeiou]{3,}$/i, "");

  return name.charAt(0).toUpperCase() + name.slice(1);
}


// Generate on page load
document.addEventListener("DOMContentLoaded", () => {
  nameOutput.textContent = `Random Pokémon Name: ${generatePokemonName()}`;
});

nameGenButton.addEventListener("click", () => {
  nameOutput.textContent = `Random Pokémon Name: ${generatePokemonName()}`;
});




// ===============================
// THEME PULSE IS IN themePulse.js
// ===============================
// This file does NOT touch Pokémon DOM elements
// All Pokémon-specific UI is handled in pokemonData.js

// ===============================
// OPTIONAL: PAGE LOAD DEFAULT
// ===============================
window.addEventListener("DOMContentLoaded", () => {
  // Any non-Pokémon page logic goes here
  console.log("Script.js loaded — tabs and name generator ready.");
});
