// (C) Copyright 2015 Moodle Pty Ltd.
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

import { CoreConstants } from '@/core/constants';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { CoreCourse, CoreCourseProvider } from '@features/course/services/course';
import {
    CoreCourseHelper,
    CoreCourseModuleData,
    CoreCourseSectionWithStatus,
    CorePrefetchStatusInfo,
} from '@features/course/services/course-helper';
import {
    CoreCourseModulePrefetchDelegate,
    CoreCourseModulePrefetchHandler } from '@features/course/services/module-prefetch-delegate';
import { CoreCourses } from '@features/courses/services/courses';
import { CoreNavigator } from '@services/navigator';
import { CoreSites } from '@services/sites';
import { CoreDomUtils } from '@services/utils/dom';
import { CoreUtils } from '@services/utils/utils';
import { Translate } from '@singletons';
import { CoreEventObserver, CoreEvents } from '@singletons/events';

/**
 * Page that displays the amount of file storage used by each activity on the course, and allows
 * the user to prefecth and delete this data.
 */
@Component({
    selector: 'page-addon-storagemanager-course-storage',
    templateUrl: 'course-storage.html',
    styleUrls: ['course-storage.scss'],
})
export class AddonStorageManagerCourseStoragePage implements OnInit, OnDestroy {

    courseId!: number;
    title = '';
    loaded = false;
    sections: AddonStorageManagerCourseSection[] = [];
    totalSize = 0;

    downloadEnabled = false;
    downloadCourseEnabled = false;

    prefetchCourseData: CorePrefetchStatusInfo = {
        icon: CoreConstants.ICON_LOADING,
        statusTranslatable: 'core.course.downloadcourse',
        status: '',
        loading: true,
    };

    protected siteUpdatedObserver?: CoreEventObserver;
    protected courseStatusObserver?: CoreEventObserver;
    protected sectionStatusObserver?: CoreEventObserver;
    protected moduleStatusObserver?: CoreEventObserver;
    protected isDestroyed = false;
    protected isGuest = false;

    constructor() {
        // Refresh the enabled flags if site is updated.
        this.siteUpdatedObserver = CoreEvents.on(CoreEvents.SITE_UPDATED, () => {
            this.downloadCourseEnabled = !CoreCourses.isDownloadCourseDisabledInSite();
            this.downloadEnabled = !CoreSites.getRequiredCurrentSite().isOfflineDisabled();

            this.initCoursePrefetch();
            this.initModulePrefetch();
        }, CoreSites.getCurrentSiteId());
    }

    /**
     * @inheritdoc
     */
    async ngOnInit(): Promise<void> {
        try {
            this.courseId = CoreNavigator.getRequiredRouteParam('courseId');
        } catch (error) {
            CoreDomUtils.showErrorModal(error);

            CoreNavigator.back();

            return;
        }

        this.title = CoreNavigator.getRouteParam<string>('title') || '';
        if (!this.title && this.courseId == CoreSites.getCurrentSiteHomeId()) {
            this.title = Translate.instant('core.sitehome.sitehome');
        }

        this.isGuest = !!CoreNavigator.getRouteBooleanParam('isGuest');

        this.downloadCourseEnabled = !CoreCourses.isDownloadCourseDisabledInSite();
        this.downloadEnabled = !CoreSites.getRequiredCurrentSite().isOfflineDisabled();

        const sections = await CoreCourse.getSections(this.courseId, false, true);
        this.sections = (await CoreCourseHelper.addHandlerDataForModules(sections, this.courseId)).sections
            .map((section) => ({ ...section, totalSize: 0 }));

        await Promise.all([
            this.loadSizes(),
            this.initCoursePrefetch(),
            this.initModulePrefetch(),
        ]);

        this.loaded = true;
    }

    /**
     * Init course prefetch information.
     *
     * @return Promise resolved when done.
     */
    protected async initCoursePrefetch(): Promise<void> {
        if (!this.downloadCourseEnabled || this.courseStatusObserver) {
            return;
        }

        // Listen for changes in course status.
        this.courseStatusObserver = CoreEvents.on(CoreEvents.COURSE_STATUS_CHANGED, (data) => {
            if (data.courseId == this.courseId || data.courseId == CoreCourseProvider.ALL_COURSES_CLEARED) {
                this.updateCourseStatus(data.status);
            }
        }, CoreSites.getCurrentSiteId());

        // Determine the course prefetch status.
        await this.determineCoursePrefetchIcon();

        if (this.prefetchCourseData.icon != CoreConstants.ICON_LOADING) {
            return;
        }

        // Course is being downloaded. Get the download promise.
        const promise = CoreCourseHelper.getCourseDownloadPromise(this.courseId);
        if (promise) {
            // There is a download promise. Show an error if it fails.
            promise.catch((error) => {
                if (!this.isDestroyed) {
                    CoreDomUtils.showErrorModalDefault(error, 'core.course.errordownloadingcourse', true);
                }
            });
        } else {
            // No download, this probably means that the app was closed while downloading. Set previous status.
            const status = await CoreCourse.setCoursePreviousStatus(this.courseId);

            this.updateCourseStatus(status);
        }
    }

    /**
     * Init module prefetch information.
     *
     * @return Promise resolved when done.
     */
    protected async initModulePrefetch(): Promise<void> {
        if (!this.downloadEnabled || this.sectionStatusObserver) {
            return;
        }

        // Listen for section status changes.
        this.sectionStatusObserver = CoreEvents.on(
            CoreEvents.SECTION_STATUS_CHANGED,
            async (data) => {
                if (!this.downloadEnabled || !this.sections.length || !data.sectionId || data.courseId != this.courseId) {
                    return;
                }

                // Check if the affected section is being downloaded.
                // If so, we don't update section status because it'll already be updated when the download finishes.
                const downloadId = CoreCourseHelper.getSectionDownloadId({ id: data.sectionId });
                if (CoreCourseModulePrefetchDelegate.isBeingDownloaded(downloadId)) {
                    return;
                }

                // Get the affected section.
                const section = this.sections.find(section => section.id == data.sectionId);
                if (!section) {
                    return;
                }

                // Recalculate the status.
                await CoreCourseHelper.calculateSectionStatus(section, this.courseId, false);

                if (section.isDownloading && !CoreCourseModulePrefetchDelegate.isBeingDownloaded(downloadId)) {
                    // All the modules are now downloading, set a download all promise.
                    this.prefecthSection(section);
                }
            },
            CoreSites.getCurrentSiteId(),
        );

        // The download status of a section might have been changed from within a module page.
        CoreCourseHelper.calculateSectionsStatus(this.sections, this.courseId, false, false);

        this.sections.forEach((section) => {
            section.modules.forEach((module) => {
                if (module.handlerData?.showDownloadButton) {

                    module.spinner = true;
                    // Listen for changes on this module status, even if download isn't enabled.
                    module.prefetchHandler = CoreCourseModulePrefetchDelegate.getPrefetchHandlerFor(module.modname);
                    this.calculateModuleStatus(module);
                }
            });
        });

        this.moduleStatusObserver = CoreEvents.on(CoreEvents.PACKAGE_STATUS_CHANGED, (data) => {
            let module: AddonStorageManagerModule | undefined;

            this.sections.some((section) => {
                module = section.modules.find((module) =>
                    module.id == data.componentId && module.prefetchHandler && data.component == module.prefetchHandler?.component);

                return !!module;
            });

            if (!module) {
                return;
            }

            // Call determineModuleStatus to get the right status to display.
            const status = CoreCourseModulePrefetchDelegate.determineModuleStatus(module, data.status);

            // Update the status.
            this.updateModuleStatus(module, status);
        }, CoreSites.getCurrentSiteId());
    }

    /**
     * Init section, course and modules sizes.
     */
    protected async loadSizes(): Promise<void> {
        this.totalSize = 0;

        const promises: Promise<void>[] = [];
        this.sections.forEach((section) => {
            section.totalSize = 0;
            section.modules.forEach((module) => {
                module.totalSize = 0;

                // Note: This function only gets the size for modules which are downloadable.
                // For other modules it always returns 0, even if they have downloaded some files.
                // However there is no 100% reliable way to actually track the files in this case.
                // You can maybe guess it based on the component and componentid.
                // But these aren't necessarily consistent, for example mod_frog vs mmaModFrog.
                // There is nothing enforcing correct values.
                // Most modules which have large files are downloadable, so I think this is sufficient.
                const promise = CoreCourseModulePrefetchDelegate.getModuleStoredSize(module, this.courseId).then((size) => {
                    // There are some cases where the return from this is not a valid number.
                    if (!isNaN(size)) {
                        module.totalSize = Number(size);
                        section.totalSize += size;
                        this.totalSize += size;
                    }

                    return;
                });
                promises.push(promise);
            });
        });

        await Promise.all(promises);

        // Mark course as not downloaded if course size is 0.
        if (this.totalSize == 0) {
            this.markCourseAsNotDownloaded();
        }
    }

    /**
     * The user has requested a delete for the whole course data.
     *
     * (This works by deleting data for each module on the course that has data.)
     */
    async deleteForCourse(): Promise<void> {
        try {
            await CoreDomUtils.showDeleteConfirm('core.course.confirmdeletestoreddata');
        } catch (error) {
            if (!CoreDomUtils.isCanceledError(error)) {
                throw error;
            }

            return;
        }

        const modules: AddonStorageManagerModule[] = [];
        this.sections.forEach((section) => {
            section.modules.forEach((module) => {
                if (module.totalSize && module.totalSize > 0) {
                    modules.push(module);
                }
            });
        });

        this.deleteModules(modules);
    }

    /**
     * The user has requested a delete for a section's data.
     *
     * (This works by deleting data for each module in the section that has data.)
     *
     * @param section Section object with information about section and modules
     */
    async deleteForSection(section: AddonStorageManagerCourseSection): Promise<void> {
        try {
            await CoreDomUtils.showDeleteConfirm('core.course.confirmdeletestoreddata');
        } catch (error) {
            if (!CoreDomUtils.isCanceledError(error)) {
                throw error;
            }

            return;
        }

        const modules: AddonStorageManagerModule[] = [];
        section.modules.forEach((module) => {
            if (module.totalSize && module.totalSize > 0) {
                modules.push(module);
            }
        });

        this.deleteModules(modules, section);
    }

    /**
     * The user has requested a delete for a module's data
     *
     * @param module Module details
     * @param section Section the module belongs to.
     */
    async deleteForModule(module: AddonStorageManagerModule, section: AddonStorageManagerCourseSection): Promise<void> {
        if (module.totalSize === 0) {
            return;
        }

        try {
            await CoreDomUtils.showDeleteConfirm('core.course.confirmdeletestoreddata');
        } catch (error) {
            if (!CoreDomUtils.isCanceledError(error)) {
                throw error;
            }

            return;
        }

        this.deleteModules([module], section);
    }

    /**
     * Deletes the specified modules, showing the loading overlay while it happens.
     *
     * @param modules Modules to delete
     * @param section Section the modules belong to.
     * @return Promise<void> Once deleting has finished
     */
    protected async deleteModules(modules: AddonStorageManagerModule[], section?: AddonStorageManagerCourseSection): Promise<void> {
        const modal = await CoreDomUtils.showModalLoading();

        const promises: Promise<void>[] = [];
        modules.forEach((module) => {
            // Remove the files.
            const promise = CoreCourseHelper.removeModuleStoredData(module, this.courseId).then(() => {
                const moduleSize = module.totalSize || 0;
                // When the files and cache are removed, update the size.
                if (section) {
                    section.totalSize -= moduleSize;
                }
                this.totalSize -= moduleSize;
                module.totalSize = 0;

                return;
            });

            promises.push(promise);
        });

        try {
            await Promise.all(promises);
        } catch (error) {
            CoreDomUtils.showErrorModalDefault(error, Translate.instant('core.errordeletefile'));
        } finally {
            modal.dismiss();

            await this.loadSizes();
            CoreCourseHelper.calculateSectionsStatus(this.sections, this.courseId, false, false);
        }
    }

    /**
     * Mark course as not downloaded.
     */
    protected markCourseAsNotDownloaded(): void {
        // @TODO This is a workaround that should be more specific solving MOBILE-3305.
        // Also should take into account all modules are not downloaded.
        // Check after MOBILE-3188 is integrated.

        CoreCourse.setCourseStatus(this.courseId, CoreConstants.NOT_DOWNLOADED);
    }

    /**
     * Calculate the status of sections.
     *
     * @param refresh If refresh or not.
     */
    protected calculateSectionsStatus(refresh?: boolean): void {
        if (!this.sections) {
            return;
        }

        CoreUtils.ignoreErrors(CoreCourseHelper.calculateSectionsStatus(this.sections, this.courseId, refresh));
    }

    /**
     * Confirm and prefetch a section. If the section is "all sections", prefetch all the sections.
     *
     * @param section Section to download.
     * @param refresh Refresh clicked (not used).
     */
    async prefecthSection(section: AddonStorageManagerCourseSection): Promise<void> {
        section.isCalculating = true;

        try {
            await CoreCourseHelper.confirmDownloadSizeSection(this.courseId, section, this.sections);

            try {
                await CoreCourseHelper.prefetchSection(section, this.courseId, this.sections);

            } catch (error) {
                if (!this.isDestroyed) {
                    CoreDomUtils.showErrorModalDefault(error, 'core.course.errordownloadingsection', true);
                }
            } finally {
                await this.loadSizes();
            }
        } catch (error) {
            // User cancelled or there was an error calculating the size.
            if (!this.isDestroyed && error) {
                CoreDomUtils.showErrorModal(error);

                return;
            }
        } finally {
            section.isCalculating = false;
        }
    }

    /**
     * Download the module.
     *
     * @param module Module to prefetch.
     * @param refresh Whether it's refreshing.
     * @return Promise resolved when done.
     */
    async prefetchModule(
        module: AddonStorageManagerModule,
        refresh = false,
    ): Promise<void> {
        if (!module.prefetchHandler) {
            return;
        }

        // Show spinner since this operation might take a while.
        module.spinner = true;

        try {
            // Get download size to ask for confirm if it's high.
            const size = await module.prefetchHandler.getDownloadSize(module, module.course, true);

            await CoreCourseHelper.prefetchModule(module.prefetchHandler, module, size, module.course, refresh);

            CoreCourseHelper.calculateSectionsStatus(this.sections, this.courseId, false, false);
        } catch (error) {
            if (!this.isDestroyed) {
                CoreDomUtils.showErrorModalDefault(error, 'core.errordownloading', true);
            }
        } finally {
            module.spinner = false;

            await this.loadSizes();
        }
    }

    /**
     * Show download buttons according to module status.
     *
     * @param module Module to update.
     * @param status Module status.
     */
    protected updateModuleStatus(module: AddonStorageManagerModule, status: string): void {
        if (!status) {
            return;
        }

        module.spinner = false;
        module.downloadStatus = status;

        module.handlerData?.updateStatus?.(status);
    }

    /**
     * Calculate and show module status.
     *
     * @param module Module to update.
     * @return Promise resolved when done.
     */
    protected async calculateModuleStatus(module: AddonStorageManagerModule): Promise<void> {
        if (!module) {
            return;
        }

        const status = await CoreCourseModulePrefetchDelegate.getModuleStatus(module, this.courseId);

        this.updateModuleStatus(module, status);
    }

    /**
     * Determines the prefetch icon of the course.
     *
     * @return Promise resolved when done.
     */
    protected async determineCoursePrefetchIcon(): Promise<void> {
        this.prefetchCourseData = await CoreCourseHelper.getCourseStatusIconAndTitle(this.courseId);
    }

    /**
     * Update the course status icon and title.
     *
     * @param status Status to show.
     */
    protected updateCourseStatus(status: string): void {
        const statusData = CoreCourseHelper.getCoursePrefetchStatusInfo(status);

        this.prefetchCourseData.status = statusData.status;
        this.prefetchCourseData.icon = statusData.icon;
        this.prefetchCourseData.statusTranslatable = statusData.statusTranslatable;
        this.prefetchCourseData.loading = statusData.loading;
    }

    /**
     * Prefetch the whole course.
     */
    async prefetchCourse(): Promise<void> {
        const courses = await CoreCourses.getUserCourses(true);
        let course = courses.find((course) => course.id == this.courseId);
        if (!course) {
            course = await CoreCourses.getCourse(this.courseId);
        }
        if (!course) {
            return;
        }

        try {
            await CoreCourseHelper.confirmAndPrefetchCourse(
                this.prefetchCourseData,
                course,
                {
                    sections: this.sections,
                    isGuest: this.isGuest,
                },
            );
        } catch (error) {
            if (this.isDestroyed) {
                return;
            }

            CoreDomUtils.showErrorModalDefault(error, 'core.course.errordownloadingcourse', true);
        }
    }

    /**
     * @inheritdoc
     */
    ngOnDestroy(): void {
        this.courseStatusObserver?.off();
        this.sectionStatusObserver?.off();
        this.moduleStatusObserver?.off();
        this.siteUpdatedObserver?.off();

        this.sections.forEach((section) => {
            section.modules.forEach((module) => {
                module.handlerData?.onDestroy?.();
            });
        });
        this.isDestroyed = true;
    }

}

type AddonStorageManagerCourseSection = Omit<CoreCourseSectionWithStatus, 'modules'> & {
    totalSize: number;
    modules: AddonStorageManagerModule[];
};

type AddonStorageManagerModule = CoreCourseModuleData & {
    totalSize?: number;
    prefetchHandler?: CoreCourseModulePrefetchHandler;
    spinner?: boolean;
    downloadStatus?: string;
};
