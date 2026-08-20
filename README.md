# Layered

A digital closet app: photograph your clothes, and the app builds outfits from what you already own.

## Current status

✅ Connected to Supabase — items and outfits persist for real. Full navigable flow:

- **Home** — My Outfits / Create Outfit / Closet
- **Closet** — catalog by category (expandable accordion), add items by photo
- **Create Outfit** — grid of 6 categories, pick real items from your closet to build an outfit
- **My Outfits** — saved outfits with a thumbnail preview

Each browser/device currently gets an **anonymous Supabase session** on first load (no login screen yet) — this already gives every user their own private, persistent closet under the hood. Email/password login (matching the Last Frequency approach) is a planned upgrade; anonymous sessions can be linked to a real account later without losing data.

## Stack

- Vanilla JS / HTML / CSS (no framework, no build step)
- PWA (`manifest.json`) — installable on mobile
- Hosting: GitHub Pages
- Backend: Supabase (Postgres database with Row Level Security, Auth, Storage)
- Next up: email/password login, `@imgly/background-removal` (local background removal via WASM), an LLM-based outfit suggestion engine

## Structure

```
layered/
├── index.html               # markup for every screen
├── css/
│   └── style.css             # design system + all screen styles
├── js/
│   ├── supabase-client.js     # Supabase project connection
│   └── app.js                 # screen navigation + app state + data calls
├── supabase/
│   └── schema.sql              # tables, RLS policies, storage bucket setup
├── manifest.json              # PWA config
└── assets/                    # icons, static images
```

## Running locally

No build step, no server required — just open `index.html` in a browser. To test the phone camera (`capture="environment"` input), serve over HTTPS (GitHub Pages handles this) or run a simple local server:

```bash
python3 -m http.server 8000
```

## Closet categories

Tops · Bottoms · Shoes · Outerwear · Headwear (hats/caps) · Accessories (watches, bracelets, necklaces, glasses, belts)

## Roadmap

- [x] Real persistence (Supabase: item and outfit tables, image storage)
- [x] Real background removal (`@imgly/background-removal`, runs in the browser)
- [x] Outfit suggestion engine (rule-based, using closet metadata — color and style — to generate combinations)
- [ ] Email/password login (upgrade from anonymous sessions)
- [x] Edit item / edit saved outfit (tap any closet item or outfit to open its detail view)
- [ ] Filter by season/weather
