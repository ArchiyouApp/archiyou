$module('twice');
units('mm');

plate = box(twice.double(50), 10, 10).name('plate');
print('doubled ' + twice.double(21));
