
/**
 * Module dependencies
 */

var rfc = require('./');

if (false) {
  rfc.sync()
  .on('end', function () {
    console.log('end');
  });
}
var search = rfc.search('punycode');

search.on('result', function (result) {
  if (result.isSynced()) {
    return result.open()
      .on('error', function (err) {
        throw err;
      });
  }

  result.sync()
    .on('error', function (err) {
      e('error: %s', err);
    })
    .on('end', function () {
      result.open();
    });
});

