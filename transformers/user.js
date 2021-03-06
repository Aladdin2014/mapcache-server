var util = require('util')
  , User = require('mapcache-models').User;

var transformUser = function(user, options) {
  if (!user) return null;

  user = user.toObject ? user.toObject({path: options.path, transform: User.transform}) : user;

  return user;
};

var transformUsers = function(users, options) {
  users = users.map(function(user) {
    return transformUser(user, options);
  });

  return users;
};

exports.transform = function(users, options) {
  options = options || {};

  return util.isArray(users) ? transformUsers(users, options) : transformUser(users, options);
};
