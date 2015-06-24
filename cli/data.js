var api = require('../api')
  , async = require('async')
  , cacheModel = require('../models/cache')
  , caches = require('../api/caches');

exports.ensureDataIntegrity = function(yargs) {
  var argv =
    yargs.usage('Ensures that the data in the database is correct as far as we can tell.')
    .help('help')
    .argv;

  new api.Cache().getAll({}, function(err, caches) {
    if (err) {
      console.log('There was an error retrieving caches.');
      process.exit();
    }
    if (!caches) {
      console.log('No caches were found.');
      process.exit();
    }

    console.log('Found ' + caches.length + ' caches.');

    async.eachSeries(caches, function iterator(cache, callback) {
      if (cache.totalTileSize && !cache.vector) {
        cache.formats = cache.formats || {};
        if (!cache.formats.xyz || !cache.formats.xyz.size) {
          console.log('Setting cache xyz size for cache ' + cache.name + ' to ' + cache.totalTileSize);
          cacheModel.updateFormatCreated(cache, 'xyz', cache.totalTileSize, function(err, newCache) {
            if(!err){
              cacheModel.updateFormatCreated(newCache, 'tms', cache.totalTileSize, function(err, newCache) {
                callback(err);
              });
            } else {
              console.log('Error saving cache', err);
              callback(err);
            }
          });
        } else {
          callback();
        }
      } else {
        callback();
      }
    }, function done() {
      process.exit();
    });
  });
}

// exports.resetGenerating = function(yargs) {
//   var argv =
//     yargs.usage('Resets all the generating formats.')
//     .help('help')
//     .argv;
//
//   new api.Cache().getAll({}, function(err, caches) {
//     if (err) {
//       console.log('There was an error retrieving caches.');
//       process.exit();
//     }
//     if (!caches) {
//       console.log('No caches were found.');
//       process.exit();
//     }
//
//     process.exit();
//   });
// }
