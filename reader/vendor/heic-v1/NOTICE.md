# HEIC decoding fallback
Unmodified CSP build of heic-to 1.5.2 (Hopper Gee), LGPL-3.0-or-later. Includes libheif 1.22.2 (LGPL-3.0), with HEVC decoding through libde265 (LGPL-3.0). Only loaded when native decoding of a HEIC photo fails.
Source: https://github.com/hoppergee/heic-to/tree/v1.5.2 (npm source snapshot included in src/, package.json and esbuild.mjs).
The npm archive including this source is https://registry.npmjs.org/heic-to/-/heic-to-1.5.2.tgz
libheif source: https://github.com/strukturag/libheif/releases/tag/v1.22.2
libde265 source: https://github.com/strukturag/libde265
Upstream rebuild instructions: UPSTREAM-README.md, “How to build libheif.js”. Full LGPL/GPL license texts included. The library can be replaced independently at heic-to.js; the website does not transmit the photo.
