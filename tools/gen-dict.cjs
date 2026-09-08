const cv = require('../vendor/opencv.js');
const iv = setInterval(() => {
  if (typeof cv.Mat !== 'function') return; clearInterval(iv);
  const dict = cv.getPredefinedDictionary(cv.DICT_4X4_50);
  const out = [];
  for (let id = 0; id < 50; id++) {
    const img = new cv.Mat(); cv.generateImageMarker(dict, id, 6, img, 1);
    // 6x6 with 1-bit border; inner 4x4 bits, 1 = white
    const bits = [];
    for (let r = 1; r <= 4; r++) { const row = []; for (let c = 1; c <= 4; c++) row.push(img.ucharAt(r, c) ? 1 : 0); bits.push(row); }
    out.push(bits); img.delete();
  }
  console.log(JSON.stringify(out));
  process.exit(0);
}, 200);
