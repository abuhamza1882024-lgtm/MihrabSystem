import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const api = process.env.MIHRAB_API_URL;
const password = process.env.MIHRAB_ADMIN_PASSWORD;

if (!api || !password) throw new Error('MIHRAB_API_URL and MIHRAB_ADMIN_PASSWORD are required');

const state = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));
state.users = state.users.map(user =>
  user.u == 'admin' || user.u == 'hr' ? user : { ...user, p: 'ChangeMe123' }
);

const login = await fetch(api + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ u: 'admin', p: password })
});
if (!login.ok) throw new Error('Admin login failed');
const { token } = await login.json();

const response = await fetch(api + '/api/db', {
  method: 'PUT',
  headers: {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json',
    'X-Restore': '1'
  },
  body: JSON.stringify(state)
});
if (!response.ok) throw new Error(await response.text());
console.log('data.json imported');
