// tilt: a board leaning on a lath (board2) and one standing 20 mm off it (board)
units('mm');
lath = boxBetween([0, 0, 0], [300, 30, 30]).name('lath');
board = boxBetween([20, 0, 0], [280, 12, 500]).rotateX(-25, [0, 0, 0]).move(0, 40, 30).name('board');
board2 = boxBetween([20, 0, 0], [280, 12, 500]).rotateX(-25, [0, 0, 0]).move(0, 30, 30).name('board2');
