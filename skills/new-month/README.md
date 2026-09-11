# new-month — OpenCode skill

Creates a new month tab in the timesheet Google Spreadsheet
("Łukasz Nowak od 17.07.2021", default ID
`1ikvo-uc5X93LrWnR3r_BK8tutSIG1Mr0M81j7m0NaCk`) by duplicating the
previous month's tab, then adjusting dates, cumulative formulas and
weekend formatting. The skill is used by OpenCode: ask the agent
"stwórz nowy miesiąc 12.2026" and it runs this skill.

## Files

| File                   | Purpose                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `SKILL.md`             | Skill definition consumed by OpenCode (procedure, checks).     |
| `new-month.mjs`        | Main script: duplicate, resize, dates, formulas, formatting.   |
| `auth.mjs`             | Shared Google Sheets API client + OAuth credential loading.    |
| `repair-c.mjs`         | Rewrites column C formulas of an existing month tab.           |
| `verify-formulas.mjs`  | Prints formulas of a range via the Sheets API.                 |
| `install.sh`           | Links the skill into `~/.config/opencode/skills/` and installs deps. |
| `run.sh`               | Selects Node >=18 and runs the main script or a helper.        |
| `package.json`         | npm metadata; one dependency: `googleapis`.                    |

## Prerequisites (on the target computer)

1. **Node.js >= 18** and **npm** on PATH.
2. **Editor access** to the timesheet spreadsheet from the Google account
   used for OAuth (or point the skill at another sheet that follows the
   same structure, via `TIMESHEET_SPREADSHEET_ID`).
3. **Google OAuth credentials**, either in
   `~/.config/opencode/google-credentials.json` with tokens from OpenCode's
   `mcp-auth.json`, or in `GOOGLE_OAUTH_*` environment variables.

OAuth client secrets, access tokens and refresh tokens are intentionally not
stored in this repository. The target computer must already have a working
`google-drive` MCP authentication or receive these files through a secure
channel.

## Install

```sh
git clone <this repository> opencode-plugins
cd opencode-plugins/skills/new-month
sh ./install.sh
```

`install.sh` creates a symlink
`~/.config/opencode/skills/new-month -> <repo>/skills/new-month`
(an existing directory is backed up first). Because it is a symlink,
`git pull` updates the skill in place. If you prefer a copy instead,
copy the folder into `~/.config/opencode/skills/new-month` and run
`npm install --omit=dev` inside it.

### Authenticating on a new machine (recommended path)

1. Create `~/.config/opencode/google-credentials.json` using the OAuth
   client credentials from the Google Cloud Console project:

   ```json
   {
     "clientId": "<client-id>",
     "clientSecret": "<client-secret>"
   }
   ```

2. Restrict access to the file: `chmod 600 ~/.config/opencode/google-credentials.json`.
3. Authenticate the `google-drive` MCP once in OpenCode. Tokens are stored
   in `~/.local/share/opencode/mcp-auth.json` under `google-drive.tokens`.
4. The scripts combine the client credentials with those access/refresh
   tokens. A normal access-token expiry is handled automatically.

## Usage

Via the agent (inside OpenCode):

```
stwórz nowy miesiąc 12.2026
```

Manually (from any directory after installation):

```sh
~/.config/opencode/skills/new-month/run.sh 12.2026 --dry-run
~/.config/opencode/skills/new-month/run.sh 12.2026
~/.config/opencode/skills/new-month/run.sh 12.2026 --source 10.2026

# helpers
~/.config/opencode/skills/new-month/run.sh verify 11.2026!C5:C6
~/.config/opencode/skills/new-month/run.sh repair 10.2026 31
```

Behavior guarantees: refuses to run if the target tab already exists or
the source tab is missing; rolls back the duplicated tab if anything
fails after the duplicate; self-verifies the first and last column C
formulas after creation (`C5 = =B5+0`, last `= Bn + C(n-1)`).

## Configuration

| Variable                      | Default                          | Notes                                   |
| ----------------------------- | -------------------------------- | --------------------------------------- |
| `TIMESHEET_SPREADSHEET_ID`    | `1ikvo-uc5X93LrWnR3r_BK8tutSIG1Mr0M81j7m0NaCk` | Any sheet following the structure below. |
| `GOOGLE_OAUTH_CLIENT_ID`      | from `google-credentials.json`   | Must be set together with the secret.   |
| `GOOGLE_OAUTH_CLIENT_SECRET`  | from `google-credentials.json`   | Must be set together with the client ID. |
| `GOOGLE_OAUTH_ACCESS_TOKEN`   | from OpenCode auth store         | Required with the two variables above.  |
| `GOOGLE_OAUTH_REFRESH_TOKEN`  | optional                         | Enables automatic token refresh.        |
| `GOOGLE_OAUTH_EXPIRY_DATE`    | optional (unix seconds)          | Only relevant without a refresh token.  |
| `NEW_MONTH_NODE`              | auto-detected                    | Path to a Node.js >=18 executable.       |

Environment variables take precedence over the credential and token files.

## Expected sheet structure

Per month tab (`MM.YYYY`):

- Row 3: `B3` = Polish month name (e.g. `PAŹDZIERNIK`).
- Row 4: headers `Data | Liczba RH | RH narastajaco | Opis`.
- Rows 5..(5+days-1): A = date (`dd-mm-yyyy`), B = hours (empty or
  number), C = cumulative hours (`=B5+0`, `=B6+C5`, …), D = notes.
- Saturday/Sunday rows carry distinct formatting, which is copied from
  the source tab and re-applied according to the target month's calendar.

## Troubleshooting

- `No Google OAuth credentials found` / token errors — complete the
  authentication step above, or export the `GOOGLE_OAUTH_*` variables.
- `403 Forbidden` from the Sheets API — the OAuth account lacks editor
  access to the spreadsheet; share it.
- `Target sheet MM.YYYY already exists` — the tab exists; delete it in
  the spreadsheet first (the skill never overwrites).
- `Node.js >= 18 is required` — install a current Node.js or set
  `NEW_MONTH_NODE` to its executable path.
- `npm install` failures — delete `node_modules` and retry with a clean cache.
