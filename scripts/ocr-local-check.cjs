const fs = require("fs");
const path = require("path");
const { createWorker } = require("tesseract.js");

async function main() {
  const root = path.resolve(__dirname, "..");
  const imagePath = path.join(root, "Documenti", "tessera_sanitaria.jpg");
  const worker = await createWorker("ita+eng", 1, {
    workerPath: path.join(root, "node_modules", "tesseract.js", "src", "worker-script", "node", "index.js"),
    langPath: path.join(root, "public", "tesseract-lang"),
    gzip: false,
    logger: () => {}
  });

  await worker.setParameters({
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz /-.",
    tessedit_pageseg_mode: "11"
  });

  const result = await worker.recognize(fs.readFileSync(imagePath), { rotateAuto: true });
  await worker.terminate();

  const text = result.data.text || "";
  const normalized = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const exactCfPattern = /[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]/.test(normalized);
  const fuzzyCandidateFound = Boolean(
    (normalized.match(/[A-Z0-9]{16}/g) || []).find((value) => /[A-Z]{6}/.test(value.slice(0, 6)))
  );

  console.log(JSON.stringify({
    image_exists: fs.existsSync(imagePath),
    ocr_chars: text.length,
    exact_cf_pattern: exactCfPattern,
    fuzzy_candidate_found: fuzzyCandidateFound
  }));

  if (!exactCfPattern && !fuzzyCandidateFound) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
