// Print NUL-delimited libpq environment fields for the backup shell script.
// Never print the input URL or its password in diagnostics.
const raw = process.env.RD_DATABASE_MIGRATION_URL;
try {
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('scheme');
  const fields = [
    url.hostname.replace(/^\[|\]$/g, ''),
    url.port || '5432',
    decodeURIComponent(url.username),
    decodeURIComponent(url.password),
    decodeURIComponent(url.pathname.slice(1)),
  ];
  if (fields.some((value) => !value || /[\x00\r\n]/.test(value))) throw new Error('field');
  if (!/^\d{1,5}$/.test(fields[1]) || Number(fields[1]) > 65535) throw new Error('port');
  if (url.search || url.hash) throw new Error('options');
  process.stdout.write(`${fields.join('\0')}\0`);
} catch {
  process.stderr.write('RD migration URL must specify host, port, user, password and database without query options.\n');
  process.exitCode = 1;
}
