import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { hashPassword, verifyPassword } from './password-crypto.mjs';
import { withTransaction } from '../../database/payroll/pool.mjs';

const SESSION_MS = 8 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_LIMIT_ROWS = 10_000;
const MAX_USER_SESSIONS = 20;
const LIMITS = { account: 5, address: 30 };
const PASSWORD_HASH = /^scrypt\$32768\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/;
// One valid hash per process; unknown/disabled users still pay the same scrypt
// cost as an existing user. Neither this random input nor a login password is saved.
const DUMMY_HASH = hashPassword(randomBytes(32).toString('hex'));
const digest = value => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');
const validToken = value => typeof value === 'string'
  && /^[A-Za-z0-9_-]{43}$/.test(value)
  && Buffer.from(value, 'base64url').toString('base64url') === value;
const publicUser = row => ({ id: row.id, username: row.username, displayName: row.display_name, role: row.role });

function loginName(value) {
  if (typeof value !== 'string' || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.trim() || null;
}

export function normalizedAddress(value) {
  // Only pass the socket address or an address from a specifically trusted
  // proxy. Never pass arbitrary X-Forwarded-For/client-supplied headers here.
  if (typeof value !== 'string' || value.length > 256) return 'unknown';
  const address = value.trim().toLowerCase().split('%')[0];
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) return 'unknown';
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

function failure(code) {
  const error = new Error(code === 'PASSWORD_RATE_LIMIT'
    ? '登录尝试过多，请稍后重试' : '用户名或密码错误');
  error.code = code;
  return error;
}

/** Server-only authentication. No HTTP cookies/headers are managed here.
 * now is a trusted clock function returning a Date or epoch milliseconds.
 * expiresAt is an ISO string. Sessions have a fixed lifetime, with at most 20
 * live sessions per user (the oldest is revoked on the next successful login).
 * Credential usernames use the independent accounts table's case-sensitive
 * identity; throttle keys additionally apply trim/NFKC/lowercase, so spelling
 * variants cannot bypass an account's failure budget.
 * The caller must not log request passwords, returned tokens.
 */
export function createPasswordAuthService(pool, { now = () => new Date() } = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a clock function');
  function clock() {
    const time = new Date(now());
    if (!Number.isFinite(time.getTime())) throw new TypeError('Invalid authentication clock');
    return time;
  }

  return {
    async login(input = {}) {
      const { username, password, clientAddress } = input ?? {};
      const name = loginName(username);
      const keys = [
        { kind: 'account', hash: digest(`account:${name === null ? '<invalid-input>' : name.normalize('NFKC').toLowerCase()}`) },
        { kind: 'address', hash: digest(`address:${normalizedAddress(clientAddress)}`) },
      ];
      const outcome = await withTransaction(pool, async client => {
        // Serializing login attempts
        // across instances makes failure budgets AND table capacity atomic.
        // Authentication of an existing session does not acquire this lock.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('finance-password-login-v1',0))");
        const time = clock();
        await client.query('DELETE FROM rd.password_login_limits WHERE expires_at <= $1', [time]);
        await client.query('DELETE FROM rd.password_sessions WHERE expires_at <= $1', [time]);
        const { rows: limits } = await client.query(`SELECT kind, key_hash, failures
          FROM rd.password_login_limits
          WHERE (kind='account' AND key_hash=$1) OR (kind='address' AND key_hash=$2)`,
        keys.map(key => key.hash));
        if (limits.some(row => row.failures >= LIMITS[row.kind])) return { error: 'PASSWORD_RATE_LIMIT' };
        const { rows: [capacity] } = await client.query('SELECT count(*)::integer AS total FROM rd.password_login_limits');
        if (capacity.total + keys.length - limits.length > MAX_LIMIT_ROWS) return { error: 'PASSWORD_RATE_LIMIT' };

        const { rows: [user] } = await client.query(`SELECT id, username, display_name, password_hash, enabled, role
          FROM rd.password_accounts WHERE username=$1`, [name]);
        const validPasswordInput = typeof password === 'string' && password.length <= 1024;
        const validStoredHash = !!user && PASSWORD_HASH.test(user.password_hash);
        const verified = verifyPassword(validPasswordInput ? password : '', validStoredHash ? user.password_hash : DUMMY_HASH);
        if (verified && validPasswordInput && validStoredHash && user.enabled) {
          const token = randomToken();
          const expiresAt = new Date(time.getTime() + SESSION_MS);
          // Check enabled/hash again at INSERT: disabling the user or changing
          // the password during verification must not mint a usable session.
          const inserted = await client.query(`INSERT INTO rd.password_sessions
            (token_hash,account_id,password_hash_snapshot,created_at,expires_at)
            SELECT $1,id,$2,$3,$4 FROM rd.password_accounts
            WHERE id=$5 AND enabled AND password_hash=$6 RETURNING account_id`,
          [digest(token), user.password_hash, time, expiresAt, user.id, user.password_hash]);
          if (inserted.rowCount) {
            // Preserve IP failures: a successful login must not reset a shared
            // source's budget for attacks against other account spellings.
            await client.query("DELETE FROM rd.password_login_limits WHERE kind='account' AND key_hash=$1", [keys[0].hash]);
            await client.query(`DELETE FROM rd.password_sessions WHERE token_hash IN (
              SELECT token_hash FROM rd.password_sessions WHERE account_id=$1 AND token_hash<>$2
              ORDER BY created_at DESC,token_hash LIMIT ALL OFFSET $3
            )`, [user.id, digest(token), MAX_USER_SESSIONS - 1]);
            return { token, user: publicUser(user), expiresAt: expiresAt.toISOString() };
          }
        }

        for (const key of keys) {
          await client.query(`INSERT INTO rd.password_login_limits
            (kind,key_hash,failures,window_started_at,expires_at) VALUES($1,$2,1,$3,$4)
            ON CONFLICT (kind,key_hash) DO UPDATE
            SET failures=rd.password_login_limits.failures+1`,
          [key.kind, key.hash, time, new Date(time.getTime() + WINDOW_MS)]);
        }
        // Return before throwing so failed-attempt counters COMMIT, not rollback.
        return { error: 'PASSWORD_AUTH_FAILED' };
      });
      if (outcome.error) throw failure(outcome.error);
      return outcome;
    },

    async authenticate(token) {
      if (!validToken(token)) return null;
      const time = clock();
      await pool.query('DELETE FROM rd.password_sessions WHERE expires_at <= $1', [time]);
      const { rows: [session] } = await pool.query(`SELECT u.id,u.username,u.display_name,u.role,s.expires_at
        FROM rd.password_sessions s JOIN rd.password_accounts u ON u.id=s.account_id
        WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.enabled AND u.password_hash=s.password_hash_snapshot`, [digest(token), time]);
      if (!session) return null;
      return { user: publicUser(session), expiresAt: new Date(session.expires_at).toISOString() };
    },

    async logout(token) {
      if (!validToken(token)) return;
      await pool.query('DELETE FROM rd.password_sessions WHERE token_hash=$1 OR expires_at<=$2', [digest(token), clock()]);
    },
  };
}
