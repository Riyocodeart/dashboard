# Desk Performance Board

A static dashboard (HTML + CSS + JavaScript, no Node.js). Shared data, the upload password and the original files are kept in **Supabase**. It is hosted on **Cloudflare Pages**, and you can also open it locally.

- Anyone with the link can **view**. Everyone sees the same saved data and charts.
- **Uploading** needs one shared password. It is asked once per browser session, the first time you upload, and is checked inside Supabase. It never appears in the page code.
- A new upload replaces that file's data for everyone. Open dashboards refresh on their own within a minute.
- Every uploaded original `.xlsx` is kept and can be downloaded from the Upload panel (password required).

```
MyDashboard/
├── index.html                    page layout
├── assets/
│   ├── style.css                 theme and layout
│   └── script.js                 all logic; CONFIGURATION block at the top
├── vendor/
│   ├── supabase-2.117.3.js       Supabase client
│   └── xlsx-0.18.5.full.min.js   spreadsheet reader (SheetJS)
├── supabase/
│   ├── setup.sql                 tables, password and secure functions (run once)
│   └── seed-sample-data.sql      optional: preload the 3 sample files
├── sample-files/                 the 3 test files
├── _headers                      Cloudflare security headers
└── README.md
```

## 1. Create the Supabase backend (about 5 minutes)
1. Create a free project at https://supabase.com and wait for it to finish starting.
2. Open **SQL Editor → New query**. Paste all of `supabase/setup.sql`.
3. Near the bottom, replace `CHANGE-THIS-PASSWORD` with your upload password (12 or more characters). Click **Run**. Type the password in the SQL Editor only, never in the `setup.sql` file you deploy, because files in this folder are publicly downloadable once deployed. The placeholder password never works.
4. Optional: to start with the current data already loaded, run `supabase/seed-sample-data.sql` the same way. You can also skip this and upload the 3 files from `sample-files/`.
5. Go to **Project Settings → API** (or **Connect**) and copy:
   - the **Project URL** (`https://xxxx.supabase.co`)
   - the **anon / publishable** key. Never use the `service_role` / secret key.

**To change the password later**, run only the last block of `setup.sql` with the new password. This signs out everyone who is currently unlocked.

## 2. Connect the page
Open `assets/script.js`. In the **CONFIGURATION** block at the top, set:
```js
supabase:{ url:'https://xxxx.supabase.co', key:'your-anon-or-publishable-key' },
```
The anon key is meant to be public. It can only read the dashboard and call the password-protected functions.

## 3. Run locally
- Double-click `index.html`, **or**
- serve the folder with `python -m http.server 8080` and open http://localhost:8080. You can also use `npx wrangler pages dev .` to apply the `_headers` too.

Locally the page uses the same Supabase data as the live site.

## 4. Deploy to Cloudflare Pages
**Drag and drop:** Cloudflare dashboard → **Workers & Pages → Create → Pages → Upload assets**. Upload the `MyDashboard` folder. There is no build step.

**From Git:** push the folder to a repo, then **Create → Pages → Connect to Git**. Leave *Build command* empty and set *Build output directory* to `/` (or the folder's path).

**CLI:** `npx wrangler pages deploy . --project-name desk-performance-board`

Share the `*.pages.dev` URL (or your custom domain).

## Using it
1. Click **⬆ Upload data** (bottom-right) and enter the password once.
2. Choose any of the 3 files. Each file is checked straight away, and a preview shows users, rows used, duplicates removed and whether the validation targets match.
3. Click **Save to dashboard**. If anything fails, nothing changes and your files stay selected.

**Filters:** the left sidebar has GL, TL, User, Greylabs date range, Language, Task type, Domain and Client check. Every table column also has an Excel-style filter and sort. On phones the sidebar folds into a **Filters → Show** bar.

## Changing column names, targets or charts
Everything is in the **CONFIGURATION** block at the top of `assets/script.js`:
- `files.*.fields`: the column names each field looks for. If a new file renames a column, add the new name to its `names` list.
- `expected`: the validation targets shown in *Merge check* (now 24 users, 3 GLs, 6 TLs, 307 clients, 231 entries, 12–23 Oct). Update them for new files, or set `expected:null` to hide the check.
- `charts`: margin cut-off (₹1,00,000), quality colour bands, task-type grouping, series colours, chart height and margin grouping.
- `refreshSeconds`, `maxFileMB`.

## How the merge works
- **Mapping** is the master list, with one row per User ID.
- **Margin** and **Greylabs** rows join by User ID, or by User Name when that name is unique.
- Repeated Mapping IDs, repeated (user, client) margin rows and identical Greylabs rows are counted once.
- Rows that match no user are left out and listed in *Merge check*.
- All numbers are calculated from the uploaded rows. Nothing is hard-coded.

## Security notes
- The password is stored only as a bcrypt hash in the `private` schema, which the Supabase API does not expose. Upload sessions are random 12-hour tokens, stored as SHA-256 hashes.
- After 5 wrong passwords from one IP, the next attempt must wait 60 seconds.
- Visitors can only `select` the dashboard row. All writes go through `save_dashboard`, which checks the session, accepts only the 3 known file types, cleans every row and saves everything in one transaction.
- `_headers` sets a strict Content-Security-Policy. If you use a custom Supabase domain, add it to `connect-src`.
- To see or back up the originals: Supabase → **Table Editor → schema `private` → `original_files`**.
