const advancedSearchCache = new Map();
const advancedSearchPending = new Map();
const advancedSpeciesPending = new Map();
const advancedEvolutionStagesPending = new Map();
const advancedOptionListPromises = new Map();
const advancedStatKeys = ["total", "hp", "attack", "defense", "special-attack", "special-defense", "speed"];
let advancedSearchIndexPromise;

async function loadAdvancedResourceList(resource) {
  const metadata = await fetchJson(`${API_BASE}/${resource}?limit=1`);
  if (!Number.isFinite(metadata?.count)) return null;
  const data = await fetchJson(`${API_BASE}/${resource}?limit=${metadata.count}`);
  return data?.results || null;
}

function loadAdvancedSearchIndex() {
  if (!advancedSearchIndexPromise) {
    advancedSearchIndexPromise = (async () => {
      const [pokemonEntries, speciesEntries, generationEntries, regionEntries] = await Promise.all([
        loadAdvancedResourceList("pokemon"),
        loadAdvancedResourceList("pokemon-species"),
        loadAdvancedResourceList("generation"),
        loadAdvancedResourceList("region")
      ]);
      if (!pokemonEntries || !speciesEntries || !generationEntries || !regionEntries) return null;

      const generationDetails = await Promise.all(generationEntries.map(entry => fetchJson(entry.url)));
      const generationBySpecies = new Map();
      const generations = generationDetails
        .map((generation, index) => ({
          id: Number(generationEntries[index].url.split("/").filter(Boolean).at(-1)),
          species: generation?.pokemon_species || []
        }))
        .filter(generation => Number.isFinite(generation.id))
        .sort((left, right) => left.id - right.id);

      generations.forEach(generation => {
        generation.species.forEach(species => generationBySpecies.set(species.name, generation.id));
      });

      const speciesNames = new Set(speciesEntries.map(entry => entry.name));
      const searchableSpeciesNames = Array.from(speciesNames).sort((left, right) => right.length - left.length);
      const variantCounts = new Map();
      const variantTagsByPokemon = new Map();
      const variantExamplesByTag = new Map();

      pokemonEntries.forEach(entry => {
        if (speciesNames.has(entry.name)) return;
        const speciesName = searchableSpeciesNames.find(name => entry.name.startsWith(`${name}-`));
        if (!speciesName) return;
        const tags = entry.name.slice(speciesName.length + 1).split("-").filter(Boolean);
        variantTagsByPokemon.set(entry.name, tags);
        const primaryTag = tags[0];
        if (!primaryTag) return;
        variantCounts.set(primaryTag, (variantCounts.get(primaryTag) || 0) + 1);
        if (!variantExamplesByTag.has(primaryTag)) variantExamplesByTag.set(primaryTag, entry.name);
      });

      const regionNames = new Set(regionEntries.map(entry => entry.name));
      const regionalCandidates = Array.from(regionNames)
        .filter(tag => variantExamplesByTag.has(tag))
        .map(tag => [tag, variantExamplesByTag.get(tag)]);
      const regionalFormDetails = await Promise.all(regionalCandidates.map(async ([tag, name]) => ({
        tag,
        form: await fetchJson(`${API_BASE}/pokemon-form/${name}`).catch(() => null)
      })));
      const regionalTags = new Set();
      regionalFormDetails.forEach(({ tag, form }) => {
        const englishName = form?.form_names?.find(entry => entry.language.name === "en")?.name || "";
        if (/^[A-Z][a-z]+(?:ian|ean|an) Form(?:\b|$)/i.test(englishName)) regionalTags.add(tag);
      });
      const formCandidates = Array.from(variantCounts)
        .filter(([tag, count]) => count >= 3 && !regionalTags.has(tag))
        .map(([tag]) => [tag, variantExamplesByTag.get(tag)]);
      const formDetails = await Promise.all(formCandidates.map(async ([tag, name]) => ({
        tag,
        form: await fetchJson(`${API_BASE}/pokemon-form/${name}`).catch(() => null)
      })));
      const megaTags = new Set();
      formDetails.forEach(({ tag, form }) => {
        if (form?.is_mega) megaTags.add(tag);
      });

      return {
        pokemonNames: pokemonEntries.map(entry => entry.name),
        generationBySpecies,
        generations: generations.map(({ id }) => ({ id })),
        variantTagsByPokemon,
        regionalTags,
        megaTags
      };
    })().catch(error => {
      console.error("Advanced search index load error:", error);
      return null;
    });
  }
  return advancedSearchIndexPromise;
}

function createAdvancedSearchRecord(data, index) {
  const speciesId = Number(data.species.url.split("/").filter(Boolean).at(-1));
  const speciesName = data.species.name;
  const variantTags = index.variantTagsByPokemon.get(data.name) || [];
  const regionalRegions = variantTags.filter(tag => index.regionalTags.has(tag));
  const stats = Object.fromEntries(data.stats.map(entry => [entry.stat.name, entry.base_stat]));
  return {
    name: data.name,
    id: data.id,
    speciesId,
    speciesName,
    formTags: variantTags,
    generation: index.generationBySpecies.get(speciesName),
    regionalRegions,
    isMega: variantTags.some(tag => index.megaTags.has(tag)),
    isGenderVariant: variantTags.includes("male") || variantTags.includes("female") || /-(male|female)$/.test(data.name),
    types: data.types.map(entry => entry.type.name),
    stats,
    totalStats: Object.values(stats).reduce((total, value) => total + value, 0),
    moves: data.moves.map(entry => entry.move.name),
    abilities: data.abilities.map(entry => entry.ability.name),
    image: data.sprites?.front_default || data.sprites?.other?.["official-artwork"]?.front_default || ""
  };
}

function getAdvancedSearchRecord(name, index) {
  if (advancedSearchCache.has(name)) return Promise.resolve(advancedSearchCache.get(name));
  if (advancedSearchPending.has(name)) return advancedSearchPending.get(name);

  const request = fetchJson(`${API_BASE}/pokemon/${name}`)
    .then(data => {
      if (!data) return null;
      const record = createAdvancedSearchRecord(data, index);
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

function getAdvancedSpeciesData(speciesId) {
  if (!advancedSpeciesPending.has(speciesId)) {
    const request = fetchJson(`${API_BASE}/pokemon-species/${speciesId}`)
      .catch(error => {
        console.error(`Advanced species data error for ${speciesId}:`, error);
        return null;
      });
    advancedSpeciesPending.set(speciesId, request);
  }
  return advancedSpeciesPending.get(speciesId);
}

function getAdvancedEvolutionStages(chainUrl) {
  if (!chainUrl) return Promise.resolve(null);
  if (!advancedEvolutionStagesPending.has(chainUrl)) {
    const request = fetchJson(chainUrl)
      .then(data => {
        if (!data?.chain) return null;
        const stageBySpecies = new Map();
        let totalStages = 0;

        function visitChain(chainNode, stage) {
          stageBySpecies.set(chainNode.species.name, {
            stage,
            isFinal: chainNode.evolves_to.length === 0
          });
          totalStages = Math.max(totalStages, stage);
          chainNode.evolves_to.forEach(nextNode => visitChain(nextNode, stage + 1));
        }

        visitChain(data.chain, 1);
        return { stageBySpecies, totalStages };
      })
      .catch(error => {
        console.error("Evolution stage data error:", error);
        return null;
      });
    advancedEvolutionStagesPending.set(chainUrl, request);
  }
  return advancedEvolutionStagesPending.get(chainUrl);
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
      chip.dataset.searchAttribute = resource;
      chip.dataset.searchValue = name;
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
    select(name) {
      selected.clear();
      selected.add(name);
      input.value = "";
      renderTokens();
      hideSuggestions();
    },
    clear() {
      selected.clear();
      input.value = "";
      renderTokens();
      hideSuggestions();
    }
  };
}

function renderAdvancedSearchOptions(index) {
  const generationContainer = document.getElementById("advancedGenerationToggles");
  const regionalContainer = document.getElementById("advancedRegionalToggles");
  if (generationContainer) {
    const fragment = document.createDocumentFragment();
    index.generations.forEach(generation => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "generation";
      input.value = String(generation.id);
      input.checked = true;
      input.defaultChecked = true;
      input.dataset.searchAttribute = "generation";
      input.dataset.searchValue = String(generation.id);
      label.append(input, document.createTextNode(` Gen ${generation.id}`));
      fragment.appendChild(label);
    });
    generationContainer.replaceChildren(fragment);
  }
  if (regionalContainer) {
    const fragment = document.createDocumentFragment();
    Array.from(index.regionalTags).sort((left, right) => left.localeCompare(right)).forEach(region => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "variant";
      input.value = `regional:${region}`;
      input.dataset.searchAttribute = "variant";
      input.dataset.searchValue = `regional:${region}`;
      label.append(input, document.createTextNode(`${capitalize(region)} regional`));
      fragment.appendChild(label);
    });
    regionalContainer.replaceChildren(fragment);
  }
}

function setupAdvancedSearch() {
  const form = document.getElementById("advancedSearchForm");
  const status = document.getElementById("advancedSearchStatus");
  const resultsContainer = document.getElementById("advancedSearchResults");
  const clearButton = document.getElementById("clearAdvancedSearch");
  const randomButton = document.getElementById("randomAdvancedSearch");
  const randomMultipleToggle = document.getElementById("advancedRandomMultiple");
  const randomCountInput = document.getElementById("advancedRandomCount");
  const evolutionLengthToggle = document.getElementById("advancedEvolutionLengthToggle");
  const evolutionLengthInput = document.getElementById("advancedEvolutionLength");
  if (!form || !status || !resultsContainer) return;

  let searchRequestId = 0;
  let hasSearched = false;
  let searchTimer = null;
  status.textContent = "Loading search filters from PokéAPI...";
  const indexPromise = loadAdvancedSearchIndex().then(index => {
    if (index) {
      renderAdvancedSearchOptions(index);
      status.textContent = "";
    } else {
      status.textContent = "Pokédex data is unavailable. Check your connection and try again.";
    }
    return index;
  });
  const movePicker = setupAdvancedTokenPicker("advancedMoveInput", "advancedMoveSuggestions", "advancedMoveTokens", "move", scheduleDynamicSearch);
  const abilityPicker = setupAdvancedTokenPicker("advancedAbilityInput", "advancedAbilitySuggestions", "advancedAbilityTokens", "ability", scheduleDynamicSearch);

  function readFilters() {
    const formData = new FormData(form);
    return {
      generations: new Set(formData.getAll("generation").map(Number)),
      classifications: new Set(formData.getAll("classification")),
      variants: new Set(formData.getAll("variant")),
      stages: new Set(formData.getAll("stage")),
      pokemon: String(formData.get("pokemon") || ""),
      formTag: String(formData.get("formTag") || ""),
      evolutionLength: formData.get("evolutionLengthEnabled") === "on"
        ? Number(formData.get("evolutionLength"))
        : null,
      types: new Set(formData.getAll("type")),
      excludeTypes: formData.get("excludeTypes") === "on",
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

  function hasFilters(filters, index, typeCount) {
    return filters.generations.size < index.generations.length ||
      filters.classifications.size < 3 ||
      (filters.excludeTypes ? filters.types.size > 0 : filters.types.size < typeCount) ||
      filters.variants.size > 0 ||
      filters.stages.size > 0 || filters.evolutionLength !== null ||
      filters.pokemon !== "" || filters.formTag !== "" ||
      filters.moves.size > 0 || filters.abilities.size > 0 || filters.statRanges.length > 0;
  }

  function matchesRecord(record, filters, index, typeCount) {
    if (filters.generations.size < index.generations.length && !filters.generations.has(record.generation)) return false;
    if (filters.pokemon && record.name !== filters.pokemon) return false;

    const matchesType = record.types.some(type => filters.types.has(type));
    if (filters.excludeTypes ? matchesType : filters.types.size < typeCount && !matchesType) return false;

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
    if (filters.classifications.size === 3) return true;
    if (filters.classifications.size === 0) return false;

    if (!record.classification) {
      const species = await getAdvancedSpeciesData(record.speciesId);
      record.classification = species?.is_legendary ? "legendary" : species?.is_mythical ? "mythical" : species ? "regular" : "unknown";
    }
    return filters.classifications.has(record.classification);
  }

  async function matchesVariant(record, filters) {
    if (filters.formTag && !record.formTags.includes(filters.formTag)) return false;
    if (filters.variants.size === 0) return true;
    const selectedRegions = Array.from(filters.variants)
      .filter(variant => variant.startsWith("regional:"))
      .map(variant => variant.slice("regional:".length));
    if (record.regionalRegions.some(region => selectedRegions.includes(region))) return true;
    if (filters.variants.has("mega") && record.isMega) return true;
    if (filters.variants.has("gmax") && record.formTags.includes("gmax")) return true;
    if (filters.variants.has("gender") && record.isGenderVariant) return true;
    if (!filters.variants.has("paradox")) return false;

    const species = await getAdvancedSpeciesData(record.speciesId);
    return species?.genera?.some(entry => entry.language.name === "en" && entry.genus === "Paradox Pokémon") || false;
  }

  async function matchesStages(record, filters) {
    if (filters.stages.size === 0 && filters.evolutionLength === null) return true;
    const species = await getAdvancedSpeciesData(record.speciesId);
    const evolutionStages = await getAdvancedEvolutionStages(species?.evolution_chain?.url);
    const speciesStage = evolutionStages?.stageBySpecies.get(record.speciesName);
    if (!speciesStage) return false;
    if (filters.evolutionLength !== null && evolutionStages.totalStages !== filters.evolutionLength) return false;
    if (filters.stages.size === 0) return true;
    return filters.stages.has(String(speciesStage.stage)) ||
      (filters.stages.has("final") && speciesStage.isFinal);
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
      text.append(document.createTextNode(`#${String(record.speciesId).padStart(4, "0")} `));
      const pokemonName = document.createElement("span");
      pokemonName.textContent = capitalize(record.name);
      pokemonName.dataset.searchAttribute = "pokemon";
      pokemonName.dataset.searchValue = record.name;
      text.append(pokemonName, document.createTextNode(" · "));
      record.types.forEach((type, index) => {
        const typeLabel = document.createElement("span");
        typeLabel.textContent = capitalize(type);
        typeLabel.dataset.searchAttribute = "type";
        typeLabel.dataset.searchValue = type;
        text.append(typeLabel);
        if (index < record.types.length - 1) text.append(document.createTextNode(" / "));
      });
      text.append(document.createTextNode(" · BST "));
      const totalStats = document.createElement("span");
      totalStats.textContent = String(record.totalStats);
      totalStats.dataset.searchAttribute = "stat";
      totalStats.dataset.searchValue = "total";
      totalStats.dataset.searchExactValue = String(record.totalStats);
      text.append(totalStats);
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

  async function runSearch(randomPick = false, randomPickCount = 1) {
    const requestId = ++searchRequestId;
    const index = await indexPromise;
    if (requestId !== searchRequestId) return;
    if (!index) {
      status.textContent = "Pokédex data is unavailable. Check your connection and try again.";
      return;
    }
    const filters = readFilters();
    const typeCount = form.querySelectorAll('input[name="type"]').length;
    resultsContainer.replaceChildren();

    for (const range of filters.statRanges) {
      if (range.minimum !== null && range.maximum !== null && range.minimum > range.maximum) {
        status.textContent = `Minimum ${range.stat.replace(/-/g, " ")} must not exceed its maximum.`;
        return;
      }
    }
    if (filters.evolutionLength !== null &&
        (!Number.isInteger(filters.evolutionLength) || filters.evolutionLength < 1 || filters.evolutionLength > 10)) {
      status.textContent = "Evolution line length must be between 1 and 10 stages.";
      return;
    }
    if (!randomPick && !hasFilters(filters, index, typeCount)) {
      status.textContent = "Choose at least one filter value to narrow the Pokédex.";
      return;
    }

    const names = index.pokemonNames;
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
        const pokemonIndex = nextIndex++;
        const record = await getAdvancedSearchRecord(names[pokemonIndex], index);
        if (!record) {
          checked++;
          continue;
        }

        if (matchesRecord(record, filters, index, typeCount) &&
          await matchesClassification(record, filters) &&
          await matchesVariant(record, filters) &&
          await matchesStages(record, filters)) {
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

    matches.sort((left, right) => left.speciesId - right.speciesId || left.name.localeCompare(right.name));
    if (randomPick && matches.length > 0) {
      const randomPool = matches.slice();
      const picks = [];
      const pickCount = Math.min(randomPickCount, randomPool.length);
      for (let index = 0; index < pickCount; index++) {
        const chosenIndex = Math.floor(Math.random() * randomPool.length);
        picks.push(randomPool.splice(chosenIndex, 1)[0]);
      }
      renderResults(picks);
      status.textContent = `Random picks: ${picks.length} of ${matches.length} matches.`;
      return;
    }
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
  randomButton?.addEventListener("click", () => {
    hasSearched = true;
    const requestedCount = randomMultipleToggle?.checked ? Number(randomCountInput?.value) : 1;
    const maximum = Number(randomCountInput?.max) || 50;
    const count = Math.max(1, Math.min(maximum, Math.floor(requestedCount) || 1));
    runSearch(true, count);
  });
  randomMultipleToggle?.addEventListener("change", () => {
    if (randomCountInput) randomCountInput.disabled = !randomMultipleToggle.checked;
  });
  evolutionLengthToggle?.addEventListener("change", () => {
    if (evolutionLengthInput) evolutionLengthInput.disabled = !evolutionLengthToggle.checked;
  });
  form.addEventListener("input", event => {
    if (!isTokenPickerInput(event.target) && !isRandomCountInput(event.target)) {
      scheduleDynamicSearch();
    }
  });
  form.addEventListener("change", event => {
    if (!isTokenPickerInput(event.target) && !isRandomCountInput(event.target)) {
      scheduleDynamicSearch();
    }
  });

  function isTokenPickerInput(target) {
    return target.id === "advancedMoveInput" || target.id === "advancedAbilityInput";
  }

  function isRandomCountInput(target) {
    return target.id === "advancedRandomMultiple" || target.id === "advancedRandomCount";
  }

  form.querySelectorAll("[data-check-group]").forEach(button => {
    button.addEventListener("click", () => {
      const checked = button.dataset.checkState === "all";
      form.querySelectorAll(`input[name="${button.dataset.checkGroup}"]`).forEach(input => {
        input.checked = checked;
      });
      scheduleDynamicSearch();
    });
  });

  document.addEventListener("advanced-search-attribute", async event => {
    let { attribute, value, exactValue } = event.detail;
    const index = await indexPromise;
    if (!index) return;

    if (attribute === "form") {
      const formTags = index.variantTagsByPokemon.get(value) || [];
      const region = formTags.find(tag => index.regionalTags.has(tag));
      if (region) {
        attribute = "variant";
        value = `regional:${region}`;
      } else if (formTags.some(tag => index.megaTags.has(tag))) {
        attribute = "variant";
        value = "mega";
      } else if (formTags.includes("gmax")) {
        attribute = "variant";
        value = "gmax";
      } else if (formTags.includes("male") || formTags.includes("female")) {
        attribute = "variant";
        value = "gender";
      } else if (formTags.length > 0) {
        attribute = "formTag";
        value = formTags[0];
      } else {
        attribute = "pokemon";
      }
    }

    const filterNames = {
      type: "type",
      stage: "stage",
      variant: "variant",
      generation: "generation",
      classification: "classification"
    };
    const filterName = filterNames[attribute];
    const filterInputs = filterName ? Array.from(form.querySelectorAll(`input[name="${filterName}"]`)) : [];
    const filterInput = filterInputs.find(input => input.value === value);
    if (filterName && !filterInput) return;
    if ((attribute === "move" && !value) || (attribute === "ability" && !value)) return;
    if (attribute === "stat" && (!advancedStatKeys.includes(value) || !Number.isFinite(Number(exactValue)))) return;
    if (attribute === "evolutionLength" && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 10)) return;
    if (attribute === "pokemon" && !form.querySelector("#advancedSearchPokemon")) return;
    if (attribute === "formTag" && !form.querySelector("#advancedSearchFormTag")) return;
    if (!filterName && !["move", "ability", "stat", "pokemon", "formTag", "evolutionLength"].includes(attribute)) return;

    clearButton?.click();
    document.querySelector('.tab[data-tab="advancedsearch"]')?.click();
    if (filterName) {
      filterInputs.forEach(input => {
        input.checked = input === filterInput;
      });
    } else if (attribute === "move") {
      movePicker.select(value);
    } else if (attribute === "ability") {
      abilityPicker.select(value);
    } else if (attribute === "stat") {
      form.querySelector(`[name="stat-${value}-min"]`).value = exactValue;
      form.querySelector(`[name="stat-${value}-max"]`).value = exactValue;
    } else if (attribute === "pokemon") {
      form.querySelector("#advancedSearchPokemon").value = value;
    } else if (attribute === "formTag") {
      form.querySelector("#advancedSearchFormTag").value = value;
    } else if (attribute === "evolutionLength") {
      evolutionLengthToggle.checked = true;
      evolutionLengthInput.disabled = false;
      evolutionLengthInput.value = value;
    }
    form.requestSubmit();
  });

  clearButton?.addEventListener("click", () => {
    searchRequestId++;
    if (searchTimer) clearTimeout(searchTimer);
    hasSearched = false;
    form.reset();
    ["#advancedSearchPokemon", "#advancedSearchFormTag"].forEach(selector => {
      const input = form.querySelector(selector);
      if (!input) return;
      input.defaultValue = "";
      input.value = "";
    });
    if (randomCountInput) randomCountInput.disabled = !randomMultipleToggle?.checked;
    if (evolutionLengthInput) evolutionLengthInput.disabled = !evolutionLengthToggle?.checked;
    movePicker.clear();
    abilityPicker.clear();
    resultsContainer.replaceChildren();
    status.textContent = "";
  });
}

function setupAttributeSearchMenu() {
  const menu = document.getElementById("attributeSearchMenu");
  const action = document.getElementById("attributeSearchAction");
  if (!menu || !action) return;

  let selectedAttribute = null;
  document.addEventListener("contextmenu", event => {
    const taggedTarget = event.target.closest("[data-search-attribute][data-search-value]");
    let attributeData = taggedTarget ? {
      attribute: taggedTarget.dataset.searchAttribute,
      value: taggedTarget.dataset.searchValue,
      exactValue: taggedTarget.dataset.searchExactValue
    } : null;
    if (!attributeData) {
      const optionLabel = event.target.closest("#advancedSearchForm label");
      const control = event.target.closest("#advancedSearchForm input") || optionLabel?.querySelector('input[type="checkbox"]');
      if (control) {
        const statMatch = control.name.match(/^stat-(.+)-(?:min|max)$/);
        if (statMatch && control.value !== "") {
          attributeData = { attribute: "stat", value: statMatch[1], exactValue: control.value };
        } else if (["type", "stage", "variant", "generation", "classification"].includes(control.name)) {
          attributeData = { attribute: control.name, value: control.value };
        } else if (control.name === "evolutionLength" && control.value !== "") {
          attributeData = { attribute: "evolutionLength", value: control.value };
        }
      }
    }
    if (!attributeData) {
      menu.hidden = true;
      return;
    }

    event.preventDefault();
    selectedAttribute = attributeData;
    const attributeLabel = selectedAttribute.attribute === "pokemon" ? "Pokémon" : selectedAttribute.attribute;
    const valueLabel = selectedAttribute.attribute === "stage"
      ? selectedAttribute.value === "final" ? "Final stage" : `Stage ${selectedAttribute.value}`
      : selectedAttribute.attribute === "stat"
        ? `${capitalize(selectedAttribute.value.replace(/-/g, " "))}: ${selectedAttribute.exactValue}`
        : capitalize(selectedAttribute.value.replace(/-/g, " "));
    action.textContent = `Search by ${attributeLabel}: ${valueLabel}`;
    menu.hidden = false;
    menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8))}px`;
    action.focus();
  });

  action.addEventListener("click", () => {
    if (!selectedAttribute) return;
    menu.hidden = true;
    document.dispatchEvent(new CustomEvent("advanced-search-attribute", { detail: selectedAttribute }));
  });

  document.addEventListener("pointerdown", event => {
    if (!menu.contains(event.target)) menu.hidden = true;
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") menu.hidden = true;
  });
}

document.addEventListener("DOMContentLoaded", setupAdvancedSearch);
document.addEventListener("DOMContentLoaded", setupAttributeSearchMenu);