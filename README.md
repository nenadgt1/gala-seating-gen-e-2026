# Gala Seating System, hosted version

This is a standalone version of the gala seating app. It is designed to run outside WordPress so the Gen-E website only embeds the viewer, moderator, and admin pages with iframes.

## Pages

After deployment, the app exposes:

- `/viewer` for the public seating finder
- `/moderator` for moderator seating change requests
- `/<ADMIN_PATH>` for the private admin panel
- `/health` for Render health checks

The old `/admin`, `/wp-admin`, and `/gala-admin` paths intentionally return 404. The private admin URL is controlled by `ADMIN_PATH`.

## Why Render is recommended

This app stores seating data in a small JSON database file. Render can attach a persistent disk, so imports, assignments, and moderator requests survive restarts. Vercel serverless storage is not suitable for this app unless you add an external database.

## Deploy on Render

1. Create a private GitHub repository and upload this folder.
2. In Render, create a new Web Service from that repository.
3. Use:
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/health`
4. Add a persistent disk:
   - Mount path: `/data`
   - Size: 1 GB is enough
5. Add environment variables:
   - `ADMIN_PASSWORD`: a long private password for the one admin user
   - `APP_SECRET`: long random string, or let Render generate it from `render.yaml`
   - `ADMIN_PATH`: secret admin route, for example `gala-private-7f39`
   - `DATA_FILE`: `/data/gala-data.json`
   - `FRAME_ANCESTORS`: `*` or a stricter domain list
   - `MODERATOR_PASSWORD`: optional. Leave empty if moderators can submit requests without a password.
6. Open the deployed URLs:
   - `https://YOUR-APP.onrender.com/viewer`
   - `https://YOUR-APP.onrender.com/moderator`
   - `https://YOUR-APP.onrender.com/YOUR_ADMIN_PATH`

## Admin workflow

1. Log in with `ADMIN_PASSWORD`.
2. Import the attendee CSV in the admin panel.
3. Use `table_number` values exactly as shown on the chart, for example `1A`, `7C`, `15F`.
4. Every table has a hard capacity of 12 people.
5. Moderator requests appear in the pending panel. Approving a request changes the attendee table only if the requested table still has capacity.

## Supported CSV columns

The importer accepts these names and common variants:

```csv
first_name,last_name,email,organisation,position,country,gender,ja_profile,registration_type,admission_item,dietary_requirements,additional_comments,departure_date,table_number
```

It also recognizes variants like `First Name`, `Surname`, `Organization`, `Table`, and `Table No`.

## WordPress embedding

Use the iframe snippets in `docs/wordpress-embed-snippets.html`. For the public Gen-E page, embed `/viewer`. For staff, embed or share `/moderator`. Do not publish the admin iframe publicly.

## Local test

```bash
cp .env.example .env
npm start
```

Then open:

- `http://localhost:3000/viewer`
- `http://localhost:3000/moderator`
- `http://localhost:3000/gala-admin-2026`

The default local admin password is `change-this-admin-password`. Change it before production.

## Files that matter

- `server.js`: backend, auth, import, assignment, pending requests
- `table-seed.json`: 83 table positions from the real seating map
- `public/assets/gala-seating-map.jpg`: optimized seating chart image
- `data/gala-data.json`: local database when not using `/data`
