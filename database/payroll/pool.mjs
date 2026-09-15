import pg from 'pg';

function parseBinaryDate(value) {
  const days = value.readInt32BE(0);
  if (days === 2147483647) return 'infinity';
  if (days === -2147483648) return '-infinity';
  return new Date(Date.UTC(2000, 0, 1) + days * 86_400_000).toISOString().split('T')[0];
}

function parseBinaryDateArray(value) {
  const dimensions = value.readInt32BE(0);
  if (dimensions < 0 || dimensions > 6 || value.readInt32BE(8) !== 1082) {
    throw new TypeError('Invalid PostgreSQL DATE array.');
  }
  if (dimensions === 0) return [];
  const lengths = Array.from({ length: dimensions }, (_, i) => value.readInt32BE(12 + i * 8));
  if (lengths.some((length) => length < 0)) throw new TypeError('Invalid PostgreSQL DATE array dimensions.');
  let offset = 12 + dimensions * 8;
  function readDimension(depth) {
    return Array.from({ length: lengths[depth] }, () => {
      if (depth + 1 < dimensions) return readDimension(depth + 1);
      const length = value.readInt32BE(offset); offset += 4;
      if (length === -1) return null;
      if (length !== 4) throw new TypeError('Invalid PostgreSQL binary DATE length.');
      const date = parseBinaryDate(value.subarray(offset, offset + length));
      offset += length;
      return date;
    });
  }
  const result = readDimension(0);
  if (offset !== value.length) throw new TypeError('Invalid PostgreSQL DATE array payload.');
  return result;
}

/** Create a pg Pool. No files are loaded and no connection is opened until use.
 * Use DATABASE_URL for the runtime role; migration credentials belong only in
 * DATABASE_MIGRATION_URL. Callers must handle Pool's ordinary 'error' event.
 */
export function createPool(options = {}) {
  const config = { ...options };
  const baseTypes = config.types ?? pg.types;
  const types = {
    getTypeParser(oid, format = 'text') {
      if (Number(oid) === 1182) {
        // DATE[] has its own OID/parser; changing DATE alone does not affect it.
        // PostgreSQL's text-array grammar preserves dates, nulls and dimensions.
        return format === 'text' ? pg.types.getTypeParser(1009, 'text') : parseBinaryDateArray;
      }
      if (Number(oid) !== 1082) return baseTypes.getTypeParser(oid, format);
      if (format === 'text') return (value) => value;
      // Binary queries are uncommon, but must preserve the same DATE contract.
      return parseBinaryDate;
    },
  };
  const connectionString = config.connectionString ?? process.env.DATABASE_URL;
  const startupOptions = [config.options, '-c timezone=UTC'].filter(Boolean).join(' ');

  if (connectionString) {
    let url;
    try {
      url = new URL(connectionString);
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
    } catch {
      // Do not include the URL, parser exception, or credentials in this error.
      throw new Error('Invalid PostgreSQL connection configuration: use a postgres:// or postgresql:// DATABASE_URL.');
    }
    // pg lets URL options override Pool options, so enforce UTC in both places.
    url.searchParams.set('options', [url.searchParams.get('options'), startupOptions].filter(Boolean).join(' '));
    config.connectionString = url.toString();
  } else if (!(config.host && config.database && config.user)) {
    throw new Error('PostgreSQL is not configured: set DATABASE_URL or pass connectionString (or host, database and user) to createPool().');
  }

  return new pg.Pool({
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    ...config,
    options: startupOptions,
    types,
  });
}

/** Run the complete transaction on one checked-out client; return callback's value. */
export async function withTransaction(pool, callback) {
  if (typeof callback !== 'function') throw new TypeError('withTransaction requires a callback.');
  const client = await pool.connect();
  let failure;
  let failed = false;
  let discard;
  let result;
  try {
    await client.query('BEGIN');
    result = await callback(client);
    await client.query('COMMIT');
  } catch (error) {
    failed = true;
    failure = error;
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      discard = rollbackError;
      failure = new AggregateError([error, rollbackError], 'Transaction failed and rollback failed.', { cause: error });
    }
  } finally {
    try {
      client.release(discard);
    } catch (releaseError) {
      failure = failed
        ? new AggregateError([failure, releaseError], 'Transaction cleanup failed.', { cause: failure })
        : releaseError;
      failed = true;
    }
  }
  if (failed) throw failure;
  return result;
}
