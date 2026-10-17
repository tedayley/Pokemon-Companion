// typecalculator.js

const TYPE_CHART = {
  normal: { weak: ["fighting"], immune: ["ghost"], resist: [] },
  fire: { weak: ["water", "rock", "ground"], resist: ["fire", "grass", "ice", "bug", "steel", "fairy"], immune: [] },
  water: { weak: ["electric", "grass"], resist: ["fire", "water", "ice", "steel"], immune: [] },
  electric: { weak: ["ground"], resist: ["electric", "flying", "steel"], immune: [] },
  grass: { weak: ["fire", "ice", "poison", "flying", "bug"], resist: ["water", "electric", "grass", "ground"], immune: [] },
  ice: { weak: ["fire", "fighting", "rock", "steel"], resist: ["ice"], immune: [] },
  fighting: { weak: ["flying", "psychic", "fairy"], resist: ["bug", "rock", "dark"], immune: [] },
  poison: { weak: ["ground", "psychic"], resist: ["grass", "fighting", "poison", "bug", "fairy"], immune: [] },
  ground: { weak: ["water", "grass", "ice"], resist: ["poison", "rock"], immune: ["electric"] },
  flying: { weak: ["electric", "ice", "rock"], resist: ["grass", "fighting", "bug"], immune: ["ground"] },
  psychic: { weak: ["bug", "ghost", "dark"], resist: ["fighting", "psychic"], immune: [] },
  bug: { weak: ["fire", "flying", "rock"], resist: ["grass", "fighting", "ground"], immune: [] },
  rock: { weak: ["water", "grass", "fighting", "ground", "steel"], resist: ["normal", "fire", "poison", "flying"], immune: [] },
  ghost: { weak: ["ghost", "dark"], resist: ["poison", "bug"], immune: ["normal", "fighting"] },
  dragon: { weak: ["ice", "dragon", "fairy"], resist: ["fire", "water", "electric", "grass"], immune: [] },
  dark: { weak: ["fighting", "bug", "fairy"], resist: ["ghost", "dark"], immune: ["psychic"] },
  steel: { weak: ["fire", "fighting", "ground"], resist: ["normal", "grass", "ice", "flying", "psychic", "bug", "rock", "dragon", "steel", "fairy"], immune: ["poison"] },
  fairy: { weak: ["poison", "steel"], resist: ["fighting", "bug", "dark"], immune: ["dragon"] }
};

function renderTypeCalculator(pokemonTypes) {
  const container = document.getElementById("calculator");
  if (!container) return;

  container.innerHTML = "<h3>Type Effectiveness</h3>";

  const effectiveness = {};

  Object.keys(TYPE_CHART).forEach(type => {
    effectiveness[type] = 1;
  });

  pokemonTypes.forEach(pType => {
    const chart = TYPE_CHART[pType];
    if (!chart) return;

    chart.weak.forEach(t => effectiveness[t] *= 2);
    chart.resist.forEach(t => effectiveness[t] *= 0.5);
    chart.immune.forEach(t => effectiveness[t] = 0);
  });

  const groups = {
    "4× Weak": [],
    "2× Weak": [],
    "Neutral": [],
    "½× Resist": [],
    "¼× Resist": [],
    "Immune": []
  };

  Object.entries(effectiveness).forEach(([type, value]) => {
    if (value === 4) groups["4× Weak"].push(type);
    else if (value === 2) groups["2× Weak"].push(type);
    else if (value === 1) groups["Neutral"].push(type);
    else if (value === 0.5) groups["½× Resist"].push(type);
    else if (value === 0.25) groups["¼× Resist"].push(type);
    else if (value === 0) groups["Immune"].push(type);
  });

    for (const [label, list] of Object.entries(groups)) {
    if (list.length === 0) continue;

    const row = document.createElement("div");
    row.className = "type-row";

    const title = document.createElement("span");
    title.className = "type-label";
    title.textContent = label;

    const chips = document.createElement("div");
    chips.className = "type-chips";

    list.forEach(type => {
        const span = document.createElement("span");
        span.className = `type ${type}`;
        span.textContent = capitalize(type);
        span.dataset.searchAttribute = "type";
        span.dataset.searchValue = type;
        chips.appendChild(span);
    });

    row.append(title, chips);
    container.appendChild(row);
    }

}
