import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {google} from 'googleapis';

const HOME = os.homedir();
const CREDENTIALS_PATH = path.join(HOME, '.config', 'opencode', 'google-credentials.json');
const TOKENS_PATH = path.join(HOME, '.local', 'share', 'opencode', 'mcp-auth.json');
const DEFAULT_PORT = 19876;
const DEFAULT_CALLBACK_PATH = '/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function usage() {
  console.log(`Usage: run.sh login [--port 19876] [--callback /callback]

Starts a local OAuth flow and writes tokens to:
  ${TOKENS_PATH}

The OAuth client must allow this redirect URI:
  http://127.0.0.1:<port><callback>

Defaults match OpenCode Google Drive MCP setups:
  http://127.0.0.1:${DEFAULT_PORT}${DEFAULT_CALLBACK_PATH}`);
}

function parseArgs(argv) {
  const opts = {port: DEFAULT_PORT, callbackPath: DEFAULT_CALLBACK_PATH};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--port') {
      opts.port = Number(argv[++i]);
      continue;
    }
    if (arg === '--callback') {
      opts.callbackPath = argv[++i];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
    throw new Error(`Invalid --port: ${opts.port}`);
  }
  if (!opts.callbackPath?.startsWith('/')) {
    throw new Error('--callback must start with /');
  }
  return opts;
}

async function main() {
  const {port, callbackPath} = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`No OAuth client credentials found at ${CREDENTIALS_PATH}`);
  }
  const credentials = readJson(CREDENTIALS_PATH);
  if (!credentials?.clientId || !credentials?.clientSecret) {
    throw new Error(`${CREDENTIALS_PATH} must contain clientId and clientSecret`);
  }

  const redirectUri = `http://127.0.0.1:${port}${callbackPath}`;
  const oauth2 = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    redirectUri,
  );

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== callbackPath) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        throw new Error(url.searchParams.get('error') || 'No authorization code returned');
      }

      const {tokens} = await oauth2.getToken(code);
      if (!tokens.access_token) {
        throw new Error('Google did not return an access token');
      }

      fs.mkdirSync(path.dirname(TOKENS_PATH), {recursive: true});
      let existing = {};
      if (fs.existsSync(TOKENS_PATH)) {
        try {
          existing = readJson(TOKENS_PATH);
        } catch {
          existing = {};
        }
      }
      existing['google-drive'] = {
        tokens: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : undefined,
          scope: tokens.scope,
          tokenType: tokens.token_type,
        },
      };
      fs.writeFileSync(TOKENS_PATH, `${JSON.stringify(existing, null, 2)}\n`);
      fs.chmodSync(TOKENS_PATH, 0o600);

      res.end('OK — token saved. You can close this tab and return to OpenCode.');
      console.log(`Token saved to ${TOKENS_PATH}`);
      server.close(() => process.exit(0));
    } catch (error) {
      res.statusCode = 500;
      res.end(String(error?.message || error));
      console.error(error);
      server.close(() => process.exit(1));
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const authUrl = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    });
    console.log(`Redirect URI: ${redirectUri}`);
    console.log('Opening Google OAuth login...');
    console.log(authUrl);
    execFile('open', [authUrl], (error) => {
      if (error) {
        console.log('Could not open the browser automatically. Open the URL above manually.');
      }
    });
  });
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
