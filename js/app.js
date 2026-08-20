/* ---------------- categories ---------------- */
  const CATEGORIES = [
    { key: 'top',       label: 'Tops',        badge: 'badge-coral', svg: '<path d="M6 4 L9 2 L12 4 L15 2 L18 4 L21 7 L18 9 L18 21 L6 21 L6 9 L3 7 Z"/>' },
    { key: 'bottom',    label: 'Bottoms',     badge: 'badge-coral', svg: '<path d="M6 3 H18 V7 L15.5 21 H13 L12 10 L11 21 H8.5 L6 7 Z"/>' },
    { key: 'shoes',     label: 'Shoes',       badge: 'badge-coral', svg: '<path d="M2 17 Q2 14 6 13 L10 11 Q12 9 15 9 L21 9 Q22 9 22 11 L22 15 Q22 17 20 17 Z"/>' },
    { key: 'jacket',    label: 'Outerwear',   badge: 'badge-coral', svg: '<path d="M6 4 L9 2 L12 4 L15 2 L18 4 L21 7 L18 9 L18 21 L6 21 L6 9 L3 7 Z"/><line x1="12" y1="4" x2="12" y2="21" stroke="#fff" stroke-width="1.4"/>' },
    { key: 'head',      label: 'Headwear',    badge: 'badge-coral', svg: '<path d="M4 14 Q4 6 12 6 Q20 6 20 14 Z"/><path d="M2 14 Q12 17.5 22 14 L22 15.6 Q12 19 2 15.6 Z"/>' },
    { key: 'accessory', label: 'Accessories', badge: 'badge-coral', svg: '<circle cx="12" cy="12" r="5.2" fill="none" stroke="#fff" stroke-width="1.6"/><rect x="10" y="1.5" width="4" height="4" rx="0.6"/><rect x="10" y="18.5" width="4" height="4" rx="0.6"/>' },
  ];
  const catMap = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));

  function badgeHtml(cat, size) {
    const sizeClass = size === 'sm' ? ' icon-badge-sm' : '';
    return `<div class="icon-badge ${cat.badge}${sizeClass}"><svg viewBox="0 0 24 24">${cat.svg}</svg></div>`;
  }

  const BUCKET = 'closet-photos';
  const SIGNED_URL_EXPIRY = 60 * 60 * 24 * 7; // 7 days

  /* ---------------- state ---------------- */
  const wardrobe = Object.fromEntries(CATEGORIES.map(c => [c.key, []]));
  let savedLooks = [];
  const currentLook = {}; // key -> item

  let currentUserId = null;
  let currentUserEmail = null;
  let currentUserIsAnonymous = true;
  let pendingCategory = null;      // category preset when opening add-item from a specific accordion/slot
  let addItemReturnTo = 'closet';  // where to go back after saving a new item
  let currentPhotoBlob = null;     // background-removed photo, ready to upload
  let currentPhotoPreviewUrl = null; // object URL for on-screen preview

  let pickerSlotKey = null;
  let pickerSelection = null;

  /* ---------------- navigation ---------------- */
  const screens = {};
  document.querySelectorAll('.screen').forEach(s => screens[s.id.replace('screen-', '')] = s);

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    if (name === 'home') renderHome();
    if (name === 'armario') renderCloset();
    if (name === 'criar-look') renderLookLayout();
    if (name === 'looks') renderLooks();
    if (name === 'account') renderAccount();
    if (name === 'outfit-detail') renderOutfitDetail();
  }

  document.querySelectorAll('[data-goto]').forEach(el => {
    el.addEventListener('click', () => showScreen(el.dataset.goto));
  });

  /* ---------------- SUPABASE HELPERS ---------------- */

  async function ensureSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      applySession(session);
      return;
    }
    // No session yet on this device/browser — create an anonymous one.
    // This gives a stable user_id without requiring a login screen.
    const { data, error } = await supabaseClient.auth.signInAnonymously();
    if (error) {
      console.error('Anonymous sign-in failed:', error.message);
      alert('Could not connect to your account. Check your connection and reload.');
      return;
    }
    applySession(data.session);
  }

  function applySession(session) {
    currentUserId = session.user.id;
    currentUserEmail = session.user.email || null;
    currentUserIsAnonymous = !!session.user.is_anonymous;
  }

  let _bgRemovalModule = null;
  async function loadBackgroundRemoval() {
    if (_bgRemovalModule) return _bgRemovalModule;
    const mod = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm');
    _bgRemovalModule = { removeBackground: mod.removeBackground || mod.default };
    return _bgRemovalModule;
  }

  async function uploadPhoto(blob) {
    const ext = (blob.type && blob.type.split('/')[1]) || 'png';
    const path = `${currentUserId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabaseClient.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type || 'image/png',
    });
    if (error) throw error;
    return path; // stored in items.image_url
  }

  async function getSignedUrls(paths) {
    if (paths.length === 0) return {};
    const { data, error } = await supabaseClient.storage
      .from(BUCKET)
      .createSignedUrls(paths, SIGNED_URL_EXPIRY);
    if (error) {
      console.error('Could not sign image URLs:', error.message);
      return {};
    }
    const map = {};
    data.forEach(d => { if (d.signedUrl) map[d.path] = d.signedUrl; });
    return map;
  }

  async function fetchWardrobe() {
    const { data, error } = await supabaseClient
      .from('items')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Could not load closet:', error.message);
      return;
    }

    CATEGORIES.forEach(c => { wardrobe[c.key] = []; });

    const urlMap = await getSignedUrls(data.map(it => it.image_url));

    data.forEach(row => {
      wardrobe[row.category].push({
        id: row.id,
        name: row.name,
        color: row.color,
        style: row.style,
        storagePath: row.image_url,
        imgSrc: urlMap[row.image_url] || '',
      });
    });
  }

  async function fetchLooks() {
    const { data, error } = await supabaseClient
      .from('outfits')
      .select('id, name, created_at, outfit_items ( category, items ( id, name, image_url ) )')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Could not load outfits:', error.message);
      return;
    }

    const allPaths = [];
    data.forEach(outfit => {
      outfit.outfit_items.forEach(oi => { if (oi.items) allPaths.push(oi.items.image_url); });
    });
    const urlMap = await getSignedUrls(allPaths);

    savedLooks = data.map(outfit => {
      const items = {};
      outfit.outfit_items.forEach(oi => {
        if (oi.items) {
          items[oi.category] = {
            id: oi.items.id,
            name: oi.items.name,
            imgSrc: urlMap[oi.items.image_url] || '',
          };
        }
      });
      return { id: outfit.id, name: outfit.name, items };
    });
  }

  /* ---------------- HOME ---------------- */
  function renderHome() {
    const totalItems = Object.values(wardrobe).reduce((a, arr) => a + arr.length, 0);
    document.getElementById('armario-count-sub').textContent =
      totalItems === 0 ? 'No items added yet' : `${totalItems} item${totalItems > 1 ? 's' : ''} added`;
    document.getElementById('looks-count-sub').textContent =
      savedLooks.length === 0 ? 'No outfits saved yet' : `${savedLooks.length} outfit${savedLooks.length > 1 ? 's' : ''} saved`;
  }

  /* ---------------- CLOSET (accordion) ---------------- */
  function renderCloset() {
    const acc = document.getElementById('armario-accordion');
    acc.innerHTML = '';
    CATEGORIES.forEach(cat => {
      const items = wardrobe[cat.key];
      const item = document.createElement('div');
      item.className = 'acc-item';
      item.innerHTML = `
        <div class="acc-header">
          ${badgeHtml(cat)}
          <div class="name">${cat.label}</div>
          <div class="count">${items.length} ${items.length === 1 ? 'item' : 'items'}</div>
          <div class="chev">›</div>
        </div>
        <div class="acc-body">
          <div class="acc-grid"></div>
        </div>
      `;
      const header = item.querySelector('.acc-header');
      header.addEventListener('click', () => item.classList.toggle('open'));

      const grid = item.querySelector('.acc-grid');
      items.forEach(it => {
        const tile = document.createElement('div');
        tile.className = 'acc-tile';
        tile.style.cursor = 'pointer';
        tile.innerHTML = `<img src="${it.imgSrc}" alt="${it.name}"><div class="tile-label">${it.name}</div>`;
        tile.addEventListener('click', (e) => {
          e.stopPropagation();
          openItemDetail(it, cat.key);
        });
        grid.appendChild(tile);
      });

      const addTile = document.createElement('div');
      addTile.className = 'acc-tile add';
      addTile.innerHTML = `<div class="plus">+</div><div class="txt">Add</div>`;
      addTile.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingCategory = cat.key;
        addItemReturnTo = 'closet';
        openCaptureScreen();
      });
      grid.appendChild(addTile);

      acc.appendChild(item);
    });
  }

  /* ---------------- ITEM DETAIL (edit/delete a closet item) ---------------- */
  let currentItemDetail = null;
  let currentItemOriginalCategory = null;

  function openItemDetail(item, categoryKey) {
    currentItemDetail = item;
    currentItemOriginalCategory = categoryKey;

    document.getElementById('item-detail-img').src = item.imgSrc;
    document.getElementById('item-detail-name').value = item.name || '';

    const catRow = document.getElementById('item-detail-category');
    catRow.innerHTML = '';
    CATEGORIES.forEach(cat => {
      const chip = document.createElement('div');
      chip.className = 'chip' + (cat.key === categoryKey ? ' selected' : '');
      chip.dataset.value = cat.key;
      chip.textContent = cat.label;
      chip.addEventListener('click', () => {
        catRow.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
      });
      catRow.appendChild(chip);
    });

    ['item-detail-color', 'item-detail-style'].forEach(id => {
      const row = document.getElementById(id);
      const currentValue = id === 'item-detail-color' ? item.color : item.style;
      row.querySelectorAll('.chip').forEach(chip => {
        chip.classList.toggle('selected', chip.dataset.value === currentValue);
      });
    });

    showScreen('item-detail');
  }

  ['item-detail-color', 'item-detail-style'].forEach(id => {
    document.getElementById(id).addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const row = document.getElementById(id);
      row.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
    });
  });

  document.getElementById('item-detail-back').addEventListener('click', () => showScreen('armario'));

  document.getElementById('item-save-btn').addEventListener('click', async () => {
    if (!currentItemDetail) return;

    const name = document.getElementById('item-detail-name').value.trim() || currentItemDetail.name;
    const newCategory = document.querySelector('#item-detail-category .selected')?.dataset.value || currentItemOriginalCategory;
    const color = document.querySelector('#item-detail-color .selected')?.dataset.value || null;
    const style = document.querySelector('#item-detail-style .selected')?.dataset.value || null;

    const saveBtn = document.getElementById('item-save-btn');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saving…';

    try {
      const { error } = await supabaseClient
        .from('items')
        .update({ name, category: newCategory, color, style })
        .eq('id', currentItemDetail.id);
      if (error) throw error;

      currentItemDetail.name = name;
      currentItemDetail.color = color;
      currentItemDetail.style = style;

      if (newCategory !== currentItemOriginalCategory) {
        wardrobe[currentItemOriginalCategory] = wardrobe[currentItemOriginalCategory].filter(i => i.id !== currentItemDetail.id);
        wardrobe[newCategory].push(currentItemDetail);
      }

      showScreen('armario');
    } catch (err) {
      console.error('Could not save item:', err.message);
      alert('Could not save changes. Please try again.');
    } finally {
      saveBtn.textContent = originalText;
    }
  });

  document.getElementById('item-delete-btn').addEventListener('click', async () => {
    if (!currentItemDetail) return;
    const confirmed = confirm(`Delete "${currentItemDetail.name}"? This can't be undone.`);
    if (!confirmed) return;

    try {
      if (currentItemDetail.storagePath) {
        await supabaseClient.storage.from(BUCKET).remove([currentItemDetail.storagePath]);
      }
      const { error } = await supabaseClient.from('items').delete().eq('id', currentItemDetail.id);
      if (error) throw error;

      wardrobe[currentItemOriginalCategory] = wardrobe[currentItemOriginalCategory].filter(i => i.id !== currentItemDetail.id);
      currentItemDetail = null;
      showScreen('armario');
    } catch (err) {
      console.error('Could not delete item:', err.message);
      alert('Could not delete this item. Please try again.');
    }
  });

  /* ---------------- CREATE OUTFIT ---------------- */
  function renderLookLayout() {
    const layout = document.getElementById('look-layout');
    layout.innerHTML = '';
    CATEGORIES.forEach(cat => {
      const filled = currentLook[cat.key];
      const slot = document.createElement('div');
      slot.className = 'slot' + (filled ? ' filled' : '');
      if (filled) {
        slot.innerHTML = `<img src="${filled.imgSrc}" alt="${filled.name}"><div class="item-label">${filled.name}</div>`;
      } else {
        slot.innerHTML = `${badgeHtml(cat, 'sm')}<div class="slot-label-static">${cat.label}</div>`;
      }
      slot.addEventListener('click', () => openPicker(cat.key));
      layout.appendChild(slot);
    });
  }

  document.getElementById('look-reset').addEventListener('click', () => {
    Object.keys(currentLook).forEach(k => delete currentLook[k]);
    renderLookLayout();
  });

  async function saveOutfit(slots) {
    const chosen = Object.entries(slots);
    if (chosen.length === 0) return false;

    const { data: outfit, error: outfitError } = await supabaseClient
      .from('outfits')
      .insert({ user_id: currentUserId, name: `Outfit ${savedLooks.length + 1}` })
      .select()
      .single();
    if (outfitError) throw outfitError;

    const rows = chosen.map(([category, item]) => ({
      outfit_id: outfit.id,
      item_id: item.id,
      category,
    }));
    const { error: itemsError } = await supabaseClient.from('outfit_items').insert(rows);
    if (itemsError) throw itemsError;

    await fetchLooks();
    return true;
  }

  document.getElementById('look-save').addEventListener('click', async () => {
    if (Object.keys(currentLook).length === 0) return;

    const saveBtn = document.getElementById('look-save');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saving…';

    try {
      await saveOutfit(currentLook);
      Object.keys(currentLook).forEach(k => delete currentLook[k]);
      showScreen('looks');
    } catch (err) {
      console.error('Could not save outfit:', err.message);
      alert('Could not save this outfit. Please try again.');
    } finally {
      saveBtn.textContent = originalText;
    }
  });

  /* ---------------- SUGGESTION ENGINE ---------------- */
  const NEUTRAL_COLORS = ['Black', 'White', 'Beige'];

  function colorScore(colorA, colorB) {
    if (!colorA || !colorB) return 0.6;
    if (colorA === colorB) return 1;
    if (NEUTRAL_COLORS.includes(colorA) || NEUTRAL_COLORS.includes(colorB)) return 0.85;
    return 0.35;
  }

  function itemCompatibility(item, anchors) {
    if (anchors.length === 0) return Math.random();
    let total = 0;
    anchors.forEach(a => {
      let s = colorScore(a.color, item.color);
      if (a.style && item.style) s += a.style === item.style ? 0.5 : 0.1;
      total += s;
    });
    return total / anchors.length + Math.random() * 0.3; // jitter for variety
  }

  function generateOutfitCandidate(lockedSlots) {
    const outfit = { ...lockedSlots };
    const remaining = CATEGORIES.map(c => c.key)
      .filter(k => !outfit[k] && wardrobe[k].length > 0)
      .sort(() => Math.random() - 0.5);

    remaining.forEach(key => {
      const anchors = Object.values(outfit);
      const scored = wardrobe[key]
        .map(it => ({ it, s: itemCompatibility(it, anchors) }))
        .sort((a, b) => b.s - a.s);
      const top = scored.slice(0, Math.min(2, scored.length));
      outfit[key] = top[Math.floor(Math.random() * top.length)].it;
    });

    return outfit;
  }

  function candidateKey(candidate) {
    return CATEGORIES.map(c => candidate[c.key]?.id || '-').join('|');
  }

  function generateSuggestions(lockedSlots, count = 5) {
    const results = [];
    const seen = new Set();
    let attempts = 0;
    while (results.length < count && attempts < count * 6) {
      attempts++;
      const candidate = generateOutfitCandidate(lockedSlots);
      const key = candidateKey(candidate);
      if (Object.keys(candidate).length > Object.keys(lockedSlots).length && !seen.has(key)) {
        seen.add(key);
        results.push(candidate);
      }
    }
    return results;
  }

  let suggestionLockedSlots = {};

  document.getElementById('suggest-looks-btn').addEventListener('click', () => {
    const totalItems = Object.values(wardrobe).reduce((a, arr) => a + arr.length, 0);
    if (totalItems < 2) {
      alert('Add at least a couple of items to your closet first, then come back for suggestions.');
      return;
    }
    suggestionLockedSlots = { ...currentLook };
    renderSuggestions(generateSuggestions(suggestionLockedSlots, 5));
    showScreen('suggestions');
  });

  document.getElementById('suggestions-back').addEventListener('click', () => showScreen('criar-look'));

  document.getElementById('regenerate-suggestions-btn').addEventListener('click', () => {
    renderSuggestions(generateSuggestions(suggestionLockedSlots, 5));
  });

  function renderSuggestions(suggestions) {
    const body = document.getElementById('suggestions-body');
    if (suggestions.length === 0) {
      body.innerHTML = `
        <div class="empty-state">
          ${badgeHtml({ badge: 'badge-coral', svg: '<path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z"/>' })}
          Not enough items yet to build a full suggestion.<br>Add a few more pieces to your closet.
        </div>
      `;
      return;
    }
    body.innerHTML = '';
    suggestions.forEach(candidate => {
      const card = document.createElement('div');
      card.className = 'suggestion-card';

      const mini = document.createElement('div');
      mini.className = 'look-mini';
      CATEGORIES.forEach(cat => {
        const it = candidate[cat.key];
        const cell = document.createElement('div');
        cell.className = 'cell';
        if (it) cell.innerHTML = `<img src="${it.imgSrc}" alt="">`;
        mini.appendChild(cell);
      });
      card.appendChild(mini);

      const actions = document.createElement('div');
      actions.className = 'suggestion-actions';

      const editBtn = document.createElement('div');
      editBtn.className = 'btn';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        Object.keys(currentLook).forEach(k => delete currentLook[k]);
        Object.entries(candidate).forEach(([k, v]) => { currentLook[k] = v; });
        showScreen('criar-look');
      });

      const addBtn = document.createElement('div');
      addBtn.className = 'btn primary';
      addBtn.textContent = 'Add Outfit';
      addBtn.addEventListener('click', async () => {
        if (addBtn.dataset.added) return;
        const originalText = addBtn.textContent;
        addBtn.textContent = 'Adding…';
        try {
          await saveOutfit(candidate);
          addBtn.textContent = 'Added ✓';
          addBtn.dataset.added = 'true';
          editBtn.style.display = 'none';
        } catch (err) {
          console.error('Could not save outfit:', err.message);
          alert('Could not save this outfit. Please try again.');
          addBtn.textContent = originalText;
        }
      });

      actions.appendChild(editBtn);
      actions.appendChild(addBtn);
      card.appendChild(actions);

      body.appendChild(card);
    });
  }

  /* ---------------- PICKER ---------------- */
  function openPicker(slotKey) {
    pickerSlotKey = slotKey;
    pickerSelection = currentLook[slotKey] ? currentLook[slotKey].id : null;
    const cat = catMap[slotKey];
    document.getElementById('picker-title').textContent = cat.label;

    const body = document.getElementById('picker-body');
    const items = wardrobe[slotKey];

    if (items.length === 0) {
      body.innerHTML = `
        <div class="empty-state">
          ${badgeHtml(cat)}
          You don't have any items yet<br>in "${cat.label}".
        </div>
      `;
      const addBtn = document.createElement('div');
      addBtn.className = 'btn primary';
      addBtn.style.marginBottom = '14px';
      addBtn.textContent = 'Add an item now';
      addBtn.addEventListener('click', () => {
        pendingCategory = slotKey;
        addItemReturnTo = 'picker';
        openCaptureScreen();
      });
      body.appendChild(addBtn);
      document.getElementById('picker-confirm').disabled = true;
    } else {
      const grid = document.createElement('div');
      grid.className = 'item-grid';
      items.forEach(it => {
        const card = document.createElement('div');
        card.className = 'item-card' + (pickerSelection === it.id ? ' selected' : '');
        card.innerHTML = `
          <div class="item-swatch"><img src="${it.imgSrc}" alt="${it.name}"><div class="check">✓</div></div>
          <div class="item-name">${it.name}</div>
        `;
        card.addEventListener('click', () => {
          pickerSelection = it.id;
          grid.querySelectorAll('.item-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          document.getElementById('picker-confirm').disabled = false;
        });
        grid.appendChild(card);
      });
      body.innerHTML = '';
      body.appendChild(grid);

      const addLink = document.createElement('div');
      addLink.className = 'btn';
      addLink.style.marginBottom = '14px';
      addLink.textContent = '+ Add another item';
      addLink.addEventListener('click', () => {
        pendingCategory = slotKey;
        addItemReturnTo = 'picker';
        openCaptureScreen();
      });
      body.appendChild(addLink);

      document.getElementById('picker-confirm').disabled = pickerSelection === null;
    }

    showScreen('picker');
  }

  document.getElementById('picker-back').addEventListener('click', () => showScreen('criar-look'));
  document.getElementById('picker-cancel').addEventListener('click', () => showScreen('criar-look'));

  document.getElementById('picker-confirm').addEventListener('click', () => {
    if (pickerSelection === null) return;
    const item = wardrobe[pickerSlotKey].find(i => i.id === pickerSelection);
    if (item) currentLook[pickerSlotKey] = item;
    showScreen('criar-look');
  });

  /* ---------------- ADD ITEM FLOW ---------------- */
  function openCaptureScreen() {
    const sub = document.getElementById('capture-subtitle');
    if (pendingCategory) {
      sub.innerHTML = `Adding to <b style="color:var(--accent)">${catMap[pendingCategory].label}</b><br>take a photo or choose from your gallery.`;
    } else {
      sub.innerHTML = "Photograph the item on a hanger, on the floor,<br>or on a table — we'll handle the rest.";
    }
    showScreen('capture');
  }

  document.getElementById('file-camera').addEventListener('change', (e) => handleFile(e.target.files[0]));
  document.getElementById('file-gallery').addEventListener('change', (e) => handleFile(e.target.files[0]));

  async function handleFile(file) {
    if (!file) return;

    const originalUrl = URL.createObjectURL(file);
    document.getElementById('processing-img').src = originalUrl;
    setProcessingLabel('Loading the background remover', 'first time only, a few seconds');
    showScreen('processing');

    try {
      const { removeBackground } = await loadBackgroundRemoval();
      const resultBlob = await removeBackground(file, {
        progress: (key, current, total) => {
          if (key && key.startsWith('fetch')) {
            setProcessingLabel('Downloading the AI model', 'first time only — happens once per device');
          } else {
            setProcessingLabel('Removing the background', 'isolating the item automatically');
          }
        },
      });
      currentPhotoBlob = resultBlob;
      currentPhotoPreviewUrl = URL.createObjectURL(resultBlob);
      document.getElementById('form-img').src = currentPhotoPreviewUrl;
      buildCategoryChips();
      showScreen('form');
    } catch (err) {
      console.error('Background removal failed, using original photo:', err.message);
      currentPhotoBlob = file;
      currentPhotoPreviewUrl = originalUrl;
      document.getElementById('form-img').src = originalUrl;
      buildCategoryChips();
      showScreen('form');
    }
  }

  function setProcessingLabel(title, sub) {
    const el = document.querySelector('.processing-label');
    if (el) el.innerHTML = `<b>${title}</b><br>${sub}`;
  }

  function buildCategoryChips() {
    const row = document.getElementById('chip-category');
    row.innerHTML = '';
    CATEGORIES.forEach(cat => {
      const chip = document.createElement('div');
      const isLocked = !!pendingCategory;
      const isSelected = pendingCategory ? cat.key === pendingCategory : false;
      chip.className = 'chip' + (isSelected ? ' selected' : '') + (isLocked ? ' locked' : '');
      chip.dataset.value = cat.key;
      chip.textContent = cat.label;
      if (!isLocked) {
        chip.addEventListener('click', () => {
          row.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');
        });
      }
      row.appendChild(chip);
    });
  }

  ['chip-color', 'chip-style'].forEach(groupId => {
    const group = document.getElementById(groupId);
    group.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      group.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
    });
  });

  document.getElementById('form-back').addEventListener('click', backFromAddItem);
  document.getElementById('form-cancel').addEventListener('click', backFromAddItem);

  function backFromAddItem() {
    pendingCategory = null;
    showScreen(addItemReturnTo === 'picker' ? 'criar-look' : 'armario');
  }

  document.getElementById('form-save').addEventListener('click', async () => {
    const name = document.getElementById('field-name').value || catMap[pendingCategory || 'top'].label;
    const categoryKey = pendingCategory || document.querySelector('#chip-category .selected')?.dataset.value || 'top';
    const color = document.querySelector('#chip-color .selected')?.dataset.value || null;
    const style = document.querySelector('#chip-style .selected')?.dataset.value || null;

    const saveBtn = document.getElementById('form-save');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saving…';
    saveBtn.style.pointerEvents = 'none';

    try {
      const storagePath = await uploadPhoto(currentPhotoBlob);

      const { data: newRow, error } = await supabaseClient
        .from('items')
        .insert({
          user_id: currentUserId,
          name,
          category: categoryKey,
          color,
          style,
          image_url: storagePath,
        })
        .select()
        .single();
      if (error) throw error;

      const urlMap = await getSignedUrls([storagePath]);
      const newItem = {
        id: newRow.id,
        name: newRow.name,
        color: newRow.color,
        style: newRow.style,
        storagePath,
        imgSrc: urlMap[storagePath] || currentPhotoPreviewUrl,
      };
      wardrobe[categoryKey].push(newItem);

      document.getElementById('field-name').value = '';
      document.querySelectorAll('#chip-color .selected, #chip-style .selected').forEach(c => c.classList.remove('selected'));

      const returnTo = addItemReturnTo;
      const wasForPicker = returnTo === 'picker';
      const slotKeyForPicker = pendingCategory;
      pendingCategory = null;

      if (wasForPicker && slotKeyForPicker) {
        pickerSelection = newItem.id;
        openPicker(slotKeyForPicker);
      } else {
        showScreen('armario');
        const idx = CATEGORIES.findIndex(c => c.key === categoryKey);
        const accItems = document.querySelectorAll('.acc-item');
        if (accItems[idx]) accItems[idx].classList.add('open');
      }
    } catch (err) {
      console.error('Could not save item:', err.message);
      alert('Could not save this item. Please try again.');
    } finally {
      saveBtn.textContent = originalText;
      saveBtn.style.pointerEvents = '';
    }
  });

  /* ---------------- MY OUTFITS ---------------- */
  let currentOutfitDetail = null;

  function renderLooks() {
    const body = document.getElementById('looks-body');
    if (savedLooks.length === 0) {
      body.innerHTML = `
        <div class="empty-state">
          <div class="icon">✨</div>
          You haven't saved any outfits yet.<br>Tap "Create Outfit" to put together your first one.
        </div>
      `;
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'looks-grid';
    savedLooks.forEach(look => {
      const card = document.createElement('div');
      card.className = 'look-card';
      card.style.cursor = 'pointer';
      const mini = document.createElement('div');
      mini.className = 'look-mini';
      CATEGORIES.forEach(cat => {
        const it = look.items[cat.key];
        const cell = document.createElement('div');
        cell.className = 'cell';
        if (it) cell.innerHTML = `<img src="${it.imgSrc}" alt="">`;
        mini.appendChild(cell);
      });
      card.appendChild(mini);
      const nameEl = document.createElement('div');
      nameEl.className = 'look-name';
      nameEl.textContent = look.name;
      card.appendChild(nameEl);
      card.addEventListener('click', () => {
        currentOutfitDetail = look;
        showScreen('outfit-detail');
      });
      grid.appendChild(card);
    });
    body.innerHTML = '';
    body.appendChild(grid);
  }

  function renderOutfitDetail() {
    if (!currentOutfitDetail) return;
    document.getElementById('outfit-detail-name').textContent = currentOutfitDetail.name;

    const layout = document.getElementById('outfit-detail-layout');
    layout.innerHTML = '';
    CATEGORIES.forEach(cat => {
      const it = currentOutfitDetail.items[cat.key];
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.style.cursor = 'default';
      if (it) {
        slot.innerHTML = `<img src="${it.imgSrc}" alt="${it.name}"><div class="item-label">${it.name}</div>`;
      } else {
        slot.style.opacity = '0.4';
        slot.innerHTML = `${badgeHtml(cat, 'sm')}<div class="slot-label-static">${cat.label}</div>`;
      }
      layout.appendChild(slot);
    });
  }

  document.getElementById('outfit-rename-btn').addEventListener('click', async () => {
    if (!currentOutfitDetail) return;
    const newName = prompt('Rename this outfit', currentOutfitDetail.name);
    if (!newName || !newName.trim() || newName === currentOutfitDetail.name) return;

    const trimmed = newName.trim();
    const { error } = await supabaseClient
      .from('outfits')
      .update({ name: trimmed })
      .eq('id', currentOutfitDetail.id);

    if (error) {
      console.error('Could not rename outfit:', error.message);
      alert('Could not rename this outfit. Please try again.');
      return;
    }

    currentOutfitDetail.name = trimmed;
    const savedEntry = savedLooks.find(l => l.id === currentOutfitDetail.id);
    if (savedEntry) savedEntry.name = trimmed;
    renderOutfitDetail();
  });

  document.getElementById('outfit-delete-btn').addEventListener('click', async () => {
    if (!currentOutfitDetail) return;
    const confirmed = confirm(`Delete "${currentOutfitDetail.name}"? This can't be undone.`);
    if (!confirmed) return;

    const { error } = await supabaseClient
      .from('outfits')
      .delete()
      .eq('id', currentOutfitDetail.id);

    if (error) {
      console.error('Could not delete outfit:', error.message);
      alert('Could not delete this outfit. Please try again.');
      return;
    }

    savedLooks = savedLooks.filter(l => l.id !== currentOutfitDetail.id);
    currentOutfitDetail = null;
    showScreen('looks');
  });

  /* ---------------- ACCOUNT ---------------- */
  function renderAccount() {
    const body = document.getElementById('account-body');

    if (!currentUserIsAnonymous && currentUserEmail) {
      body.innerHTML = `
        <div class="account-status">
          <div class="icon">✅</div>
          <div>
            <div class="email">${currentUserEmail}</div>
            <div class="tag">Signed in — your closet is saved to this account</div>
          </div>
        </div>
      `;
      const logoutBtn = document.createElement('div');
      logoutBtn.className = 'btn';
      logoutBtn.textContent = 'Log out';
      logoutBtn.addEventListener('click', handleLogout);
      body.appendChild(logoutBtn);
      return;
    }

    body.innerHTML = `
      <p class="account-copy">Log in to reach the closet and outfits saved under an existing account.</p>
      <div class="field">
        <label>Email</label>
        <input type="email" id="account-login-email" placeholder="you@example.com">
      </div>
      <div class="field">
        <label>Password</label>
        <input type="password" id="account-login-password" placeholder="••••••••">
      </div>
      <p class="account-message" id="account-login-message"></p>
    `;

    const loginBtn = document.createElement('div');
    loginBtn.className = 'btn primary';
    loginBtn.textContent = 'Log in';
    loginBtn.addEventListener('click', handleAccountLogin);
    body.appendChild(loginBtn);

    const createLink = document.createElement('div');
    createLink.className = 'text-link';
    createLink.style.marginTop = '18px';
    createLink.textContent = "Don't have an account yet? Create one here";
    createLink.addEventListener('click', () => showScreen('create-account'));
    body.appendChild(createLink);
  }

  async function handleAccountLogin() {
    const email = document.getElementById('account-login-email').value.trim();
    const password = document.getElementById('account-login-password').value;
    const msg = document.getElementById('account-login-message');
    msg.textContent = '';
    msg.classList.remove('error');

    if (!email || !password) {
      msg.textContent = 'Enter your email and password.';
      msg.classList.add('error');
      return;
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      msg.textContent = error.message;
      msg.classList.add('error');
      return;
    }

    applySession(data.session);
    await Promise.all([fetchWardrobe(), fetchLooks()]);
    showScreen('home');
  }

  document.getElementById('create-account-back').addEventListener('click', () => showScreen('account'));

  document.getElementById('create-account-submit').addEventListener('click', async () => {
    const email = document.getElementById('create-account-email').value.trim();
    const password = document.getElementById('create-account-password').value;
    const msg = document.getElementById('create-account-message');
    msg.textContent = '';
    msg.classList.remove('error');

    if (!email || password.length < 6) {
      msg.textContent = 'Enter an email and a password with at least 6 characters.';
      msg.classList.add('error');
      return;
    }

    const { error } = await supabaseClient.auth.updateUser({ email, password });
    if (error) {
      msg.textContent = error.message;
      msg.classList.add('error');
      return;
    }

    msg.classList.remove('error');
    msg.textContent = 'Check your email to confirm the address, then you can log in from any device.';
  });

  async function handleLogout() {
    await supabaseClient.auth.signOut();
    currentUserEmail = null;
    currentUserIsAnonymous = true;
    Object.keys(currentLook).forEach(k => delete currentLook[k]);
    CATEGORIES.forEach(c => { wardrobe[c.key] = []; });
    savedLooks = [];
    await ensureSession(); // starts a fresh anonymous session
    await Promise.all([fetchWardrobe(), fetchLooks()]);
    showScreen('home');
  }

  /* ---------------- INIT ---------------- */
  async function init() {
    const splashStart = Date.now();
    const minSplashTime = 900; // ms, so the animation doesn't just flash by

    await ensureSession();
    if (!currentUserId) {
      hideSplash();
      return; // sign-in failed, error already shown
    }
    await Promise.all([fetchWardrobe(), fetchLooks()]);
    renderHome();

    const elapsed = Date.now() - splashStart;
    const remaining = Math.max(0, minSplashTime - elapsed);
    setTimeout(hideSplash, remaining);
  }

  function hideSplash() {
    const splash = document.getElementById('splash-screen');
    const fill = document.getElementById('splash-bar-fill');
    if (fill) fill.classList.add('complete');
    if (splash) {
      setTimeout(() => {
        splash.classList.add('hidden');
        setTimeout(() => splash.remove(), 450);
      }, 200);
    }
  }

  init();
