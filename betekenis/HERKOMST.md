# Herkomst van deze map

- `transformers.min.js`, `ort-wasm-simd-threaded.jsep.mjs`, `ort-wasm-simd-threaded.jsep.wasm`: ongewijzigd uit het npm-pakket
  `@huggingface/transformers` versie 3.7.6 (map `dist/`). Licentie: Apache 2.0 (`LICENSE` hiernaast). De rekenkern (ONNX Runtime
  Web) zit erin en valt onder de MIT-licentie van Microsoft.
- Het MODEL staat hier niet: het wordt pas na een tik een keer opgehaald en daarna door de browser bewaard.
