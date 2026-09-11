import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {google} from 'googleapis';

const DEFAULT_SPREADSHEET_ID = '1ikvo-uc5X93LrWnR3r_BK8tutSIG1Mr0M81j7m0NaCk';
const HOME = os.homedir();
const CREDENTIALS_PATH = path.join(HOME, '.config', 'opencode', 'google-credentials.json');
const TOKENS_PATH = path.join(HOME, '.local', 'share', 'opencode', 'mcp-auth.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadClientIdSecret() {
  const env = process.env;
  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return {clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET};
  }
  if (fs.existsSync(CREDENTIALS_PATH)) {
    try {
      const stored = readJson(CREDENTIALS_PATH);
      if (stored?.clientId && stored?.clientSecret) {
        return {clientId: stored.clientId, clientSecret: stored.clientSecret};
      }
    } catch {
      // fall through to the next source
    }
  }
  return null;
}

function loadTokens() {
  const env = process.env;
  if (env.GOOGLE_OAUTH_ACCESS_TOKEN) {
    const expiry = env.GOOGLE_OAUTH_EXPIRY_DATE
      ? Number(env.GOOGLE_OAUTH_EXPIRY_DATE)
      : undefined;
    return {
      accessToken: env.GOOGLE_OAUTH_ACCESS_TOKEN,
      refreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN || undefined,
      expiresAt: expiry && expiry < 1e12 ? expiry * 1000 : expiry,
    };
  }
  if (fs.existsSync(TOKENS_PATH)) {
    try {
      const stored = readJson(TOKENS_PATH)?.['google-drive']?.tokens;
      if (stored?.accessToken) {
        return {
          accessToken: stored.accessToken,
          refreshToken: stored.refreshToken,
          expiresAt: stored.expiresAt ? stored.expiresAt * 1000 : undefined,
        };
      }
    } catch {
      // fall through
    }
  }
  return null;
}

export function createSheetsApi() {
  const client = loadClientIdSecret();
  const tokens = loadTokens();
  if (!tokens?.accessToken) {
    throw new Error(
      'No Google OAuth access token found. Authenticate the google-drive MCP in OpenCode once ' +
      '(tokens are stored in ~/.local/share/opencode/mcp-auth.json), or set GOOGLE_OAUTH_ACCESS_TOKEN ' +
      'together with GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET.',
    );
  }

  const auth = client
    ? new google.auth.OAuth2(client.clientId, client.clientSecret)
    : new google.auth.OAuth2();
  const credentials = {access_token: tokens.accessToken};
  if (tokens.refreshToken) credentials.refresh_token = tokens.refreshToken;
  if (tokens.expiresAt) credentials.expiry_date = tokens.expiresAt;
  auth.setCredentials(credentials);

  const spreadsheetId = process.env.TIMESHEET_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  return {api: google.sheets({version: 'v4', auth}), spreadsheetId};
}
