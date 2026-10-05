// ===============================
// POKÉAPI CONFIG
// ===============================
const API_BASE = "https://pokeapi.co/api/v2";

// Cache Pokémon list for autocomplete
let pokemonCache = [];
let pokemonCacheNormalized = [];
const pokemonDataCache = new Map();
const speciesCache = new Map();
const evolutionChainCache = new Map();
const abilityCache = new Map();
const moveCache = new Map();
let activePokemonRequestId = 0;
let evolutionRenderRequestId = 0;
let suggestionTimer = null;
let dropdownFrame = null;
let viewedPokemon = [];
let viewedPokemonIndex = -1;

const CACHE_LIMITS = {
  pokemonData: 80,
  species: 40,
  evolutionChain: 40,
  ability: 60,
  move: 60
};

function getCacheForUrl(url) {
  if (url.includes("/evolution-chain/")) return { cache: evolutionChainCache, limit: CACHE_LIMITS.evolutionChain };
  if (url.includes("/pokemon-species")) return { cache: speciesCache, limit: CACHE_LIMITS.species };
  if (url.includes("/ability/")) return { cache: abilityCache, limit: CACHE_LIMITS.ability };
  if (url.includes("/move/")) return { cache: moveCache, limit: CACHE_LIMITS.move };
  if (url.includes("/pokemon/")) return { cache: pokemonDataCache, limit: CACHE_LIMITS.pokemonData };
  return null;
}

function getCachedValue(cache, key) {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function setCachedValue(cache, key, value, limit) {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= limit) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }

  cache.set(key, value);
  return value;
}

async function fetchJson(url) {
  const cacheInfo = getCacheForUrl(url);
  if (cacheInfo) {
    const cached = getCachedValue(cacheInfo.cache, url);
    if (cached !== undefined) return cached;
  }

  const response = await fetch(url);
  if (!response.ok) return null;

  const data = await response.json();

  if (cacheInfo) {
    setCachedValue(cacheInfo.cache, url, data, cacheInfo.limit);
  }

  return data;
}

// ===============================
// DOMContentLoaded WRAPPER
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  // DOM Elements
  const searchInput = document.getElementById("pokemonSearch");
  const suggestionsBox = document.getElementById("searchSuggestions");
  const pokemonDexEl = document.getElementById("dexNumber");
  const pokemonNameEl = document.getElementById("pokemonName");
  const pokemonImgEl = document.getElementById("pokemonImage");
  const pokemonShinyImgEl = document.getElementById("pokemonShinyImage");
  const pokemonTypesEl = document.getElementById("pokemonTypes");
  const statsContainer = document.getElementById("statsList");
  const learnsetContainer = document.getElementById("learnsetTable");
  const prevBtn = document.getElementById("prevDex");
  const nextBtn = document.getElementById("nextDex");
  const previousViewedBtn = document.getElementById("previousViewed");
  const nextViewedBtn = document.getElementById("nextViewed");

  // Load Pokémon list for autocomplete
  await loadPokemonList();

  // Setup search
  setupSearch(
    searchInput,
    suggestionsBox,
    pokemonNameEl,
    pokemonDexEl,
    pokemonImgEl,
    pokemonShinyImgEl,
    pokemonTypesEl,
    statsContainer,
    learnsetContainer
  );

  // Load default Pokémon
  loadPokemon(
    "zorua",
    pokemonNameEl,
    pokemonDexEl,
    pokemonImgEl,
    pokemonShinyImgEl,
    pokemonTypesEl,
    statsContainer,
    learnsetContainer
  );

  // ✅ ADD NAV LISTENERS HERE
  prevBtn?.addEventListener("click", () => {
    navigateDex(-1);
  });

  nextBtn?.addEventListener("click", () => {
    navigateDex(1);
  });

  previousViewedBtn?.addEventListener("click", () => navigatePokemonHistory(-1));
  nextViewedBtn?.addEventListener("click", () => navigatePokemonHistory(1));
});

// ===============================
// LOAD POKÉMON LIST FOR AUTOCOMPLETE (Future-Proof)
// ===============================
async function loadPokemonList() {
  try {
    const metaData = await fetchJson(`${API_BASE}/pokemon-species?limit=1`);
    if (!metaData) return;

    const totalSpecies = metaData.count;
    const data = await fetchJson(`${API_BASE}/pokemon-species?limit=${totalSpecies}`);

    if (!data?.results) return;

    pokemonCache = data.results.map(p => p.name);
    pokemonCacheNormalized = pokemonCache.map(name => normalizeName(name));
  } catch (err) {
    console.error("Failed to load Pokémon list:", err);
  }
}

function normalizeName(name) {
  return String(name).toLowerCase().replace(/[\s-]/g, "");
}

function boundedEditDistance(left, right, limit) {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;

  let previousRow = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const currentRow = Array(right.length + 1).fill(limit + 1);
    currentRow[0] = leftIndex;
    const start = Math.max(1, leftIndex - limit);
    const end = Math.min(right.length, leftIndex + limit);
    let rowMinimum = currentRow[0];

    for (let rightIndex = start; rightIndex <= end; rightIndex++) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      currentRow[rightIndex] = Math.min(
        previousRow[rightIndex] + 1,
        currentRow[rightIndex - 1] + 1,
        previousRow[rightIndex - 1] + substitutionCost
      );
      rowMinimum = Math.min(rowMinimum, currentRow[rightIndex]);
    }

    if (rowMinimum > limit) return limit + 1;
    previousRow = currentRow;
  }

  return previousRow[right.length];
}

function boundedPrefixEditDistance(query, name, limit) {
  const shortestPrefixLength = Math.max(1, query.length - limit);
  const longestPrefixLength = Math.min(name.length, query.length + limit);
  let closestDistance = limit + 1;

  for (let prefixLength = shortestPrefixLength; prefixLength <= longestPrefixLength; prefixLength++) {
    closestDistance = Math.min(
      closestDistance,
      boundedEditDistance(query, name.slice(0, prefixLength), limit)
    );
    if (closestDistance === 0) break;
  }

  return closestDistance;
}

// ===============================
// SEARCH + AUTOCOMPLETE
// ===============================
function setupSearch(searchInput, suggestionsBox, pokemonNameEl, pokemonDexEl, pokemonImgEl, pokemonShinyImgEl, pokemonTypesEl, statsContainer, learnsetContainer) {
  let selectedIndex = -1; // tracks arrow key selection

  function positionDropdown() {
    const rect = searchInput.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownHeight = suggestionsBox.offsetHeight;

    if (dropdownHeight > spaceBelow && spaceBelow < 200) {
      suggestionsBox.style.top = `-${dropdownHeight + 2}px`;
    } else {
      suggestionsBox.style.top = "100%";
    }
  }

  function scheduleDropdownPosition() {
    if (dropdownFrame) cancelAnimationFrame(dropdownFrame);
    dropdownFrame = requestAnimationFrame(positionDropdown);
  }

  function updateHighlight(items, index) {
    items.forEach((item, i) => {
      item.classList.toggle("highlighted", i === index);
      if (i === index) {
        item.scrollIntoView({ block: "nearest", behavior: "auto" });
      }
    });
  }

  function selectSuggestion(name) {
    searchInput.value = capitalize(name);
    suggestionsBox.innerHTML = "";
    suggestionsBox.style.display = "none";
    loadPokemon(name, pokemonNameEl, pokemonDexEl, pokemonImgEl, pokemonShinyImgEl, pokemonTypesEl, statsContainer, learnsetContainer);
  }

  function renderSuggestions(query) {
    suggestionsBox.innerHTML = "";
    selectedIndex = -1;

    if (!query) {
      suggestionsBox.style.display = "none";
      return;
    }

    const normalizedQuery = normalizeName(query);
    const matches = [];
    for (let index = 0; index < pokemonCacheNormalized.length && matches.length < 8; index++) {
      if (pokemonCacheNormalized[index].includes(normalizedQuery)) {
        matches.push(pokemonCache[index]);
      }
    }

    let isFuzzyMatch = false;
    if (matches.length === 0) {
      const closeMatches = [];
      for (let index = 0; index < pokemonCacheNormalized.length; index++) {
        const normalizedName = pokemonCacheNormalized[index];
        const distance = boundedPrefixEditDistance(normalizedQuery, normalizedName, 2);
        if (distance <= 2) {
          closeMatches.push({ name: pokemonCache[index], distance });
        }
      }

      closeMatches.sort((left, right) =>
        left.distance - right.distance ||
        left.name.localeCompare(right.name)
      );
      matches.push(...closeMatches.slice(0, 8).map(match => match.name));
      isFuzzyMatch = matches.length > 0;
    }

    if (matches.length === 0) {
      suggestionsBox.style.display = "none";
      return;
    }

    const fragment = document.createDocumentFragment();
    suggestionsBox.dataset.matchType = isFuzzyMatch ? "fuzzy" : "direct";

    matches.forEach((name, index) => {
      const div = document.createElement("div");
      div.className = "suggestion";
      div.textContent = capitalize(name.replace(/-/g, " "));
      div.dataset.index = index;
      div.dataset.name = name;
      div.addEventListener("click", () => selectSuggestion(name));
      fragment.appendChild(div);
    });

    suggestionsBox.appendChild(fragment);
    suggestionsBox.style.display = "block";
    scheduleDropdownPosition();
  }

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim().toLowerCase();

    if (suggestionTimer) clearTimeout(suggestionTimer);
    if (!query) {
      suggestionsBox.innerHTML = "";
      suggestionsBox.style.display = "none";
      selectedIndex = -1;
      return;
    }

    suggestionTimer = window.setTimeout(() => renderSuggestions(query), 120);
  });

  searchInput.addEventListener("keydown", (e) => {
    const items = suggestionsBox.querySelectorAll(".suggestion");
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
      updateHighlight(items, selectedIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      updateHighlight(items, selectedIndex);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < items.length) {
        selectSuggestion(items[selectedIndex].dataset.name);
      } else if (items.length > 0 && suggestionsBox.dataset.matchType === "fuzzy") {
        selectSuggestion(items[0].dataset.name);
      } else if (searchInput.value.trim() !== "") {
        loadPokemon(searchInput.value.toLowerCase(), pokemonNameEl, pokemonDexEl, pokemonImgEl, pokemonShinyImgEl, pokemonTypesEl, statsContainer, learnsetContainer);
        suggestionsBox.style.display = "none";
      }
    }
  });

  document.addEventListener("click", (e) => {
    if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
      suggestionsBox.style.display = "none";
    }
  });

  window.addEventListener("resize", scheduleDropdownPosition);
  window.addEventListener("scroll", scheduleDropdownPosition, { passive: true });
}

// ===============================
// LOAD POKÉMON DATA FROM API
// ===============================
async function loadPokemon(name, pokemonNameEl, pokemonDexEl, pokemonImgEl, pokemonShinyImgEl, pokemonTypesEl, statsContainer, learnsetContainer, recordHistory = true) {
  const requestId = ++activePokemonRequestId;
  const normalizedName = name.trim().toLowerCase();

  try {
    let data;
    let species;

    const pokemonUrl = `${API_BASE}/pokemon/${normalizedName}`;
    data = await fetchJson(pokemonUrl);

    if (data) {
      species = await fetchJson(data.species.url);
    } else {
      const speciesUrl = `${API_BASE}/pokemon-species/${normalizedName}`;
      species = await fetchJson(speciesUrl);
      if (!species) throw new Error("Pokémon not found");

      const defaultVariety = species.varieties.find(v => v.is_default);
      if (!defaultVariety) throw new Error("Pokémon form not found");
      data = await fetchJson(defaultVariety.pokemon.url);
    }

    if (!data || !species || requestId !== activePokemonRequestId) return;
    if (recordHistory) recordViewedPokemon(data.name);

    await renderPokemon(
      data,
      species,
      pokemonNameEl,
      pokemonDexEl,
      pokemonImgEl,
      pokemonShinyImgEl,
      pokemonTypesEl,
      statsContainer,
      learnsetContainer,
      requestId
    );
  } catch (err) {
    if (requestId !== activePokemonRequestId) return;
    alert("Pokémon not found");
    console.error(err);
  }
}

function recordViewedPokemon(name) {
  if (viewedPokemon[viewedPokemonIndex] === name) return;

  viewedPokemon = viewedPokemon.slice(0, viewedPokemonIndex + 1);
  viewedPokemon.push(name);
  viewedPokemonIndex = viewedPokemon.length - 1;
  updatePokemonHistoryButtons();
}

function updatePokemonHistoryButtons() {
  const previousViewedBtn = document.getElementById("previousViewed");
  const nextViewedBtn = document.getElementById("nextViewed");
  if (previousViewedBtn) previousViewedBtn.disabled = viewedPokemonIndex <= 0;
  if (nextViewedBtn) nextViewedBtn.disabled = viewedPokemonIndex >= viewedPokemon.length - 1;
}

function navigatePokemonHistory(direction) {
  const nextIndex = viewedPokemonIndex + direction;
  if (nextIndex < 0 || nextIndex >= viewedPokemon.length) return;

  viewedPokemonIndex = nextIndex;
  updatePokemonHistoryButtons();
  loadPokemon(
    viewedPokemon[nextIndex],
    document.getElementById("pokemonName"),
    document.getElementById("dexNumber"),
    document.getElementById("pokemonImage"),
    document.getElementById("pokemonShinyImage"),
    document.getElementById("pokemonTypes"),
    document.getElementById("statsList"),
    document.getElementById("learnsetTable"),
    false
  );
}

async function navigateDex(direction) {
  const dexText = document.getElementById("dexNumber");
  if (!dexText) return;

  const current = parseInt(dexText.textContent.replace("#", "")) || 1;
  const newDex = current + direction;

  if (newDex < 1) return;
  loadPokemon(
    String(newDex),
    document.getElementById("pokemonName"),
    dexText,
    document.getElementById("pokemonImage"),
    document.getElementById("pokemonShinyImage"),
    document.getElementById("pokemonTypes"),
    document.getElementById("statsList"),
    document.getElementById("learnsetTable")
  );
}


// ===============================
// IMAGE PRELOADING
// ===============================
function preloadImage(url) {
  if (!url) return Promise.resolve(null);

  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(url);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function preloadPokemonArtwork(data) {
  const artwork = data?.sprites?.other?.["official-artwork"];
  if (!artwork) return [];

  const urls = [artwork.front_default, artwork.front_shiny].filter(Boolean);
  if (urls.length === 0) return [];

  return Promise.allSettled(urls.map(url => preloadImage(url)));
}

async function preloadAlternateFormArtwork(species) {
  if (!species?.varieties?.length) return [];

  const varietyPromises = species.varieties.map(async variety => {
    if (!variety?.pokemon?.url) return null;

    const varietyData = await fetchJson(variety.pokemon.url);
    if (!varietyData) return null;

    return preloadPokemonArtwork(varietyData);
  });

  return Promise.allSettled(varietyPromises);
}

// ===============================
// RENDER POKÉMON
// ===============================
async function renderPokemon(data, species, pokemonNameEl, pokemonDexEl, pokemonImgEl, pokemonShinyImgEl, pokemonTypesEl, statsContainer, learnsetContainer, requestId) {
  pokemonNameEl.textContent = capitalize(data.name);

  const artwork = data.sprites?.other?.["official-artwork"] || {};
  const defaultImageUrl = artwork.front_default;
  const shinyImageUrl = artwork.front_shiny;

  if (defaultImageUrl) {
    pokemonImgEl.src = defaultImageUrl;
  }

  if (shinyImageUrl) {
    pokemonShinyImgEl.src = shinyImageUrl;
  }

  void preloadPokemonArtwork(data);
  void preloadAlternateFormArtwork(species);

  const formsContainer = document.getElementById("pokemonForms");

  if (formsContainer && species.varieties.length > 1) {
    const fragment = document.createDocumentFragment();

    species.varieties.forEach(v => {
      const btn = document.createElement("button");
      btn.classList.add("form-button", "neon-text");
      btn.textContent = capitalize(
        v.pokemon.name
          .replace(species.name + "-", "")
          .replace(species.name, "Normal")
      );

      btn.addEventListener("click", () => {
        loadPokemon(
          v.pokemon.name,
          pokemonNameEl,
          pokemonDexEl,
          pokemonImgEl,
          pokemonShinyImgEl,
          pokemonTypesEl,
          statsContainer,
          learnsetContainer
        );
      });

      fragment.appendChild(btn);
    });

    formsContainer.replaceChildren(fragment);
  } else if (formsContainer) {
    formsContainer.replaceChildren();
  }

  const typesFragment = document.createDocumentFragment();
  data.types.forEach(t => {
    const span = document.createElement("span");
    span.className = `type ${t.type.name}`;
    span.textContent = capitalize(t.type.name);
    typesFragment.appendChild(span);
  });
  pokemonTypesEl.replaceChildren(typesFragment);

  const pokemonTypes = data.types.map(t => t.type.name);
  renderTypeCalculator(pokemonTypes);

  if (pokemonDexEl) {
    pokemonDexEl.textContent = `#${species.id.toString().padStart(4, "0")}`;
  }

  renderStats(data.stats, statsContainer);

  const abilitiesEl = document.getElementById("pokemonAbilities");
  if (abilitiesEl) {
    const abilityNodes = await Promise.all(
      data.abilities.map(async (abilityEntry) => {
        const span = document.createElement("span");
        span.className = "ability";
        span.textContent = capitalize(abilityEntry.ability.name);

        try {
          const abilityData = await fetchJson(abilityEntry.ability.url);
          const effectEntry = abilityData?.effect_entries?.find(entry => entry.language.name === "en");
          span.dataset.tooltip = effectEntry ? effectEntry.effect : "No description available";
        } catch (err) {
          console.error("Ability fetch error:", err);
          span.dataset.tooltip = "Description unavailable";
        }

        return span;
      })
    );

    const abilitiesFragment = document.createDocumentFragment();
    abilityNodes.forEach((span, index) => {
      abilitiesFragment.appendChild(span);
      if (index < abilityNodes.length - 1) {
        abilitiesFragment.appendChild(document.createTextNode(", "));
      }
    });
    abilitiesEl.replaceChildren(abilitiesFragment);
  }

  renderLearnset(data.moves, learnsetContainer);

  const otherMovesContainer = document.getElementById("otherMovesTable");
  if (otherMovesContainer) {
    renderOtherMoves(data.moves, otherMovesContainer);
  }

  const flavor = species.flavor_text_entries.find(e => e.language.name === "en");
  const flavorTextEl = document.getElementById("flavorText");
  if (flavorTextEl) flavorTextEl.textContent = flavor ? flavor.flavor_text.replace(/\f/g, " ") : "";

  if (species.id) {
    void preloadAdjacentPokemon(species.id);
  }
  if (requestId === activePokemonRequestId) {
    void renderEvolutionLine(species, requestId);
  }
}

function getEvolutionStages(rootEvolution) {
  const stages = [];
  let currentStage = rootEvolution ? [rootEvolution] : [];

  while (currentStage.length > 0) {
    stages.push(currentStage);
    currentStage = currentStage.flatMap(evolution => evolution.evolves_to || []);
  }

  return stages;
}

async function renderEvolutionLine(species, pokemonRequestId) {
  const section = document.getElementById("evolutionSection");
  const stagesContainer = document.getElementById("evolutionStages");
  if (!section || !stagesContainer) return;

  const requestId = ++evolutionRenderRequestId;
  section.hidden = true;
  stagesContainer.replaceChildren();

  if (!species.evolution_chain?.url) return;

  try {
    const evolutionData = await fetchJson(species.evolution_chain.url);
    if (requestId !== evolutionRenderRequestId || pokemonRequestId !== activePokemonRequestId || !evolutionData?.chain) return;

    const stages = getEvolutionStages(evolutionData.chain);
    if (stages.reduce((count, stage) => count + stage.length, 0) < 2) return;

    const fragment = document.createDocumentFragment();
    stages.forEach((stage, index) => {
      const stageRow = document.createElement("div");
      stageRow.className = "evolution-stage";

      const stageLabel = document.createElement("span");
      stageLabel.className = "evolution-stage-label";
      stageLabel.textContent = `Stage ${index + 1}`;
      stageRow.appendChild(stageLabel);

      stage.forEach(evolution => {
        const name = evolution.species.name;
        const button = document.createElement("button");
        const isCurrentSpecies = name === species.name;
        button.type = "button";
        button.className = `evolution-button${isCurrentSpecies ? " active-evolution" : ""}`;
        button.textContent = capitalize(name.replace(/-/g, " "));
        if (isCurrentSpecies) {
          button.disabled = true;
          button.setAttribute("aria-current", "true");
        } else {
          button.addEventListener("click", () => {
            loadPokemon(
              name,
              document.getElementById("pokemonName"),
              document.getElementById("dexNumber"),
              document.getElementById("pokemonImage"),
              document.getElementById("pokemonShinyImage"),
              document.getElementById("pokemonTypes"),
              document.getElementById("statsList"),
              document.getElementById("learnsetTable")
            );
          });
        }
        stageRow.appendChild(button);
      });

      fragment.appendChild(stageRow);
    });

    if (requestId !== evolutionRenderRequestId) return;
    stagesContainer.replaceChildren(fragment);
    section.hidden = false;
  } catch (err) {
    console.error("Evolution chain load error:", err);
  }
}

// ===============================
// RENDER STATS
// ===============================
function renderStats(stats, container) {
  const fragment = document.createDocumentFragment();
  let total = 0;

  stats.forEach(stat => {
    total += stat.base_stat;

    const li = document.createElement("li");
    li.className = "stat-row";
    li.style.display = "flex";
    li.style.alignItems = "center";
    li.style.gap = "10px";

    const label = document.createElement("span");
    label.textContent = formatStatName(stat.stat.name);
    label.style.fontWeight = "bold";
    label.style.fontSize = "0.95rem";
    label.style.width = "100px";
    label.style.color = getStatColor(stat.base_stat);
    label.style.textShadow = `0 0 1px ${getStatColor(stat.base_stat)}, 0 0 1px ${getStatColor(stat.base_stat)}`;

    const value = document.createElement("span");
    value.textContent = stat.base_stat;
    value.style.width = "40px";
    value.style.textAlign = "right";
    value.style.fontWeight = "bold";
    value.style.fontSize = "0.95rem";
    value.style.color = getStatColor(stat.base_stat);
    value.style.textShadow = `0 0 1px ${getStatColor(stat.base_stat)}, 0 0 1px ${getStatColor(stat.base_stat)}`;

    const barContainer = document.createElement("div");
    barContainer.className = "stat-bar-container";
    barContainer.style.flexGrow = "1";

    const bar = document.createElement("div");
    bar.className = "stat-bar";
    const percent = Math.min((stat.base_stat / 255) * 100, 100);
    bar.style.width = percent + "%";
    bar.style.background = getStatColor(stat.base_stat);
    bar.style.boxShadow = `0 0 6px ${getStatColor(stat.base_stat)}`;

    barContainer.appendChild(bar);
    li.append(label, value, barContainer);
    fragment.appendChild(li);
  });

  const MAX_BST = 720;
  const normalized = (total / 6) * 1.2;
  const bstColor = getStatColor(normalized);

  const totalLi = document.createElement("li");
  totalLi.className = "stat-row";
  totalLi.style.display = "flex";
  totalLi.style.alignItems = "center";
  totalLi.style.gap = "10px";
  totalLi.style.marginTop = "8px";
  totalLi.style.borderTop = "1px solid rgba(255,255,255,0.2)";
  totalLi.style.paddingTop = "6px";

  const totalLabel = document.createElement("span");
  totalLabel.textContent = "Base Stat Total";
  totalLabel.style.fontWeight = "bold";
  totalLabel.style.width = "100px";
  totalLabel.style.color = bstColor;
  totalLabel.style.textShadow = `0 0 1px ${bstColor}, 0 0 1px ${bstColor}`;

  const totalValue = document.createElement("span");
  totalValue.textContent = total;
  totalValue.style.width = "40px";
  totalValue.style.textAlign = "right";
  totalValue.style.fontWeight = "bold";
  totalValue.style.color = bstColor;
  totalValue.style.textShadow = `0 0 1px ${bstColor}, 0 0 1px ${bstColor}`;

  const totalBarContainer = document.createElement("div");
  totalBarContainer.className = "stat-bar-container";
  totalBarContainer.style.flexGrow = "1";

  const totalBar = document.createElement("div");
  totalBar.className = "stat-bar";
  const totalPercent = Math.min((total / MAX_BST) * 100, 100);
  totalBar.style.width = totalPercent + "%";
  totalBar.style.background = bstColor;
  totalBar.style.boxShadow = `0 0 6px ${bstColor}`;

  totalBarContainer.appendChild(totalBar);
  totalLi.append(totalLabel, totalValue, totalBarContainer);
  fragment.appendChild(totalLi);

  container.replaceChildren(fragment);
}


// ===============================
// RENDER LEARNSET
// ===============================
function renderLearnset(moves, container) {
  const fragment = document.createDocumentFragment();

  moves
    .map(m => {
      const levelUp = m.version_group_details.find(d => d.move_learn_method.name === "level-up");
      if (!levelUp) return null;
      return { name: m.move.name, level: levelUp.level_learned_at, url: m.move.url};
    })
    .filter(Boolean)
    .sort((a, b) => a.level - b.level)
    .forEach(m => {
      const row = document.createElement("tr");
      const levelTd = document.createElement("td");
      levelTd.textContent = m.level;
      levelTd.classList.add("move-level");

      const moveTd = document.createElement("td");
      moveTd.textContent = capitalize(m.name);
      moveTd.classList.add("move-name");
      attachMoveTooltip(moveTd, m.url);

      row.append(levelTd, moveTd);
      fragment.appendChild(row);
    });

  container.replaceChildren(fragment);
}

// ===============================
// RENDER MoveSET
// ===============================
function renderOtherMoves(moves, container) {
  const seen = new Set();
  const collected = [];

  moves.forEach(m => {
    m.version_group_details.forEach(d => {
      if (d.move_learn_method.name === "level-up") return;

      const key = `${m.move.name}-${d.move_learn_method.name}`;
      if (seen.has(key)) return;
      seen.add(key);

      collected.push({
        method: d.move_learn_method.name,
        moveName: m.move.name,
        moveUrl: m.move.url
      });
    });
  });

  collected.sort((a, b) => {
    if (a.method !== b.method) {
      return a.method.localeCompare(b.method);
    }
    return a.moveName.localeCompare(b.moveName);
  });

  const fragment = document.createDocumentFragment();
  collected.forEach(entry => {
    const row = document.createElement("tr");

    const methodTd = document.createElement("td");
    methodTd.textContent = capitalize(entry.method.replace("-", " "));
    methodTd.classList.add("move-method");

    const moveTd = document.createElement("td");
    moveTd.textContent = capitalize(entry.moveName);
    moveTd.classList.add("move-name");

    attachMoveTooltip(moveTd, entry.moveUrl);

    row.append(methodTd, moveTd);
    fragment.appendChild(row);
  });

  container.replaceChildren(fragment);
}

// ===============================
// Hover moves
// ===============================
async function preloadAdjacentPokemon(currentDex) {
  const neighbors = [currentDex - 1, currentDex + 1].filter(dex => Number.isInteger(dex) && dex > 0);

  await Promise.allSettled(neighbors.map(async dex => {
    const data = await fetchJson(`${API_BASE}/pokemon/${dex}`);
    if (data) {
      await fetchJson(data.species.url);
      await preloadPokemonArtwork(data);
    }
  }));
}

async function attachMoveTooltip(cell, moveUrl) {
  if (moveCache.has(moveUrl)) {
    cell.dataset.tooltip = buildMoveTooltip(moveCache.get(moveUrl));
    return;
  }

  cell.addEventListener("mouseenter", async () => {
    try {
      cell.dataset.tooltip = "Loading...";
      const moveData = await fetchJson(moveUrl);
      if (!moveData) throw new Error("Move data unavailable");
      cell.dataset.tooltip = buildMoveTooltip(moveData);
    } catch (err) {
      console.error("Tooltip error:", err);
      cell.dataset.tooltip = "Move data unavailable.";
    }
  });
}

function buildMoveTooltip(moveData) {
  const power = moveData.power ?? "—";
  const accuracy = moveData.accuracy ?? "—";
  const type = capitalize(moveData.type?.name ?? "unknown");
  const damageClass = capitalize(moveData.damage_class?.name ?? "status");

  const effectEntry = moveData.effect_entries?.find(e => e.language.name === "en");
  let description =
    effectEntry?.effect ||
    effectEntry?.short_effect ||
    "No description available.";

  description = description.replace(
    /\$effect_chance\$?%?/g,
    moveData.effect_chance != null ? `${moveData.effect_chance}%` : ""
  );

  description = description.replace(/\s{2,}/g, " ").trim();

  return `
${type} | ${damageClass}
Power: ${power}
Accuracy: ${accuracy}

${description}
  `.trim();
}


// ===============================
// UTILITIES
// ===============================
function capitalize(str) {
  return str.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function formatStatName(name) {
  return name.replace("special-", "Sp. ").replace("-", " ").toUpperCase();
}

function getStatColor(value) {
  if (value < 50) return "#ff3b3b";     // red
  if (value < 80) return "#ffcc00";     // yellow
  if (value < 120) return "#4cff4c";    // green
  return "#b84cff";                     // purple
}
