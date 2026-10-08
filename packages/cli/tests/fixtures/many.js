// many: 600 named blocks, for output larger than a pipe buffer
units('mm');
Array.from({ length: 600 }, (_, i) => box(10).move((i % 30) * 20, Math.floor(i / 30) * 20, 0).name(`block${i}`));
