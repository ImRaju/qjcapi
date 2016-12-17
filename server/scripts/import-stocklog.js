
var server = require('../server.js');
var options = JSON.parse(process.argv[2]);

try {
	server.models.stock["import"](options.container, options.file, options, function(err) {
    return process.exit(err ? 1 : 0);
  });
} catch (_error) {
  console.log(_error);
  var err = _error;
  process.exit(err ? 1 : 0);
}
