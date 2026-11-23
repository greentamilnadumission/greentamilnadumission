# GTM Department Dashboard

A department-wise dashboard of Green Tamil Nadu Mission geotagged plantings. Each department signs in with its own login ID and password and sees only its own data, district by district. The head office login (`GTM-ADMIN`) sees every department.

The site is plain HTML, CSS and JavaScript, with no framework. A small Node.js script turns the `gtm-data` export into one encrypted file per department. A GitHub Action rebuilds and deploys it to Vercel automatically.

```
gtm-data release (merged.csv.gz)
        │  GitHub Action (checks every hour, rebuilds only when the release changed)
        ▼
scripts/build-data.mjs ── cleans, filters, removes personal data,
        │                 encrypts one file per department
        ▼
public/  ──────────────── vercel deploy --prebuilt ──► https://<your-project>.vercel.app
```

## What the dashboard shows

**Dashboard (`index.html`)**

- **Summary boxes**: seedlings planted, planting records, districts (or taluks and blocks when a district is open), species planted, records on the map, and seedlings per record.
- **District list**: all districts ranked by seedlings. Selecting a district filters everything on the page; selecting it again returns to all districts. **Hide districts** / **Show districts** (or the × in the list) closes and opens the list, and the choice is remembered on that computer.
- **Filters**: plantation year, taluk or block, species, and land type. The head office login also has a department filter and a "Seedlings by department" chart.
- **Charts**: seedlings by plantation year, plantings by month, taluks and blocks, species, and land type. Selecting a bar applies that filter.
- **Map**: every geotagged planting. Selecting a dot zooms in and opens that planting's full record, including names and phone numbers.
- **Table**: districts, or the villages within the selected district, with serial numbers. You can sort and search it. Selecting a district opens it; selecting a village opens its planting records.
- **Download CSV**: a summary row for every planting record in the current selection, with serial numbers.

**Planting records (`records.html`)**

Opened with **View planting records with contact details**. It shows every row of the export for one district or for all districts, with every column under a clear heading, including names and phone numbers. It has filters for district, department (head office only), taluk or block, plantation year, species and land type, plus a search box for names, mobile numbers and villages. It also shows serial numbers, 50/100/200 rows per page, and the full record when you select a row. **Export to Excel (CSV)** saves every record that matches the filters, with serial numbers. **Back to dashboard** returns to the same district and filters. If someone opens this page in a new tab, they're asked to sign in and then brought back to it.

**Logo**: put the GTM logo at `public/img/gtm-logo.png` (a square PNG works best). It appears in the header of every page. Until the file is there, a leaf mark is shown instead.

## Data rules

The build applies these rules every time it runs. They're configured in `config/departments.json`.

| Rule | Detail |
|---|---|
| Sources | The `Other Department` rows with Department Type `Govt Department`, plus all `Agriculture Department` rows. The Forest, Plant-a-Tree and Coastal sources are not included. |
| Agriculture | `Agriculture Department` rows are shown inside **Agriculture** (`GTM-AGRI`) together with `DEPARTMENT OF AGRICULTURE`. |
| Merges | The two HR&CE values become one department. Both spellings of Animal Husbandry become one department. |
| Others and blanks | Matched by keyword: Stakeholder Name first, then Contact Name and Officer Name. For example, DRDA, BDO and Panchayat go to Rural Development and Panchayat Raj. Rows that match nothing stay in **Others**, which only `GTM-ADMIN` can see. |
| Excluded | NGO, Trust, Private Entity, Public Sector and "Others" Department Types. NLC India. Test entries. Rows with 0 seedlings. |
| Districts | Spellings are cleaned to Tamil Nadu's 38 districts. For example, Trichy becomes Tiruchirappalli and Tuticorin becomes Thoothukudi. |
| Dates | The monthly chart ignores dates before April 2021 and dates in the future. The financial year column is used as given. |
| Full records | Each district's rows are kept with every column from the export, including names, mobile numbers, emails, addresses and survey numbers. They are stored in a separate encrypted file per department and district, which loads only when needed: on the planting records page, or when a map dot is selected. |

Every build writes `build-report/reassigned.tsv`, which lists each row moved out of Others or blank and where it went. It also writes `build-report/summary.json`. On GitHub, both are attached to each run as the **build-report** artifact.

## How the logins work

The dashboard has no server, so each department's data files are encrypted with AES-256-GCM. The key is derived from that department's password using PBKDF2-SHA-256 with 310,000 iterations. Each login has a summary file, loaded at sign-in, and one file per district holding the full records, loaded when that district is opened. The browser can only decrypt a login's files with the correct password. A wrong password reveals nothing. One department's password can't open another department's files.

Things to know:

- Anyone who has a department's ID and password can see that department's data, **including names and phone numbers**. Give each department only its own login, and only to the people who should see it.
- The passwords are randomly generated and long (about 84 bits), which makes guessing them impractical. Don't replace them with short or easy ones.
- To withdraw someone's access, change that department's password (see below). The old password stops working after the next deploy.
- The site isn't indexed by search engines: it sends `noindex` and has a `robots.txt` that disallows all crawlers.

## One-time setup

You need Node.js 20 or newer on your computer for step 1 only. Everything after that runs on GitHub.

### 1. Create the department passwords

```bash
npm run credentials
```

This creates two files on your computer:

- `config/credentials.local.json`, which you'll copy into GitHub in step 4.
- `config/credentials.local.csv`, the list of departments, login IDs and passwords to hand out.

Both are git-ignored and must never be committed. Send each department only its own row, through a channel you trust.

### 2. Put the code on GitHub

Create a **private** repository, for example `greentamilnadumission/gtm-dashboard`, and push this folder to it. The data and passwords are not part of the repository.

### 3. Create the Vercel project

1. Install the Vercel CLI and link the folder to a new project:
   ```bash
   npm install --global vercel
   vercel link
   ```
   Choose your team and **create a new project**. When asked about the framework, choose **Other**.
2. Open `.vercel/project.json`. Copy `orgId` and `projectId`; you'll need them in step 4.
3. In Vercel, go to **Account Settings → Tokens** and create a token for GitHub Actions.

Automatic deploys from Git are switched off in `vercel.json`. This is deliberate: a Git deploy wouldn't have the data, so only the GitHub Action deploys.

### 4. Add the repository secrets

In the dashboard repository, go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret | Value |
|---|---|
| `GTM_DATA_TOKEN` | A GitHub fine-grained personal access token with **Resource owner** `greentamilnadumission`, **Repository access** set to `gtm-data` only, and **Permissions** Contents: Read-only. |
| `DEPT_CREDENTIALS` | The whole contents of `config/credentials.local.json`. |
| `VERCEL_TOKEN` | The Vercel token from step 3. |
| `VERCEL_ORG_ID` | `orgId` from `.vercel/project.json`. |
| `VERCEL_PROJECT_ID` | `projectId` from `.vercel/project.json`. |

### 5. Run the first deploy

Go to **Actions → Build and deploy dashboard → Run workflow**. When the run finishes, its summary page shows the record and seedling totals for each department. The site is then live on the project's Vercel URL. You can add your own domain under **Vercel → Project → Settings → Domains**.

## How it keeps itself up to date

The website never talks to GitHub itself, because that would expose the token to anyone. The data only changes when the build runs, which downloads the release and rebuilds the encrypted files.

The workflow (`.github/workflows/deploy.yml`) runs:

- **Every hour.** It checks the upload time of `merged.csv.gz` in the `latest-export` release. If neither that nor the dashboard code has changed since the last deploy, it stops after a few seconds. So a new release is live within about an hour, plus 2 to 3 minutes to build and deploy.
- When you press **Run workflow**. This always rebuilds; use it after changing passwords.
- When code or config changes on `main`.
- When `gtm-data` sends a `gtm-data-updated` event, which refreshes the site straight away (see below).

If a build produces almost no rows, it stops before replacing anything, so a broken export can't blank the site.

If the site isn't updating, open **Actions** in the dashboard repository and look at the latest run. The error names the problem; the usual causes are a missing secret, or an expired or wrong `GTM_DATA_TOKEN`.

**Optional: refresh as soon as the export finishes.** Add this as the last step of the export workflow in `gtm-data`. It needs a token secret there, `DASHBOARD_DISPATCH_TOKEN`: a fine-grained token on the dashboard repository with Contents read and write permission.

```yaml
      - name: Refresh the dashboard
        env:
          GH_TOKEN: ${{ secrets.DASHBOARD_DISPATCH_TOKEN }}
        run: gh api repos/greentamilnadumission/gtm-dashboard/dispatches -f event_type=gtm-data-updated
```

## Everyday tasks

**Change one department's password**

```bash
npm run credentials -- --reset GTM-RDPR
```

Paste the new JSON into the `DEPT_CREDENTIALS` secret, then run the workflow. Run `npm run credentials -- --reset all` to change every password.

**Add a department, an alias or a keyword rule**

Edit `config/departments.json`, add a password with `npm run credentials`, update the secret, and push.

**The run summary warns about a new department or district spelling**

That means the export contains a value the build doesn't recognise. Add the department value to the department's `match` list in `config/departments.json`. Add a district spelling to the aliases in `scripts/lib/clean.mjs`.

**Preview on your own computer with the latest data**

1. Create `config/github-token.local.txt` and paste a GitHub token with read access to `gtm-data` on one line. The file is git-ignored.
2. Run:
   ```bash
   npm run update
   npm run serve
   ```
   `npm run update` downloads the latest `merged.csv.gz` from the release and rebuilds `public/data`. Run it again whenever the release changes.
3. Open http://localhost:4173, or use VS Code Live Server on `public/index.html`, and sign in with a login from `config/credentials.local.csv`.

If you already have a `merged.csv.gz`, put it in this folder and run `npm run build:data` instead.

## Files

```
public/                    the website (what Vercel serves)
  index.html               dashboard
  records.html             planting records page
  img/gtm-logo.png         GTM logo (add this file)
  css/styles.css
  js/app.js                filters, district list, summary boxes, charts, map, table, CSV export
  js/records.js            planting records page: filters, search, paging, export
  js/brand.js              shows the GTM logo when the file is present
  js/vault.js              sign-in and decryption
  js/dotlayer.js           fast map dots
  js/format.js             lakh/crore formatting
  vendor/                  Chart.js 4.6, Leaflet 1.9, fonts (self-hosted, MIT/OFL)
  data/                    encrypted department files (generated; not in Git)
config/departments.json    login IDs, department names, merges, keyword rules, exclusions
scripts/build-data.mjs     builds public/data from the export
scripts/update-local.mjs     downloads the latest release and rebuilds (npm run update)
scripts/generate-credentials.mjs
scripts/serve.mjs          local preview server
.github/workflows/deploy.yml
vercel.json                static hosting, security headers, Git deploys off
```

Map tiles come from OpenStreetMap; the attribution appears on the map.
