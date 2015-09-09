var SourceModel = require('../../models/source')
  , FeatureModel = require('../../models/feature')
  , async = require('async')
  , path = require('path')
  , request = require('request')
  , fs = require('fs-extra')
  , turf = require('turf')
  , tileUtilities = require('../tileUtilities.js')
  , config = require('../../config.js');

exports.process = function(source, callback) {
  callback(null, source);
  var child = require('child_process').fork('api/sources/processor.js');
  child.send({operation:'process', sourceId: source.id});
}

exports.getTile = tileUtilities.getVectorTile;
exports.getFeatures = tileUtilities.getFeatures;

exports.getData = function(source, west, south, east, north, callback) {
  FeatureModel.findFeaturesBySourceIdWithin(sourceId, west, south, east, north, callback);
}

exports.processSource = function(source, callback) {
  source.status = source.status || {};
  source.status.message = "Parsing GeoJSON";
  source.vector = true;
  console.log('saving the source');
  SourceModel.updateDatasource(source, function(err, updatedSource) {
    console.log('xxxxxxx herp');
    console.log('saved the source', updatedSource);
    if (updatedSource.url) {
      var dir = path.join(config.server.sourceDirectory.path, updatedSource.id);
      fs.mkdirp(dir, function(err) {
        if (err) return callback(err);
        var req = request.get({url: updatedSource.url})
        .on('error', function(err) {
          console.log(err+ updatedSource.url);

          callback(err);
        })
        .on('response', function(response) {
          var size = response.headers['content-length'];
          SourceModel.updateSourceAverageSize(updatedSource, size, function(err) {
          });
        });
        if (req) {
          var stream = fs.createWriteStream(dir + '/' + updatedSource.id + '.geojson');
      		stream.on('close',function(status) {
            fs.stat(dir + '/' + updatedSource.id + '.geojson', function(err, stat) {
              updatedSource.filePath = dir + '/' + updatedSource.id + '.geojson';
              updatedSource.size = stat.size;
              updatedSource.status = {
                message: "Creating",
                complete: false,
                zoomLevelStatus: {}
              };
              SourceModel.updateDatasource(updatedSource, function(err, updatedSource) {
                console.log('saved the source', updatedSource);
                parseGeoJSONFile(updatedSource, function(err, updatedSource) {

                  callback();
                });
              });
            });
      		});

    			req.pipe(stream);
        }
      });

    } else if (fs.existsSync(updatedSource.file.path)) {
      parseGeoJSONFile(updatedSource, function(err, updatedSource) {
        updatedSource.status.complete = true;
        updatedSource.status.message="Complete";
        console.log('source saved for file', updatedSource);
        SourceModel.updateDatasource(updatedSource, function(err, updatedSource) {
          console.log('source err', err);
          console.log('updated source', updatedSource);
          callback();
        });
      });

      // var dir = path.join(config.server.sourceDirectory.path, source.id);
      // var fileName = path.basename(path.basename(source.filePath), path.extname(source.filePath)) + '.geojson';
      // var file = path.join(dir, fileName);
      //
      // fs.move(source.filePath, file, function(err){
      //   source.filePath = file;
      //   source.save(function(err){
      //   });
      // });
    }
  });
}

function parseGeoJSONFile(source, callback) {
  var stream = fs.createReadStream(source.file.path);
  console.log('reading in the file', source.file.path);
  fs.readFile(source.file.path, function(err, fileData) {
    console.log('parsing file data', source.file.path);
    console.time('parsing geojson');
    var gjData = JSON.parse(fileData);
    console.timeEnd('parsing geojson');
    // save the geojson to the db
    console.log('gjdata.features', gjData.features.length);
    var count = 0;
    async.eachSeries(gjData.features, function iterator(feature, callback) {
      console.log('saving feature %d', count);
      FeatureModel.createFeatureForSource(feature, source.id, function(err) {
        count++;
        // console.log('err', err);
        async.setImmediate(function() {
          if (count % 1000 == 0) {
            source.status.message="Processing " + ((count/gjData.features.length)*100) + "% complete";
            SourceModel.updateDatasource(source, function(err, updatedSource) {
              source = updatedSource;
              callback(null, feature);
    				});
          } else {
            callback(null, feature);
          }
        });
      });
    }, function done() {
      console.log('done processing features');
      source.status.totalFeatures = gjData.features.length;
      var geometry = turf.envelope(gjData);
    	source.geometry = geometry;
      source.style = {
    		defaultStyle: {
    			style: {
    				'fill': "#000000",
    				'fill-opacity': 0.5,
    				'stroke': "#0000FF",
    				'stroke-opacity': 1.0,
    				'stroke-width': 1
    			}
    		},
    		styles: []
    	};
      source.status.complete = true;
			source.status.message = "Complete";
			source.properties = [];
			var allProperties = {};
			for (var i = 0; i < gjData.features.length; i++) {
				var feature = gjData.features[i];
				for (var property in feature.properties) {
					allProperties[property] = allProperties[property] || {key: property, values:[]};
					if (allProperties[property].values.indexOf(feature.properties[property]) == -1) {
						allProperties[property].values.push(feature.properties[property]);
					}
				}
			}
			for (var property in allProperties) {
				source.properties.push(allProperties[property]);
			}
      console.log('saving source');
      SourceModel.updateDatasource(source, function(err, updatedSource) {
        source = updatedSource;
        callback(null, updatedSource);
      });
    });

  });
}
