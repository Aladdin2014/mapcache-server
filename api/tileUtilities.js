var request = require('request')
	, fs = require('fs-extra')
	, path = require('path')
	, async = require('async')
	, turf = require('turf')
	, xyzTileWorker = require('./xyzTileWorker')
	, path = require('path')
	, Canvas = require('canvas')
	, Image = Canvas.Image
	, CacheModel = require('../models/cache')
	, SourceModel = require('../models/source')
	, FeatureModel = require('../models/feature')
	, Maps = require('./sources')
	, Readable = require('stream').Readable
	, Caches = require('./caches')
 	, config = require('../config.json');

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

exports.tileBboxCalculator = function(x, y, z) {
  console.log('tile box calculator for ' + x + ' ' + y + ' ' + z);
  x = Number(x);
  y = Number(y);
  var tileBounds = {
    north: tile2lat(y, z),
    east: tile2lon(x+1, z),
    south: tile2lat(y+1, z),
    west: tile2lon(x, z)
  };

  return tileBounds;
}

exports.getOverviewTile = function(cache, callback) {
	var extent = turf.extent(cache.geometry);
	var zoom = cache.maxZoom || 18;
	var min = cache.minZoom || 0;
	//find the first zoom level with 1 tile
	var y = exports.yCalculator(extent, cache.maxZoom);
	var x = exports.xCalculator(extent, cache.maxZoom);
	var found = false;
	for (zoom; zoom >= min && !found; zoom--) {
		y = exports.yCalculator(extent, zoom);
		x = exports.xCalculator(extent, zoom);
		if (y.min == y.max && x.min == x.max) {
			found = true;
		}
	}
	zoom = zoom+1;

	Caches.getTile(cache, 'png', zoom, x.min, y.min, callback);
}

exports.getOverviewMapTile = function(map, callback) {
	var extent = [-180, -85, 180, 85];
	if (map.geometry) {
		extent = turf.extent(map.geometry);
	}
	var zoom = 18;
	var min = 0;
	//find the first zoom level with 1 tile
	var y = exports.yCalculator(extent, zoom);
	var x = exports.xCalculator(extent, zoom);
	var found = false;
	for (zoom; zoom >= min && !found; zoom--) {
		y = exports.yCalculator(extent, zoom);
		x = exports.xCalculator(extent, zoom);
		if (y.min == y.max && x.min == x.max) {
			found = true;
		}
	}
	zoom = zoom+1;

	var params = {};

	Maps.getTile(map, 'png', zoom, x.min, y.min, params, callback);
}

exports.xCalculator = function(bbox,z) {
	var x = [];
	var x1 = exports.getX(Number(bbox[0]), z);
	var x2 = exports.getX(Number(bbox[2]), z);
	x.max = Math.max(x1, x2);
	x.min = Math.max(0,Math.min(x1, x2));
	if (z == 0){
		x.current = Math.min(x1, x2);
	}
	return x;
}

exports.yCalculator = function(bbox,z) {
	var y = [];
	var y1 = exports.getY(Number(bbox[1]), z);
	var y2 = exports.getY(Number(bbox[3]), z);
	y.max = Math.max(y1, y2);
	y.min = Math.max(0,Math.min(y1, y2));
	y.current = Math.min(y1, y2);
	return y;
}

exports.getX = function(lon, zoom) {
	var xtile = Math.floor((lon + 180) / 360 * (1 << zoom));
	return xtile;
}

exports.getY = function(lat, zoom) {
	var ytile = Math.floor((1 - Math.log(Math.tan(Math.radians(parseFloat(lat))) + 1 / Math.cos(Math.radians(parseFloat(lat)))) / Math.PI) /2 * (1 << zoom));
	return ytile;
}

exports.getFeatures = function(source, west, south, east, north, zoom, callback) {
	FeatureModel.findFeaturesBySourceIdWithin(source.id, west, south, east, north, function(err, featureList) {
		featureList = featureList.sort(function (a, b) {
			if (a.geoType === 1 && b.geoType === 1) {
				var aDistance = turf.distance(turf.point(a.geometry[0]), queryPoint);
				var bDistance = turf.distance(turf.point(b.geometry[0]), queryPoint);
				if (aDistance < bDistance) return -1;
				if (bDistance > aDistance) return 1;
				return 0;
			} else if (a.geoType === 1) {
				return -1;
			} else if (b.geoType === 1) {
				return 1;
			}

			return 0;
		});
		callback(null, featureList);
	});
}

function tileContainsData(source, bbox) {
	if (source.geometry && !turf.intersect(turf.bboxPolygon([bbox.west - Math.abs(bbox.west*.05), bbox.south - Math.abs(bbox.south*.05), bbox.east + Math.abs(bbox.east*.05), bbox.north + Math.abs(bbox.north*.05)]), source.geometry)) {
		console.log("No data, returning early");
		return false;
	}
	return true;
}

exports.getVectorTile = function(source, format, z, x, y, params, callback) {
	console.log('getting vector tile %d %d %d', z, x, y);
	var bbox = exports.tileBboxCalculator(x, y, z);

	if (!tileContainsData(source.source ? source.source : source, bbox)) {
		console.log("No data, returning early");
		return callback(null);
	}

	// use the style time to determine if there has already been an image created for this source and style
	var imageTile = path.join(config.server.sourceDirectory.path, source.id.toString(), 'prebuilt-'+source.styleTime, z.toString(), x.toString(), y.toString()+'.png');
	if (source.source) {
		imageTile = path.join(config.server.cacheDirectory.path, source.id.toString(), 'prebuilt-'+source.styleTime, z.toString(), x.toString(), y.toString()+'.png');
	}
	if (params && !params.noCache && fs.existsSync(imageTile)) {
		console.log('pulling tile from prebuilt', imageTile);
		return callback(null, fs.createReadStream(imageTile));
	} else {
		console.log('getting tile from db', imageTile);
		if (source.source) {
			FeatureModel.fetchTileForCacheId(source.id, bbox, z, function(err, tile) {
				handleTileData(tile, format, source.source, imageTile, callback);
			});
		} else {
			FeatureModel.fetchTileForSourceId(source.id, bbox, z, function(err, tile) {
				handleTileData(tile, format, source, imageTile, callback);
			});
		}
	}
}

function handleTileData(tile, format, source, imageTile, callback) {
	try {
		if (format == 'png') {
			return exports.createImage(tile, source.style, function(err, pngStream) {
				var size = 0;
				var done = true;
				pngStream.on('data', function(chunk) {
					size += chunk.length;
				});
				pngStream.on('end', function() {
					if (!done && source){
						SourceModel.updateSourceAverageSize(source, size, function(err) {
						});
						done = true;
					}
				});
				fs.mkdirsSync(path.dirname(imageTile), function(err){
					 if (err) console.log(err);
				 });
				var tileWriter = fs.createWriteStream(imageTile);
				pngStream.pipe(tileWriter);
				return callback(err, pngStream);
			});
		} else {
			return callback(null);
		}
	} catch (e) {
		// console.log('error with tile ', tile);
		// console.log(tile);
		console.log(e);
		throw e;
	}
}

exports.createImage = function(tile, style, callback) {
	var canvases = {};

	console.log('creating image');
	console.time('creating image for tile');
	var ratio = 256 / 4096;
	var features = tile;

	var points = 0;

  for (var i = 0; i < features.length; i++) {
		var feature = JSON.parse(features[i].geometry);
		var type = feature.type;
		var ctx;
		var styles = styleFunction(features[i], style);
		// console.log('styles.styleId', styles.styleId);
    if (styles && !canvases[styles.styleId]) {
			var canvas = new Canvas(256,256);
		  var ctx = canvas.getContext('2d');
			canvases[styles.styleId] = {canvas: canvas, ctx: ctx};
      var rgbFill = hexToRgb(styles.fillColor);
      ctx.fillStyle = "rgba("+rgbFill.r+","+rgbFill.g+","+rgbFill.b+","+styles.fillOpacity+")";
      ctx.lineWidth = styles.weight;
      var rgbStroke = hexToRgb(styles.color);
      ctx.strokeStyle = "rgba("+rgbStroke.r+","+rgbStroke.g+","+rgbStroke.b+","+styles.opacity+")";
    } else {
			ctx = canvases[styles.styleId].ctx;
		}

    ctx.beginPath();

    var geom = feature.coordinates;

    if (type === 'Point' && points < 10000) {
			points++;
      drawPoint(geom, ctx, ratio);
    } else if (type === 'MultiPoint') {
			for (var point = 0; point < geom.length; point++) {
				drawPoint(geom[point], ctx, ratio);
			}
		} else if (type === 'LineString') {
			drawLine(geom, ctx, ratio);
		} else if (type === 'MultiLineString') {
			for (var line = 0; line < geom.length; line++) {
				drawLine(geom[line], ctx, ratio);
			}
		} else if (type === 'Polygon') {
			drawPolygon(geom, ctx, ratio);
		} else if (type === 'MultiPolygon') {
			for (var poly = 0; poly < geom.length; poly++) {
				drawPolygon(geom[poly], ctx, ratio);
			}
		}

		ctx.closePath();
		ctx.fill('evenodd');
    ctx.stroke();
  }

	var finalCanvas = new Canvas(256,256);
	var finalCtx = finalCanvas.getContext('2d');

	for (var key in canvases) {
		finalCtx.drawImage(canvases[key].canvas, 0, 0);
	}

	console.timeEnd('creating image for tile');
  callback(null, finalCanvas.pngStream());
}

function drawPoint(point, ctx, ratio) {
	ctx.arc(~~(point[0] * ratio), ~~(256-(point[1] * ratio)), 2, 0, 2 * Math.PI, false);
}

function drawLine(line, ctx, ratio) {
	for (var k = 0; k < line.length; k++) {
		var coord = line[k];
		if (coord[0] == null || coord[1] == null) continue;
		if (k) ctx.lineTo(~~(coord[0] * ratio), ~~(256-(coord[1] * ratio)));
		else ctx.moveTo(~~(coord[0] * ratio), ~~(256-(coord[1] * ratio)));
	}
}

function drawPolygon(polygon, ctx, ratio) {
	for (var ring = 0; ring < polygon.length; ring++) {
		var linearRing = polygon[ring];
		drawLine(linearRing, ctx, ratio);
	}
}

function styleFunction(feature, style) {
  if (!style) return null;
  if (style.styles) {
    var sorted = style.styles.sort(styleCompare);
    for (var i = 0; i < sorted.length; i++) {
      var styleProperty = sorted[i];
      var key = styleProperty.key;
      if (feature.properties && feature.properties[key]) {
        if (feature.properties[key] == styleProperty.value) {
          return {
            color: styleProperty.style['stroke'],
            fillOpacity: styleProperty.style['fill-opacity'],
            opacity: styleProperty.style['stroke-opacity'],
            weight: styleProperty.style['stroke-width'],
            fillColor: styleProperty.style['fill'],
						styleId: i
          };
        }
      }
    }
  }
  var defaultStyle = style.defaultStyle;
  if (!defaultStyle) {
    return null;
  }

  return {
    color: defaultStyle.style['stroke'],
    fillOpacity: defaultStyle.style['fill-opacity'],
    opacity: defaultStyle.style['stroke-opacity'],
    weight: defaultStyle.style['stroke-width'],
    fillColor: defaultStyle.style['fill'],
		styleId: style.styles.length
  }
}

function styleCompare(a, b) {
  if (a.priority < b.priority) {
    return -1;
  }
  if (a.priority > b.priority) {
    return 1;
  }
  // a must be equal to b
  return 0;
}

function hexToRgb(hex) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
  } : null;
}
