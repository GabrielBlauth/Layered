/* ---------------- categories ---------------- */
  const CATEGORIES = [
    { key: 'top',       label: 'Tops',        icon: '👕' },
    { key: 'bottom',    label: 'Bottoms',     icon: '👖' },
    { key: 'shoes',     label: 'Shoes',       icon: '👟' },
    { key: 'jacket',    label: 'Outerwear',   icon: '🧥' },
    { key: 'head',      label: 'Headwear',    icon: '🧢' },
    { key: 'accessory', label: 'Accessories', icon: '⌚' },
  ];
  const catMap = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));

  /* ---------------- state ---------------- */
  const wardrobe = Object.fromEntries(CATEGORIES.map(c => [c.key, []]));
  const savedLooks = [];
  const currentLook = {}; // key -> item

  let itemIdSeq = 1;
  let pendingCategory = null;      // category preset when opening add-item from a specific accordion/slot
  let addItemReturnTo = 'closet';  // where to go back after saving a new item
  let currentImageData = null;

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
  }

  document.querySelectorAll('[data-goto]').forEach(el => {
    el.addEventListener('click', () => showScreen(el.dataset.goto));
  });

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
          <div class="icon">${cat.icon}</div>
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
        tile.innerHTML = `<img src="${it.imgSrc}" alt="${it.name}"><div class="tile-label">${it.name}</div>`;
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
        slot.innerHTML = `<div class="plus">${cat.icon}</div><div class="slot-label-static">${cat.label}</div>`;
      }
      slot.addEventListener('click', () => openPicker(cat.key));
      layout.appendChild(slot);
    });
  }

  document.getElementById('look-reset').addEventListener('click', () => {
    Object.keys(currentLook).forEach(k => delete currentLook[k]);
    renderLookLayout();
  });

  document.getElementById('look-save').addEventListener('click', () => {
    const chosen = Object.values(currentLook);
    if (chosen.length === 0) return;
    savedLooks.unshift({
      id: itemIdSeq++,
      name: `Outfit ${savedLooks.length + 1}`,
      items: { ...currentLook },
    });
    Object.keys(currentLook).forEach(k => delete currentLook[k]);
    showScreen('looks');
  });

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
          <div class="icon">${cat.icon}</div>
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

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      currentImageData = e.target.result;
      document.getElementById('processing-img').src = currentImageData;
      showScreen('processing');
      setTimeout(() => {
        document.getElementById('form-img').src = currentImageData;
        buildCategoryChips();
        showScreen('form');
      }, 1300);
    };
    reader.readAsDataURL(file);
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

  document.getElementById('form-save').addEventListener('click', () => {
    const name = document.getElementById('field-name').value || catMap[pendingCategory || 'top'].label;
    const categoryKey = pendingCategory || document.querySelector('#chip-category .selected')?.dataset.value || 'top';
    const color = document.querySelector('#chip-color .selected')?.dataset.value || '—';
    const style = document.querySelector('#chip-style .selected')?.dataset.value || '—';

    const newItem = { id: itemIdSeq++, imgSrc: currentImageData, name, color, style };
    wardrobe[categoryKey].push(newItem);

    document.getElementById('field-name').value = '';
    document.querySelectorAll('#chip-color .selected, #chip-style .selected').forEach(c => c.classList.remove('selected'));

    const returnTo = addItemReturnTo;
    const wasForPicker = returnTo === 'picker';
    const slotKeyForPicker = pendingCategory;
    pendingCategory = null;

    if (wasForPicker && slotKeyForPicker) {
      showScreen('criar-look');
      openPicker(slotKeyForPicker);
      pickerSelection = newItem.id;
      openPicker(slotKeyForPicker); // re-render with new item selected
    } else {
      showScreen('armario');
      const idx = CATEGORIES.findIndex(c => c.key === categoryKey);
      const accItems = document.querySelectorAll('.acc-item');
      if (accItems[idx]) accItems[idx].classList.add('open');
    }
  });

  /* ---------------- MY OUTFITS ---------------- */
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
      grid.appendChild(card);
    });
    body.innerHTML = '';
    body.appendChild(grid);
  }

  renderHome();
