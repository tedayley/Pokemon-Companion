const advancedSearchCache = new Map();
const advancedSearchPending = new Map();
const advancedOptionListPromises = new Map();
const advancedStatKeys = ["total", "hp", "attack", "defense", "special-attack", "special-defense", "speed"];

function getPokemonGeneration(speciesId) {
  if (speciesId <= 151) return 1;
  if (speciesId <= 251) return 2;
  if (speciesId <= 386) return 3;
  if (speciesId <= 493) return 4;
  if (speciesId <= 649) return 5;
  if (speciesId <= 721) return 6;
  if (speciesId <= 809) return 7;
  if (speciesId <= 905) return 8;
  return 9;
}

function createAdvancedSearchRecord(data) {
  const speciesId = Number(data.species.url.split("/").filter(Boolean).at(-1));
  const stats = Object.fromEntries(data.stats.map(entry => [entry.stat.name, entry.base_stat]));
  return {
    name: data.name,
    id: data.id,
    speciesId,
    generation: getPokemonGeneration(speciesId),
    types: data.types.map(entry => entry.type.name),
    stats,
    totalStats: Object.values(stats).reduce((total, value) => total + value, 0),
    moves: data.moves.map(entry => entry.move.name),
    abilities: data.abilities.map(entry => entry.ability.name),
    image: data.sprites?.front_default || data.sprites?.other?.["official-artwork"]?.front_default || ""
  };
}

function getAdvancedSearchRecord(name) {
  if (advancedSearchCache.has(name)) return Promise.resolve(advancedSearchCache.get(name));
  if (advancedSearchPending.has(name)) return advancedSearchPending.get(name);

  const request = fetchJson(`${API_BASE}/pokemon/${name}`)
    .then(data => {
      if (!data) return null;
      const record = createAdvancedSearchRecord(data);
      advancedSearchCache.set(name, record);
      return record;
    })
    .catch(error => {
      console.error(`Advanced search data error for ${name}:`, error);
      return null;
    })
    .finally(() => advancedSearchPending.delete(name));

  advancedSearchPending.set(name, request);
  return request;
}

function loadAdvancedOptionList(resource) {
  if (!advancedOptionListPromises.has(resource)) {
    const limit = resource === "move" ? 2000 : 1000;
    const request = fetchJson(`${API_BASE}/${resource}?limit=${limit}`)
      .then(data => data?.results?.map(entry => entry.name) || [])
      .catch(error => {
        console.error(`${resource} list load error:`, error);
        return [];
      });
    advancedOptionListPromises.set(resource, request);
  }
  return advancedOptionListPromises.get(resource);
}

function setupAdvancedTokenPicker(inputId, suggestionsId, tokensId, resource, onSelectionChange) {
  const input = document.getElementById(inputId);
  const suggestions = document.getElementById(suggestionsId);
  const tokens = document.getElementById(tokensId);
  const selected = new Set();
  let highlightedIndex = -1;
  if (!input || !suggestions || !tokens) return { selected, clear() {} };

  function hideSuggestions() {
    suggestions.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    highlightedIndex = -1;
  }

  function renderTokens() {
    const fragment = document.createDocumentFragment();
    selected.forEach(name => {
      const chip = document.createElement("span");
      chip.className = "search-token-chip";
      const label = document.createElement("span");
      label.textContent = capitalize(name);
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "×";
      removeButton.setAttribute("aria-label", `Remove ${name.replace(/-/g, " ")}`);
      removeButton.addEventListener("click", () => {
        selected.delete(name);
        renderTokens();
        onSelectionChange();
      });
      chip.append(label, removeButton);
      fragment.appendChild(chip);
    });
    tokens.replaceChildren(fragment);
  }

  function addToken(name) {
    if (selected.has(name)) {
      input.value = "";
      hideSuggestions();
      return;
    }
    selected.add(name);
    input.value = "";
    renderTokens();
    hideSuggestions();
    onSelectionChange();
    input.focus();
  }

  function updateHighlight() {
    const options = Array.from(suggestions.querySelectorAll(".token-suggestion"));
    options.forEach((option, index) => {
      option.classList.toggle("highlighted", index === highlightedIndex);
      option.setAttribute("aria-selected", String(index === highlightedIndex));
      if (index === highlightedIndex) {
        input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
      }
    });
  }

  async function renderSuggestions() {
    const queryText = input.value.trim();
    const query = normalizeName(queryText);
    if (!query) {
      hideSuggestions();
      return;
    }

    suggestions.hidden = false;
    input.setAttribute("aria-expanded", "true");
    suggestions.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "token-suggestion-message";
    loading.textContent = `Loading ${resource === "move" ? "moves" : "abilities"}...`;
    suggestions.appendChild(loading);

    const names = await loadAdvancedOptionList(resource);
    if (normalizeName(input.value.trim()) !== query) return;

    let matches = names.filter(name => normalizeName(name).includes(query)).slice(0, 8);
    if (matches.length === 0) {
      matches = names
        .map(name => ({ name, distance: boundedPrefixEditDistance(query, normalizeName(name), 2) }))
        .filter(match => match.distance <= 2)
        .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name))
        .slice(0, 8)
        .map(match => match.name);
    }

    const fragment = document.createDocumentFragment();
    matches.filter(name => !selected.has(name)).forEach((name, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `${suggestionsId}-option-${index}`;
      option.className = "token-suggestion";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.textContent = capitalize(name);
      option.addEventListener("click", () => addToken(name));
      fragment.appendChild(option);
    });
    if (fragment.childNodes.length === 0) {
      const message = document.createElement("div");
      message.className = "token-suggestion-message";
      message.textContent = matches.length ? "Already selected" : "No matching entries";
      fragment.appendChild(message);
    }
    suggestions.replaceChildren(fragment);
    highlightedIndex = -1;
  }

  input.addEventListener("focus", renderSuggestions);
  input.addEventListener("input", renderSuggestions);
  input.addEventListener("keydown", event => {
    const options = suggestions.querySelectorAll(".token-suggestion");
    if (event.key === "ArrowDown" && options.length) {
      event.preventDefault();
      highlightedIndex = (highlightedIndex + 1) % options.length;
      updateHighlight();
    } else if (event.key === "ArrowUp" && options.length) {
      event.preventDefault();
      highlightedIndex = (highlightedIndex - 1 + options.length) % options.length;
      updateHighlight();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (options.length) options[highlightedIndex >= 0 ? highlightedIndex : 0].click();
    } else if (event.key === "Escape") {
      hideSuggestions();
    }
  });
  document.addEventListener("click", event => {
    if (!input.closest(".token-picker").contains(event.target)) hideSuggestions();
  });

  return {
    selected,
    clear() {
      selected.clear();
      input.value = "";
      renderTokens();
      hideSuggestions();
    }
  };
}

function setupAdvancedSearch() {
  const form = document.getElementById("advancedSearchForm");
  const status = document.getElementById("advancedSearchStatus");
  const resultsContainer = document.getElementById("advancedSearchResults");
  const clearButton = document.getElementById("clearAdvancedSearch");
  if (!form || !status || !resultsContainer) return;

  let searchRequestId = 0;
  let hasSearched = false;
  let searchTimer = null;
  const movePicker = setupAdvancedTokenPicker("advancedMoveInput", "advancedMoveSuggestions", "advancedMoveTokens", "move", scheduleDynamicSearch);
  const abilityPicker = setupAdvancedTokenPicker("advancedAbilityInput", "advancedAbilitySuggestions", "advancedAbilityTokens", "ability", scheduleDynamicSearch);

  function readFilters() {
    const formData = new FormData(form);
    return {
      generations: new Set(formData.getAll("generation").map(Number)),
      classifications: new Set(formData.getAll("classification")),
      types: new Set(formData.getAll("type")),
      moves: new Set(movePicker.selected),
      moveMatch: String(formData.get("moveMatch") || "any"),
      abilities: new Set(abilityPicker.selected),
      abilityMatch: String(formData.get("abilityMatch") || "any"),
      statRanges: advancedStatKeys.map(stat => {
        const minimum = formData.get(`stat-${stat}-min`);
        const maximum = formData.get(`stat-${stat}-max`);
        return {
          stat,
          minimum: minimum === "" ? null : Number(minimum),
          maximum: maximum === "" ? null : Number(maximum)
        };
      }).filter(range => range.minimum !== null || range.maximum !== null)
    };
  }

  function hasFilters(filters) {
    return (filters.generations.size > 0 && filters.generations.size < 9) ||
      (filters.classifications.size > 0 && filters.classifications.size < 3) ||
      (filters.types.size > 0 && filters.types.size < 18) ||
      filters.moves.size > 0 || filters.abilities.size > 0 || filters.statRanges.length > 0;
  }

  function matchesRecord(record, filters) {
    if (filters.generations.size > 0 && filters.generations.size < 9 && !filters.generations.has(record.generation)) return false;
    if (filters.types.size > 0 && filters.types.size < 18 && !record.types.some(type => filters.types.has(type))) return false;

    const moveMatch = filters.moveMatch === "all"
      ? Array.from(filters.moves).every(move => record.moves.includes(move))
      : Array.from(filters.moves).some(move => record.moves.includes(move));
    if (filters.moves.size > 0 && !moveMatch) return false;

    const abilityMatch = filters.abilityMatch === "all"
      ? Array.from(filters.abilities).every(ability => record.abilities.includes(ability))
      : Array.from(filters.abilities).some(ability => record.abilities.includes(ability));
    if (filters.abilities.size > 0 && !abilityMatch) return false;

    for (const range of filters.statRanges) {
      const statValue = range.stat === "total" ? record.totalStats : record.stats[range.stat];
      if (range.minimum !== null && statValue < range.minimum) return false;
      if (range.maximum !== null && statValue > range.maximum) return false;
    }
    return true;
  }

  async function matchesClassification(record, filters) {
    if (filters.classifications.size === 0 || filters.classifications.size === 3) return true;

    if (!record.classification) {
      try {
        const species = await fetchJson(`${API_BASE}/pokemon-species/${record.speciesId}`);
        record.classification = species?.is_legendary ? "legendary" : species?.is_mythical ? "mythical" : "regular";
      } catch (error) {
        console.error(`Classification lookup error for ${record.name}:`, error);
        record.classification = "unknown";
      }
    }
    return filters.classifications.has(record.classification);
  }

  function renderResults(records) {
    const fragment = document.createDocumentFragment();
    records.forEach(record => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "advanced-search-result";
      button.setAttribute("aria-label", `View ${record.name}, National Pokédex ${record.speciesId}`);

      if (record.image) {
        const image = document.createElement("img");
        image.src = record.image;
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        button.appendChild(image);
      }

      const text = document.createElement("span");
      text.className = "advanced-search-result-copy";
      text.textContent = `#${String(record.speciesId).padStart(4, "0")} ${capitalize(record.name)} · ${record.types.map(capitalize).join(" / ")} · BST ${record.totalStats}`;
      button.appendChild(text);
      button.addEventListener("click", () => {
        document.getElementById("pokemonSearch").value = capitalize(record.name);
        document.querySelector('.tab[data-tab="overview"]')?.click();
        loadPokemon(
          record.name,
          document.getElementById("pokemonName"),
          document.getElementById("dexNumber"),
          document.getElementById("pokemonImage"),
          document.getElementById("pokemonShinyImage"),
          document.getElementById("pokemonTypes"),
          document.getElementById("statsList"),
          document.getElementById("learnsetTable")
        );
      });
      fragment.appendChild(button);
    });
    resultsContainer.replaceChildren(fragment);
  }

  async function runSearch() {
    const requestId = ++searchRequestId;
    const filters = readFilters();
    resultsContainer.replaceChildren();

    for (const range of filters.statRanges) {
      if (range.minimum !== null && range.maximum !== null && range.minimum > range.maximum) {
        status.textContent = `Minimum ${range.stat.replace(/-/g, " ")} must not exceed its maximum.`;
        return;
      }
    }
    if (!hasFilters(filters)) {
      status.textContent = "Choose at least one filter value to narrow the Pokédex.";
      return;
    }

    if (!pokemonCache.length) await loadPokemonList();
    const names = pokemonCache;
    if (requestId !== searchRequestId) return;
    if (names.length === 0) {
      status.textContent = "Pokédex data is unavailable. Check your connection and try again.";
      return;
    }

    let nextIndex = 0;
    let checked = 0;
    const matches = [];
    const concurrency = 6;
    status.textContent = `Searching ${names.length} Pokémon...`;

    async function worker() {
      while (requestId === searchRequestId && nextIndex < names.length) {
        const index = nextIndex++;
        const record = await getAdvancedSearchRecord(names[index]);
        if (!record) {
          checked++;
          continue;
        }

        if (matchesRecord(record, filters) && await matchesClassification(record, filters)) {
          matches.push(record);
        }

        checked++;
        if (checked % 20 === 0 && requestId === searchRequestId) {
          status.textContent = `Checked ${checked} of ${names.length} · ${matches.length} found`;
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } catch (error) {
      console.error("Advanced search failed:", error);
      if (requestId === searchRequestId) status.textContent = "Search failed. Check your connection and try again.";
      return;
    }
    if (requestId !== searchRequestId) return;

    matches.sort((left, right) => left.speciesId - right.speciesId);
    renderResults(matches);
    if (matches.length === 0) {
      status.textContent = `No matches after checking ${checked} Pokémon.`;
    } else {
      status.textContent = `Found all ${matches.length} match${matches.length === 1 ? "" : "es"} · checked ${checked} Pokémon.`;
    }
  }

  function scheduleDynamicSearch() {
    if (!hasSearched) return;
    searchRequestId++;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = window.setTimeout(runSearch, 350);
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    hasSearched = true;
    runSearch();
  });
  form.addEventListener("input", event => {
    if (event.target.id !== "advancedMoveInput" && event.target.id !== "advancedAbilityInput") {
      scheduleDynamicSearch();
    }
  });
  form.addEventListener("change", event => {
    if (event.target.id !== "advancedMoveInput" && event.target.id !== "advancedAbilityInput") {
      scheduleDynamicSearch();
    }
  });

  form.querySelectorAll("[data-check-group]").forEach(button => {
    button.addEventListener("click", () => {
      const checked = button.dataset.checkState === "all";
      form.querySelectorAll(`input[name="${button.dataset.checkGroup}"]`).forEach(input => {
        input.checked = checked;
      });
      scheduleDynamicSearch();
    });
  });

  clearButton?.addEventListener("click", () => {
    searchRequestId++;
    if (searchTimer) clearTimeout(searchTimer);
    hasSearched = false;
    form.reset();
    movePicker.clear();
    abilityPicker.clear();
    resultsContainer.replaceChildren();
    status.textContent = "";
  });
}

document.addEventListener("DOMContentLoaded", setupAdvancedSearch);