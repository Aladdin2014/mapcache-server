var assert = require('assert')
  , turf = require('turf')
  , fs = require('fs-extra')
  , lengthStream = require('length-stream')
  , devnull = require('dev-null')
  , path = require('path')
  , Cache = require('../../cache/cache')
  , should = require('should');

var osmDataSource = {
  id: 'test-ds',
  name: 'osm',
  url: 'http://osm.geointapps.org/osm',
  format: 'xyz',
  zOrder: 0
};

var mapboxDataSource = {
  id: 'test-mapbox-ds',
  name: 'mapbox',
  url: 'http://mapbox.geointapps.org:2999/v4/mapbox.light',
  format: 'xyz',
  zOrder: 1
};

var map = {
  id: 'test-map',
  dataSources: [osmDataSource, mapboxDataSource]
};

var cache = {
  id: 'test-cache',
  name: 'osm test cache',
  geometry: turf.polygon([[
    [-179, -85],
    [-179, 85],
    [179, 85],
    [179, -85],
    [-179, -85]
  ]]),
  minZoom: 0,
  maxZoom: 2,
  formats: ['xyz'],
  source: map,
  cacheCreationParams: {
    dataSources: ['test-ds']
  },
  outputDirectory: '/tmp'
};

var XYZ = require('../../format/xyz');

describe('xyz', function() {
  describe('#constructor', function () {
    it('should construct an Xyz with a source', function () {
      var xyz = new XYZ({source: {id: '5'}, outputDirectory:'/tmp'});
      xyz.source.id.should.equal('5');
    });
    it('should construct an Xyz with a cache', function() {
      var xyz = new XYZ({cache: {id: '6'}, outputDirectory:'/tmp'});
      xyz.cache.id.should.equal('6');
    })
  });

  describe('source tests', function() {
    var xyz;
    before(function() {
      xyz = new XYZ({
        source: osmDataSource,
        outputDirectory:'/tmp'
      });
    });
    it('should process the source', function(done) {
      xyz.processSource(function(err, newSource) {
        if(err) {
          return done(err);
        }
        newSource.status.message.should.equal("Complete");
        done();
      });
    });
    it('should pull the 0/0/0 tile for the data source', function(done) {
      xyz.getTile('png', 0, 0, 0, {}, function(err, tileRequest) {
        if (err) {
          done(err);
          return;
        }

        tileRequest.on('response', function(response) {
          try {
            response.statusCode.should.equal(200);
            var size = response.headers['content-length'];
            size.should.be.greaterThan(0);
            response.headers['content-type'].should.equal('image/png');
            done();
          } catch (e) {
            done(e);
          }
        })
        .on('error', function(err) {
          console.log('tile request error', err);
          done(err);
        });
      });
    });
  });

  describe('cache tests', function() {
    var xyz;
    before(function(done) {
      var cacheObj = new Cache(cache);
      cacheObj.callbackWhenInitialized(function(err, cacheObj) {
        xyz = new XYZ({
          cache: cacheObj,
          outputDirectory:cache.outputDirectory
        });
        done();
      });
    });
    after(function(done) {
      fs.remove(path.join(cache.outputDirectory, cache.id), function(err) {
        fs.remove(path.join(cache.outputDirectory, map.id), function(err) {
          done(err);
        });
      });
    });
    it('should pull the 0/0/0 tile for the cache', function(done) {
      xyz.getTile('png', 0, 0, 0, {noCache: true}, function(err, stream) {
        if (err) {
          done(err);
          return;
        }

        done();

        var lstream = lengthStream(function(length) {
          length.should.be.greaterThan(0);
          done();
        });
        stream.pipe(lstream).pipe(devnull());

      });
    });
    it('should generate the cache', function(done) {
      this.timeout(0);
      xyz.generateCache(function(err, cache) {
        console.log('done', cache);
        done();
      }, function(cache, callback) {
        console.log('progress', cache);
        callback(null, cache);
      })
    });
    it('should generate the cache then download the format', function(done) {
      this.timeout(10000);
      xyz.generateCache(function(err, cache) {
        console.log('done', cache);
        xyz.getData(cache.minZoom, cache.maxZoom, function(err, status) {
          should.exist(status.stream);
          done();
        });
      }, function(cache, callback) {
        console.log('progress', cache);
        callback(null, cache);
      })
    });
    it('should generate the cache then delete the format', function(done) {
      this.timeout(10000);
      xyz.generateCache(function(err, cache) {
        console.log('done', cache);
        xyz.delete(done);
      }, function(cache, callback) {
        console.log('progress', cache);
        callback(null, cache);
      })
    });
  });
});
