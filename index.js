import { Command } from 'commander';
import { readFileSync } from 'node:fs';

const program = new Command();

program.configureOutput({
  outputError: (str, write) => {
    const text = str
      .replace("error: missing required argument", "Помилка: не вказано обов'язковий аргумент")
      .replace("error: unknown option", "Помилка: невідома опція")
      .replace("error: unknown command", "Помилка: невідома команда")
      .replace("error: option", "Помилка: опція")
      .replace("error:", "Помилка:");
    write(text);
  },
});

program
  .name('catalog')
  .description('CLI для роботи з каталогом диску з JSON-файлу')
  .version('1.0.0', '-V, --version', 'показати версію програми')
  .option('-f, --file <path>', 'шлях до JSON-файлу', 'data.json')
  .helpOption('-h, --help', 'показати довідку');

function fail(message) {
  console.error(`Помилка: ${message}`);
  process.exit(1);
}

function loadData() {
  const path = program.opts().file;
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') fail(`файл "${path}" не знайдено`);
    fail(`не вдалося прочитати файл "${path}"`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`файл "${path}" містить некоректний JSON`);
  }
}

function findByPath(items, targetPath) {
  for (const item of items) {
    if (item.path === targetPath || item.id === targetPath) return item;
    if (item.children) {
      const found = findByPath(item.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

function calculateFolderSize(item) {
  if (item.type === 'file') return item.sizeKb || 0;
  let total = 0;
  if (item.children && Array.isArray(item.children)) {
    for (const child of item.children) {
      total += calculateFolderSize(child);
    }
  }
  return total;
}

function searchByName(items, nameQuery, results = []) {
  for (const item of items) {
    if (item.name.toLowerCase().includes(nameQuery.toLowerCase())) {
      results.push(item);
    }
    if (item.children) {
      searchByName(item.children, nameQuery, results);
    }
  }
  return results;
}

// 1. Загальна можливість 1: Перелік елементів верхнього рівня з лімітом
program
  .command('list')
  .description('показати список елементів верхнього рівня')
  .option('-l, --limit <n>', 'максимальна кількість записів')
  .action((options) => {
    const data = loadData();
    let items = data.items;

    if (options.limit !== undefined) {
      const n = Number(options.limit);
      if (!Number.isInteger(n) || n < 1) {
        fail('значення --limit має бути додатним цілим числом');
      }
      items = items.slice(0, n);
    }

    for (const item of items) {
      console.log(`[${item.type.toUpperCase()}] ${item.name} (${item.path})`);
    }
  });

// 2. Загальна можливість 2: Повний перегляд одного елемента
program
  .command('show')
  .description('показати один елемент за ID або шляхом')
  .argument('<idOrPath>', 'ідентифікатор або шлях до елемента')
  .action((idOrPath) => {
    const data = loadData();
    const found = findByPath(data.items, idOrPath);
    if (!found) {
      fail(`елемент "${idOrPath}" не знайдено`);
    }
    console.log(JSON.stringify(found, null, 2));
  });

// 3. Загальна можливість 3: Читання окремого вкладеного поля
program
  .command('field')
  .description('показати значення поля за шляхом у об\'єкті')
  .argument('<path>', 'шлях до поля через крапку')
  .action((fieldPath) => {
    const data = loadData();
    let current = data;
    for (const key of fieldPath.split('.')) {
      if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) {
        fail(`поле "${fieldPath}" не знайдено (зупинились на "${key}")`);
      }
      current = current[key];
    }
    console.log(JSON.stringify(current, null, 2));
  });

// 4. Можливість варіанта 3.1: Вміст папки з прапорцем -a
program
  .command('ls')
  .description('показати вміст вкладеної папки')
  .argument('<folderPath>', 'шлях до папки (наприклад, /Documents)')
  .option('-a, --all', 'показати приховані елементи')
  .action((folderPath, options) => {
    const data = loadData();
    const folder = findByPath(data.items, folderPath);

    if (!folder) {
      fail(`папку "${folderPath}" не знайдено`);
    }
    if (folder.type !== 'folder') {
      fail(`об'єкт "${folderPath}" не є папкою`);
    }

    let children = folder.children || [];
    if (!options.all) {
      children = children.filter((item) => !item.isHidden);
    }

    if (children.length === 0) {
      console.log('Папка порожня або містить лише приховані елементи.');
      return;
    }

    for (const child of children) {
      const hiddenMark = child.isHidden ? ' [прихований]' : '';
      console.log(`  ${child.type === 'folder' ? '[DIR]' : '[FILE]'} ${child.name}${hiddenMark} (${child.sizeKb} KB)`);
    }
  });

// 5. Можливість варіанта 3.2: Сумарний розмір папки
program
  .command('size')
  .description('показати сумарний розмір папки')
  .argument('<folderPath>', 'шлях до папки або елемента')
  .action((folderPath) => {
    const data = loadData();
    const folder = findByPath(data.items, folderPath);

    if (!folder) {
      fail(`папку "${folderPath}" не знайдено`);
    }

    const totalSize = calculateFolderSize(folder);
    console.log(`Сумарний розмір папки "${folder.name}" (${folder.path}): ${totalSize} KB`);
  });

// 6. Можливість варіанта 3.3: Рекурсивний пошук за назвою
program
  .command('find')
  .description('пошук файлу чи папки за назвою в усьому дереві')
  .argument('<query>', 'назва або частина назви файлу/папки')
  .action((query) => {
    const data = loadData();
    const matches = searchByName(data.items, query);

    if (matches.length === 0) {
      console.log(`Елементів із назвою "${query}" не знайдено.`);
      return;
    }

    console.log(`Знайдено елементів: ${matches.length}`);
    for (const item of matches) {
      console.log(`  - [${item.type}] ${item.name} -> Шлях: ${item.path} (Розмір: ${item.sizeKb} KB)`);
    }
  });

program.parse();