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

import { Injectable } from '@angular/core';
// import { PopoverController } from '@ionic/angular';
import { CoreUtils } from '@services/utils/utils';
import { CoreSites } from '@services/sites';
import { CoreCourses, CoreCourseSearchedData, CoreCourseUserAdminOrNavOptionIndexed, CoreEnrolledCourseData } from './courses';
import { makeSingleton } from '@singletons/core.singletons';
import { CoreWSExternalFile } from '@services/ws';
// import { AddonCourseCompletionProvider } from '@addon/coursecompletion/providers/coursecompletion';
// import { CoreCoursePickerMenuPopoverComponent } from '@components/course-picker-menu/course-picker-menu-popover';

/**
 * Helper to gather some common courses functions.
 */
@Injectable({
    providedIn: 'root',
})
export class CoreCoursesHelperProvider {

    /**
     * Get the courses to display the course picker popover. If a courseId is specified, it will also return its categoryId.
     *
     * @param courseId Course ID to get the category.
     * @return Promise resolved with the list of courses and the category.
     */
    async getCoursesForPopover(): Promise<void> {
        // @todo params and logic
    }

    /**
     * Given a course object returned by core_enrol_get_users_courses and another one returned by core_course_get_courses_by_field,
     * load some extra data to the first one.
     *
     * @param course Course returned by core_enrol_get_users_courses.
     * @param courseByField Course returned by core_course_get_courses_by_field.
     * @param addCategoryName Whether add category name or not.
     */
    loadCourseExtraInfo(
        course: CoreEnrolledCourseDataWithExtraInfo,
        courseByField: CoreCourseSearchedData,
        addCategoryName: boolean = false,
        colors?: (string | undefined)[],
    ): void {
        if (courseByField) {
            course.displayname = courseByField.displayname;
            course.categoryname = addCategoryName ? courseByField.categoryname : undefined;
            course.overviewfiles = course.overviewfiles || courseByField.overviewfiles;
        } else {
            delete course.displayname;
        }

        this.loadCourseColorAndImage(course, colors);
    }

    /**
     * Given a list of courses returned by core_enrol_get_users_courses, load some extra data using the WebService
     * core_course_get_courses_by_field if available.
     *
     * @param courses List of courses.
     * @param loadCategoryNames Whether load category names or not.
     * @return Promise resolved when done.
     */
    async loadCoursesExtraInfo(courses: CoreEnrolledCourseDataWithExtraInfo[], loadCategoryNames: boolean = false): Promise<void> {
        if (!courses.length ) {
            // No courses or cannot get the data, stop.
            return;
        }

        let coursesInfo = {};
        let courseInfoAvailable = false;

        const promises: Promise<void>[] = [];
        let colors: (string | undefined)[] = [];

        promises.push(this.loadCourseSiteColors().then((loadedColors) => {
            colors = loadedColors;

            return;
        }));

        if (CoreCourses.instance.isGetCoursesByFieldAvailable() && (loadCategoryNames ||
                (typeof courses[0].overviewfiles == 'undefined' && typeof courses[0].displayname == 'undefined'))) {
            const courseIds = courses.map((course) => course.id).join(',');

            courseInfoAvailable = true;

            // Get the extra data for the courses.
            promises.push(CoreCourses.instance.getCoursesByField('ids', courseIds).then((coursesInfos) => {
                coursesInfo = CoreUtils.instance.arrayToObject(coursesInfos, 'id');

                return;
            }));
        }

        await Promise.all(promises);

        courses.forEach((course) => {
            this.loadCourseExtraInfo(course, courseInfoAvailable ? coursesInfo[course.id] : course, loadCategoryNames, colors);
        });
    }

    /**
     * Load course colors from site config.
     *
     * @return course colors RGB.
     */
    protected async loadCourseSiteColors(): Promise<(string | undefined)[]> {
        const site = CoreSites.instance.getCurrentSite();
        const colors: (string | undefined)[] = [];

        if (site?.isVersionGreaterEqualThan('3.8')) {
            try {
                const configs = await site.getConfig();
                for (let x = 0; x < 10; x++) {
                    colors[x] = configs['core_admin_coursecolor' + (x + 1)] || undefined;
                }
            } catch {
                // Ignore errors.
            }
        }

        return colors;
    }

    /**
     * Loads the color of the course or the thumb image.
     *
     * @param course Course data.
     * @param colors Colors loaded.
     */
    async loadCourseColorAndImage(course: CoreCourseWithImageAndColor, colors?: (string | undefined)[]): Promise<void> {
        if (!colors) {
            colors = await this.loadCourseSiteColors();
        }

        if (course.overviewfiles && course.overviewfiles[0]) {
            course.courseImage = course.overviewfiles[0].fileurl;
        } else {
            course.colorNumber = course.id % 10;
            course.color = colors.length ? colors[course.colorNumber] : undefined;
        }
    }

    /**
     * Get user courses with admin and nav options.
     *
     * @param sort Sort courses after get them. If sort is not defined it won't be sorted.
     * @param slice Slice results to get the X first one. If slice > 0 it will be done after sorting.
     * @param filter Filter using some field.
     * @param loadCategoryNames Whether load category names or not.
     * @return Courses filled with options.
     */
    async getUserCoursesWithOptions(): Promise<void> {
        // @todo params and logic
    }

    /**
     * Show a context menu to select a course, and return the courseId and categoryId of the selected course (-1 for all courses).
     * Returns an empty object if popover closed without picking a course.
     *
     * @param event Click event.
     * @param courses List of courses, from CoreCoursesHelperProvider.getCoursesForPopover.
     * @param courseId The course to select at start.
     * @return Promise resolved with the course ID and category ID.
     */
    async selectCourse(): Promise<void> {
        // @todo params and logic
    }

}

export class CoreCoursesHelper extends makeSingleton(CoreCoursesHelperProvider) { }

/**
 * Course with colors info and course image.
 */
export type CoreCourseWithImageAndColor = {
    id: number; // Course id.
    overviewfiles?: CoreWSExternalFile[];
    colorNumber?: number; // Color index number.
    color?: string; // Color RGB.
    courseImage?: string; // Course thumbnail.
};

/**
 * Enrolled course data with extra rendering info.
 */
export type CoreEnrolledCourseDataWithExtraInfo = CoreCourseWithImageAndColor & CoreEnrolledCourseData & {
    categoryname?: string; // Category name,
};

/**
 * Enrolled course data with admin and navigation option availability.
 */
export type CoreEnrolledCourseDataWithOptions = CoreEnrolledCourseData & {
    navOptions?: CoreCourseUserAdminOrNavOptionIndexed;
    admOptions?: CoreCourseUserAdminOrNavOptionIndexed;
};

/**
 * Enrolled course data with admin and navigation option availability and extra rendering info.
 */
export type CoreEnrolledCourseDataWithExtraInfoAndOptions = CoreEnrolledCourseDataWithExtraInfo & CoreEnrolledCourseDataWithOptions;

