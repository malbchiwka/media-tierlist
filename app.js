/**
 * CRIMSON TIER - Media Tierlist Application
 * Handles state, drag-and-drop, online search, manual uploads, filters, and high-res PNG export.
 */

(function () {
  'use strict';

  // --- Storage Key ---
  const STORAGE_KEY = 'crimson_tierlist_state_v1';

  // --- Application State ---
  const state = {
    tiers: [],
    pool: [],
    items: {},
    filter: 'all',          // 'all' | 'movie' | 'anime'
    searchQuery: '',
    poolSort: 'default',    // 'default' | 'alpha' | 'rating' | 'year'
    poolOriginalOrder: []
  };

  // Dragging reference
  let draggedItemId = null;
  let dragSourceTierId = null; // null if from pool
  let isDraggingCard = false;
  let draggedTierId = null;
  let isDraggingTier = false;

  // Detail Modal reference & Cover Changer
  let currentDetailItemId = null;
  let pendingDetailPoster = null;

  // Search Preview reference & Search request counter
  let currentSearchPreviewItem = null;
  let activeSearchId = 0;

  // Compress image file to lightweight poster thumbnail (<60KB) to prevent LocalStorage quota overflow
  function compressImageFile(file, maxWidth = 400, maxHeight = 600, quality = 0.85) {
    return new Promise((resolve) => {
      if (!file || (file.type && !file.type.startsWith('image/'))) {
        return resolve(null);
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let w = img.width;
          let h = img.height;
          if (w <= 0 || h <= 0) {
            return resolve(null);
          }
          if (w > maxWidth || h > maxHeight) {
            const ratio = Math.min(maxWidth / w, maxHeight / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          try {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', quality));
          } catch (err) {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }


  // --- Initialization ---
  function init() {
    loadState();
    bindEvents();
    renderAll();
  }

  // --- State Management & LocalStorage ---
  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.tiers && parsed.items && parsed.pool) {
          state.tiers = parsed.tiers;
          state.items = parsed.items;
          state.pool = parsed.pool;
          state.poolOriginalOrder = [...parsed.pool];
          // Refresh fallbackPosters and update any obsolete poster links with local assets
          const presets = window.TIERLIST_PRESETS || {};
          const allPresets = [...(presets.anime || []), ...(presets.movies || [])];
          allPresets.forEach(p => {
            if (state.items[p.id]) {
              state.items[p.id].fallbackPoster = p.fallbackPoster;
              state.items[p.id].cdnPoster = p.cdnPoster || state.items[p.id].cdnPoster;
              if (!state.items[p.id].isUserCover && (!state.items[p.id].poster || state.items[p.id].poster.includes('images.metahub.space') || state.items[p.id].poster.includes('media.kitsu.app'))) {
                state.items[p.id].poster = p.poster;
              }
            }
          });
          return;
        }
      }
    } catch (e) {
      console.warn('Could not load saved state, falling back to defaults:', e);
    }
    loadDefaultPresets();
  }

  function loadDefaultPresets() {
    const presets = window.TIERLIST_PRESETS || {};
    state.items = {};

    // Register all starter anime & movies
    (presets.anime || []).forEach(item => {
      state.items[item.id] = { ...item };
    });
    (presets.movies || []).forEach(item => {
      state.items[item.id] = { ...item };
    });

    // Deep copy default tiers
    state.tiers = (presets.defaultTiers || []).map(t => ({
      id: t.id,
      name: t.name,
      color: t.color,
      items: [...t.items]
    }));

    // Placed item IDs
    const placed = new Set();
    state.tiers.forEach(t => t.items.forEach(id => placed.add(id)));

    // Pool contains unassigned items
    state.pool = Object.keys(state.items).filter(id => !placed.has(id));
    state.poolOriginalOrder = [...state.pool];
    saveState();
  }

  function saveState() {
    try {
      const dataToSave = {
        tiers: state.tiers,
        items: state.items,
        pool: state.pool,
        updatedAt: new Date().toISOString()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
    updateStats();
  }

  // --- Rendering UI ---
  function renderAll() {
    renderTiers();
    renderPool();
    updateStats();
    updateFilterCounts();
  }

  function renderTiers() {
    const container = document.getElementById('tiers-container');
    if (!container) return;
    container.innerHTML = '';

    state.tiers.forEach((tier, tierIdx) => {
      const row = document.createElement('div');
      row.className = 'tier-row';
      row.dataset.tierId = tier.id;

      // Tier row dragover events for tier reordering
      row.addEventListener('dragover', (e) => {
        if (!draggedTierId || draggedTierId === tier.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const rect = row.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          row.classList.add('tier-row-drag-over-top');
          row.classList.remove('tier-row-drag-over-bottom');
        } else {
          row.classList.add('tier-row-drag-over-bottom');
          row.classList.remove('tier-row-drag-over-top');
        }
      });

      row.addEventListener('dragleave', (e) => {
        if (!draggedTierId) return;
        if (!row.contains(e.relatedTarget)) {
          row.classList.remove('tier-row-drag-over-top', 'tier-row-drag-over-bottom');
        }
      });

      row.addEventListener('drop', (e) => {
        if (!draggedTierId || draggedTierId === tier.id) return;
        e.preventDefault();
        e.stopPropagation();

        row.classList.remove('tier-row-drag-over-top', 'tier-row-drag-over-bottom');

        const rect = row.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midY;

        reorderTier(draggedTierId, tier.id, insertBefore);
      });

      // Tier Label Cell (Draggable for tier reordering)
      const labelCell = document.createElement('div');
      labelCell.className = 'tier-label-cell';
      labelCell.style.backgroundColor = tier.color || '#e11d48';
      labelCell.draggable = true;

      labelCell.addEventListener('dragstart', (e) => {
        draggedTierId = tier.id;
        isDraggingTier = true;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/tier-id', tier.id);
        e.dataTransfer.setData('text/plain', tier.id);
        row.classList.add('is-tier-dragging');
      });

      labelCell.addEventListener('dragend', () => {
        row.classList.remove('is-tier-dragging');
        document.querySelectorAll('.tier-row-drag-over-top, .tier-row-drag-over-bottom').forEach(el => {
          el.classList.remove('tier-row-drag-over-top', 'tier-row-drag-over-bottom');
        });
        draggedTierId = null;
        setTimeout(() => { isDraggingTier = false; }, 120);
      });

      const nameText = document.createElement('div');
      nameText.className = 'tier-name-text';
      nameText.textContent = tier.name;
      labelCell.appendChild(nameText);

      // Label mini controls (Gear icon for quick settings)
      const labelControls = document.createElement('div');
      labelControls.className = 'tier-label-controls';
      labelControls.innerHTML = `
        <button class="tier-ctrl-btn" data-action="edit-tier" data-tier-id="${tier.id}">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        </button>
      `;
      labelCell.appendChild(labelControls);

      labelCell.addEventListener('click', (e) => {
        if (isDraggingTier) return;
        if (!e.target.closest('.tier-ctrl-btn')) {
          openEditTierModal(tier.id);
        }
      });

      // Side tools: Remove move-up, move-down, clear-tier per task requirements. Only delete-tier remains.
      const sideTools = document.createElement('div');
      sideTools.className = 'tier-row-side-tools';
      sideTools.innerHTML = `
        <button class="btn btn-xs btn-danger-outline" data-action="delete-tier" data-tier-id="${tier.id}">✕</button>
      `;

      // Items dropzone
      const dropzone = document.createElement('div');
      dropzone.className = 'tier-items-dropzone';
      dropzone.dataset.tierId = tier.id;

      setupDropzoneEvents(dropzone, tier.id);

      // Filter and render cards in this tier
      const visibleItemIds = filterItems(tier.items);

      visibleItemIds.forEach(itemId => {
        const item = state.items[itemId];
        if (item) {
          const card = createMediaCardElement(item, false, tier.id);
          dropzone.appendChild(card);
        }
      });

      row.appendChild(labelCell);
      row.appendChild(dropzone);
      row.appendChild(sideTools);
      container.appendChild(row);
    });
  }

  function renderPool() {
    const container = document.getElementById('pool-cards-container');
    const emptyState = document.getElementById('pool-empty-state');
    const poolBadge = document.getElementById('pool-badge-count');
    if (!container) return;

    container.innerHTML = '';

    // Apply sorting
    const sortedPool = getSortedPool();
    const visiblePoolIds = filterItems(sortedPool);

    if (poolBadge) {
      poolBadge.textContent = state.pool.length;
    }

    if (state.pool.length === 0) {
      if (emptyState) emptyState.style.display = 'flex';
    } else {
      if (emptyState) emptyState.style.display = 'none';
      visiblePoolIds.forEach(itemId => {
        const item = state.items[itemId];
        if (item) {
          const card = createMediaCardElement(item, true, null);
          container.appendChild(card);
        }
      });
    }

    const poolDropzone = document.getElementById('pool-dropzone');
    if (poolDropzone && !poolDropzone.dataset.hasDropHandler) {
      setupDropzoneEvents(poolDropzone, 'pool');
      poolDropzone.dataset.hasDropHandler = 'true';
    }
  }

  // --- Media Card Element Creation ---
  function createMediaCardElement(item, isInPool, tierId) {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.dataset.itemId = item.id;
    card.draggable = true;

    // Resting state: pure clean poster
    const posterImg = document.createElement('img');
    posterImg.className = 'card-poster';
    posterImg.alt = item.title || 'Постер';
    posterImg.loading = 'lazy';
    const fallbackSrc = item.fallbackPoster || window.TIERLIST_PRESETS.createPosterSVG(item.title, item.type);
    posterImg.src = item.poster || item.cdnPoster || fallbackSrc;
    let imgDone = false;
    posterImg.onload = function () { imgDone = true; };
    posterImg.onerror = function () {
      imgDone = true;
      if (item.cdnPoster && this.src !== item.cdnPoster) {
        this.src = item.cdnPoster;
      } else if (this.src !== fallbackSrc) {
        this.src = fallbackSrc;
      }
    };
    // Safe fallback if image cannot load within generous timeout
    setTimeout(() => {
      if (!imgDone && (!posterImg.complete || posterImg.naturalWidth === 0)) {
        if (posterImg.src !== fallbackSrc) posterImg.src = fallbackSrc;
      }
    }, 7000);
    card.appendChild(posterImg);

    // Quick delete button (×) - only in pool on hover
    if (isInPool) {
      const delBtn = document.createElement('button');
      delBtn.className = 'card-quick-delete';
      delBtn.innerHTML = '&times;';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteItem(item.id, true);
      });
      card.appendChild(delBtn);
    }

    // Hover Info Badge: Minimalist title & type badge ONLY per user requirement
    const overlay = document.createElement('div');
    overlay.className = 'card-hover-overlay';

    const titleEl = document.createElement('div');
    titleEl.className = 'card-title';
    titleEl.textContent = item.title;

    const typeBadge = document.createElement('span');
    typeBadge.className = `card-badge-type ${item.type}`;
    typeBadge.textContent = item.type === 'anime' ? 'Аниме' : 'Фильм';

    overlay.appendChild(titleEl);
    overlay.appendChild(typeBadge);
    card.appendChild(overlay);

    // Click to open detailed info & diary modal
    card.addEventListener('click', (e) => {
      if (isDraggingCard) return;
      if (e.target.closest('.card-quick-delete')) return;
      openItemDetailModal(item.id);
    });

    // Drag events
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);

    return card;
  }

  // --- Filtering & Sorting Helpers ---
  function filterItems(itemIds) {
    const q = state.searchQuery.toLowerCase().trim();
    return itemIds.filter(id => {
      const it = state.items[id];
      if (!it) return false;

      // Category filter
      if (state.filter !== 'all' && it.type !== state.filter) {
        return false;
      }

      // Search text filter
      if (q) {
        const matchesTitle = it.title && it.title.toLowerCase().includes(q);
        const matchesOriginal = it.originalTitle && it.originalTitle.toLowerCase().includes(q);
        const matchesYear = it.year && it.year.toString().toLowerCase().includes(q);
        if (!matchesTitle && !matchesOriginal && !matchesYear) {
          return false;
        }
      }

      return true;
    });
  }

  function getSortedPool() {
    const pool = [...state.pool];
    if (state.poolSort === 'alpha') {
      return pool.sort((a, b) => {
        const titleA = (state.items[a]?.title || '').toLowerCase();
        const titleB = (state.items[b]?.title || '').toLowerCase();
        return titleA.localeCompare(titleB, 'ru');
      });
    } else if (state.poolSort === 'rating') {
      return pool.sort((a, b) => {
        const rA = parseFloat(state.items[a]?.rating) || 0;
        const rB = parseFloat(state.items[b]?.rating) || 0;
        return rB - rA;
      });
    } else if (state.poolSort === 'year') {
      return pool.sort((a, b) => {
        const yA = parseInt(state.items[a]?.year) || 0;
        const yB = parseInt(state.items[b]?.year) || 0;
        return yB - yA;
      });
    }
    return pool;
  }

  function updateStats() {
    // Header counters were removed per clean-human-ui design.
    // Sync pool badge count with current bank size.
    const poolBadge = document.getElementById('pool-badge-count');
    if (poolBadge) poolBadge.textContent = state.pool.length;
  }

  function updateFilterCounts() {
    let all = 0, movie = 0, anime = 0;
    Object.values(state.items).forEach(it => {
      all++;
      if (it.type === 'movie') movie++;
      if (it.type === 'anime') anime++;
    });

    const cAll = document.getElementById('count-all');
    const cMovie = document.getElementById('count-movie');
    const cAnime = document.getElementById('count-anime');

    if (cAll) cAll.textContent = all;
    if (cMovie) cMovie.textContent = movie;
    if (cAnime) cAnime.textContent = anime;
  }

  // --- Drag and Drop Logic ---
  function handleDragStart(e) {
    const card = e.target.closest('.media-card');
    if (!card) return;

    isDraggingCard = true;
    draggedItemId = card.dataset.itemId;
    const tierRow = card.closest('.tier-row');
    dragSourceTierId = tierRow ? tierRow.dataset.tierId : null;

    card.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedItemId);
  }

  function handleDragEnd(e) {
    const card = e.target.closest('.media-card');
    if (card) card.classList.remove('is-dragging');

    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    draggedItemId = null;
    dragSourceTierId = null;
    setTimeout(() => {
      isDraggingCard = false;
    }, 120);
  }

  function setupDropzoneEvents(dropzone, targetDestination) {
    dropzone.addEventListener('dragover', (e) => {
      if (draggedTierId) return; // Ignore tier reordering drag
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', (e) => {
      if (!dropzone.contains(e.relatedTarget)) {
        dropzone.classList.remove('drag-over');
      }
    });

    dropzone.addEventListener('drop', (e) => {
      if (draggedTierId) return; // Ignore tier reordering drag
      e.preventDefault();
      dropzone.classList.remove('drag-over');

      const itemId = e.dataTransfer.getData('text/plain') || draggedItemId;
      if (!itemId || !state.items[itemId]) return;

      // Find drop insertion index if dropped over another card
      const targetCard = e.target.closest('.media-card');
      moveItem(itemId, targetDestination, targetCard ? targetCard.dataset.itemId : null);
    });
  }

  function moveItem(itemId, targetDestination, targetBeforeItemId = null) {
    if (targetBeforeItemId === itemId) return;

    // 1. Remove from source
    state.tiers.forEach(t => {
      t.items = t.items.filter(id => id !== itemId);
    });
    state.pool = state.pool.filter(id => id !== itemId);

    // 2. Insert into target
    if (targetDestination === 'pool') {
      if (targetBeforeItemId && state.pool.includes(targetBeforeItemId)) {
        const idx = state.pool.indexOf(targetBeforeItemId);
        state.pool.splice(idx, 0, itemId);
      } else {
        state.pool.push(itemId);
      }
    } else {
      const tier = state.tiers.find(t => t.id === targetDestination);
      if (tier) {
        if (targetBeforeItemId && tier.items.includes(targetBeforeItemId)) {
          const idx = tier.items.indexOf(targetBeforeItemId);
          tier.items.splice(idx, 0, itemId);
        } else {
          tier.items.push(itemId);
        }
      }
    }

    saveState();
    renderAll();
  }

  // --- Card Deletion & Quick Move Menu ---
  function deleteItem(itemId, skipConfirm = false) {
    const item = state.items[itemId];
    if (!item) return;

    if (skipConfirm || confirm(`Удалить тайтл «${item.title}» из коллекции?`)) {
      // Remove from everywhere
      delete state.items[itemId];
      state.pool = state.pool.filter(id => id !== itemId);
      state.tiers.forEach(t => {
        t.items = t.items.filter(id => id !== itemId);
      });
      saveState();
      renderAll();
      showToast(`Тайтл «${item.title}» удален`);
    }
  }

  function openQuickMoveMenu(itemId, event) {
    // Clean up any existing menu
    document.querySelectorAll('.quick-move-popover').forEach(el => el.remove());

    const popover = document.createElement('div');
    popover.className = 'quick-move-popover';

    const rect = event.target.getBoundingClientRect();
    popover.style.top = `${Math.min(window.innerHeight - 220, rect.bottom + 4)}px`;
    popover.style.left = `${Math.min(window.innerWidth - 170, Math.max(8, rect.left))}px`;

    const titleDiv = document.createElement('div');
    titleDiv.className = 'quick-move-title';
    titleDiv.textContent = 'Переместить в:';
    popover.appendChild(titleDiv);

    state.tiers.forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-xs btn-outline quick-move-btn';
      btn.innerHTML = `<span class="quick-move-dot" style="background:${t.color || '#e11d48'}"></span><span>${t.name}</span>`;
      btn.onclick = () => {
        moveItem(itemId, t.id);
        popover.remove();
      };
      popover.appendChild(btn);
    });

    const poolBtn = document.createElement('button');
    poolBtn.className = 'btn btn-xs btn-ghost quick-move-btn';
    poolBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg><span>Банк тайтлов</span>`;
    poolBtn.onclick = () => {
      moveItem(itemId, 'pool');
      popover.remove();
    };
    popover.appendChild(poolBtn);

    document.body.appendChild(popover);

    const closeHandler = (e) => {
      if (!popover.contains(e.target)) {
        popover.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
  }

  // --- Tier Operations (Add, Edit, Reorder, Delete, Clear) ---
  function openEditTierModal(tierId) {
    const tier = state.tiers.find(t => t.id === tierId);
    if (!tier) return;

    document.getElementById('edit-tier-id').value = tier.id;
    document.getElementById('edit-tier-name').value = tier.name;
    document.getElementById('edit-tier-color-input').value = tier.color || '#e11d48';
    document.getElementById('edit-tier-color-hex').value = tier.color || '#e11d48';

    openModal('modal-edit-tier');
  }

  function handleSaveTierEdit(e) {
    e.preventDefault();
    const id = document.getElementById('edit-tier-id').value;
    const name = document.getElementById('edit-tier-name').value.trim() || 'Tier';
    const color = document.getElementById('edit-tier-color-hex').value.trim() || '#e11d48';

    const tier = state.tiers.find(t => t.id === id);
    if (tier) {
      tier.name = name;
      tier.color = color;
      saveState();
      renderAll();
      closeModal('modal-edit-tier');
      showToast(`Уровень «${name}» обновлен`);
    }
  }

  function addNewTier() {
    const newId = `tier-${Date.now()}`;
    const defaultColors = ['#e11d48', '#be123c', '#9f1239', '#881337', '#6b0f2b', '#4c0519'];
    const color = defaultColors[state.tiers.length % defaultColors.length];

    state.tiers.push({
      id: newId,
      name: `T${state.tiers.length + 1}`,
      color: color,
      items: []
    });

    saveState();
    renderAll();
    showToast('Новый уровень добавлен в тир-лист');
  }

  function moveTierUp(tierId) {
    const idx = state.tiers.findIndex(t => t.id === tierId);
    if (idx > 0) {
      const temp = state.tiers[idx];
      state.tiers[idx] = state.tiers[idx - 1];
      state.tiers[idx - 1] = temp;
      saveState();
      renderAll();
    }
  }

  function moveTierDown(tierId) {
    const idx = state.tiers.findIndex(t => t.id === tierId);
    if (idx < state.tiers.length - 1 && idx !== -1) {
      const temp = state.tiers[idx];
      state.tiers[idx] = state.tiers[idx + 1];
      state.tiers[idx + 1] = temp;
      saveState();
      renderAll();
    }
  }

  function clearTierToPool(tierId) {
    const tier = state.tiers.find(t => t.id === tierId);
    if (!tier || tier.items.length === 0) return;

    state.pool.push(...tier.items);
    tier.items = [];
    saveState();
    renderAll();
    showToast(`Тайтлы уровня «${tier.name}» возвращены в банк`);
  }

  function deleteTier(tierId) {
    const tier = state.tiers.find(t => t.id === tierId);
    if (!tier) return;

    if (confirm(`Удалить уровень «${tier.name}»? Находящиеся в нем тайтлы вернутся в банк.`)) {
      state.pool.push(...tier.items);
      state.tiers = state.tiers.filter(t => t.id !== tierId);
      saveState();
      renderAll();
      showToast(`Уровень «${tier.name}» удален`);
    }
  }

  function clearBoardToPool() {
    let count = 0;
    state.tiers.forEach(t => {
      count += t.items.length;
      state.pool.push(...t.items);
      t.items = [];
    });

    if (count === 0) {
      showToast('Доска уже пуста');
      return;
    }

    saveState();
    renderAll();
    showToast(`Все ${count} тайтлов перемещены в банк`);
  }

  function reorderTier(sourceTierId, targetTierId, insertBefore = true) {
    const fromIdx = state.tiers.findIndex(t => t.id === sourceTierId);
    if (fromIdx === -1) return;
    const [removed] = state.tiers.splice(fromIdx, 1);
    let toIdx = state.tiers.findIndex(t => t.id === targetTierId);
    if (toIdx === -1) {
      state.tiers.push(removed);
    } else {
      if (!insertBefore) {
        toIdx += 1;
      }
      state.tiers.splice(toIdx, 0, removed);
    }
    saveState();
    renderAll();
    showToast(`Порядок уровней обновлен`);
  }

  // --- Item Detail Modal & Viewing Diary ---
  function resetPendingCoverEdit() {
    pendingDetailPoster = null;
    const coverUrlInput = document.getElementById('detail-cover-url-input');
    if (coverUrlInput) coverUrlInput.value = '';
    const coverFileInput = document.getElementById('detail-cover-file-input');
    if (coverFileInput) coverFileInput.value = '';
    const statusEl = document.getElementById('detail-cover-preview-status');
    if (statusEl) {
      statusEl.style.display = 'none';
      statusEl.classList.remove('has-error');
    }
    const statusBadge = document.querySelector('#detail-cover-preview-status .cover-status-badge');
    if (statusBadge) {
      statusBadge.classList.remove('error');
      const textSpan = statusBadge.querySelector('span');
      if (textSpan) textSpan.textContent = 'Новая обложка выбрана (предпросмотр на постере)';
    }
    if (currentDetailItemId && state.items[currentDetailItemId]) {
      const item = state.items[currentDetailItemId];
      const fallbackSrc = item.fallbackPoster || window.TIERLIST_PRESETS.createPosterSVG(item.title, item.type);
      const posterImg = document.getElementById('detail-poster-img');
      if (posterImg) posterImg.src = item.poster || item.cdnPoster || fallbackSrc;
    }
  }

  function cancelCoverEdit() {
    const coverEditSec = document.getElementById('detail-cover-edit-section');
    if (coverEditSec) coverEditSec.style.display = 'none';
    resetPendingCoverEdit();
  }

  function revertToOriginalCover() {
    if (!currentDetailItemId || !state.items[currentDetailItemId]) return;
    const item = state.items[currentDetailItemId];
    const presets = window.TIERLIST_PRESETS || {};
    const allPresets = [...(presets.anime || []), ...(presets.movies || [])];
    const original = allPresets.find(p => p.id === item.id);
    const originalPoster = original ? original.poster : (item.fallbackPoster || presets.createPosterSVG(item.title, item.type));
    item.poster = originalPoster;
    item.cdnPoster = original ? original.cdnPoster : null;
    item.isUserCover = false;
    pendingDetailPoster = null;
    saveState();
    renderAll();
    const posterImg = document.getElementById('detail-poster-img');
    if (posterImg) posterImg.src = originalPoster;
    resetPendingCoverEdit();
    const revertRow = document.getElementById('detail-cover-revert-row');
    if (revertRow) revertRow.style.display = 'none';
    showToast('Исходная обложка восстановлена');
  }

  function openItemDetailModal(itemId) {
    const item = state.items[itemId];
    if (!item) return;

    currentDetailItemId = itemId;
    resetPendingCoverEdit();
    document.getElementById('detail-poster-wrap')?.classList.remove('is-focused-target');

    // Reset cover edit panel state
    const coverEditSec = document.getElementById('detail-cover-edit-section');
    if (coverEditSec) coverEditSec.style.display = 'none';

    // Toggle revert original cover button
    const revertRow = document.getElementById('detail-cover-revert-row');
    if (revertRow) {
      revertRow.style.display = item.isUserCover ? 'flex' : 'none';
    }

    const titleEl = document.getElementById('detail-title');
    const badgeEl = document.getElementById('detail-type-badge');
    const posterImg = document.getElementById('detail-poster-img');
    const yearEl = document.getElementById('detail-year');
    const durationEl = document.getElementById('detail-duration');
    const descEl = document.getElementById('detail-description');
    const startDateInp = document.getElementById('detail-start-date');
    const startTimeInp = document.getElementById('detail-start-time');
    const endDateInp = document.getElementById('detail-end-date');
    const endTimeInp = document.getElementById('detail-end-time');
    const commentInp = document.getElementById('detail-user-comment');

    if (titleEl) titleEl.textContent = item.title;
    if (badgeEl) {
      badgeEl.className = `card-badge-type ${item.type}`;
      badgeEl.textContent = item.type === 'anime' ? 'Аниме' : 'Фильм';
    }
    if (posterImg) {
      const fallbackSrc = item.fallbackPoster || window.TIERLIST_PRESETS.createPosterSVG(item.title, item.type);
      posterImg.src = item.poster || item.cdnPoster || fallbackSrc;
      posterImg.onerror = function () { this.src = fallbackSrc; };
    }
    if (yearEl) yearEl.textContent = item.year || '—';
    if (durationEl) durationEl.textContent = item.duration || '—';
    if (descEl) descEl.textContent = item.synopsis || item.description || 'Описание отсутствует.';

    if (startDateInp) startDateInp.value = item.startDate || '';
    if (startTimeInp) startTimeInp.value = item.startTime || '';
    if (endDateInp) endDateInp.value = item.endDate || '';
    if (endTimeInp) endTimeInp.value = item.endTime || '';
    if (commentInp) commentInp.value = item.userComment || '';

    renderRewatchDatesList(item.rewatchDates || []);

    openModal('modal-item-detail');
  }

  function renderRewatchDatesList(entries) {
    const container = document.getElementById('detail-rewatch-list');
    if (!container) return;
    container.innerHTML = '';
    if (!Array.isArray(entries)) return;

    entries.forEach((entry) => {
      let sDate = '';
      let sTime = '';
      let eDate = '';
      let eTime = '';
      let comment = '';

      if (typeof entry === 'object' && entry !== null) {
        sDate = entry.startDate || entry.date || '';
        sTime = entry.startTime || entry.time || '';
        eDate = entry.endDate || '';
        eTime = entry.endTime || '';
        comment = entry.comment || entry.note || entry.userComment || '';
      } else if (typeof entry === 'string') {
        if (entry.includes(' - ') || entry.includes(' — ')) {
          const parts = entry.split(/\s*[-—]\s*/);
          const startParts = (parts[0] || '').trim().split(/\s+/);
          sDate = startParts[0] || '';
          sTime = startParts[1] || '';
          if (parts[1]) {
            const endParts = parts[1].trim().split(/\s+/);
            eDate = endParts[0] || '';
            eTime = endParts[1] || '';
          }
        } else if (entry.includes(' ')) {
          const parts = entry.split(' ');
          sDate = parts[0] || '';
          sTime = parts[1] || '';
        } else if (entry.includes('T')) {
          const parts = entry.split('T');
          sDate = parts[0] || '';
          sTime = parts[1] || '';
        } else {
          sDate = entry;
        }
      }

      const itemEl = createRewatchRow(sDate, sTime, eDate, eTime, comment);
      container.appendChild(itemEl);
    });

    updateRewatchNumbers();
  }

  function updateRewatchNumbers() {
    const rows = document.querySelectorAll('#detail-rewatch-list .rewatch-item');
    rows.forEach((row, idx) => {
      const numSpan = row.querySelector('.rewatch-row-num');
      if (numSpan) numSpan.textContent = `${idx + 1}.`;
    });
  }

  function createRewatchRow(startDate = '', startTime = '', endDate = '', endTime = '', comment = '', isExpanded = false) {
    const itemEl = document.createElement('div');
    itemEl.className = 'rewatch-item';

    const headerEl = document.createElement('div');
    headerEl.className = 'rewatch-item-header';

    const numSpan = document.createElement('span');
    numSpan.className = 'rewatch-row-num';
    numSpan.textContent = '1.';

    // Start datetime group
    const startGroup = document.createElement('div');
    startGroup.className = 'rewatch-datetime-group';

    const startDateInp = document.createElement('input');
    startDateInp.type = 'date';
    startDateInp.className = 'rewatch-date-input rewatch-start-date';
    startDateInp.value = startDate;
    startDateInp.setAttribute('aria-label', 'Дата начала пересмотра');
    startDateInp.addEventListener('change', () => {
      saveCurrentItemDetail(false);
    });

    const startTimeInp = document.createElement('input');
    startTimeInp.type = 'time';
    startTimeInp.className = 'rewatch-time-input rewatch-start-time';
    startTimeInp.value = startTime;
    startTimeInp.setAttribute('aria-label', 'Время начала пересмотра');
    startTimeInp.addEventListener('change', () => {
      saveCurrentItemDetail(false);
    });

    startGroup.appendChild(startDateInp);
    startGroup.appendChild(startTimeInp);

    // Separator between start and end
    const sepSpan = document.createElement('span');
    sepSpan.className = 'rewatch-range-sep';
    sepSpan.textContent = '—';

    // End datetime group
    const endGroup = document.createElement('div');
    endGroup.className = 'rewatch-datetime-group';

    const endDateInp = document.createElement('input');
    endDateInp.type = 'date';
    endDateInp.className = 'rewatch-date-input rewatch-end-date';
    endDateInp.value = endDate;
    endDateInp.setAttribute('aria-label', 'Дата окончания пересмотра');
    endDateInp.addEventListener('change', () => {
      saveCurrentItemDetail(false);
    });

    const endTimeInp = document.createElement('input');
    endTimeInp.type = 'time';
    endTimeInp.className = 'rewatch-time-input rewatch-end-time';
    endTimeInp.value = endTime;
    endTimeInp.setAttribute('aria-label', 'Время окончания пересмотра');
    endTimeInp.addEventListener('change', () => {
      saveCurrentItemDetail(false);
    });

    endGroup.appendChild(endDateInp);
    endGroup.appendChild(endTimeInp);

    // Comment toggle button (Expand / Collapse comment)
    const commentBtn = document.createElement('button');
    commentBtn.type = 'button';
    const hasCommentText = Boolean(comment && comment.trim());
    commentBtn.className = 'btn-toggle-rewatch-comment' + (hasCommentText ? ' has-comment' : '') + (isExpanded ? ' is-open' : '');
    commentBtn.setAttribute('aria-label', hasCommentText ? 'Комментарий к пересмотру' : 'Развернуть и добавить комментарий');
    commentBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
      <span class="comment-btn-text">${hasCommentText ? 'Заметка' : '+ Заметка'}</span>
      <svg class="rewatch-chevron-icon" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
    `;

    // Remove button
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-remove-rewatch';
    delBtn.innerHTML = '&times;';
    delBtn.setAttribute('aria-label', 'Удалить этот пересмотр');
    delBtn.addEventListener('click', () => {
      itemEl.remove();
      updateRewatchNumbers();
      saveCurrentItemDetail(false);
    });

    headerEl.appendChild(numSpan);
    headerEl.appendChild(startGroup);
    headerEl.appendChild(sepSpan);
    headerEl.appendChild(endGroup);
    headerEl.appendChild(commentBtn);
    headerEl.appendChild(delBtn);

    // Expandable Comment Panel
    const commentPanel = document.createElement('div');
    commentPanel.className = 'rewatch-comment-panel';
    commentPanel.style.display = isExpanded ? 'block' : 'none';

    const commentTextarea = document.createElement('textarea');
    commentTextarea.className = 'rewatch-comment-input';
    commentTextarea.rows = 2;
    commentTextarea.placeholder = 'Комментарий к этому пересмотру (впечатления, мысли)...';
    commentTextarea.value = comment || '';
    commentTextarea.addEventListener('input', () => {
      const val = commentTextarea.value.trim();
      if (val) {
        commentBtn.classList.add('has-comment');
        const textSpan = commentBtn.querySelector('.comment-btn-text');
        if (textSpan) textSpan.textContent = 'Заметка';
      } else {
        commentBtn.classList.remove('has-comment');
        const textSpan = commentBtn.querySelector('.comment-btn-text');
        if (textSpan) textSpan.textContent = '+ Заметка';
      }
      saveCurrentItemDetail(false);
    });

    commentBtn.addEventListener('click', () => {
      const isClosed = commentPanel.style.display === 'none';
      commentPanel.style.display = isClosed ? 'block' : 'none';
      commentBtn.classList.toggle('is-open', isClosed);
      if (isClosed) {
        setTimeout(() => commentTextarea.focus(), 40);
      }
    });

    commentPanel.appendChild(commentTextarea);

    itemEl.appendChild(headerEl);
    itemEl.appendChild(commentPanel);

    return itemEl;
  }

  function addRewatchDate(initialStart = null, initialStartTime = null, initialEnd = null, initialEndTime = null, initialComment = '') {
    const container = document.getElementById('detail-rewatch-list');
    if (!container) return;

    let sDate = '';
    let sTime = '';
    let eDate = '';
    let eTime = '';
    let comment = initialComment || '';

    if (typeof initialStart === 'object' && initialStart !== null) {
      sDate = initialStart.startDate || initialStart.date || '';
      sTime = initialStart.startTime || initialStart.time || '';
      eDate = initialStart.endDate || '';
      eTime = initialStart.endTime || '';
      comment = initialStart.comment || initialStart.note || '';
    } else if (typeof initialStart === 'string') {
      if (initialStart.includes(' - ') || initialStart.includes(' — ')) {
        const parts = initialStart.split(/\s*[-—]\s*/);
        const startParts = (parts[0] || '').trim().split(/\s+/);
        sDate = startParts[0] || '';
        sTime = startParts[1] || '';
        if (parts[1]) {
          const endParts = parts[1].trim().split(/\s+/);
          eDate = endParts[0] || '';
          eTime = endParts[1] || '';
        }
      } else if (initialStart.includes(' ')) {
        const parts = initialStart.split(' ');
        sDate = parts[0] || '';
        sTime = parts[1] || '';
      } else {
        sDate = initialStart;
        sTime = initialStartTime || '';
      }
      eDate = initialEnd || sDate;
      eTime = initialEndTime || '';
    } else {
      sDate = new Date().toISOString().slice(0, 10);
      sTime = '';
      eDate = sDate;
      eTime = '';
    }

    const itemEl = createRewatchRow(sDate, sTime, eDate, eTime, comment);
    container.appendChild(itemEl);
    updateRewatchNumbers();

    saveCurrentItemDetail(false);
  }

  function saveCurrentItemDetail(isExplicitSave = true) {
    if (!currentDetailItemId || !state.items[currentDetailItemId]) return;

    const item = state.items[currentDetailItemId];
    const startDateInp = document.getElementById('detail-start-date');
    const startTimeInp = document.getElementById('detail-start-time');
    const endDateInp = document.getElementById('detail-end-date');
    const endTimeInp = document.getElementById('detail-end-time');
    const commentInp = document.getElementById('detail-user-comment');

    if (startDateInp) item.startDate = startDateInp.value;
    if (startTimeInp) item.startTime = startTimeInp.value;
    if (endDateInp) item.endDate = endDateInp.value;
    if (endTimeInp) item.endTime = endTimeInp.value;
    if (commentInp) item.userComment = commentInp.value;

    const rewatchRows = document.querySelectorAll('#detail-rewatch-list .rewatch-item');
    item.rewatchDates = Array.from(rewatchRows).map(row => {
      const sDateInp = row.querySelector('.rewatch-start-date');
      const sTimeInp = row.querySelector('.rewatch-start-time');
      const eDateInp = row.querySelector('.rewatch-end-date');
      const eTimeInp = row.querySelector('.rewatch-end-time');
      const commentInp = row.querySelector('.rewatch-comment-input');
      const sDate = sDateInp ? sDateInp.value : '';
      const sTime = sTimeInp ? sTimeInp.value : '';
      const eDate = eDateInp ? eDateInp.value : '';
      const eTime = eTimeInp ? eTimeInp.value : '';
      const comment = commentInp ? commentInp.value.trim() : '';
      return {
        startDate: sDate,
        startTime: sTime,
        endDate: eDate,
        endTime: eTime,
        comment: comment,
        // Legacy fields for backward compatibility with existing tests and imports
        date: sDate,
        time: sTime
      };
    }).filter(r => r.startDate || r.startTime || r.endDate || r.endTime || r.comment || r.date || r.time);

    let coverChanged = false;

    // Only commit pending cover edit on explicit save
    if (isExplicitSave) {
      const urlInp = document.getElementById('detail-cover-url-input');
      const urlVal = urlInp ? urlInp.value.trim() : '';
      const newCover = pendingDetailPoster || (urlVal ? urlVal : null);

      if (newCover && newCover !== item.poster) {
        item.poster = newCover;
        item.cdnPoster = newCover;
        item.isUserCover = true;
        coverChanged = true;
        pendingDetailPoster = null;
      }
    }

    saveState();
    if (coverChanged) {
      renderAll();
    }
    if (isExplicitSave) {
      showToast(coverChanged ? 'Данные и новая обложка сохранены' : 'Данные просмотра сохранены');
    }
  }

  // --- Circular Year Wheel (Time-Space Wheel) ---
  let activeWheelItemId = null;
  let activeWheelLayers = [];

  const MONTH_NAMES = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];
  const SEASONS_CONFIG = [
    { id: 'winter', name: 'ЗИМА', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.10)', border: 'rgba(56, 189, 248, 0.30)', startAngle: 315, endAngle: 45, centerAngle: 0, icon: '❄' },
    { id: 'spring', name: 'ВЕСНА', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.10)', border: 'rgba(74, 222, 128, 0.30)', startAngle: 45, endAngle: 135, centerAngle: 90, icon: '🌸' },
    { id: 'summer', name: 'ЛЕТО', color: '#facc15', bg: 'rgba(250, 204, 21, 0.10)', border: 'rgba(250, 204, 21, 0.30)', startAngle: 135, endAngle: 225, centerAngle: 180, icon: '☀️' },
    { id: 'autumn', name: 'ОСЕНЬ', color: '#f97316', bg: 'rgba(249, 115, 22, 0.10)', border: 'rgba(249, 115, 22, 0.30)', startAngle: 225, endAngle: 315, centerAngle: 270, icon: '🍁' }
  ];

  function getMonthSeasonInfo(m) {
    // 11 (Декабрь), 0 (Январь), 1 (Февраль) -> Зима
    if (m === 11 || m === 0 || m === 1) return SEASONS_CONFIG[0];
    // 2 (Март), 3 (Апрель), 4 (Май) -> Весна
    if (m >= 2 && m <= 4) return SEASONS_CONFIG[1];
    // 5 (Июнь), 6 (Июль), 7 (Август) -> Лето
    if (m >= 5 && m <= 7) return SEASONS_CONFIG[2];
    // 8 (Сентябрь), 9 (Октябрь), 10 (Ноябрь) -> Осень
    return SEASONS_CONFIG[3];
  }

  function updateSectorVisibility(layerId, isActive) {
    const sectorEl = document.querySelector(`.wheel-sector-group[data-layer-id="${layerId}"]`);
    if (sectorEl) {
      sectorEl.classList.toggle('is-hidden', !isActive);
      sectorEl.style.display = isActive ? '' : 'none';
      sectorEl.style.opacity = isActive ? '1' : '0';
      sectorEl.style.pointerEvents = isActive ? 'auto' : 'none';
    }
  }

  function dateToWheelAngle(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const parts = dateStr.trim().split('-');
    if (parts.length < 3) return null;
    const year = parseInt(parts[0], 10) || 2024;
    const month = (parseInt(parts[1], 10) - 1) % 12;
    if (isNaN(month) || month < 0) return null;
    const day = parseInt(parts[2], 10) || 1;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthStartAngle = (month * 30 - 15 + 360) % 360;
    const dayFraction = Math.max(0, Math.min(1, (day - 0.5) / daysInMonth));
    return (monthStartAngle + dayFraction * 30) % 360;
  }

  function describeSvgArc(cx, cy, r, startAngle, endAngle) {
    let diff = (endAngle - startAngle) % 360;
    if (diff < 0) diff += 360;
    if (diff < 2.5) diff = 2.5; // Ensure minimum visible arc for 1-day events
    if (diff >= 359.99) diff = 359.99;

    const actualEnd = (startAngle + diff) % 360;
    const rad1 = startAngle * Math.PI / 180;
    const rad2 = actualEnd * Math.PI / 180;

    const x1 = cx + r * Math.sin(rad1);
    const y1 = cy - r * Math.cos(rad1);
    const x2 = cx + r * Math.sin(rad2);
    const y2 = cy - r * Math.cos(rad2);

    const largeArcFlag = diff > 180 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }

  function describeSvgRingSector(cx, cy, rIn, rOut, startAngle, endAngle) {
    let diff = (endAngle - startAngle) % 360;
    if (diff < 0) diff += 360;
    if (diff >= 359.99) diff = 359.99;

    const actualEnd = (startAngle + diff) % 360;
    const rad1 = startAngle * Math.PI / 180;
    const rad2 = actualEnd * Math.PI / 180;

    const x1Out = cx + rOut * Math.sin(rad1);
    const y1Out = cy - rOut * Math.cos(rad1);
    const x2Out = cx + rOut * Math.sin(rad2);
    const y2Out = cy - rOut * Math.cos(rad2);

    const x1In = cx + rIn * Math.sin(rad1);
    const y1In = cy - rIn * Math.cos(rad1);
    const x2In = cx + rIn * Math.sin(rad2);
    const y2In = cy - rIn * Math.cos(rad2);

    const largeArcFlag = diff > 180 ? 1 : 0;
    return `M ${x1Out.toFixed(2)} ${y1Out.toFixed(2)} ` +
           `A ${rOut} ${rOut} 0 ${largeArcFlag} 1 ${x2Out.toFixed(2)} ${y2Out.toFixed(2)} ` +
           `L ${x2In.toFixed(2)} ${y2In.toFixed(2)} ` +
           `A ${rIn} ${rIn} 0 ${largeArcFlag} 0 ${x1In.toFixed(2)} ${y1In.toFixed(2)} Z`;
  }

  function formatRuDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    const day = parseInt(parts[2], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parts[0];
    const monthShort = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][month] || '';
    return `${day} ${monthShort} ${year}`;
  }

  function calculateDaysDifference(sStr, eStr) {
    if (!sStr && !eStr) return 0;
    if (!sStr) sStr = eStr;
    if (!eStr) eStr = sStr;
    const d1 = new Date(sStr);
    const d2 = new Date(eStr);
    const diffTime = Math.abs(d2 - d1);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return isNaN(diffDays) ? 1 : diffDays;
  }

  function openYearWheelModal(itemId) {
    const item = state.items[itemId];
    if (!item) return;

    activeWheelItemId = itemId;

    const titleEl = document.getElementById('year-wheel-title');
    const subtitleEl = document.getElementById('year-wheel-subtitle');
    if (titleEl) titleEl.textContent = 'Круг года просмотра';
    if (subtitleEl) subtitleEl.textContent = item.title;

    // Build layers list
    const palette = ['#f43f5e', '#a855f7', '#38bdf8', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#eab308'];
    activeWheelLayers = [];

    // 1. Primary Viewing
    const primStart = item.startDate || '';
    const primEnd = item.endDate || primStart;
    if (primStart || primEnd) {
      activeWheelLayers.push({
        id: 'primary',
        name: 'Первый просмотр',
        startDate: primStart,
        endDate: primEnd,
        comment: item.userComment || '',
        color: palette[0],
        active: true,
        isPrimary: true
      });
    }

    // 2. Rewatches
    if (Array.isArray(item.rewatchDates)) {
      item.rewatchDates.forEach((r, idx) => {
        let s = '';
        let e = '';
        let c = '';
        if (typeof r === 'object' && r !== null) {
          s = r.startDate || r.date || '';
          e = r.endDate || s;
          c = r.comment || '';
        } else if (typeof r === 'string') {
          s = r;
          e = r;
        }
        if (s || e) {
          activeWheelLayers.push({
            id: `rewatch-${idx}`,
            name: `Пересмотр #${idx + 1}`,
            startDate: s,
            endDate: e,
            comment: c,
            color: palette[(idx + 1) % palette.length],
            active: true,
            isPrimary: false,
            rewatchIndex: idx
          });
        }
      });
    }

    renderYearWheelSVG();
    renderYearWheelLayersList();

    openModal('modal-year-wheel');
  }

  function renderYearWheelLayersList() {
    const container = document.getElementById('year-wheel-layers-list');
    const countEl = document.getElementById('year-wheel-active-count');
    if (!container) return;
    container.innerHTML = '';

    const activeCount = activeWheelLayers.filter(l => l.active).length;
    if (countEl) countEl.textContent = `${activeCount} из ${activeWheelLayers.length} активно`;

    if (activeWheelLayers.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'wheel-empty-layers';
      emptyDiv.innerHTML = 'В дневнике пока нет сохраненных дат просмотра.<br><br>Добавьте даты начала или пересмотра в карточке тайтла, чтобы увидеть их на круге года.';
      container.appendChild(emptyDiv);
      return;
    }

    activeWheelLayers.forEach((layer) => {
      const row = document.createElement('div');
      row.className = `wheel-layer-row ${layer.active ? 'is-active' : ''}`;
      row.dataset.layerId = layer.id;

      const dot = document.createElement('div');
      dot.className = 'wheel-layer-indicator';
      dot.style.background = layer.color;

      const info = document.createElement('div');
      info.className = 'wheel-layer-info';

      const nameRow = document.createElement('div');
      nameRow.className = 'wheel-layer-name-row';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'wheel-layer-name';
      nameSpan.textContent = layer.name;

      const days = calculateDaysDifference(layer.startDate, layer.endDate);
      const durSpan = document.createElement('span');
      durSpan.className = 'wheel-layer-duration';
      durSpan.textContent = days > 0 ? `${days} дн.` : '';

      nameRow.appendChild(nameSpan);
      if (days > 0) nameRow.appendChild(durSpan);

      const datesDiv = document.createElement('div');
      datesDiv.className = 'wheel-layer-dates';
      const sFormatted = formatRuDate(layer.startDate);
      const eFormatted = formatRuDate(layer.endDate);
      datesDiv.textContent = sFormatted === eFormatted ? sFormatted : `${sFormatted} — ${eFormatted}`;

      info.appendChild(nameRow);
      info.appendChild(datesDiv);

      // Toggle switch
      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'wheel-layer-toggle';
      toggleLabel.setAttribute('aria-label', `Переключить ${layer.name}`);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = layer.active;
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        layer.active = checkbox.checked;
        row.classList.toggle('is-active', layer.active);
        updateSectorVisibility(layer.id, layer.active);
        const newCount = activeWheelLayers.filter(l => l.active).length;
        if (countEl) countEl.textContent = `${newCount} из ${activeWheelLayers.length} активно`;
      });

      const slider = document.createElement('span');
      slider.className = 'wheel-toggle-slider';

      toggleLabel.appendChild(checkbox);
      toggleLabel.appendChild(slider);

      // Clicking row toggles the checkbox
      row.addEventListener('click', (e) => {
        if (e.target.closest('.wheel-layer-toggle')) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      });

      // Hover on list row highlights the corresponding SVG sector
      row.addEventListener('mouseenter', () => {
        const sector = document.querySelector(`.wheel-sector-group[data-layer-id="${layer.id}"]`);
        if (sector) sector.classList.add('is-highlighted');
      });
      row.addEventListener('mouseleave', () => {
        const sector = document.querySelector(`.wheel-sector-group[data-layer-id="${layer.id}"]`);
        if (sector) sector.classList.remove('is-highlighted');
      });

      row.appendChild(dot);
      row.appendChild(info);
      row.appendChild(toggleLabel);

      container.appendChild(row);
    });
  }

  function renderYearWheelSVG() {
    const container = document.getElementById('year-wheel-svg-container');
    if (!container) return;
    container.innerHTML = '';

    const cx = 260;
    const cy = 260;
    const rMonthOut = 248;
    const rMonthIn = 192; // Single bold month ring: 56px thickness
    const rCenter = 76;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 520 520');
    svg.setAttribute('class', 'year-wheel-svg');

    // Defs (drop shadows, clips, radial glows)
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <filter id="wheel-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
      <clipPath id="wheel-center-clip">
        <circle cx="${cx}" cy="${cy}" r="${rCenter - 2}" />
      </clipPath>
      <radialGradient id="grad-winter-ambient" cx="50%" cy="20%" r="65%">
        <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.14" />
        <stop offset="100%" stop-color="#38bdf8" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="grad-spring-ambient" cx="80%" cy="50%" r="65%">
        <stop offset="0%" stop-color="#4ade80" stop-opacity="0.14" />
        <stop offset="100%" stop-color="#4ade80" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="grad-summer-ambient" cx="50%" cy="80%" r="65%">
        <stop offset="0%" stop-color="#facc15" stop-opacity="0.14" />
        <stop offset="100%" stop-color="#facc15" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="grad-autumn-ambient" cx="20%" cy="50%" r="65%">
        <stop offset="0%" stop-color="#f97316" stop-opacity="0.14" />
        <stop offset="100%" stop-color="#f97316" stop-opacity="0" />
      </radialGradient>
    `;
    svg.appendChild(defs);

    // 1. Season Quadrants Artistic Styling (Interior zone: R = 76 to R = 192)
    const seasonsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    seasonsGroup.setAttribute('class', 'wheel-seasons-group');

    // Subtle concentric radar orbital guide rings in interior
    [114, 152].forEach(rGuide => {
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('cx', cx);
      ring.setAttribute('cy', cy);
      ring.setAttribute('r', rGuide.toString());
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', 'rgba(255, 255, 255, 0.05)');
      ring.setAttribute('stroke-width', '1');
      ring.setAttribute('stroke-dasharray', '2 5');
      seasonsGroup.appendChild(ring);
    });

    // --- QUADRANT 1: ЗИМА (Top: 315° to 45°) ---
    const winterSector = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    winterSector.setAttribute('d', describeSvgRingSector(cx, cy, rCenter, rMonthIn, 315, 45));
    winterSector.setAttribute('fill', 'url(#grad-winter-ambient)');
    seasonsGroup.appendChild(winterSector);

    // Winter season watermark text
    const winterText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    winterText.setAttribute('x', cx);
    winterText.setAttribute('y', '110');
    winterText.setAttribute('fill', '#38bdf8');
    winterText.setAttribute('font-size', '13');
    winterText.setAttribute('font-weight', '800');
    winterText.setAttribute('letter-spacing', '6');
    winterText.setAttribute('opacity', '0.45');
    winterText.setAttribute('text-anchor', 'middle');
    winterText.setAttribute('class', 'wheel-season-watermark');
    winterText.textContent = 'ЗИМА';
    seasonsGroup.appendChild(winterText);

    // Snowflake vector artwork at (cx, 142)
    const snowflake = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    snowflake.setAttribute('class', 'wheel-season-art');
    snowflake.setAttribute('transform', `translate(${cx}, 142)`);
    snowflake.innerHTML = `
      <g stroke="#38bdf8" stroke-width="1.2" stroke-linecap="round" fill="none" opacity="0.85" filter="url(#wheel-glow)">
        <path d="M 0 0 L 0 -15 M -4 -8 L 0 -12 L 4 -8 M -3 -4 L 0 -7 L 3 -4" />
        <path d="M 0 0 L 0 15 M -4 8 L 0 12 L 4 8 M -3 4 L 0 7 L 3 4" />
        <path d="M 0 0 L 13 -7.5 M 8 -8 L 11 -3 L 6 -1 M 4 -4 L 7 -1 L 3 0" />
        <path d="M 0 0 L -13 7.5 M -8 8 L -11 3 L -6 1 M -4 4 L -7 1 L -3 0" />
        <path d="M 0 0 L -13 -7.5 M -8 -8 L -11 -3 L -6 -1 M -4 -4 L -7 -1 L -3 0" />
        <path d="M 0 0 L 13 7.5 M 8 8 L 11 3 L 6 1 M 4 4 L 7 1 L 3 0" />
      </g>
      <circle cx="0" cy="0" r="2" fill="#e0f2fe" />
    `;
    seasonsGroup.appendChild(snowflake);

    // Winter Ice stars & frost dots
    const winterStars = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    winterStars.setAttribute('class', 'wheel-season-art');
    winterStars.innerHTML = `
      <path d="M 0 -6 L 1.5 -1.5 L 6 0 L 1.5 1.5 L 0 6 L -1.5 1.5 L -6 0 L -1.5 -1.5 Z" transform="translate(${cx - 48}, 138)" fill="#e0f2fe" opacity="0.8" />
      <path d="M 0 -6 L 1.5 -1.5 L 6 0 L 1.5 1.5 L 0 6 L -1.5 1.5 L -6 0 L -1.5 -1.5 Z" transform="translate(${cx + 48}, 138)" fill="#e0f2fe" opacity="0.8" />
      <circle cx="${cx - 28}" cy="168" r="1.3" fill="#38bdf8" opacity="0.6" />
      <circle cx="${cx + 28}" cy="168" r="1.3" fill="#38bdf8" opacity="0.6" />
      <circle cx="${cx - 70}" cy="164" r="1.5" fill="#38bdf8" opacity="0.5" />
      <circle cx="${cx + 70}" cy="164" r="1.5" fill="#38bdf8" opacity="0.5" />
    `;
    seasonsGroup.appendChild(winterStars);

    // --- QUADRANT 2: ВЕСНА (Right: 45° to 135°) ---
    const springSector = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    springSector.setAttribute('d', describeSvgRingSector(cx, cy, rCenter, rMonthIn, 45, 135));
    springSector.setAttribute('fill', 'url(#grad-spring-ambient)');
    seasonsGroup.appendChild(springSector);

    // Spring season watermark text
    const springText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    springText.setAttribute('x', '410');
    springText.setAttribute('y', `${cy - 22}`);
    springText.setAttribute('fill', '#4ade80');
    springText.setAttribute('font-size', '13');
    springText.setAttribute('font-weight', '800');
    springText.setAttribute('letter-spacing', '6');
    springText.setAttribute('opacity', '0.45');
    springText.setAttribute('text-anchor', 'middle');
    springText.setAttribute('class', 'wheel-season-watermark');
    springText.textContent = 'ВЕСНА';
    seasonsGroup.appendChild(springText);

    // Sakura blossom 🌸 at (395, cy + 18)
    const sakura = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    sakura.setAttribute('class', 'wheel-season-art');
    sakura.setAttribute('transform', `translate(395, ${cy + 18})`);
    sakura.innerHTML = `
      <g fill="rgba(74, 222, 128, 0.2)" stroke="#4ade80" stroke-width="1.2" opacity="0.9" filter="url(#wheel-glow)">
        <path d="M 0 0 C -3.5 -5 -5 -11 0 -14 C 5 -11 3.5 -5 0 0" />
        <path d="M 0 0 C -3.5 -5 -5 -11 0 -14 C 5 -11 3.5 -5 0 0" transform="rotate(72)" />
        <path d="M 0 0 C -3.5 -5 -5 -11 0 -14 C 5 -11 3.5 -5 0 0" transform="rotate(144)" />
        <path d="M 0 0 C -3.5 -5 -5 -11 0 -14 C 5 -11 3.5 -5 0 0" transform="rotate(216)" />
        <path d="M 0 0 C -3.5 -5 -5 -11 0 -14 C 5 -11 3.5 -5 0 0" transform="rotate(288)" />
      </g>
      <circle cx="0" cy="0" r="2.2" fill="#fef08a" />
    `;
    seasonsGroup.appendChild(sakura);

    // Spring breeze trail & young leaves 🍃
    const springBreeze = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    springBreeze.setAttribute('class', 'wheel-season-art');
    springBreeze.innerHTML = `
      <path d="M 310 232 Q 360 252 405 225 T 435 272" stroke="rgba(74, 222, 128, 0.24)" stroke-width="1" fill="none" stroke-dasharray="2 4" />
      <path d="M 0 -8 C 4 -4 4 4 0 8 C -4 4 -4 -4 0 -8 Z" transform="translate(348, 230) rotate(28)" fill="#4ade80" opacity="0.75" />
      <path d="M 0 -7 C 3.5 -3.5 3.5 3.5 0 7 C -3.5 3.5 -3.5 -3.5 0 -7 Z" transform="translate(422, 252) rotate(-32)" fill="#4ade80" opacity="0.65" />
      <circle cx="328" cy="292" r="1.4" fill="#4ade80" opacity="0.6" />
      <circle cx="372" cy="312" r="1.3" fill="#4ade80" opacity="0.5" />
      <circle cx="412" cy="196" r="1.5" fill="#4ade80" opacity="0.6" />
    `;
    seasonsGroup.appendChild(springBreeze);

    // --- QUADRANT 3: ЛЕТО (Bottom: 135° to 225°) ---
    const summerSector = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    summerSector.setAttribute('d', describeSvgRingSector(cx, cy, rCenter, rMonthIn, 135, 225));
    summerSector.setAttribute('fill', 'url(#grad-summer-ambient)');
    seasonsGroup.appendChild(summerSector);

    // Summer season watermark text
    const summerText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    summerText.setAttribute('x', cx);
    summerText.setAttribute('y', '412');
    summerText.setAttribute('fill', '#facc15');
    summerText.setAttribute('font-size', '13');
    summerText.setAttribute('font-weight', '800');
    summerText.setAttribute('letter-spacing', '6');
    summerText.setAttribute('opacity', '0.45');
    summerText.setAttribute('text-anchor', 'middle');
    summerText.setAttribute('class', 'wheel-season-watermark');
    summerText.textContent = 'ЛЕТО';
    seasonsGroup.appendChild(summerText);

    // Radiant Sunburst ☀️ / Solar Corona at (cx, 362)
    const sunburst = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    sunburst.setAttribute('class', 'wheel-season-art');
    sunburst.setAttribute('transform', `translate(${cx}, 362)`);
    sunburst.innerHTML = `
      <circle cx="0" cy="0" r="7.5" fill="none" stroke="#facc15" stroke-width="1.4" opacity="0.85" filter="url(#wheel-glow)" />
      <circle cx="0" cy="0" r="4" fill="#facc15" opacity="0.95" />
      <g fill="#facc15" filter="url(#wheel-glow)">
        <path d="M 0 -8 L 2 -15 L 0 -19 L -2 -15 Z" />
        <path d="M 0 -8 L 2 -15 L 0 -19 L -2 -15 Z" transform="rotate(60)" />
        <path d="M 0 -8 L 2 -15 L 0 -19 L -2 -15 Z" transform="rotate(120)" />
        <path d="M 0 -8 L 2 -15 L 0 -19 L -2 -15 Z" transform="rotate(180)" />
        <path d="M 0 -8 L 2 -15 L 0 -19 L -2 -15 Z" transform="rotate(240)" />
        <path d="M 0 -8 L 2 -15 L 0 -19 L -2 -15 Z" transform="rotate(300)" />
      </g>
      <g fill="#facc15" opacity="0.85">
        <path d="M 0 -8 L 1.5 -12 L 0 -14 L -1.5 -12 Z" transform="rotate(30)" />
        <path d="M 0 -8 L 1.5 -12 L 0 -14 L -1.5 -12 Z" transform="rotate(90)" />
        <path d="M 0 -8 L 1.5 -12 L 0 -14 L -1.5 -12 Z" transform="rotate(150)" />
        <path d="M 0 -8 L 1.5 -12 L 0 -14 L -1.5 -12 Z" transform="rotate(210)" />
        <path d="M 0 -8 L 1.5 -12 L 0 -14 L -1.5 -12 Z" transform="rotate(270)" />
        <path d="M 0 -8 L 1.5 -12 L 0 -14 L -1.5 -12 Z" transform="rotate(330)" />
      </g>
    `;
    seasonsGroup.appendChild(sunburst);

    // Summer sparkles & solar flare points
    const summerSparkles = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    summerSparkles.setAttribute('class', 'wheel-season-art');
    summerSparkles.innerHTML = `
      <path d="M 0 -6 L 1.5 -1.5 L 6 0 L 1.5 1.5 L 0 6 L -1.5 1.5 L -6 0 L -1.5 -1.5 Z" transform="translate(${cx - 50}, 372)" fill="#fef08a" opacity="0.8" />
      <path d="M 0 -6 L 1.5 -1.5 L 6 0 L 1.5 1.5 L 0 6 L -1.5 1.5 L -6 0 L -1.5 -1.5 Z" transform="translate(${cx + 50}, 372)" fill="#fef08a" opacity="0.8" />
      <circle cx="${cx - 28}" cy="336" r="1.4" fill="#facc15" opacity="0.6" />
      <circle cx="${cx + 28}" cy="336" r="1.4" fill="#facc15" opacity="0.6" />
      <circle cx="${cx - 72}" cy="348" r="1.5" fill="#facc15" opacity="0.5" />
      <circle cx="${cx + 72}" cy="348" r="1.5" fill="#facc15" opacity="0.5" />
    `;
    seasonsGroup.appendChild(summerSparkles);

    // --- QUADRANT 4: ОСЕНЬ (Left: 225° to 315°) ---
    const autumnSector = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    autumnSector.setAttribute('d', describeSvgRingSector(cx, cy, rCenter, rMonthIn, 225, 315));
    autumnSector.setAttribute('fill', 'url(#grad-autumn-ambient)');
    seasonsGroup.appendChild(autumnSector);

    // Autumn season watermark text
    const autumnText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    autumnText.setAttribute('x', '110');
    autumnText.setAttribute('y', `${cy - 22}`);
    autumnText.setAttribute('fill', '#f97316');
    autumnText.setAttribute('font-size', '13');
    autumnText.setAttribute('font-weight', '800');
    autumnText.setAttribute('letter-spacing', '6');
    autumnText.setAttribute('opacity', '0.45');
    autumnText.setAttribute('text-anchor', 'middle');
    autumnText.setAttribute('class', 'wheel-season-watermark');
    autumnText.textContent = 'ОСЕНЬ';
    seasonsGroup.appendChild(autumnText);

    // Momiji / Japanese maple leaf 🍁 at (125, cy + 18)
    const maple = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    maple.setAttribute('class', 'wheel-season-art');
    maple.setAttribute('transform', `translate(125, ${cy + 18}) scale(0.9)`);
    maple.innerHTML = `
      <g fill="rgba(249, 115, 22, 0.22)" stroke="#f97316" stroke-width="1.2" filter="url(#wheel-glow)">
        <path d="M 0 10 L 0 3 C -2 3 -5 1 -7 -3 C -8 -5 -11 -6 -13 -4 C -12 -7 -14 -9 -17 -8 C -14 -11 -12 -13 -13 -17 C -10 -15 -8 -13 -6 -13 C -5 -16 -4 -19 0 -22 C 4 -19 5 -16 6 -13 C 8 -13 10 -15 13 -17 C 12 -13 14 -11 17 -8 C 14 -9 12 -7 13 -4 C 11 -6 8 -5 7 -3 C 5 1 2 3 0 3 Z" />
      </g>
      <path d="M 0 3 L 0 -19 M 0 1 L -12 -7 M 0 1 L 12 -7 M 0 2 L -7 -2 M 0 2 L 7 -2" stroke="#f97316" stroke-width="0.8" opacity="0.75" />
      <path d="M 0 3 L 0 10" stroke="#f97316" stroke-width="1.2" />
    `;
    seasonsGroup.appendChild(maple);

    // Autumn breeze & drifting foliage
    const autumnBreeze = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    autumnBreeze.setAttribute('class', 'wheel-season-art');
    autumnBreeze.innerHTML = `
      <path d="M 210 232 Q 160 252 115 225 T 85 272" stroke="rgba(249, 115, 22, 0.24)" stroke-width="1" fill="none" stroke-dasharray="2 4" />
      <path d="M 0 -8 C 4 -4 4 4 0 8 C -4 4 -4 -4 0 -8 Z" transform="translate(172, 230) rotate(-28)" fill="#f97316" opacity="0.75" />
      <path d="M 0 -7 C 3.5 -3.5 3.5 3.5 0 7 C -3.5 3.5 -3.5 -3.5 0 -7 Z" transform="translate(98, 252) rotate(36)" fill="#fb923c" opacity="0.65" />
      <circle cx="192" cy="292" r="1.4" fill="#f97316" opacity="0.6" />
      <circle cx="148" cy="312" r="1.3" fill="#f97316" opacity="0.5" />
      <circle cx="108" cy="196" r="1.5" fill="#f97316" opacity="0.6" />
    `;
    seasonsGroup.appendChild(autumnBreeze);

    // Solstice & Equinox 4 Dividing Axes (45°, 135°, 225°, 315°) from center hub to month ring edge
    [45, 135, 225, 315].forEach(ang => {
      const rad = ang * Math.PI / 180;
      const x1 = (cx + rCenter * Math.sin(rad)).toFixed(1);
      const y1 = (cy - rCenter * Math.cos(rad)).toFixed(1);
      const x2 = (cx + rMonthOut * Math.sin(rad)).toFixed(1);
      const y2 = (cy - rMonthOut * Math.cos(rad)).toFixed(1);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.setAttribute('stroke', 'rgba(255, 255, 255, 0.22)');
      line.setAttribute('stroke-width', '1.2');
      line.setAttribute('stroke-dasharray', '4 3');
      line.setAttribute('class', 'wheel-dividing-line');
      seasonsGroup.appendChild(line);

      // Connecting diamond marker at border of month ring (R = 192)
      const xMid = cx + rMonthIn * Math.sin(rad);
      const yMid = cy - rMonthIn * Math.cos(rad);
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      node.setAttribute('d', 'M 0 -3.5 L 3.5 0 L 0 3.5 L -3.5 0 Z');
      node.setAttribute('transform', `translate(${xMid.toFixed(1)}, ${yMid.toFixed(1)})`);
      node.setAttribute('fill', '#ffffff');
      node.setAttribute('opacity', '0.85');
      seasonsGroup.appendChild(node);
    });

    svg.appendChild(seasonsGroup);

    // 2. Single Bolder Month Ring (R_in = 192, R_out = 248) - Months Colored by Season
    const monthsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    monthsGroup.setAttribute('class', 'wheel-months-group');

    for (let m = 0; m < 12; m++) {
      const sAng = (m * 30 - 15 + 360) % 360;
      const eAng = (m * 30 + 15 + 360) % 360;
      const midAng = (m * 30) % 360;
      const season = getMonthSeasonInfo(m);

      // Month sector cell
      const sectorCell = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      sectorCell.setAttribute('d', describeSvgRingSector(cx, cy, rMonthIn, rMonthOut, sAng, eAng));
      sectorCell.setAttribute('fill', season.bg);
      sectorCell.setAttribute('stroke', season.border);
      sectorCell.setAttribute('stroke-width', '1');
      sectorCell.setAttribute('class', 'wheel-month-cell');
      monthsGroup.appendChild(sectorCell);

      // Accent border arc along the outer rim in season color
      const rimArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      rimArc.setAttribute('d', describeSvgArc(cx, cy, rMonthOut, sAng, eAng));
      rimArc.setAttribute('fill', 'none');
      rimArc.setAttribute('stroke', season.color);
      rimArc.setAttribute('stroke-width', '2.2');
      rimArc.setAttribute('opacity', '0.75');
      monthsGroup.appendChild(rimArc);

      // 10-day & 20-day inner tick marks
      [10, 20].forEach(dayTick => {
        const tickAng = (sAng + (dayTick / 30) * 30) % 360;
        const tickRad = tickAng * Math.PI / 180;
        const tickLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tickLine.setAttribute('x1', (cx + rMonthIn * Math.sin(tickRad)).toFixed(1));
        tickLine.setAttribute('y1', (cy - rMonthIn * Math.cos(tickRad)).toFixed(1));
        tickLine.setAttribute('x2', (cx + (rMonthIn + 4.5) * Math.sin(tickRad)).toFixed(1));
        tickLine.setAttribute('y2', (cy - (rMonthIn + 4.5) * Math.cos(tickRad)).toFixed(1));
        tickLine.setAttribute('stroke', season.color);
        tickLine.setAttribute('stroke-width', '1');
        tickLine.setAttribute('opacity', '0.45');
        monthsGroup.appendChild(tickLine);
      });

      // Month text positioned in the center of the bold ring
      const rad = midAng * Math.PI / 180;
      const rText = (rMonthIn + rMonthOut) / 2 - 2;
      const tx = cx + rText * Math.sin(rad);
      const ty = cy - rText * Math.cos(rad);

      const mText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      mText.setAttribute('x', tx.toFixed(1));
      mText.setAttribute('y', (ty + 4).toFixed(1));
      mText.setAttribute('fill', season.color);
      mText.setAttribute('font-size', '11.5');
      mText.setAttribute('font-weight', '700');
      mText.setAttribute('text-anchor', 'middle');
      mText.setAttribute('letter-spacing', '0.8');
      mText.setAttribute('font-family', 'inherit');
      mText.textContent = MONTH_NAMES[m];
      monthsGroup.appendChild(mText);

      // Small season indicator dot near the outer edge
      const rDot = rMonthOut - 8;
      const dx = cx + rDot * Math.sin(rad);
      const dy = cy - rDot * Math.cos(rad);
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', dx.toFixed(1));
      dot.setAttribute('cy', dy.toFixed(1));
      dot.setAttribute('r', '1.8');
      dot.setAttribute('fill', season.color);
      dot.setAttribute('opacity', '0.85');
      monthsGroup.appendChild(dot);
    }

    svg.appendChild(monthsGroup);

    // 3. Viewing Sector Beams (bursting out from center to outer month perimeter with full sector fill)
    const sectorsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    sectorsGroup.setAttribute('class', 'wheel-sectors-group');

    activeWheelLayers.forEach((layer) => {
      const sAng = dateToWheelAngle(layer.startDate);
      const rawEAng = dateToWheelAngle(layer.endDate);
      const eAng = rawEAng !== null ? rawEAng : sAng;

      if (sAng === null) return;

      let diff = (eAng - sAng) % 360;
      if (diff < 0) diff += 360;
      // Minimum angular wedge width for short 1-2 day viewings so the beam is clearly visible and punchy
      if (diff < 3.5) diff = 3.5;
      if (diff >= 359.99) diff = 359.99;
      const actualEnd = (sAng + diff) % 360;

      const layerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      layerGroup.setAttribute('class', 'wheel-sector-group');
      layerGroup.setAttribute('data-layer-id', layer.id);
      if (!layer.active) {
        layerGroup.classList.add('is-hidden');
        layerGroup.style.display = 'none';
        layerGroup.style.opacity = '0';
      }

      const rad1 = sAng * Math.PI / 180;
      const rad2 = actualEnd * Math.PI / 180;

      const x1Out = cx + rMonthOut * Math.sin(rad1);
      const y1Out = cy - rMonthOut * Math.cos(rad1);
      const x2Out = cx + rMonthOut * Math.sin(rad2);
      const y2Out = cy - rMonthOut * Math.cos(rad2);

      const largeArcFlag = diff > 180 ? 1 : 0;

      // Filled Sector Wedge from center (cx, cy) all the way out to outer month ring perimeter (rMonthOut = 248)
      const sectorPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const sectorD = `M ${cx} ${cy} L ${x1Out.toFixed(2)} ${y1Out.toFixed(2)} A ${rMonthOut} ${rMonthOut} 0 ${largeArcFlag} 1 ${x2Out.toFixed(2)} ${y2Out.toFixed(2)} Z`;
      sectorPath.setAttribute('d', sectorD);
      sectorPath.setAttribute('fill', layer.color);
      sectorPath.setAttribute('fill-opacity', '0.28');
      sectorPath.setAttribute('class', 'wheel-sector-fill');
      sectorPath.setAttribute('data-layer-id', layer.id);

      // Bright outer cap arc along the outer month border
      const capPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const capD = `M ${x1Out.toFixed(2)} ${y1Out.toFixed(2)} A ${rMonthOut} ${rMonthOut} 0 ${largeArcFlag} 1 ${x2Out.toFixed(2)} ${y2Out.toFixed(2)}`;
      capPath.setAttribute('d', capD);
      capPath.setAttribute('fill', 'none');
      capPath.setAttribute('stroke', layer.color);
      capPath.setAttribute('stroke-width', '3.5');
      capPath.setAttribute('stroke-linecap', 'round');
      capPath.setAttribute('class', 'wheel-sector-cap');
      capPath.setAttribute('filter', 'url(#wheel-glow)');

      // Ray 1 (start date boundary line from center to outer rim)
      const ray1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ray1.setAttribute('x1', cx.toString());
      ray1.setAttribute('y1', cy.toString());
      ray1.setAttribute('x2', x1Out.toFixed(2));
      ray1.setAttribute('y2', y1Out.toFixed(2));
      ray1.setAttribute('stroke', layer.color);
      ray1.setAttribute('stroke-width', '1.6');
      ray1.setAttribute('opacity', '0.85');
      ray1.setAttribute('class', 'wheel-sector-ray');

      // Ray 2 (end date boundary line from center to outer rim)
      const ray2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ray2.setAttribute('x1', cx.toString());
      ray2.setAttribute('y1', cy.toString());
      ray2.setAttribute('x2', x2Out.toFixed(2));
      ray2.setAttribute('y2', y2Out.toFixed(2));
      ray2.setAttribute('stroke', layer.color);
      ray2.setAttribute('stroke-width', '1.6');
      ray2.setAttribute('opacity', '0.85');
      ray2.setAttribute('class', 'wheel-sector-ray');

      // Start pin dot on outer rim
      const dotStart = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dotStart.setAttribute('cx', x1Out.toFixed(1));
      dotStart.setAttribute('cy', y1Out.toFixed(1));
      dotStart.setAttribute('r', '2.5');
      dotStart.setAttribute('fill', '#ffffff');
      dotStart.setAttribute('stroke', layer.color);
      dotStart.setAttribute('stroke-width', '1');
      dotStart.setAttribute('pointer-events', 'none');

      // Hover on sector highlights the list row in the side panel (NO popup tooltip!)
      sectorPath.addEventListener('mouseenter', () => {
        layerGroup.classList.add('is-highlighted');
        const listRow = document.querySelector(`.wheel-layer-row[data-layer-id="${layer.id}"]`);
        if (listRow) listRow.classList.add('is-hovered');
      });
      sectorPath.addEventListener('mouseleave', () => {
        layerGroup.classList.remove('is-highlighted');
        const listRow = document.querySelector(`.wheel-layer-row[data-layer-id="${layer.id}"]`);
        if (listRow) listRow.classList.remove('is-hovered');
      });

      layerGroup.appendChild(sectorPath);
      layerGroup.appendChild(ray1);
      layerGroup.appendChild(ray2);
      layerGroup.appendChild(capPath);
      layerGroup.appendChild(dotStart);

      sectorsGroup.appendChild(layerGroup);
    });

    svg.appendChild(sectorsGroup);

    // 4. Center Hub (R = 76)
    const centerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    centerGroup.setAttribute('class', 'wheel-center-group');

    const centerBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    centerBg.setAttribute('cx', cx);
    centerBg.setAttribute('cy', cy);
    centerBg.setAttribute('r', rCenter.toString());
    centerBg.setAttribute('fill', '#121214');
    centerBg.setAttribute('stroke', 'rgba(255, 255, 255, 0.18)');
    centerBg.setAttribute('stroke-width', '1.5');
    centerGroup.appendChild(centerBg);

    const item = activeWheelItemId ? state.items[activeWheelItemId] : null;

    if (item && (item.poster || item.cdnPoster)) {
      const posterImg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      posterImg.setAttribute('x', (cx - rCenter).toString());
      posterImg.setAttribute('y', (cy - rCenter).toString());
      posterImg.setAttribute('width', (rCenter * 2).toString());
      posterImg.setAttribute('height', (rCenter * 2).toString());
      posterImg.setAttribute('href', item.poster || item.cdnPoster);
      posterImg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      posterImg.setAttribute('clip-path', 'url(#wheel-center-clip)');
      posterImg.setAttribute('opacity', '0.22');
      centerGroup.appendChild(posterImg);
    }

    // Mini 4-color compass icon in center
    const miniCompass = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    miniCompass.setAttribute('transform', `translate(${cx}, ${cy - 16}) scale(1)`);
    miniCompass.innerHTML = `
      <path d="M 0 0 L -8 -8 A 11 11 0 0 1 8 -8 Z" fill="#38bdf8" />
      <path d="M 0 0 L 8 -8 A 11 11 0 0 1 8 8 Z" fill="#4ade80" />
      <path d="M 0 0 L 8 8 A 11 11 0 0 1 -8 8 Z" fill="#facc15" />
      <path d="M 0 0 L -8 8 A 11 11 0 0 1 -8 -8 Z" fill="#f97316" />
      <circle cx="0" cy="0" r="3" fill="#121214" stroke="rgba(255,255,255,0.4)" stroke-width="0.7" />
    `;
    centerGroup.appendChild(miniCompass);

    // Center stats text
    const textTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textTitle.setAttribute('x', cx);
    textTitle.setAttribute('y', cy + 14);
    textTitle.setAttribute('fill', '#fafafa');
    textTitle.setAttribute('font-size', '14');
    textTitle.setAttribute('font-weight', '700');
    textTitle.setAttribute('text-anchor', 'middle');
    textTitle.textContent = `${activeWheelLayers.length}`;
    centerGroup.appendChild(textTitle);

    const textSub = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textSub.setAttribute('x', cx);
    textSub.setAttribute('y', cy + 28);
    textSub.setAttribute('fill', '#a1a1aa');
    textSub.setAttribute('font-size', '10');
    textSub.setAttribute('font-weight', '500');
    textSub.setAttribute('text-anchor', 'middle');
    textSub.textContent = activeWheelLayers.length === 1 ? 'просмотр' : (activeWheelLayers.length >= 2 && activeWheelLayers.length <= 4 ? 'просмотра' : 'просмотров');
    centerGroup.appendChild(textSub);

    svg.appendChild(centerGroup);
    container.appendChild(svg);
  }

  function setupYearWheelEvents() {
    document.getElementById('btn-open-year-wheel')?.addEventListener('click', () => {
      if (currentDetailItemId) {
        saveCurrentItemDetail(false);
        openYearWheelModal(currentDetailItemId);
      }
    });

    document.getElementById('btn-wheel-toggle-all')?.addEventListener('click', () => {
      const anyActive = activeWheelLayers.some(l => l.active);
      activeWheelLayers.forEach(l => {
        l.active = !anyActive;
        updateSectorVisibility(l.id, l.active);
      });
      renderYearWheelLayersList();
    });
  }

  // --- Online Search Service (Shikimori + Jikan + Kitsu + Cinemeta + Local Catalog) ---
  async function performOnlineSearch() {
    const currentSearchId = ++activeSearchId;
    const query = document.getElementById('api-search-input').value.trim();
    const mediaType = document.getElementById('search-media-type').value;
    const statusEl = document.getElementById('search-status');
    const gridEl = document.getElementById('search-results-grid');
    const spinner = document.getElementById('search-spinner');

    if (!query) {
      statusEl.textContent = 'Пожалуйста, введите название для поиска';
      statusEl.style.display = 'block';
      gridEl.innerHTML = '';
      return;
    }

    statusEl.textContent = 'Идет поиск...';
    statusEl.style.display = 'block';
    gridEl.innerHTML = '';
    if (spinner) spinner.style.display = 'inline-block';

    const results = [];
    const seenTitles = new Set();

    function addResult(item) {
      const norm = (item.title || '').toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
      if (norm && !seenTitles.has(norm)) {
        seenTitles.add(norm);
        results.push(item);
      }
    }

    // 1. Instant Local Catalog Search (Presets + Extended Media Database)
    const presets = window.TIERLIST_PRESETS || {};
    const localBank = [
      ...(presets.anime || []),
      ...(presets.movies || []),
      ...(presets.extendedMedia || [])
    ];
    const lowerQ = query.toLowerCase();

    localBank.forEach(p => {
      if (mediaType !== 'all' && p.type !== mediaType) return;
      const t = (p.title || '').toLowerCase();
      const ot = (p.originalTitle || '').toLowerCase();
      if (t.includes(lowerQ) || ot.includes(lowerQ)) {
        addResult({
          ...p,
          id: `local-search-${p.id || Date.now()}-${Math.floor(Math.random() * 1000)}`,
          fallbackPoster: p.fallbackPoster || presets.createPosterSVG(p.title, p.type)
        });
      }
    });

    // Render local instant results immediately so user gets 0ms feedback
    if (results.length > 0 && currentSearchId === activeSearchId) {
      renderSearchResults(results);
    }

    // 2. Parallel Remote API Searches with timeouts
    const fetchWithTimeout = (url, options = {}, timeoutMs = 2000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      return fetch(url, { ...options, signal: controller.signal })
        .finally(() => clearTimeout(timer));
    };

    const searchPromises = [];

    // 2a. Anime: Shikimori API (Primary Russian & English anime database)
    if (mediaType === 'all' || mediaType === 'anime') {
      searchPromises.push(
        fetchWithTimeout(`https://shikimori.one/api/animes?search=${encodeURIComponent(query)}&limit=8`)
          .then(res => res.ok ? res.json() : [])
          .then(data => {
            (Array.isArray(data) ? data : []).forEach(shiki => {
              const titleRu = shiki.russian || shiki.name || 'Аниме';
              const year = shiki.aired_on ? shiki.aired_on.substring(0, 4) : '';
              const rating = shiki.score ? parseFloat(shiki.score).toFixed(1) : '8.0';
              const poster = shiki.image ? (shiki.image.original.startsWith('http') ? shiki.image.original : `https://shikimori.one${shiki.image.original}`) : '';
              addResult({
                id: `shiki-${shiki.id}`,
                title: shiki.russian ? `${shiki.russian} (${shiki.name})` : shiki.name,
                originalTitle: shiki.name,
                type: 'anime',
                year: year,
                duration: shiki.episodes ? `${shiki.episodes} эп.` : '',
                rating: rating,
                poster: poster,
                fallbackPoster: presets.createPosterSVG(titleRu, 'anime'),
                synopsis: ''
              });
            });
          })
          .catch(() => {})
      );

      // 2b. Anime: Jikan / MyAnimeList API
      searchPromises.push(
        fetchWithTimeout(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=6`)
          .then(res => res.ok ? res.json() : { data: [] })
          .then(data => {
            (data.data || []).forEach(j => {
              const title = j.title || 'Аниме';
              const year = j.year ? j.year.toString() : (j.aired?.from ? j.aired.from.substring(0, 4) : '');
              const rating = j.score ? parseFloat(j.score).toFixed(1) : '8.0';
              const poster = j.images?.jpg?.large_image_url || j.images?.jpg?.image_url || '';
              addResult({
                id: `jikan-${j.mal_id}`,
                title: title,
                originalTitle: j.title_japanese || j.title_english || title,
                type: 'anime',
                year: year,
                duration: j.episodes ? `${j.episodes} эп.` : '',
                rating: rating,
                poster: poster,
                fallbackPoster: presets.createPosterSVG(title, 'anime'),
                synopsis: j.synopsis || ''
              });
            });
          })
          .catch(() => {})
      );

      // 2c. Anime: Kitsu API
      searchPromises.push(
        fetchWithTimeout(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(query)}&page[limit]=6`, {
          headers: { 'Accept': 'application/vnd.api+json' }
        })
          .then(res => res.ok ? res.json() : { data: [] })
          .then(data => {
            (data.data || []).forEach(item => {
              const attr = item.attributes || {};
              const title = attr.canonicalTitle || attr.titles?.en || attr.titles?.ja_jp || 'Аниме';
              const year = attr.startDate ? attr.startDate.substring(0, 4) : '';
              const rating = attr.averageRating ? (parseFloat(attr.averageRating) / 10).toFixed(1) : '8.0';
              const poster = attr.posterImage?.medium || attr.posterImage?.small || '';
              addResult({
                id: `kitsu-${item.id}`,
                title: title,
                originalTitle: attr.titles?.ja_jp || '',
                type: 'anime',
                year: year,
                duration: attr.episodeCount ? `${attr.episodeCount} эп.` : '',
                rating: rating,
                poster: poster,
                fallbackPoster: presets.createPosterSVG(title, 'anime'),
                synopsis: attr.synopsis || ''
              });
            });
          })
          .catch(() => {})
      );
    }

    // 2d. Movie & Series: Cinemeta (IMDb meta catalog)
    if (mediaType === 'all' || mediaType === 'movie') {
      searchPromises.push(
        fetchWithTimeout(`https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(query)}.json`)
          .then(res => res.ok ? res.json() : { metas: [] })
          .then(data => {
            (data.metas || []).slice(0, 6).forEach(m => {
              const title = m.name || 'Фильм';
              const year = m.year ? m.year.toString() : '';
              const rating = m.imdbRating || '7.8';
              const poster = m.poster || '';
              addResult({
                id: `cine-m-${m.imdb_id || Math.random().toString(36).substr(2, 9)}`,
                title: title,
                originalTitle: title,
                type: 'movie',
                year: year,
                duration: '',
                rating: rating,
                poster: poster,
                fallbackPoster: presets.createPosterSVG(title, 'movie'),
                synopsis: m.description || ''
              });
            });
          })
          .catch(() => {})
      );

      searchPromises.push(
        fetchWithTimeout(`https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(query)}.json`)
          .then(res => res.ok ? res.json() : { metas: [] })
          .then(data => {
            (data.metas || []).slice(0, 6).forEach(s => {
              const title = s.name || 'Сериал';
              const year = s.year ? s.year.toString() : '';
              const rating = s.imdbRating || '8.0';
              const poster = s.poster || '';
              addResult({
                id: `cine-s-${s.imdb_id || Math.random().toString(36).substr(2, 9)}`,
                title: title,
                originalTitle: title,
                type: mediaType === 'movie' ? 'movie' : 'anime',
                year: year,
                duration: '',
                rating: rating,
                poster: poster,
                fallbackPoster: presets.createPosterSVG(title, mediaType === 'movie' ? 'movie' : 'anime'),
                synopsis: s.description || ''
              });
            });
          })
          .catch(() => {})
      );
    }

    try {
      await Promise.allSettled(searchPromises);

      // Guard against race condition: if another search started while awaiting, discard stale results
      if (currentSearchId !== activeSearchId) return;

      // 3. Fallback quick title if zero matches anywhere
      if (results.length === 0) {
        results.push({
          id: `custom-quick-${Date.now()}`,
          title: query,
          type: mediaType === 'movie' ? 'movie' : 'anime',
          year: new Date().getFullYear().toString(),
          rating: '8.0',
          poster: '',
          fallbackPoster: presets.createPosterSVG(query, mediaType === 'movie' ? 'movie' : 'anime'),
          synopsis: 'Пользовательский тайтл'
        });
      }

      renderSearchResults(results);
    } catch (err) {
      if (currentSearchId !== activeSearchId) return;
      if (results.length > 0) {
        renderSearchResults(results);
      } else {
        statusEl.textContent = 'Ошибка сети. Создайте тайтл вручную на соседней вкладке.';
      }
    } finally {
      if (currentSearchId === activeSearchId && spinner) spinner.style.display = 'none';
    }
  }

  function renderSearchResults(items) {
    const statusEl = document.getElementById('search-status');
    const gridEl = document.getElementById('search-results-grid');
    statusEl.style.display = 'none';
    gridEl.innerHTML = '';

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'search-result-item';

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'search-item-thumb-wrap';
      thumbWrap.setAttribute('role', 'button');
      thumbWrap.setAttribute('tabindex', '0');

      const thumb = document.createElement('img');
      thumb.className = 'search-item-thumb';
      thumb.alt = item.title;
      thumb.src = item.poster || item.fallbackPoster;
      thumb.onerror = function () { this.src = item.fallbackPoster; };

      const hoverBadge = document.createElement('div');
      hoverBadge.className = 'search-thumb-hover-badge';
      hoverBadge.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;

      thumbWrap.appendChild(thumb);
      thumbWrap.appendChild(hoverBadge);

      // Click or press Enter on cover to open preview modal
      thumbWrap.addEventListener('click', (e) => {
        e.stopPropagation();
        openSearchPreviewModal(item);
      });
      thumbWrap.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          openSearchPreviewModal(item);
        }
      });

      const details = document.createElement('div');
      details.className = 'search-item-details';

      const title = document.createElement('div');
      title.className = 'search-item-title';
      title.textContent = item.title;
      title.style.cursor = 'pointer';
      title.addEventListener('click', (e) => {
        e.stopPropagation();
        openSearchPreviewModal(item);
      });

      const meta = document.createElement('div');
      meta.className = 'search-item-meta';
      meta.innerHTML = `
        <span class="card-badge-type ${item.type}">${item.type === 'anime' ? 'Аниме' : 'Фильм'}</span>
        <span>⭐ ${item.rating || '—'}</span>
        <span>${item.year || ''}</span>
      `;

      details.appendChild(title);
      details.appendChild(meta);

      const addBtn = document.createElement('button');
      addBtn.className = item._addedToPool ? 'btn btn-xs btn-outline' : 'btn btn-xs btn-primary';
      addBtn.dataset.searchItemId = item.id;
      addBtn.textContent = item._addedToPool ? '✓ Добавлен' : '+ В банк';
      addBtn.disabled = !!item._addedToPool;
      addBtn.onclick = (e) => {
        e.stopPropagation();
        item._addedToPool = true;
        addItemToPool(item);
        addBtn.className = 'btn btn-xs btn-outline';
        addBtn.textContent = '✓ Добавлен';
        addBtn.disabled = true;
      };

      card.appendChild(thumbWrap);
      card.appendChild(details);
      card.appendChild(addBtn);
      gridEl.appendChild(card);
    });
  }

  function cleanSynopsisText(text) {
    if (!text) return '';
    return text
      .replace(/\[\/?(?:b|i|u|character|anime|manga|url)[^\]]*\]/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?[^>]+(>|$)/g, '')
      .trim();
  }

  function openSearchPreviewModal(item) {
    if (!item) return;
    currentSearchPreviewItem = item;

    const posterImg = document.getElementById('search-preview-poster-img');
    const badgeEl = document.getElementById('search-preview-type-badge');
    const titleEl = document.getElementById('search-preview-title');
    const origTitleEl = document.getElementById('search-preview-orig-title');
    const typeEl = document.getElementById('search-preview-type');
    const yearEl = document.getElementById('search-preview-year');
    const durationEl = document.getElementById('search-preview-duration');
    const ratingEl = document.getElementById('search-preview-rating');
    const synopsisEl = document.getElementById('search-preview-synopsis');
    const addBtn = document.getElementById('btn-search-preview-add');

    const fallbackSrc = item.fallbackPoster || window.TIERLIST_PRESETS.createPosterSVG(item.title, item.type);
    if (posterImg) {
      posterImg.src = item.poster || item.cdnPoster || fallbackSrc;
      posterImg.onerror = function () { this.src = fallbackSrc; };
    }

    if (badgeEl) {
      badgeEl.className = `card-badge-type ${item.type}`;
      badgeEl.textContent = item.type === 'anime' ? 'Аниме' : 'Фильм';
    }

    if (titleEl) {
      titleEl.textContent = item.title;
    }

    if (origTitleEl) {
      let orig = item.originalTitle || '';
      if (!orig && item.title) {
        const match = item.title.match(/\(([^)]+)\)/);
        if (match) orig = match[1];
      }
      if (orig && orig !== item.title) {
        origTitleEl.textContent = orig;
        origTitleEl.style.display = 'block';
      } else {
        origTitleEl.textContent = '';
        origTitleEl.style.display = 'none';
      }
    }

    if (typeEl) {
      typeEl.textContent = item.type === 'anime' ? 'Аниме' : 'Фильм';
    }

    if (yearEl) {
      yearEl.textContent = item.year || '—';
    }

    if (durationEl) {
      durationEl.textContent = item.duration || (item.type === 'anime' ? 'Эпизоды не указаны' : 'Хронометраж не указан');
    }

    if (ratingEl) {
      ratingEl.textContent = item.rating ? `⭐ ${item.rating}` : '—';
    }

    if (synopsisEl) {
      synopsisEl.textContent = cleanSynopsisText(item.synopsis || item.description) || 'Описание сюжета отсутствует или не предоставлено API.';
    }

    // Dynamic enrichment for Cinemeta items if synopsis or details are missing
    if ((!item.synopsis || item.synopsis === '') && item.id && item.id.startsWith('cine-')) {
      const imdbId = item.imdb_id || item.id.replace(/^cine-[ms]-/, '');
      if (imdbId && imdbId.startsWith('tt')) {
        const cat = item.type === 'movie' ? 'movie' : 'series';
        fetch(`https://v3-cinemeta.strem.io/meta/${cat}/${imdbId}.json`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.meta && currentSearchPreviewItem === item) {
              if (data.meta.description) {
                item.synopsis = data.meta.description;
                if (synopsisEl) synopsisEl.textContent = cleanSynopsisText(data.meta.description);
              }
              if (data.meta.imdbRating && ratingEl) {
                item.rating = data.meta.imdbRating;
                ratingEl.textContent = `⭐ ${data.meta.imdbRating}`;
              }
              if (data.meta.runtime && durationEl) {
                item.duration = data.meta.runtime;
                durationEl.textContent = data.meta.runtime;
              }
            }
          })
          .catch(() => {});
      }
    }

    // Dynamic enrichment for Shikimori items if synopsis is missing
    if ((!item.synopsis || item.synopsis === '') && item.id && item.id.startsWith('shiki-')) {
      const shikiId = item.id.replace('shiki-', '');
      if (shikiId) {
        fetch(`https://shikimori.one/api/animes/${shikiId}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data && currentSearchPreviewItem === item) {
              if (data.description) {
                item.synopsis = data.description;
                if (synopsisEl) synopsisEl.textContent = cleanSynopsisText(data.description);
              }
              if (data.episodes && durationEl && !item.duration) {
                item.duration = `${data.episodes} эп.`;
                durationEl.textContent = `${data.episodes} эп.`;
              }
            }
          })
          .catch(() => {});
      }
    }

    // Check if already added from this search session
    const isAdded = !!item._addedToPool;
    if (addBtn) {
      if (isAdded) {
        addBtn.className = 'btn btn-outline';
        addBtn.innerHTML = '<span>✓ Добавлен в банк</span>';
        addBtn.disabled = true;
      } else {
        addBtn.className = 'btn btn-primary';
        addBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          <span>+ Добавить в банк</span>
        `;
        addBtn.disabled = false;
      }
    }

    openModal('modal-search-preview');
  }

  function addItemToPool(item, targetTierId = null) {
    item._addedToPool = true;
    let uniqueId = item.id || `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    if (state.items[uniqueId]) {
      uniqueId = `${uniqueId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    }
    const newItem = {
      ...item,
      id: uniqueId,
      fallbackPoster: item.fallbackPoster || window.TIERLIST_PRESETS.createPosterSVG(item.title, item.type)
    };

    state.items[uniqueId] = newItem;

    if (targetTierId && targetTierId !== 'pool') {
      const tier = state.tiers.find(t => t.id === targetTierId);
      if (tier) {
        tier.items.push(uniqueId);
      } else {
        state.pool.push(uniqueId);
      }
    } else {
      state.pool.push(uniqueId);
    }

    saveState();
    renderAll();
    showToast(`«${item.title}» добавлен в коллекцию`);
  }

  // --- Manual Item Form & File Upload ---
  function setupManualAddForm() {
    const form = document.getElementById('manual-add-form');
    const fileInput = document.getElementById('manual-poster-file');
    const urlInput = document.getElementById('manual-poster-url');
    const previewWrap = document.getElementById('manual-preview-card');
    const tierSelect = document.getElementById('manual-target-tier');

    // Populate target tier options
    function updateTierSelect() {
      if (!tierSelect) return;
      tierSelect.innerHTML = '<option value="pool">В банк тайтлов (неотсортированное)</option>';
      state.tiers.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `Сразу в уровень «${t.name}»`;
        tierSelect.appendChild(opt);
      });
    }
    updateTierSelect();

    // Local file picker with automatic thumbnail compressor
    let loadedDataUrl = null;
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const compressed = await compressImageFile(file);
        if (compressed) {
          loadedDataUrl = compressed;
          urlInput.value = '';
          updatePreview(loadedDataUrl);
        }
      });
    }

    if (urlInput) {
      urlInput.addEventListener('input', () => {
        if (urlInput.value.trim()) {
          loadedDataUrl = null;
          updatePreview(urlInput.value.trim());
        }
      });
    }

    function updatePreview(src) {
      if (!previewWrap) return;
      previewWrap.innerHTML = '';
      const img = document.createElement('img');
      img.src = src;
      img.onerror = () => {
        previewWrap.innerHTML = '<div class="preview-placeholder">Ошибка загрузки ссылки</div>';
      };
      previewWrap.appendChild(img);
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = document.getElementById('manual-title').value.trim();
        const type = document.getElementById('manual-type').value;
        const year = document.getElementById('manual-year').value.trim();
        const duration = document.getElementById('manual-duration').value.trim();
        const rating = document.getElementById('manual-rating').value.trim() || '8.0';
        const targetTier = tierSelect.value;
        const posterSrc = loadedDataUrl || urlInput.value.trim();

        if (!title) return;

        const newItem = {
          id: `custom-${Date.now()}`,
          title: title,
          type: type,
          year: year,
          duration: duration,
          rating: rating,
          poster: posterSrc,
          fallbackPoster: window.TIERLIST_PRESETS.createPosterSVG(title, type)
        };

        addItemToPool(newItem, targetTier);
        form.reset();
        loadedDataUrl = null;
        if (previewWrap) {
          previewWrap.innerHTML = '<div class="preview-placeholder">Предпросмотр постера появится здесь</div>';
        }
        closeModal('modal-add-item');
      });
    }
  }

  // --- High-Res PNG Export (Canvas 2D + HTML2Canvas) ---
  let exportImageBlobUrl = null;

  async function generateHighResPNG() {
    const loadingEl = document.getElementById('export-loading-indicator');
    const previewImg = document.getElementById('export-preview-img');
    const titleText = document.getElementById('export-title-input').value || 'Мой Тир-Лист';
    const scale = parseInt(document.getElementById('export-resolution-select').value) || 2;
    const includeEmpty = document.getElementById('export-include-empty').checked;

    if (loadingEl) loadingEl.style.display = 'flex';
    if (previewImg) previewImg.style.display = 'none';

    // Canvas Dimensions
    const baseWidth = 1200;
    const labelWidth = 140;
    const cardW = 100;
    const cardH = 146;
    const padding = 12;
    const headerHeight = 90;
    const rowGap = 6;

    // Filter tiers
    const tiersToDraw = state.tiers.filter(t => includeEmpty || t.items.length > 0);

    // Calculate row heights
    const rowLayouts = tiersToDraw.map(tier => {
      const availableW = baseWidth - labelWidth - padding * 2;
      const cardsPerRow = Math.max(1, Math.floor(availableW / (cardW + padding)));
      const itemsCount = tier.items.length;
      const rowsCount = Math.max(1, Math.ceil(itemsCount / cardsPerRow));
      const rowHeight = Math.max(cardH + padding * 2, rowsCount * (cardH + padding) + padding);
      return { tier, cardsPerRow, rowHeight };
    });

    const totalHeight = headerHeight + rowLayouts.reduce((sum, r) => sum + r.rowHeight + rowGap, 0) + 40;

    // Create high-DPI canvas
    const canvas = document.createElement('canvas');
    canvas.width = baseWidth * scale;
    canvas.height = totalHeight * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // Background: Grounded dark graphite
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, baseWidth, totalHeight);

    // Header Drawing
    ctx.fillStyle = '#fafafa';
    ctx.font = '600 24px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(titleText, 32, 46);

    ctx.fillStyle = '#e11d48';
    ctx.font = '600 11px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('CRIMSON TIER • ANIME & MOVIE COLLECTION', 32, 68);

    // Date watermark
    ctx.fillStyle = '#71717a';
    ctx.font = '500 11px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'right';
    const nowStr = new Date().toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
    ctx.fillText(nowStr, baseWidth - 32, 54);
    ctx.textAlign = 'left';

    // Helper to load an image safely without CORS taint
    function loadImageSafely(src) {
      return new Promise((resolve) => {
        if (!src) return resolve(null);
        const img = new Image();
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) { settled = true; resolve(null); }
        }, 3000);
        if (src.startsWith('http://') || src.startsWith('https://')) {
          img.crossOrigin = 'anonymous';
        }
        img.onload = () => {
          if (!settled) { settled = true; clearTimeout(timer); resolve(img); }
        };
        img.onerror = () => {
          if (!settled) { settled = true; clearTimeout(timer); resolve(null); }
        };
        img.src = src;
      });
    }

    // Aspect-ratio preserving cover drawing for Canvas 2D
    function drawImageCover(targetCtx, img, x, y, w, h, radius = 6) {
      targetCtx.save();
      targetCtx.beginPath();
      if (targetCtx.roundRect) {
        targetCtx.roundRect(x, y, w, h, radius);
      } else {
        targetCtx.rect(x, y, w, h);
      }
      targetCtx.clip();

      const imgW = img.naturalWidth || img.width;
      const imgH = img.naturalHeight || img.height;
      if (!imgW || !imgH) {
        targetCtx.drawImage(img, x, y, w, h);
        targetCtx.restore();
        return;
      }

      const imgRatio = imgW / imgH;
      const targetRatio = w / h;
      let drawW, drawH, drawX, drawY;

      if (imgRatio > targetRatio) {
        drawH = h;
        drawW = h * imgRatio;
        drawX = x - (drawW - w) / 2;
        drawY = y;
      } else {
        drawW = w;
        drawH = w / imgRatio;
        drawX = x;
        drawY = y - (drawH - h) / 2;
      }

      targetCtx.drawImage(img, drawX, drawY, drawW, drawH);
      targetCtx.restore();
    }

    let currentY = headerHeight;

    for (const layout of rowLayouts) {
      const { tier, cardsPerRow, rowHeight } = layout;

      // Tier row background: Solid dark surface
      ctx.fillStyle = '#121214';
      ctx.fillRect(20, currentY, baseWidth - 40, rowHeight);

      // Border outline
      ctx.strokeStyle = '#27272a';
      ctx.lineWidth = 1;
      ctx.strokeRect(20, currentY, baseWidth - 40, rowHeight);

      // Tier Label Cell
      ctx.fillStyle = tier.color || '#e11d48';
      ctx.fillRect(20, currentY, labelWidth, rowHeight);

      // Tier Name Text
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 22px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tier.name, 20 + labelWidth / 2, currentY + rowHeight / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      // Draw Tier Cards
      for (let i = 0; i < tier.items.length; i++) {
        const itemId = tier.items[i];
        const item = state.items[itemId];
        if (!item) continue;

        const col = i % cardsPerRow;
        const row = Math.floor(i / cardsPerRow);
        const cardX = 20 + labelWidth + padding + col * (cardW + padding);
        const cardY = currentY + padding + row * (cardH + padding);

        // Draw card poster - prioritize actual poster image, fallback only if unavailable/CORS rejected
        let img = null;
        if (item.poster) {
          img = await loadImageSafely(item.poster);
        }
        if (!img && item.cdnPoster) {
          img = await loadImageSafely(item.cdnPoster);
        }
        if (!img && item.fallbackPoster) {
          img = await loadImageSafely(item.fallbackPoster);
        }

        if (img) {
          drawImageCover(ctx, img, cardX, cardY, cardW, cardH, 6);
        } else {
          // Minimal fallback vector card
          ctx.save();
          ctx.fillStyle = '#18181b';
          ctx.beginPath();
          ctx.roundRect(cardX, cardY, cardW, cardH, 6);
          ctx.fill();

          ctx.fillStyle = '#e11d48';
          ctx.font = '16px "Inter", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(item.type === 'anime' ? '🎌' : '🎬', cardX + cardW / 2, cardY + cardH / 2 - 10);

          ctx.fillStyle = '#fafafa';
          ctx.font = '500 10px "Inter", -apple-system, sans-serif';
          const fullTitle = item.title || 'Тайтл';
          if (fullTitle.length <= 13) {
            ctx.fillText(fullTitle, cardX + cardW / 2, cardY + cardH / 2 + 12);
          } else {
            const splitIdx = fullTitle.lastIndexOf(' ', 13);
            const line1 = splitIdx > 0 ? fullTitle.substring(0, splitIdx) : fullTitle.substring(0, 12);
            let line2 = splitIdx > 0 ? fullTitle.substring(splitIdx + 1) : fullTitle.substring(12);
            if (line2.length > 13) line2 = line2.substring(0, 12) + '…';
            ctx.fillText(line1, cardX + cardW / 2, cardY + cardH / 2 + 8);
            ctx.fillText(line2, cardX + cardW / 2, cardY + cardH / 2 + 22);
          }
          ctx.restore();
        }

        // Crisp flat card border
        ctx.strokeStyle = '#27272a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(cardX, cardY, cardW, cardH, 6);
        ctx.stroke();
      }

      currentY += rowHeight + rowGap;
    }

    function setPreviewSource(src) {
      exportImageBlobUrl = src;
      if (loadingEl) loadingEl.style.display = 'none';
      if (previewImg) {
        previewImg.src = exportImageBlobUrl;
        previewImg.style.display = 'block';
      }
    }

    // Convert to Blob & Preview Image with safe fallback
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          if (exportImageBlobUrl && exportImageBlobUrl.startsWith('blob:')) {
            URL.revokeObjectURL(exportImageBlobUrl);
          }
          setPreviewSource(URL.createObjectURL(blob));
        } else {
          try {
            setPreviewSource(canvas.toDataURL('image/png'));
          } catch (e) {
            if (loadingEl) loadingEl.innerHTML = '<div style="color:#ff2b56">Ошибка генерации PNG</div>';
          }
        }
      }, 'image/png');
    } catch (err) {
      try {
        setPreviewSource(canvas.toDataURL('image/png'));
      } catch (e) {
        if (loadingEl) loadingEl.innerHTML = '<div style="color:#ff2b56">Ошибка генерации PNG</div>';
      }
    }
  }

  function downloadExportPNG() {
    if (!exportImageBlobUrl) {
      showToast('Подождите, изображение ещё генерируется');
      return;
    }
    const a = document.createElement('a');
    a.href = exportImageBlobUrl;
    a.download = `media-tierlist-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('Изображение успешно скачано!');
  }

  // --- Backup & Restore (JSON) ---
  let stagedBackupData = null;

  function openBackupModal() {
    const itemsCountEl = document.getElementById('backup-stat-items-count');
    const tiersCountEl = document.getElementById('backup-stat-tiers-count');
    const diaryCountEl = document.getElementById('backup-stat-diary-count');

    if (itemsCountEl) {
      itemsCountEl.textContent = Object.keys(state.items).length;
    }
    if (tiersCountEl) {
      tiersCountEl.textContent = state.tiers.length;
    }
    if (diaryCountEl) {
      let diaryCount = 0;
      Object.values(state.items).forEach(item => {
        if (item.startDate || item.endDate || item.userComment || (item.rewatchDates && item.rewatchDates.length > 0)) {
          diaryCount++;
        }
      });
      diaryCountEl.textContent = diaryCount;
    }

    resetBackupFileSelection();
    openModal('modal-backup');
  }

  function exportBackupJSON() {
    try {
      const backupData = {
        app: 'crimson_tier',
        version: '1.0',
        exportedAt: new Date().toISOString(),
        tiers: state.tiers,
        items: state.items,
        pool: state.pool
      };

      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `crimson_tier_backup_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Резервная копия (.json) успешно скачана!');
      return backupData;
    } catch (err) {
      console.error('Export backup error:', err);
      showToast('Ошибка при экспорте резервной копии');
      return null;
    }
  }

  function processParsedBackup(parsed, fileName) {
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Файл не является объектом JSON');
    }
    if (!Array.isArray(parsed.tiers) || !parsed.items || typeof parsed.items !== 'object' || !Array.isArray(parsed.pool)) {
      throw new Error('Некорректная структура тир-листа в файле');
    }
    stagedBackupData = parsed;
    const dropzone = document.getElementById('backup-dropzone');
    const preview = document.getElementById('backup-file-preview');
    const filenameEl = document.getElementById('backup-preview-filename');
    const detailsEl = document.getElementById('backup-preview-details');

    if (filenameEl) filenameEl.textContent = fileName;
    if (detailsEl) {
      const itemsCount = Object.keys(parsed.items).length;
      const tiersCount = parsed.tiers.length;
      detailsEl.innerHTML = `<span>Найдено в файле: <strong>${itemsCount}</strong> тайтлов, <strong>${tiersCount}</strong> тиров</span>`;
    }
    if (dropzone) dropzone.style.display = 'none';
    if (preview) preview.style.display = 'flex';
  }

  function handleBackupFile(fileOrData) {
    if (!fileOrData) return;
    if (typeof fileOrData === 'object' && !(fileOrData instanceof Blob)) {
      try {
        processParsedBackup(fileOrData, 'backup.json');
      } catch (err) {
        showToast('Ошибка: файл не является корректным бэкапом тир-листа');
        resetBackupFileSelection();
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const parsed = JSON.parse(text);
        processParsedBackup(parsed, fileOrData.name || 'backup.json');
      } catch (err) {
        console.error('Backup parse error:', err);
        showToast('Ошибка: файл не является корректным бэкапом тир-листа');
        resetBackupFileSelection();
      }
    };
    reader.onerror = () => {
      showToast('Не удалось прочитать выбранный файл');
      resetBackupFileSelection();
    };
    reader.readAsText(fileOrData);
  }

  function resetBackupFileSelection() {
    stagedBackupData = null;
    const dropzone = document.getElementById('backup-dropzone');
    const preview = document.getElementById('backup-file-preview');
    const fileInput = document.getElementById('backup-file-input');

    if (dropzone) dropzone.style.display = 'flex';
    if (preview) preview.style.display = 'none';
    if (fileInput) fileInput.value = '';
  }

  function applyBackupRestore() {
    if (!stagedBackupData) {
      showToast('Сначала выберите файл для восстановления');
      return;
    }

    try {
      state.tiers = stagedBackupData.tiers;
      state.items = stagedBackupData.items;
      state.pool = stagedBackupData.pool;
      state.poolOriginalOrder = [...stagedBackupData.pool];

      saveState();
      renderAll();
      closeModal('modal-backup');

      const count = Object.keys(state.items).length;
      showToast(`База успешно восстановлена (${count} тайтлов)!`);
      stagedBackupData = null;
    } catch (err) {
      console.error('Backup restore error:', err);
      showToast('Ошибка при восстановлении базы данных');
    }
  }

  function setupBackupModalEvents() {
    const openBtn = document.getElementById('btn-backup-open');
    if (openBtn) {
      openBtn.addEventListener('click', openBackupModal);
    }

    const exportBtn = document.getElementById('btn-export-backup-json');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportBackupJSON);
    }

    const dropzone = document.getElementById('backup-dropzone');
    const fileInput = document.getElementById('backup-file-input');

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => {
        fileInput.click();
      });

      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleBackupFile(file);
      });

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-active');
      });

      dropzone.addEventListener('dragleave', (e) => {
        if (!dropzone.contains(e.relatedTarget)) {
          dropzone.classList.remove('drag-active');
        }
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-active');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleBackupFile(e.dataTransfer.files[0]);
        }
      });
    }

    const cancelFileBtn = document.getElementById('btn-cancel-backup-file');
    if (cancelFileBtn) {
      cancelFileBtn.addEventListener('click', resetBackupFileSelection);
    }

    const applyRestoreBtn = document.getElementById('btn-apply-backup-restore');
    if (applyRestoreBtn) {
      applyRestoreBtn.addEventListener('click', applyBackupRestore);
    }
  }

  // --- Modal Helpers ---
  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'flex';
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
  }

  // --- Toast System ---
  function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    while (container.children.length >= 3) {
      container.children[0].remove();
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.cursor = 'pointer';
    toast.innerHTML = `<span class="toast-dot"></span><span>${message}</span>`;
    toast.onclick = () => toast.remove();
    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 2200);
  }

  // --- Global Event Bindings ---
  function bindEvents() {
    // Top Action buttons
    document.getElementById('btn-add-item')?.addEventListener('click', () => openModal('modal-add-item'));
    document.getElementById('btn-export-png')?.addEventListener('click', () => {
      openModal('modal-export');
      generateHighResPNG();
    });
    document.getElementById('btn-add-tier')?.addEventListener('click', addNewTier);
    document.getElementById('btn-clear-board-to-pool')?.addEventListener('click', clearBoardToPool);

    // Modal Close buttons
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal) {
          modal.style.display = 'none';
          if (modal.id === 'modal-item-detail') resetPendingCoverEdit();
        }
      });
    });

    // Close modal on click backdrop
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.style.display = 'none';
          if (modal.id === 'modal-item-detail') resetPendingCoverEdit();
        }
      });
    });

    // Global Escape key handling with modal stacking support
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const searchPreview = document.getElementById('modal-search-preview');
        if (searchPreview && searchPreview.style.display !== 'none') {
          searchPreview.style.display = 'none';
          return;
        }
        const openModals = Array.from(document.querySelectorAll('.modal-overlay'))
          .filter(m => m.style.display !== 'none');
        if (openModals.length > 0) {
          const topModal = openModals[openModals.length - 1];
          topModal.style.display = 'none';
          if (topModal.id === 'modal-item-detail') {
            resetPendingCoverEdit();
          }
        }
      }
    });

    // Modal Tabs switching
    document.querySelectorAll('.modal-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const targetTabId = tab.dataset.tab;
        const modal = tab.closest('.modal-card');
        if (!modal) return;

        modal.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
        modal.querySelectorAll('.modal-tab-body').forEach(b => b.classList.remove('active'));

        tab.classList.add('active');
        const targetBody = modal.querySelector(`#${targetTabId}`);
        if (targetBody) targetBody.classList.add('active');
      });
    });

    // Filter pills
    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.filter = pill.dataset.filter;
        renderAll();
      });
    });

    // Board search input
    const searchInput = document.getElementById('board-search-input');
    const searchClear = document.getElementById('board-search-clear');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        state.searchQuery = searchInput.value;
        if (searchClear) searchClear.style.display = searchInput.value ? 'block' : 'none';
        renderAll();
      });
    }
    if (searchClear) {
      searchClear.addEventListener('click', () => {
        searchInput.value = '';
        state.searchQuery = '';
        searchClear.style.display = 'none';
        renderAll();
      });
    }

    // Pool sorting buttons
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.poolSort = btn.dataset.sort;
        renderPool();
      });
    });

    // Tier actions delegation (move up, move down, clear, delete)
    document.getElementById('tiers-container')?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const tierId = btn.dataset.tierId;

      if (action === 'move-tier-up') moveTierUp(tierId);
      if (action === 'move-tier-down') moveTierDown(tierId);
      if (action === 'clear-tier') clearTierToPool(tierId);
      if (action === 'delete-tier') deleteTier(tierId);
      if (action === 'edit-tier') openEditTierModal(tierId);
    });

    // Online search bindings
    document.getElementById('btn-run-api-search')?.addEventListener('click', performOnlineSearch);
    document.getElementById('api-search-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        performOnlineSearch();
      }
    });
    document.querySelectorAll('.quick-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        const q = tag.dataset.query;
        const input = document.getElementById('api-search-input');
        if (input) {
          input.value = q;
          performOnlineSearch();
        }
      });
    });

    // Manual Form Setup
    setupManualAddForm();

    // Detail Modal Events
    document.getElementById('btn-add-rewatch-date')?.addEventListener('click', () => addRewatchDate());
    document.getElementById('btn-save-detail')?.addEventListener('click', () => {
      saveCurrentItemDetail(true);
      closeModal('modal-item-detail');
    });
    document.getElementById('detail-start-date')?.addEventListener('change', () => saveCurrentItemDetail(false));
    document.getElementById('detail-end-date')?.addEventListener('change', () => saveCurrentItemDetail(false));
    document.getElementById('detail-user-comment')?.addEventListener('input', () => saveCurrentItemDetail(false));

    // Export Modal Controls
    document.getElementById('export-resolution-select')?.addEventListener('change', generateHighResPNG);
    document.getElementById('export-include-empty')?.addEventListener('change', generateHighResPNG);
    document.getElementById('export-title-input')?.addEventListener('input', generateHighResPNG);
    document.getElementById('btn-download-export-png')?.addEventListener('click', downloadExportPNG);

    // Detail Modal Cover Changing Controls
    const toggleCoverBtn = document.getElementById('btn-toggle-cover-edit');
    const posterWrap = document.getElementById('detail-poster-wrap');
    const coverEditSec = document.getElementById('detail-cover-edit-section');
    const cancelCoverBtn = document.getElementById('btn-cancel-cover-edit');
    const coverUrlInput = document.getElementById('detail-cover-url-input');
    const coverFileInput = document.getElementById('detail-cover-file-input');
    const coverResetBtn = document.getElementById('btn-reset-cover');
    const revertCoverBtn = document.getElementById('btn-revert-cover-default');

    const toggleCoverSection = () => {
      if (!coverEditSec) return;
      const isHidden = coverEditSec.style.display === 'none' || !coverEditSec.style.display;
      coverEditSec.style.display = isHidden ? 'flex' : 'none';
      if (isHidden && coverUrlInput) {
        coverUrlInput.focus();
      }
    };

    const applyNewPendingCover = (src, toastMsg = 'Обложка вставлена из буфера (Ctrl+V)') => {
      pendingDetailPoster = src;
      const posterImg = document.getElementById('detail-poster-img');
      const statusEl = document.getElementById('detail-cover-preview-status');
      const statusBadge = document.querySelector('#detail-cover-preview-status .cover-status-badge');
      const textSpan = statusBadge?.querySelector('span');

      if (posterImg) {
        posterImg.src = pendingDetailPoster;
        posterImg.classList.remove('poster-pasted-anim');
        void posterImg.offsetWidth;
        posterImg.classList.add('poster-pasted-anim');
      }

      if (coverUrlInput) {
        coverUrlInput.value = src.startsWith('data:') ? '' : src;
      }

      if (coverEditSec) {
        coverEditSec.style.display = 'flex';
      }

      if (statusEl) {
        statusEl.classList.remove('has-error');
        statusEl.style.display = 'flex';
      }
      if (statusBadge) statusBadge.classList.remove('error');
      if (textSpan) textSpan.textContent = 'Новая обложка выбрана (предпросмотр на постере)';

      showToast(toastMsg);
    };

    const handleCoverPaste = async (e) => {
      const detailModal = document.getElementById('modal-item-detail');
      if (!detailModal || detailModal.style.display === 'none') return;
      if (!currentDetailItemId || !state.items[currentDetailItemId]) return;

      const clipboardData = e.clipboardData || window.clipboardData;
      if (!clipboardData) return;

      // 1. Check for image files in clipboard
      const items = clipboardData.items;
      let imgFile = null;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type && items[i].type.startsWith('image/')) {
            imgFile = items[i].getAsFile();
            if (imgFile) break;
          }
        }
      }

      if (imgFile) {
        e.preventDefault();
        try {
          const compressed = await compressImageFile(imgFile);
          if (compressed) {
            applyNewPendingCover(compressed, 'Изображение вставлено из буфера (Ctrl+V)');
          } else {
            showToast('Не удалось обработать изображение из буфера');
          }
        } catch (err) {
          console.error('Failed to paste image file:', err);
        }
        return;
      }

      // 2. If user is actively typing in a form input/textarea other than the poster or cover URL, do not hijack text paste
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
      if (isInput && activeEl.id !== 'detail-cover-url-input' && activeEl !== posterWrap) {
        return;
      }

      // 3. Check for text image URL or data URL in clipboard
      const text = clipboardData.getData('text')?.trim();
      if (text) {
        const isUrl = /^https?:\/\/.+/i.test(text);
        const isDataImg = /^data:image\//i.test(text);
        if (isUrl || isDataImg) {
          e.preventDefault();
          applyNewPendingCover(text, 'Ссылка на обложку вставлена из буфера (Ctrl+V)');
        }
      }
    };

    document.addEventListener('paste', handleCoverPaste);

    toggleCoverBtn?.addEventListener('click', toggleCoverSection);
    posterWrap?.addEventListener('click', () => {
      posterWrap.focus();
      toggleCoverSection();
    });
    posterWrap?.addEventListener('focus', () => posterWrap.classList.add('is-focused-target'));
    posterWrap?.addEventListener('blur', () => posterWrap.classList.remove('is-focused-target'));
    posterWrap?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCoverSection();
      }
    });

    cancelCoverBtn?.addEventListener('click', cancelCoverEdit);
    coverResetBtn?.addEventListener('click', resetPendingCoverEdit);
    revertCoverBtn?.addEventListener('click', revertToOriginalCover);

    if (coverUrlInput) {
      coverUrlInput.addEventListener('input', () => {
        const val = coverUrlInput.value.trim();
        if (val) {
          pendingDetailPoster = val;
          const posterImg = document.getElementById('detail-poster-img');
          const statusEl = document.getElementById('detail-cover-preview-status');
          const statusBadge = document.querySelector('#detail-cover-preview-status .cover-status-badge');
          const textSpan = statusBadge?.querySelector('span');

          if (posterImg) {
            posterImg.src = pendingDetailPoster;
            posterImg.onerror = function () {
              if (statusEl) statusEl.classList.add('has-error');
              if (statusBadge) statusBadge.classList.add('error');
              if (textSpan) textSpan.textContent = 'Ошибка загрузки ссылки (проверьте URL)';
              const fallbackSrc = (currentDetailItemId && state.items[currentDetailItemId]?.fallbackPoster) || window.TIERLIST_PRESETS.createPosterSVG('Постер', 'movie');
              this.src = fallbackSrc;
            };
            posterImg.onload = function () {
              if (statusEl) statusEl.classList.remove('has-error');
              if (statusBadge) statusBadge.classList.remove('error');
              if (textSpan) textSpan.textContent = 'Новая обложка выбрана (предпросмотр на постере)';
            };
          }
          if (statusEl) statusEl.style.display = 'flex';
        } else {
          resetPendingCoverEdit();
        }
      });
    }

    if (coverFileInput) {
      coverFileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!file.type || !file.type.startsWith('image/')) {
          showToast('Выбранный файл не является изображением');
          coverFileInput.value = '';
          return;
        }
        const compressed = await compressImageFile(file);
        if (compressed) {
          pendingDetailPoster = compressed;
          const posterImg = document.getElementById('detail-poster-img');
          if (posterImg) posterImg.src = pendingDetailPoster;
          if (coverUrlInput) coverUrlInput.value = '';
          const statusEl = document.getElementById('detail-cover-preview-status');
          const statusBadge = document.querySelector('#detail-cover-preview-status .cover-status-badge');
          const textSpan = statusBadge?.querySelector('span');
          if (statusEl) {
            statusEl.classList.remove('has-error');
            statusEl.style.display = 'flex';
          }
          if (statusBadge) statusBadge.classList.remove('error');
          if (textSpan) textSpan.textContent = 'Новая обложка выбрана (предпросмотр на постере)';
        } else {
          showToast('Не удалось обработать изображение');
        }
        coverFileInput.value = '';
      });
    }

    // Search Preview Modal Add Button
    document.getElementById('btn-search-preview-add')?.addEventListener('click', () => {
      if (!currentSearchPreviewItem) return;
      addItemToPool(currentSearchPreviewItem);
      const addBtn = document.getElementById('btn-search-preview-add');
      if (addBtn) {
        addBtn.className = 'btn btn-outline';
        addBtn.innerHTML = '<span>✓ Добавлен в банк</span>';
        addBtn.disabled = true;
      }
      const gridBtn = document.getElementById('search-results-grid')?.querySelector(`[data-search-item-id="${CSS.escape(currentSearchPreviewItem.id)}"]`);
      if (gridBtn) {
        gridBtn.className = 'btn btn-xs btn-outline';
        gridBtn.textContent = '✓ Добавлен';
        gridBtn.disabled = true;
      }
    });

    // Tier Edit Modal Color picker bindings
    const colorInput = document.getElementById('edit-tier-color-input');
    const colorHex = document.getElementById('edit-tier-color-hex');
    if (colorInput && colorHex) {
      colorInput.addEventListener('input', () => colorHex.value = colorInput.value);
      colorHex.addEventListener('input', () => colorInput.value = colorHex.value);
    }
    document.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        const col = dot.dataset.color;
        if (colorInput) colorInput.value = col;
        if (colorHex) colorHex.value = col;
      });
    });
    document.getElementById('tier-edit-form')?.addEventListener('submit', handleSaveTierEdit);
    setupBackupModalEvents();
    setupYearWheelEvents();
  }

  // Export state to window for testing / automated verification
  window.__crimsonTierState = state;
  window.__crimsonTierApp = {
    addItemToPool,
    moveItem,
    deleteItem,
    clearBoardToPool,
    addNewTier,
    reorderTier,
    openItemDetailModal,
    openSearchPreviewModal,
    openYearWheelModal,
    saveCurrentItemDetail,
    resetPendingCoverEdit,
    cancelCoverEdit,
    revertToOriginalCover,
    addRewatchDate,
    compressImageFile,
    generateHighResPNG,
    renderAll,
    openBackupModal,
    exportBackupJSON,
    handleBackupFile,
    applyBackupRestore,
    resetBackupFileSelection,
    resetToDefaults: function () {
      loadDefaultPresets();
      renderAll();
    }
  };

  // Launch on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
