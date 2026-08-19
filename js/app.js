/* ---------------- categories ---------------- */
  const CATEGORIES = [
    { key: 'top',       label: 'Tops',        badge: 'badge-coral',  svg: '<path d="M6 4 L9 2 L12 4 L15 2 L18 4 L21 7 L18 9 L18 21 L6 21 L6 9 L3 7 Z"/>' },
    { key: 'bottom',    label: 'Bottoms',     badge: 'badge-indigo', svg: '<path d="M6 3 H18 V7 L15.5 21 H13 L12 10 L11 21 H8.5 L6 7 Z"/>' },
    { key: 'shoes',     label: 'Shoes',       badge: 'badge-teal',   svg: '<path d="M2 17 Q2 14 6 13 L10 11 Q12 9 15 9 L21 9 Q22 9 22 11 L22 15 Q22 17 20 17 Z"/>' },
    { key: 'jacket',    label: 'Outerwear',   badge: 'badge-purple', svg: '<path d="M6 4 L9 2 L12 4 L15 2 L18 4 L21 7 L18 9 L18 21 L6 21 L6 9 L3 7 Z"/><line x1="12" y1="4" x2="12" y2="21" stroke="#fff" stroke-width="1.4"/>' },
    { key: 'head',      label: 'Headwear',    badge: 'badge-orange', svg: '<path d="M4 14 Q4 6 12 6 Q20 6 20 14 Z"/><path d="M2 14 Q12 17.5 22 14 L22 15.6 Q12 19 2 15.6 Z"/>' },
    { key: 'accessory', label: 'Accessories', badge: 'badge-gold',   svg: '<circle cx="12" cy="12" r="5.2" fill="none" stroke="#fff" stroke-width="1.6"/><rect x="10" y="1.5" width="4" height="4" rx="0.6"/><rect x="10" y="18.5" width="4" height="4" rx="0.6"/>' },
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
  let currentImageData = null;     // data URL of the photo just captured

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

  function dataURLtoBlob(dataUrl) {
    const [header, base64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function uploadPhoto(dataUrl) {
    const blob = dataURLtoBlob(dataUrl);
    const ext = blob.type.split('/')[1] || 'png';
    const path = `${currentUserId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabaseClient.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type,
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

  document.getElementById('look-save').addEventListener('click', async () => {
    const chosen = Object.entries(currentLook);
    if (chosen.length === 0) return;

    const saveBtn = document.getElementById('look-save');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saving…';

    try {
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

      Object.keys(currentLook).forEach(k => delete currentLook[k]);
      await fetchLooks();
      showScreen('looks');
    } catch (err) {
      console.error('Could not save outfit:', err.message);
      alert('Could not save this outfit. Please try again.');
    } finally {
      saveBtn.textContent = originalText;
    }
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
      const storagePath = await uploadPhoto(currentImageData);

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
        imgSrc: urlMap[storagePath] || currentImageData,
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
      <p class="account-copy">Your closet is currently only saved on this device. Add an email and password to keep it safe and reach it from other devices.</p>
      <div class="field">
        <label>Email</label>
        <input type="email" id="account-email" placeholder="you@example.com">
      </div>
      <div class="field">
        <label>Password</label>
        <input type="password" id="account-password" placeholder="At least 6 characters">
      </div>
      <p class="account-message" id="account-message"></p>
    `;

    const createBtn = document.createElement('div');
    createBtn.className = 'btn primary';
    createBtn.textContent = 'Create account';
    createBtn.addEventListener('click', handleCreateAccount);
    body.appendChild(createBtn);

    const loginLink = document.createElement('div');
    loginLink.className = 'account-link';
    loginLink.style.marginTop = '18px';
    loginLink.textContent = 'Already have an account? Log in';
    loginLink.addEventListener('click', () => showScreen('login'));
    body.appendChild(loginLink);
  }

  async function handleCreateAccount() {
    const email = document.getElementById('account-email').value.trim();
    const password = document.getElementById('account-password').value;
    const msg = document.getElementById('account-message');
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
  }

  document.getElementById('login-back').addEventListener('click', () => showScreen('account'));

  document.getElementById('login-submit').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const msg = document.getElementById('login-message');
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
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    await Promise.all([fetchWardrobe(), fetchLooks()]);
    showScreen('home');
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
    await ensureSession();
    if (!currentUserId) return; // sign-in failed, error already shown
    await Promise.all([fetchWardrobe(), fetchLooks()]);
    renderHome();
  }

  init();
