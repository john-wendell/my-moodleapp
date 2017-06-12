// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

angular.module('mm.addons.mod_data')

/**
 * Data index controller.
 *
 * @module mm.addons.mod_data
 * @ngdoc controller
 * @name mmaModDataIndexCtrl
 */
.controller('mmaModDataIndexCtrl', function($scope, $stateParams, $mmaModData, mmaModDataComponent, $mmCourse, $mmCourseHelper, $q,
        $mmText, $translate, $mmEvents, mmCoreEventOnlineStatusChanged, $mmApp, $mmUtil, $mmSite, $mmaModDataHelper, $mmGroups) {

    var module = $stateParams.module || {},
        courseId = $stateParams.courseid,
        data,
        onlineObserver;

    $scope.title = module.name;
    $scope.description = module.description;
    $scope.moduleUrl = module.url;
    $scope.moduleName = $mmCourse.translateModuleName('data');
    $scope.refreshIcon = 'spinner';
    $scope.syncIcon = 'spinner';
    $scope.component = mmaModDataComponent;
    $scope.databaseLoaded = false;
    $scope.selectedGroup = $stateParams.group || 0;

    function fetchDatabaseData(refresh, sync, showErrors) {
        $scope.isOnline = $mmApp.isOnline();

        return $mmaModData.getDatabase(courseId, module.id).then(function(databaseData) {
            data = databaseData;

            $scope.title = data.name || $scope.title;
            $scope.description = data.intro || $scope.description;
            $scope.data = databaseData;

            $scope.database = data;

            return $mmaModData.getDatabaseAccessInformation(data.id);

        }).then(function(accessData) {
            $scope.access = accessData;

            if (!accessData.timeavailable) {
                var time = $mmUtil.timestamp();

                $scope.timeAvailableFrom = data.timeavailablefrom && time < data.timeavailablefrom ?
                    parseInt(data.timeavailablefrom, 10) * 1000 : false;
                $scope.timeAvailableFromReadable = $scope.timeAvailableFrom ?
                    moment($scope.timeAvailableFrom).format('LLL') : false;
                $scope.timeAvailableTo = data.timeavailableto && time > data.timeavailableto ?
                    parseInt(data.timeavailableto, 10) * 1000 : false;
                $scope.timeAvailableToReadable = $scope.timeAvailableTo ? moment($scope.timeAvailableTo).format('LLL') : false;

                $scope.isEmpty = true;
                $scope.groupInfo = false;
                return false;
            }

            return $mmGroups.getActivityGroupInfo(data.coursemodule, accessData.canmanageentries).then(function(groupInfo) {
                $scope.groupInfo = groupInfo;

                // Check selected group is accessible.
                if (groupInfo && groupInfo.groups && groupInfo.groups.length > 0) {
                    var found = false;
                    for (var x in groupInfo.groups) {
                        if (groupInfo.groups[x].id == $scope.selectedGroup) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        $scope.selectedGroup = groupInfo.groups[0].id;
                    }
                }

                return fetchEntriesData();
            });
        }).then(function() {
            // All data obtained, now fill the context menu.
            $mmCourseHelper.fillContextMenu($scope, module, courseId, refresh, mmaModDataComponent);
        }).catch(function(message) {
            if (!refresh) {
                // Some call failed, retry without using cache since it might be a new activity.
                return refreshAllData();
            }

            $mmUtil.showErrorModalDefault(message, 'mm.course.errorgetmodule', true);
            return $q.reject();
        }).finally(function(){
            $scope.databaseLoaded = true;
        });
    }

    function fetchEntriesData() {
        return $mmaModData.getDatabaseAccessInformation(data.id, $scope.selectedGroup).then(function(accessData) {
            // Update values for current group.
            $scope.access.canaddentry = accessData.canaddentry;

            return $mmaModData.getEntries(data.id, $scope.selectedGroup).then(function(entries) {
                $scope.isEmpty = !entries || entries.entries.length <= 0;
                $scope.entries = "";

                if (!$scope.isEmpty) {
                    $scope.cssTemplate = $mmaModDataHelper.prefixCSS(data.csstemplate, '.mma-data-entries-' + data.id);
                    $scope.entries = entries.listviewcontents;
                }
            });
        });
    }


    // Set group to see the database.
    $scope.setGroup = function(groupId) {
        $scope.selectedGroup = groupId;
        return fetchEntriesData().catch(function(message) {
            $mmUtil.showErrorModalDefault(message, 'mm.course.errorgetmodule', true);
            return $q.reject();
        });
    };

    // Convenience function to refresh all the data.
    function refreshAllData(sync, showErrors) {
        var promises = [];

        promises.push($mmaModData.invalidateDatabaseData(courseId));
        if (data) {
            promises.push($mmaModData.invalidateDatabaseAccessInformationData(data.id));
            promises.push($mmGroups.invalidateActivityGroupInfo(data.coursemodule));
            promises.push($mmaModData.invalidateEntriesData(data.id));
        }

        return $q.all(promises).finally(function() {
            return fetchDatabaseData(true, sync, showErrors);
        });
    }

    fetchDatabaseData(false, true).then(function() {
        $mmaModData.logView(data.id).then(function() {
            $mmCourse.checkModuleCompletion(courseId, module.completionstatus);
        });
    }).finally(function() {
        $scope.refreshIcon = 'ion-refresh';
        $scope.syncIcon = 'ion-loop';
    });

    // Confirm and Remove action.
    $scope.removeFiles = function() {
        $mmCourseHelper.confirmAndRemove(module, courseId);
    };

    // Context Menu Prefetch action.
    $scope.prefetch = function() {
        $mmCourseHelper.contextMenuPrefetch($scope, module, courseId);
    };
    // Context Menu Description action.
    $scope.expandDescription = function() {
        $mmText.expandText($translate.instant('mm.core.description'), $scope.description, false, mmaModDataComponent, module.id);
    };

    // Pull to refresh.
    $scope.refreshDatabase = function(showErrors) {
        if ($scope.databaseLoaded) {
            $scope.refreshIcon = 'spinner';
            $scope.syncIcon = 'spinner';
            return refreshAllData(true, showErrors).finally(function() {
                $scope.refreshIcon = 'ion-refresh';
                $scope.syncIcon = 'ion-loop';
                $scope.$broadcast('scroll.refreshComplete');
            });
        }
    };

    // Opens search.
    $scope.gotoSearch = function() {
        $mmUtil.openInApp($mmSite.getURL() + '/mod/data/view.php?mode=asearch&d=' + data.id);
    };

    // Opens add entries form
    $scope.gotoAddEntries = function() {
        $mmUtil.openInApp($mmSite.getURL() + '/mod/data/edit.php?d=' + data.id);
    };

    // Refresh online status when changes.
    onlineObserver = $mmEvents.on(mmCoreEventOnlineStatusChanged, function(online) {
        $scope.isOnline = online;
    });

    $scope.$on('$destroy', function() {
        onlineObserver && onlineObserver.off && onlineObserver.off();
    });
});
