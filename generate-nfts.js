const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const IMG_ROOT = path.join(ROOT, 'img');
const MARKERS_ROOT = path.join(ROOT, 'markers');

const CATEGORIES = ['cafe', 'hamburguesa', 'pizza', 'sushi'];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generateNftForImage(inputPath, markerId) {
  const outputDir = path.join(MARKERS_ROOT, markerId);
  ensureDir(outputDir);
  const baseOutput = path.join(outputDir, markerId);
  const cmd = `arjs-image -i "${inputPath}" -o "${baseOutput}" -m "descriptor"`;
  console.log('\n=== Generando NFT para:', inputPath);
  console.log(cmd);
  execSync(cmd, { stdio: 'inherit' });
}

function main() {
  CATEGORIES.forEach((cat) => {
    const dir = path.join(IMG_ROOT, cat);
    if (!fs.existsSync(dir)) {
      console.warn('No se encontró carpeta de imágenes para categoría:', cat);
      return;
    }
    const files = fs.readdirSync(dir);
    files.forEach((file) => {
      const lower = file.toLowerCase();
      if (!lower.endsWith('.png') && !lower.endsWith('.jpg') && !lower.endsWith('.jpeg')) {
        return;
      }
      const baseName = path.parse(file).name;
      const markerId = baseName;
      const inputPath = path.join(dir, file);
      generateNftForImage(inputPath, markerId);
    });
  });
}

main();
