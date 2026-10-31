# Deploying to cPanel (test site on mpadqclab.com hosting)

The app runs as one Node.js application with a MySQL database: the same server serves the web screens and the API. GitHub Actions builds it on every push to `main` and publishes a ready-to-run copy to the **`deploy`** branch, so the hosting account never has to build anything.

Use a **subdomain** such as `app.mpadqclab.com` so the live website is never touched.

## One-time setup (about 20 minutes)

### 1. Check the hosting supports Node.js
cPanel → look for **Setup Node.js App** (under *Software*). If it is missing, ask the host to enable it (CloudLinux Node.js Selector). If they can't, see *No Node.js on the host* at the end.

### 2. Create the subdomain
cPanel → **Domains** → *Create a new domain* → `app.mpadqclab.com`. Then **SSL/TLS Status** → run AutoSSL so it has HTTPS.

### 3. Create the database
cPanel → **MySQL® Databases**:
1. Create database, e.g. `cpuser_suite`.
2. Create user, e.g. `cpuser_suite`, with a strong password.
3. *Add user to database* → tick **ALL PRIVILEGES**.

### 4. Pull the app from GitHub
Wait until the **Actions** tab on GitHub shows a green run (it creates the `deploy` branch).
cPanel → **Git™ Version Control** → *Create*:
- Clone URL: `https://github.com/<your-account>/<repo>.git`
- Repository path: `lab-suite`
- After it clones: *Manage* → *Checkout* branch **deploy**.

### 5. Create the Node.js application
cPanel → **Setup Node.js App** → *Create application*:
- Node.js version: **20** (18 also works)
- Application mode: **Production**
- Application root: `lab-suite`
- Application URL: `app.mpadqclab.com`
- Application startup file: `server.cjs`

Add **environment variables** (same page). Secrets are entered here, never in GitHub or chat:

| Name | Value |
| --- | --- |
| `DB_CLIENT` | `mysql` |
| `MYSQL_HOST` | `localhost` |
| `MYSQL_DATABASE` | the database from step 3 |
| `MYSQL_USER` | the user from step 3 |
| `MYSQL_PASSWORD` | that user's password |
| `JWT_SECRET` | a long random string (40+ characters) |
| `COOKIE_SECURE` | `true` |
| `ADMIN_EMAIL` | the owner's login email |
| `ADMIN_PASSWORD` | the owner's first password (change it after login) |
| `ADMIN_NAME` | owner's name |
| `SMTP_PASSWORD` | mailbox password, only when email sending is set up |

Click **Create**, then **Run NPM Install**, then **Restart**.

### 6. First login
Open `https://app.mpadqclab.com` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. The database tables are created automatically on first start. Then:
1. **Settings → Company & branding**: name, CIN, GSTIN, state, address, logo, NABL symbol, seal, bank details, numbering formats, standard notes.
2. **Users & roles**: add staff; signatories upload their own signature.
3. **Rate card**: export the CSV, fill it in Excel, import it back.
4. **Equipment**: add proving rings / CTM with calibration factor, certificate and due date.
5. **Clients**: add or import clients.

## Updating to a new version
1. Changes are pushed to `main` → GitHub Actions tests and rebuilds the `deploy` branch (about 3 minutes).
2. cPanel → **Git Version Control** → *Manage* → *Pull or Deploy* → **Update from Remote**.
3. cPanel → **Setup Node.js App** → **Restart** (run *NPM Install* first only if the release notes say dependencies changed).

Database changes are applied automatically when the app restarts.

## Email
Settings → Company & branding → **Email**: SMTP host/port/username/from. Put the mailbox password in `SMTP_PASSWORD` and restart.
- cPanel mailbox: host `mail.mpadqclab.com`, port 465, SSL on.
- Gmail: host `smtp.gmail.com`, port 465, and a Google **App Password** (normal passwords are refused).

## Backups
- cPanel → **Backup** → download a MySQL backup of the suite database weekly, or use the host's automatic backups.
- Registers and ledgers can also be exported to Excel from inside the app at any time.

## Troubleshooting
- **Blank page / 503**: Setup Node.js App → check the app is *Started*; open `stderr.log` in the `lab-suite` folder.
- **“Startup failed … ER_ACCESS_DENIED”**: database name, user or password variable is wrong, or the user was not added to the database.
- **Logged out immediately**: `COOKIE_SECURE=true` requires HTTPS; make sure the site opens with `https://`.
- **Changes not visible**: pull the update *and* restart the app.

## No Node.js on the host?
The same build runs unchanged on any Node host (a small VPS, Render, Railway, Hostinger VPS, DigitalOcean): copy the `deploy` branch, `npm install`, set the same environment variables, `node server.cjs`. Point `app.mpadqclab.com` at it with a DNS record.
