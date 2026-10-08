// clash: a and b share a 50 mm cube, a and d a 20 mm cube; c only touches a
units('mm');
a = boxbetween([0, 0, 0], [100, 100, 100]).name('a');
b = boxbetween([50, 50, 50], [150, 150, 150]).name('b');
c = boxbetween([100, 0, 0], [200, 40, 40]).name('c');
d = boxBetween([-20, -20, -20], [20, 20, 20]).name('d');
