var async = require('async')
  , turf = require('turf')
  , turfMeta = require('turf-meta');

Math.radians = function(degrees) {
  return degrees * Math.PI / 180;
};

// Converts from radians to degrees.
Math.degrees = function(radians) {
  return radians * 180 / Math.PI;
};

function tile2lon(x,z) {
  return (x/Math.pow(2,z)*360-180);
}

function tile2lat(y,z) {
  var n=Math.PI-2*Math.PI*y/Math.pow(2,z);
  return (180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))));
}

function long2tile(lon,zoom) {
  return Math.min(Math.pow(2,zoom)-1, (Math.floor((lon+180)/360*Math.pow(2,zoom))));
}

function lat2tile(lat,zoom) {
  return (Math.floor((1-Math.log(Math.tan(lat*Math.PI/180) + 1/Math.cos(lat*Math.PI/180))/Math.PI)/2 *Math.pow(2,zoom)));
}

var zoomLevelResolutions = [156412,78206,39103,19551,9776,4888,2444,1222,610.984,305.492,152.746,76.373,38.187,19.093,9.547,4.773,2.387,1.193,0.596,0.298];

exports.getZoomLevelResolution = function(z) {
	return zoomLevelResolutions[z];
};

exports.getXYZFullyEncompassingExtent = function(extent, minZoom, maxZoom) {
	var zoom = maxZoom || 18;
	var min = minZoom || 0;
	//find the first zoom level with 1 tile
	var y = exports.calculateYTileRange(extent, zoom);
	var x = exports.calculateXTileRange(extent, zoom);
	var found = false;
	for (zoom; zoom >= min && !found; zoom--) {
		y = exports.calculateYTileRange(extent, zoom);
		x = exports.calculateXTileRange(extent, zoom);
		if (y.min === y.max && x.min === x.max) {
			found = true;
		}
	}
  if (found) {
  	zoom = zoom+1;
  } else {
    y = exports.calculateYTileRange(extent, minZoom);
		x = exports.calculateXTileRange(extent, minZoom);
    zoom = minZoom;
  }
	return {
		z: zoom,
		x: x.min,
		y: y.min
	};
};

exports.tileBboxCalculator = function(x, y, z) {
  x = Number(x);
  y = Number(y);
  var tileBounds = {
    north: tile2lat(y, z),
    east: tile2lon(x+1, z),
    south: tile2lat(y+1, z),
    west: tile2lon(x, z)
  };

  return tileBounds;
};

exports.tileExtentCalculator = function(x, y, z) {
  x = Number(x);
  y = Number(y);
  var tileBounds = [
    tile2lon(x, z),
    tile2lat(y+1, z),
    tile2lon(x+1, z),
    tile2lat(y, z)
  ];

  return tileBounds;
};

exports.tilesToFeatureCollection = function(tiles, zoom) {
  var features = [];
  for (var key in tiles) {
    var tile = tiles[key];
    var extent = exports.tileExtentCalculator(tile.x, tile.y, zoom);
    features.push(turf.bboxPolygon(extent));
  }
  var fc = turf.featureCollection(features);
  return fc;
};

exports.mergeFeatureCollection = function(featureCollection) {
  var merged = JSON.parse(JSON.stringify(featureCollection.features[0]));
  var features = featureCollection.features;
  for (var i = 0; i < features.length; i++) {
    if (features[i].geometry) {
      merged = turf.union(merged, features[i]);
    }
  }
  return merged;
};

exports.calculateXTileRange = function(bbox, z) {
  var west = long2tile(bbox[0], z);
  var east = long2tile(bbox[2], z);
  return {
    min: Math.max(0, Math.min(west, east)),
    max: Math.max(0, Math.max(west, east))
  };
};

exports.calculateYTileRange = function(bbox, z) {
  var south = lat2tile(bbox[1], z);
  var north = lat2tile(bbox[3], z);
  return {
    min: Math.max(0, Math.min(south, north)),
    max: Math.max(0, Math.max(south, north)),
    current: Math.max(0,Math.min(south, north))
  };
};

exports.tilesInFeatureCollection = function(featureCollection, minZoom, maxZoom, bufferSize, bufferUnits) {
  var bufferedFeatures = [];
  turfMeta.featureEach(featureCollection, function(feature) {
    if (feature.geometry
    && (feature.geometry.type === "LineString"
    || feature.geometry.type === "Point")) {
      bufferedFeatures.push(turf.buffer(feature, bufferSize || .01, bufferUnits || 'miles'));
    } else {
      bufferedFeatures.push(feature);
    }
  });

  featureCollection = turf.featureCollection(bufferedFeatures);

  // get the overall envelope of all features
  var envelope = turf.envelope(featureCollection);
  var extent = turf.bbox(featureCollection);

  var yRange = exports.calculateYTileRange(extent, minZoom);
  var xRange = exports.calculateXTileRange(extent, minZoom);

  var tiles = {};

  tiles[minZoom] = {};

  // now iterate and get the tiles
  for (var x = xRange.min; x <= xRange.max; x++) {
    for (var y = yRange.min; y <= yRange.max; y++) {
      // verify this tile matches the geometry
      var tileExtent = exports.tileExtentCalculator(x, y, minZoom);
      var matches = exports.determineGeometryMatch(featureCollection, tileExtent);
      if (matches) {
        var tile = {x: x, y: y};
        tiles[minZoom][minZoom+'-'+x+'-'+y] = tile;//.push(tile);
        diveDown(tiles, featureCollection, x, y, minZoom, maxZoom);
      }
    }
  }

  return tiles;
}

function diveDown(tiles, featureCollection, x, y, zoom, maxZoom) {
  if (zoom+1 > maxZoom) {
    return tiles;
  }
  zoom = zoom + 1;
  tiles[zoom] = tiles[zoom] || {};

  var yRange = {
    min: y*2,
    max: (y*2)+1
  };

  var xRange = {
    min: x*2,
    max: (x*2)+1
  };

  // now iterate and get the tiles
  for (var x = xRange.min; x <= xRange.max; x++) {
    for (var y = yRange.min; y <= yRange.max; y++) {
      var tileExtent = exports.tileExtentCalculator(x, y, zoom);

      var matches = exports.determineGeometryMatch(featureCollection, tileExtent);
      if (matches) {
        var tile = {x: x, y: y};
        tiles[zoom][zoom+'-'+x+'-'+y] = tile;
        diveDown(tiles, featureCollection, x, y, zoom, maxZoom);
      }
    }
  }

  return tiles;
}

exports.iterateTiles = function(tileList, minZoom, maxZoom, data, processTileCallback, zoomCompleteCallback, completeCallback) {
  var zoom = minZoom;
  async.whilst(
    function (stopIterating) {
      return zoom <= maxZoom && !stopIterating;
    },
    function (zoomLevelDone) {
      async.setImmediate(function() {
        var tiles = [];

        var q = async.queue(processTileCallback, 100);

        q.drain = function() {
          zoomCompleteCallback(zoom, function(stop) {
            zoom++;
            zoomLevelDone(stop);
          });
        }

        for (var key in tileList[zoom]) {
          var tile = tileList[zoom][key];
          q.push({z:zoom, x: tile.x, y: tile.y, data: data}, function(stop) {
            if (stop) {
              q.kill();
              zoomLevelDone(true);
            }
          });
        }
      });
    },
    function (err) {
      completeCallback(err, data);
    }
  );
};

exports.determineGeometryMatch = function(geometry, tileExtent) {
  var extentPoly = turf.bboxPolygon(tileExtent);
  var found;
  turfMeta.featureEach(geometry, function(feature) {
    if (!found) {
      found = turf.intersect(feature, extentPoly);
    }
  });
  return found;
}

exports.tileCountInExtent = function(extent, minZoom, maxZoom) {
  var tiles = 0;
  for (var zoom = minZoom; zoom <= maxZoom; zoom++) {
    var yRange = exports.calculateYTileRange(extent, zoom);
    var xRange = exports.calculateXTileRange(extent, zoom);
    tiles += (1+yRange.max-yRange.min)*(1+xRange.max-xRange.min);
  }
  return tiles;
};

exports.iterateAllTilesInExtent = function(extent, minZoom, maxZoom, data, processTileCallback, zoomCompleteCallback, completeCallback) {
  var poly = turf.bboxPolygon(extent);
  var fc = turf.featureCollection([poly]);
  var tiles = exports.tilesInFeatureCollection(fc, minZoom, maxZoom);
  exports.iterateTiles(tiles, minZoom, maxZoom, data, processTileCallback, zoomCompleteCallback, completeCallback);
};
