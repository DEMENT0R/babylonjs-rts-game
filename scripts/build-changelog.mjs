// Собирает данные для игрового журнала изменений из CHANGELOG.md.
//
// Даты берутся из истории git: для каждой записи ищется коммит, который её
// добавил, и его дата. Поэтому игровой журнал не расходится с репозиторием и
// не требует ручного переписывания дат.
//
//   npm run changelog:build

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const changelogPath = path.join(root, 'CHANGELOG.md');
const outPath = path.join(root, 'src', 'changelog.js');
const packagePath = path.join(root, 'package.json');

const SECTION_ORDER = ['Добавлено', 'Изменено', 'Исправлено', 'Удалено', 'Документация'];

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** Дата коммита, который впервые добавил эту строку в CHANGELOG.md. */
function commitDate(fragment) {
  if (!fragment) return null;
  const out = git(['log', '--reverse', '--format=%cs', `-S${fragment}`, '--', 'CHANGELOG.md']);
  const first = out.split(/\r?\n/).filter(Boolean)[0];
  return first || null;
}

function parseChangelog(text) {
  const releases = [];
  let release = null;
  let section = null;
  let item = null;

  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^##\s+\[(.+?)\](?:\s+—\s+(\d{4}-\d{2}-\d{2}))?/);
    if (heading) {
      const name = heading[1].trim();
      release = {
        version: name === 'Unreleased' ? null : name,
        date: heading[2] ?? null,
        sections: [],
      };
      releases.push(release);
      section = null;
      item = null;
      continue;
    }
    if (!release) continue;

    const sub = line.match(/^###\s+(.+?)\s*$/);
    if (sub) {
      section = { title: sub[1], items: [] };
      release.sections.push(section);
      item = null;
      continue;
    }

    if (!section) continue;

    if (line.startsWith('- ')) {
      const text = line.slice(2).trim();
      item = { firstLine: text, raw: text };
      section.items.push(item);
      continue;
    }
    if (item && /^\s+\S/.test(line)) {
      item.raw += ` ${line.trim()}`;
      continue;
    }
    if (!line.trim()) item = null;
  }
  return releases;
}

/** Markdown → строка для игрового интерфейса. */
function plain(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const ddmmyyyy = (iso) => {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
};

const { version: gameVersion } = JSON.parse(readFileSync(packagePath, 'utf8'));
const rawText = readFileSync(changelogPath, 'utf8');
const releases = parseChangelog(rawText);

const fallbackDate = git(['log', '-1', '--format=%cs', '--', 'CHANGELOG.md'])
  || new Date().toISOString().slice(0, 10);

// Записи группируются по дате: в игре дата — главное, версия — подпись.
const groups = new Map();
let resolved = 0;
let guessed = 0;

for (const release of releases) {
  for (const section of release.sections) {
    for (const item of section.items) {
      const text = plain(item.raw);
      if (!text) continue;
      const date = release.date ?? commitDate(item.firstLine) ?? fallbackDate;
      if (release.date || (!release.date && commitDate(item.firstLine))) resolved++;
      else guessed++;
      if (!groups.has(date)) {
        groups.set(date, {
          date,
          version: release.version ?? 'ОБНОВЛЕНИЕ',
          sections: new Map(),
        });
      }
      const group = groups.get(date);
      // Если в один день попали и релиз, и текущие правки — показываем версию.
      if (release.version && group.version === 'ОБНОВЛЕНИЕ') group.version = release.version;
      if (!group.sections.has(section.title)) group.sections.set(section.title, []);
      group.sections.get(section.title).push(text);
    }
  }
}

const ordered = [...groups.values()]
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  .map((group, index) => ({
    version: group.version,
    date: ddmmyyyy(group.date),
    current: index === 0,
    sections: [...group.sections.entries()]
      .sort((a, b) => {
        const ai = SECTION_ORDER.indexOf(a[0]);
        const bi = SECTION_ORDER.indexOf(b[0]);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      })
      .map(([title, items]) => ({ title, items })),
  }));

const header = `// Журнал изменений для экрана в игре.
//
// Файл сгенерирован, править его вручную не нужно: источник — CHANGELOG.md,
// а даты взяты из истории git (дата коммита, который добавил запись).
// Пересобрать: npm run changelog:build

`;

writeFileSync(
  outPath,
  `${header}export const GAME_VERSION = '${gameVersion}';\n\nexport const CHANGELOG = ${JSON.stringify(ordered, null, 2)};\n`,
  'utf8',
);

const total = ordered.reduce(
  (sum, group) => sum + group.sections.reduce((n, section) => n + section.items.length, 0),
  0,
);
console.log(`Журнал изменений: ${total} записей в ${ordered.length} датах → src/changelog.js`);
if (guessed) console.log(`  дат из коммитов не нашлось: ${guessed} (подставлена последняя дата)`);
if (!resolved) console.log('  предупреждение: git недоступен, все даты условные');
