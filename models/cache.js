var mongoose = require('mongoose')
	, fs = require('fs-extra')
	, config = require('../config.json')
	, Source = require('./source');

// Creates a new Mongoose Schema object
var Schema = mongoose.Schema;

var TileFailureSchema = new Schema({
	url: {type: String, required: true},
	retries: {type: Number, required: true}
});

var FormatSchema = new Schema({
	format: { type: String, required: true},
	size: { type: Number, required: true},
	zoomLevelSize: Schema.Types.Mixed
},{
	strict: true
});

// Creates the Schema for the cache objects
var CacheSchema = new Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String, required: false },
  date: {type: Date, require: true },
	geometry: Schema.Types.Mixed,
	maxZoom: {type: Number, required: true },
	minZoom: {type: Number, required: true},
	formats: [FormatSchema],
	tileFailures: [TileFailureSchema],
	status: {
		complete: {type: Boolean, required: true},
		totalTiles: {type: Number, required: true},
		generatedTiles: {type: Number, required: true},
		zoomLevelStatus: Schema.Types.Mixed
	},
	sourceId: { type: Schema.Types.ObjectId, ref: 'Source', required: true }
},{
	strict: true
});

CacheSchema.index({geometry: "2dsphere"});
CacheSchema.index({'name': 1});

function transform(cache, ret, options) {
	ret.id = ret._id;
	delete ret._id;

	delete ret.__v;

	if (cache.populated('sourceId')) {
		ret.source = ret.sourceId;
		delete ret.sourceId;
	}

	if (cache.populated('statusId')) {
		ret.status = ret.statusId;
		delete ret.status;
	}

	var path = options.path ? options.path : "";
  ret.url = [path, cache.id].join("/");
}

CacheSchema.set("toJSON", {
  transform: transform
});

var Cache = mongoose.model('Cache', CacheSchema);
exports.cacheModel = Cache;

function getSourceByUrlAndFormat(url, format, callback) {
  var query = {
	  'format': format,
		'url': url
  };
  Source.findOne(query).exec(function(err, source) {
    if (err) {
      console.log("Error finding cache in mongo: " + id + ', error: ' + err);
    }
    callback(err, source);
  });
}

exports.getCaches = function(callback) {
	var query = {};
	Cache.find(query).populate('sourceId').exec(function(err, caches) {
    if (err) {
      console.log("Error finding caches in mongo: " + id + ', error: ' + err);
    }
    callback(err, caches);
  });
}

exports.getCacheById = function(id, callback) {
  Cache.findById(id).populate('sourceId').exec(function(err, cache) {
    if (err) {
      console.log("Error finding cache in mongo: " + id + ', error: ' + err);
    }
    callback(err, cache);
  });
}

exports.createCache = function(cache, callback) {
	if (cache.sourceId) {
		Cache.create(cache, function(err, newCache) {
			callback(err, newCache);
		});
		return;
	}

	Source.getSources({url: cache.source.url, format: cache.source.format}, function(err, sources) {
		if (sources) {
			console.log(sources);
			var source = sources[0];
			cache.sourceId = source._id;
			Cache.create(cache, function(err, newCache) {
				if (err) return callback(err);
				newCache.source = source;
				callback(err, newCache);
			});
		} else {
			Source.create(cache.source, function(err, newSource) {
				if (err) return callback(err);
				cache.sourceId = newSource._id;
				Cache.create(cache, function(err, newCache) {
					if (err) return callback(err);
					newCache.source = newSource;
					callback(err, newCache);
				});
			});
		}
	});
}

exports.updateZoomLevelStatus = function(cache, zoomLevel, complete, callback) {
	var update = {};
	update['status.zoomLevelStatus.'+zoomLevel+'.complete'] = true;
	Cache.findByIdAndUpdate(cache._id, {'$set':update}, callback);
}

exports.updateTileDownloaded = function(cache, z, x, y, callback) {
	fs.stat(config.server.cacheDirectory.path + "/" + cache._id + '/' + z + '/' + x + '/' + y + '.png', function(err, stat) {
		var update = {$inc: {}};
		update.$inc['status.zoomLevelStatus.'+z+'.generatedTiles'] = 1;
		update.$inc['status.generatedTiles'] = 1;
		update.$inc['status.zoomLevelStatus.'+z+'.size'] = stat.size;
		Cache.findByIdAndUpdate(cache._id, update, callback);
	});
}
