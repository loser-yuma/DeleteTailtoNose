import fs from 'node:fs';
import readline from 'node:readline';
import { gzipSync } from 'node:zlib';

const [jmdictPath, ...sudachiPaths] = process.argv.slice(2);
const outputPath = 'public/dictionary.data';

if (!jmdictPath) {
  throw new Error('Usage: node scripts/build-dictionary.mjs <JMdict JSON> [Sudachi CSV ...]');
}

function normalizeWord(word) {
  return String(word)
    .normalize('NFKC')
    .replace(/[ァ-ヶヷ-ヺ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/ー/g, '')
    .replace(/\s+/g, '')
    .replace(/[！-／：-＠［-｀｛-～]/g, '')
    .replace(/[\u3000]/g, '')
    .replace(/\r|\n/g, '');
}

function isJapaneseWord(word) {
  return /[ぁ-ゖ一-龯々〆ヵヶ]/.test(word);
}

function addEntry(dictionary, surface, reading) {
  const normalizedSurface = normalizeWord(surface);
  const normalizedReading = normalizeWord(reading);
  if (
    !normalizedSurface
    || !/^[ぁ-ゖー]+$/.test(normalizedReading)
    || !isJapaneseWord(normalizedSurface)
  ) {
    return;
  }

  if (!dictionary.has(normalizedSurface)) {
    dictionary.set(normalizedSurface, normalizedReading);
  }
}

const dictionary = new Map();
const jmdict = JSON.parse(fs.readFileSync(jmdictPath, 'utf8'));

for (const entry of jmdict.words || []) {
  const readings = entry.kana
    .map(item => item.text)
    .filter(Boolean);

  for (const reading of readings) {
    addEntry(dictionary, reading, reading);
  }

  for (const kanji of entry.kanji || []) {
    const applicableReadings = readings.filter(reading => (
      entry.kana.some(item => item.text === reading
        && (item.appliesToKanji.includes('*') || item.appliesToKanji.includes(kanji.text)))
    ));
    for (const reading of applicableReadings.length ? applicableReadings : readings) {
      addEntry(dictionary, kanji.text, reading);
    }
  }
}

for (const sudachiPath of sudachiPaths) {
  const input = readline.createInterface({
    input: fs.createReadStream(sudachiPath),
    crlfDelay: Infinity,
  });

  for await (const line of input) {
    const fields = line.split(',');
    addEntry(dictionary, fields[0], fields[11]);
  }
}

fs.mkdirSync('public', { recursive: true });
fs.writeFileSync(
  outputPath,
  gzipSync(Buffer.from(JSON.stringify([...dictionary])), { level: 9 }),
);
console.log(`Wrote ${dictionary.size} entries to ${outputPath}`);
