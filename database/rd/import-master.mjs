import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import XLSX from 'xlsx';
import { createPool, withTransaction } from '../payroll/pool.mjs';

const SHEETS = [[2025, '2025年研发项目平台'], [2026, '2026年研发项目平台']];
const KNOWN_PLATFORMS = new Map([
  ['一体化电控平台', 'electronic'],
  ['氢动力飞行器及平台项目', 'aircraft'],
  ['自研工装', 'tooling'],
  ['氢锂混电系统及平台研究与应用', 'hybrid'],
  ['氢助力两轮车及平台项目', 'bicycle'],
  ['氢能前沿研究及应用', 'frontier'],
]);

function cell(value) { return value === undefined || value === null || value === '' ? null : String(value); }
function code(value) { return cell(value)?.trim() ?? null; }
function required(value, where) { if (!value) throw new Error(`${where} is blank`); return value; }
function equality(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

export function parseMasterWorkbook(bytes, platformAliases = {}) {
  const workbook = XLSX.read(bytes, { type: 'buffer', raw: true });
  const platforms = [];
  const projects = [];
  const codes = new Set();
  for (const [year, sheetName] of SHEETS) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`Missing worksheet ${sheetName}`);
    // Keep empty worksheet rows; array indexes must remain real Excel row numbers.
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: true });
    if (code(rows[0]?.[1]) !== '项目平台编码' || code(rows[0]?.[3]) !== '项目编码') throw new Error(`Unexpected headings in ${sheetName}`);
    let currentPlatform = null;
    let currentProject = null;
    for (let index = 1; index < rows.length; index++) {
      const raw = rows[index];
      const row = index + 1;
      const annualCode = code(raw[1]);
      if (annualCode) {
        currentProject = null;
        const name = required(cell(raw[2]), `${sheetName}!C${row}`);
        const platformId = KNOWN_PLATFORMS.get(name.trim()) || platformAliases[name.trim()];
        if (!platformId) throw new Error(`Unknown platform name ${name} at ${sheetName}!C${row}; add an explicit platform mapping before import`);
        currentPlatform = { code: annualCode, name, platformId, year, row };
        if (platforms.some(item => item.code === annualCode)) throw new Error(`Duplicate annual platform code ${annualCode}`);
        platforms.push(currentPlatform);
      }
      const projectCode = code(raw[3]);
      if (projectCode) {
        if (!currentPlatform) throw new Error(`Project ${projectCode} has no platform at ${sheetName}!D${row}`);
        if (codes.has(projectCode)) throw new Error(`Duplicate project code ${projectCode}`);
        codes.add(projectCode);
        currentProject = {
          code: projectCode,
          platformId: currentPlatform.platformId,
          annualPlatformCode: currentPlatform.code,
          year,
          name: cell(raw[5]),
          manager: cell(raw[6]),
          rawStatus: cell(raw[7]),
          remark: cell(raw[8]),
          details: [],
        };
        projects.push(currentProject);
      } else if (!currentProject && raw.slice(4, 9).some(value => cell(value) !== null)) {
        throw new Error(`Unattached detail at ${sheetName}!A${row}`);
      }
      if (currentProject && (projectCode || raw.slice(4, 9).some(value => cell(value) !== null))) {
        currentProject.details.push({
          row,
          materialCode: cell(raw[4]),
          name: cell(raw[5]),
          manager: cell(raw[6]),
          rawStatus: cell(raw[7]),
          remark: cell(raw[8]),
          rawCells: raw.slice(0, 9).map(value => value === undefined ? null : value),
        });
      }
    }
  }
  if (!platforms.length || !projects.length) throw new Error('Master workbook has no platform or project records');
  return { platforms, projects, counts: { platforms: platforms.length, projects: projects.length, details: projects.reduce((sum, item) => sum + item.details.length, 0) } };
}

function projectValues(project) {
  return {
    number: project.code,
    name: project.name?.trim() || '项目名称待补充',
    source_name: project.name,
    platform_id: project.platformId,
    annual_platform_code: project.annualPlatformCode,
    source_year: project.year,
    project_manager: project.manager,
    raw_status: project.rawStatus,
    source_remark: project.remark,
  };
}

function status(raw) { return raw === '运行' ? 'active' : raw === '完成' ? 'completed' : 'init'; }

async function existingState(client) {
  const platforms = await client.query('SELECT id,name,number FROM rd.platforms');
  const annual = await client.query('SELECT code,platform_id,source_year,name FROM rd.annual_platforms');
  const projects = await client.query(`SELECT id,number,name,source_name,platform_id,annual_platform_code,source_year,project_manager,raw_status,source_remark FROM rd.projects`);
  const details = await client.query('SELECT p.number,d.source_row,d.material_code,d.source_name,d.project_manager,d.raw_status,d.source_remark,d.raw_cells FROM rd.project_detail_rows d JOIN rd.projects p ON p.id=d.project_id ORDER BY d.source_row');
  return { platforms: platforms.rows, annual: annual.rows, projects: projects.rows, details: details.rows };
}

function plan(data, state, renames = {}, platformAliases = {}) {
  const platformById = new Map(state.platforms.map(item => [item.id, item]));
  const annualByCode = new Map(state.annual.map(item => [item.code, item]));
  const projectByCode = new Map(state.projects.map(item => [item.number, item]));
  const changes = { platforms: [], annualPlatforms: [], projects: [], omissions: [], conflicts: [] };
  const reverse = new Map();
  for (const [oldCode, newCode] of Object.entries(renames)) {
    if (reverse.has(newCode)) changes.conflicts.push(`Two old codes map to ${newCode}`);
    reverse.set(newCode, oldCode);
    if (!data.projects.some(item => item.code === newCode)) changes.conflicts.push(`New project code ${newCode} is not in workbook`);
    if (data.projects.some(item => item.code === oldCode)) changes.conflicts.push(`Old project code ${oldCode} still appears in workbook`);
    if (!projectByCode.has(oldCode)) changes.conflicts.push(`Old project code ${oldCode} is not in database`);
    if (projectByCode.has(newCode)) changes.conflicts.push(`New project code ${newCode} already exists in database`);
  }
  const latestFamily = new Map();
  for (const p of data.platforms) if (!latestFamily.has(p.platformId) || latestFamily.get(p.platformId).year < p.year) latestFamily.set(p.platformId, p);
  for (const p of data.platforms) {
    const family = platformById.get(p.platformId);
    const desiredName = latestFamily.get(p.platformId).name;
    if (!family && !changes.platforms.some(item => item.id === p.platformId)) changes.platforms.push({ action: 'add', id: p.platformId, name: desiredName });
    else if (family && family.name !== desiredName && !changes.platforms.some(item => item.id === p.platformId)) {
      if (platformAliases[desiredName.trim()] === p.platformId) changes.platforms.push({ action: 'update', id: p.platformId, name: desiredName });
      else changes.conflicts.push(`Platform family ${p.platformId} name mismatch: ${family.name} / ${desiredName}; provide --platform-map`);
    }
    const prior = annualByCode.get(p.code);
    if (prior && (prior.platform_id !== p.platformId || Number(prior.source_year) !== p.year)) changes.conflicts.push(`Annual platform ${p.code} has conflicting ownership or year`);
    else if (!prior || prior.name !== p.name) changes.annualPlatforms.push({ action: prior ? 'update' : 'add', code: p.code, year: p.year, name: p.name });
  }
  const imported = new Set(data.projects.map(item => item.code));
  for (const p of data.projects) {
    const oldCode = reverse.get(p.code);
    const prior = projectByCode.get(oldCode || p.code);
    const values = projectValues(p);
    if (prior && prior.platform_id && prior.platform_id !== p.platformId) changes.conflicts.push(`Project ${p.code} changes platform ${prior.platform_id} -> ${p.platformId}; review required`);
    if (!prior && p.name && state.projects.some(item => item.number !== p.code && item.source_name === p.name && item.platform_id === p.platformId)) changes.conflicts.push(`Project ${p.code} has the same original name as another code; provide an explicit rename mapping if this is a code change`);
    const priorDetails = state.details.filter(item => item.number === (oldCode || p.code)).map(item => ({ row: item.source_row, materialCode: item.material_code, name: item.source_name, manager: item.project_manager, rawStatus: item.raw_status, remark: item.source_remark, rawCells: item.raw_cells }));
    const changedFields = prior ? Object.entries(values).filter(([key, value]) => !equality(prior[key], value)).map(([key]) => key) : [];
    if (!prior || changedFields.length || !equality(priorDetails, p.details)) changes.projects.push({ action: oldCode ? 'rename' : prior ? 'update' : 'add', code: p.code, oldCode: oldCode || undefined, fields: changedFields, detailRows: p.details.length });
  }
  for (const item of state.projects) if (!imported.has(item.number) && !Object.hasOwn(renames, item.number)) changes.omissions.push({ code: item.number, id: item.id });
  return changes;
}

export async function importMaster(pool, filePath, { apply = false, renames = {}, platformAliases = {} } = {}) {
  const bytes = await readFile(filePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const data = parseMasterWorkbook(bytes, platformAliases);
  const filename = basename(filePath);
  return withTransaction(pool, async client => {
    // Serialize all master imports so a preview and its write observe one catalog state.
    await client.query('SELECT pg_advisory_xact_lock($1,$2)', [0x52444d53, 0x54455231]);
    const state = await existingState(client);
    const changes = plan(data, state, renames, platformAliases);
    const preview = { sha256, filename, counts: data.counts, changes, applied: false };
    if (!apply) return preview;
    if (changes.conflicts.length) throw new Error(`Master import conflicts: ${changes.conflicts.join('; ')}`);
    await client.query('INSERT INTO rd.source_documents(sha256,filename,content) VALUES($1,$2,$3) ON CONFLICT(sha256) DO NOTHING', [sha256, filename, bytes]);
    const priorImport = await client.query('SELECT sha256 FROM rd.master_imports WHERE sha256=$1', [sha256]);
    if (priorImport.rowCount && !changes.projects.length && !changes.annualPlatforms.length) return { ...preview, applied: false, repeated: true };
    for (const p of data.platforms) {
      const latest = data.platforms.filter(item => item.platformId === p.platformId).at(-1);
      await client.query(`INSERT INTO rd.platforms(id,name,number,sort_order) VALUES($1,$2,$3,$4)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,number=EXCLUDED.number`, [p.platformId, latest.name, latest.code, data.platforms.findIndex(item => item.platformId === p.platformId)]);
      await client.query(`INSERT INTO rd.annual_platforms(code,platform_id,source_year,name,source_row) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,source_row=EXCLUDED.source_row,updated_at=CURRENT_TIMESTAMP`, [p.code, p.platformId, p.year, p.name, p.row]);
    }
    for (const p of data.projects) {
      const oldCode = Object.entries(renames).find(([, next]) => next === p.code)?.[0];
      const prior = state.projects.find(item => item.number === (oldCode || p.code));
      const id = prior?.id || `master-${p.code.toLowerCase()}`;
      const v = projectValues(p);
      if (prior) {
        await client.query(`UPDATE rd.projects SET number=$1,name=$2,status=$3,platform_id=$4,annual_platform_code=$5,source_year=$6,
          source_name=$7,project_manager=$8,raw_status=$9,source_remark=$10,updated_at=CURRENT_TIMESTAMP WHERE id=$11`,
        [v.number,v.name,status(p.rawStatus),v.platform_id,v.annual_platform_code,v.source_year,v.source_name,v.project_manager,v.raw_status,v.source_remark,id]);
      } else {
        await client.query(`INSERT INTO rd.projects(id,number,name,status,budget,platform_id,annual_platform_code,source_year,source_name,project_manager,raw_status,source_remark)
          VALUES($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$10,$11)`,
        [id,v.number,v.name,status(p.rawStatus),v.platform_id,v.annual_platform_code,v.source_year,v.source_name,v.project_manager,v.raw_status,v.source_remark]);
      }
      await client.query('DELETE FROM rd.project_detail_rows WHERE project_id=$1', [id]);
      for (const detail of p.details) await client.query(`INSERT INTO rd.project_detail_rows(project_id,source_row,material_code,source_name,project_manager,raw_status,source_remark,raw_cells)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id,detail.row,detail.materialCode,detail.name,detail.manager,detail.rawStatus,detail.remark,JSON.stringify(detail.rawCells)]);
      await client.query('UPDATE rd.projects SET source_records=$1 WHERE id=$2', [JSON.stringify([{ sha256,filename,sheet:`${p.year}年研发项目平台`,rows:p.details.map(item=>item.row),year:p.year }]), id]);
    }
    await client.query(`INSERT INTO rd.master_imports(sha256,filename,platform_count,project_count,detail_count) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(sha256) DO NOTHING`, [sha256,filename,data.counts.platforms,data.counts.projects,data.counts.details]);
    return { ...preview, applied: true };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const renameIndex = args.indexOf('--renames');
  const renames = renameIndex < 0 ? {} : JSON.parse(await readFile(required(args[renameIndex + 1], '--renames file'), 'utf8'));
  const aliasesIndex = args.indexOf('--platform-map');
  const platformAliases = aliasesIndex < 0 ? {} : JSON.parse(await readFile(required(args[aliasesIndex + 1], '--platform-map file'), 'utf8'));
  const filePath = args.find(item => !item.startsWith('--')
    && (renameIndex < 0 || item !== args[renameIndex + 1])
    && (aliasesIndex < 0 || item !== args[aliasesIndex + 1]));
  if (!filePath) throw new Error('Usage: node database/rd/import-master.mjs <master.xlsx> [--apply] [--renames old-to-new.json]');
  const url = process.env.RD_DATABASE_MIGRATION_URL;
  if (!url) throw new Error('Set RD_DATABASE_MIGRATION_URL');
  const pool = createPool({ connectionString: url, application_name: 'rd-master-import', max: 1 });
  try { process.stdout.write(`${JSON.stringify(await importMaster(pool, filePath, { apply, renames, platformAliases }), null, 2)}\n`); }
  finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`RD master import failed: ${error.message}\n`); process.exitCode = 1; });
}
