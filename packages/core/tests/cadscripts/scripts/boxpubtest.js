// boxpubtest
// test server test server

$PARAMS.define('SIZE', 'number', { units: "mm", order: 0, default: 50, minimum: 10, maximum: 100, multipleOf: 1 });

// Archiyou 0.5

box($SIZE)
