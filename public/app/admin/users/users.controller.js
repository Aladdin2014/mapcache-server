angular
  .module('userManagement')
  .controller('AdminUsersController', AdminUsersController);

AdminUsersController.$inject = ['$scope', '$injector', '$filter', 'LocalStorageService', 'UserService'];

function AdminUsersController($scope, $injector, $filter, LocalStorageService, UserService) {
  $scope.token = LocalStorageService.getToken();
  $scope.filter = "all"; // possible values all, active, inactive
  $scope.users = [];
  $scope.roles = [];
  $scope.page = 0;
  $scope.itemsPerPage = 10;

  UserService.getRoles().success(function (roles) {
    $scope.roles = roles;
  });

  UserService.getAllUsers(true).success(function(users) {
    $scope.users = users;
  });

  $scope.filterActive = function (user) {
    switch ($scope.filter) {
      case 'all': return true;
      case 'active': return user.active;
      case 'inactive': return !user.active;
    }
  }

  $scope.newUser = function() {
    $scope.user = {};
  }

  $scope.editUser = function(user) {
    $scope.edit = false;

    // TODO temp code to convert array of phones to one phone
    if (user.phones && user.phones.length > 0) {
      user.phone = user.phones[0].number;
    }

    $scope.user = user;
  }

  var debounceHideSave = _.debounce(function() {
    $scope.$apply(function() {
      $scope.saved = false;
    });
  }, 5000);

  $scope.saveUser = function () {
    $scope.saving = true;
    $scope.error = false;

    var user = {
      username: $scope.user.username,
      firstname: $scope.user.firstname,
      lastname: $scope.user.lastname,
      email: $scope.user.email,
      phone: $scope.user.phone,
      password: this.user.password,
      passwordconfirm: this.user.passwordconfirm,
      roleId: $scope.user.roleId
    };

    var failure = function(response) {
      $scope.$apply(function() {
        $scope.saving = false;
        $scope.error = response.responseText;
      });
    }

    var progress = function(e) {
      if(e.lengthComputable){
        $scope.$apply(function() {
          $scope.uploading = true;
          $scope.uploadProgress = (e.loaded/e.total) * 100;
        });
      }
    }

    if ($scope.user.id) {
      UserService.updateUser($scope.user.id, user, function(response) {
        $scope.$apply(function() {
          $scope.saved = true;
          $scope.saving = false;
          debounceHideSave();
        });
      }, failure, progress);
    } else {
      UserService.createUser(user, function(response) {
        $scope.$apply(function() {
          $scope.saved = true;
          $scope.saving = false;
          debounceHideSave();
          $scope.users.push(response);
        });
      }, failure, progress);
    }
  }

  $scope.deleteUser = function(user) {
    var modalInstance = $injector.get('$modal').open({
      templateUrl: '/app/admin/users/user-delete.html',
      resolve: {
        user: function () {
          return user;
        }
      },
      controller: ['$scope', '$modalInstance', 'user', function ($scope, $modalInstance, user) {
        $scope.user = user;

        $scope.deleteUser = function(user, force) {
          UserService.deleteUser(user).success(function() {
            $modalInstance.close(user);
          });
        }
        $scope.cancel = function () {
          $modalInstance.dismiss('cancel');
        };
      }]
    });

    modalInstance.result.then(function(user) {
      $scope.user = null;
      $scope.users = _.reject($scope.users, function(u) { return u.id == user.id});
    });
  }

  $scope.refresh = function() {
    $scope.users = [];
    UserService.getAllUsers(true).success(function (users) {
      $scope.users = users;
    });
  }

  /* shortcut for giving a user the USER_ROLE */
  $scope.activateUser = function (user) {
    user.active = true;
    UserService.updateUser(user.id, user, function(response) {
      $scope.$apply(function() {
        $scope.saved = true;
        debounceHideSave();
      });
    }, function(response) {
      $scope.$apply(function() {
        $scope.error = response.responseText;
      });
    });
  }
}
