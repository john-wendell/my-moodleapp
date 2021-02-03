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

import { Component, OnInit } from '@angular/core';
import { IonRefresher } from '@ionic/angular';

import { CoreError } from '@classes/errors/error';
import { CoreUser } from '@features/user/services/user';
import { CoreNavigator } from '@services/navigator';
import { CoreSites } from '@services/sites';
import { CoreDomUtils } from '@services/utils/dom';
import { CoreTextUtils } from '@services/utils/text';
import { CoreUtils } from '@services/utils/utils';
import { Translate } from '@singletons';
import {
    AddonModLesson,
    AddonModLessonAttemptsOverviewsAttemptWSData,
    AddonModLessonAttemptsOverviewsStudentWSData,
    AddonModLessonGetUserAttemptWSResponse,
    AddonModLessonLessonWSData,
    AddonModLessonProvider,
    AddonModLessonUserAttemptAnswerData,
    AddonModLessonUserAttemptAnswerPageWSData,
} from '../../services/lesson';
import { AddonModLessonAnswerData, AddonModLessonHelper } from '../../services/lesson-helper';
import { CoreTimeUtils } from '@services/utils/time';

/**
 * Page that displays a retake made by a certain user.
 */
@Component({
    selector: 'page-addon-mod-lesson-user-retake',
    templateUrl: 'user-retake.html',
    styleUrls: ['user-retake.scss'],
})
export class AddonModLessonUserRetakePage implements OnInit {

    component = AddonModLessonProvider.COMPONENT;
    lesson?: AddonModLessonLessonWSData; // The lesson the retake belongs to.
    courseId!: number; // Course ID the lesson belongs to.
    selectedRetake?: number; // The retake to see.
    student?: StudentData; // Data about the student and his retakes.
    retake?: RetakeToDisplay; // Data about the retake.
    loaded?: boolean; // Whether the data has been loaded.
    timeTakenReadable?: string; // Time taken in a readable format.

    protected lessonId!: number; // The lesson ID the retake belongs to.
    protected userId?: number; // User ID to see the retakes.
    protected retakeNumber?: number; // Number of the initial retake to see.
    protected previousSelectedRetake?: number; // To be able to detect the previous selected retake when it has changed.

    /**
     * Component being initialized.
     */
    ngOnInit(): void {
        this.lessonId = CoreNavigator.instance.getRouteNumberParam('lessonId')!;
        this.courseId = CoreNavigator.instance.getRouteNumberParam('courseId')!;
        this.userId = CoreNavigator.instance.getRouteNumberParam('userId') || CoreSites.instance.getCurrentSiteUserId();
        this.retakeNumber = CoreNavigator.instance.getRouteNumberParam('retake');

        // Fetch the data.
        this.fetchData().finally(() => {
            this.loaded = true;
        });
    }

    /**
     * Change the retake displayed.
     *
     * @param retakeNumber The new retake number.
     */
    async changeRetake(retakeNumber: number): Promise<void> {
        this.loaded = false;

        try {
            await this.setRetake(retakeNumber);
        } catch (error) {
            this.selectedRetake = this.previousSelectedRetake;
            CoreDomUtils.instance.showErrorModal(CoreUtils.instance.addDataNotDownloadedError(error, 'Error getting attempt.'));
        } finally {
            this.loaded = true;
        }
    }

    /**
     * Pull to refresh.
     *
     * @param refresher Refresher.
     */
    doRefresh(refresher: CustomEvent<IonRefresher>): void {
        this.refreshData().finally(() => {
            refresher?.detail.complete();
        });
    }

    /**
     * Get lesson and retake data.
     *
     * @return Promise resolved when done.
     */
    protected async fetchData(): Promise<void> {
        try {
            this.lesson = await AddonModLesson.instance.getLessonById(this.courseId, this.lessonId);

            // Get the retakes overview for all participants.
            const data = await AddonModLesson.instance.getRetakesOverview(this.lesson.id, {
                cmId: this.lesson.coursemodule,
            });

            // Search the student.
            const student: StudentData | undefined = data?.students?.find(student => student.id == this.userId);
            if (!student) {
                // Student not found.
                throw new CoreError(Translate.instance.instant('addon.mod_lesson.cannotfinduser'));
            }

            if (!student.attempts.length) {
                // No retakes.
                throw new CoreError(Translate.instance.instant('addon.mod_lesson.cannotfindattempt'));
            }

            student.bestgrade = CoreTextUtils.instance.roundToDecimals(student.bestgrade, 2);
            student.attempts.forEach((retake) => {
                if (!this.selectedRetake && this.retakeNumber == retake.try) {
                    // The retake specified as parameter exists. Use it.
                    this.selectedRetake = this.retakeNumber;
                }

                retake.label = AddonModLessonHelper.instance.getRetakeLabel(retake);
            });

            if (!this.selectedRetake) {
                // Retake number not specified or not valid, use the last retake.
                this.selectedRetake = student.attempts[student.attempts.length - 1].try;
            }

            // Get the profile image of the user.
            const user = await CoreUtils.instance.ignoreErrors(CoreUser.instance.getProfile(student.id, this.courseId, true));

            this.student = student;
            this.student.profileimageurl = user?.profileimageurl;

            await this.setRetake(this.selectedRetake);
        } catch (error) {
            CoreDomUtils.instance.showErrorModalDefault(error, 'Error getting data.', true);
        }
    }

    /**
     * Refreshes data.
     *
     * @return Promise resolved when done.
     */
    protected async refreshData(): Promise<void> {
        const promises: Promise<void>[] = [];

        promises.push(AddonModLesson.instance.invalidateLessonData(this.courseId));
        if (this.lesson) {
            promises.push(AddonModLesson.instance.invalidateRetakesOverview(this.lesson.id));
            promises.push(AddonModLesson.instance.invalidateUserRetakesForUser(this.lesson.id, this.userId));
        }

        await CoreUtils.instance.ignoreErrors(Promise.all(promises));

        await this.fetchData();
    }

    /**
     * Set the retake to view and load its data.
     *
     * @param retakeNumber Retake number to set.
     * @return Promise resolved when done.
     */
    protected async setRetake(retakeNumber: number): Promise<void> {
        this.selectedRetake = retakeNumber;

        const retakeData = await AddonModLesson.instance.getUserRetake(this.lessonId, retakeNumber, {
            cmId: this.lesson!.coursemodule,
            userId: this.userId,
        });

        this.retake = this.formatRetake(retakeData);
        this.previousSelectedRetake = this.selectedRetake;
    }

    /**
     * Format retake data, adding some calculated data.
     *
     * @param data Retake data.
     * @return Formatted data.
     */
    protected formatRetake(retakeData: AddonModLessonGetUserAttemptWSResponse): RetakeToDisplay {
        const formattedData = <RetakeToDisplay> retakeData;

        if (formattedData.userstats.gradeinfo) {
            // Completed.
            formattedData.userstats.grade = CoreTextUtils.instance.roundToDecimals(formattedData.userstats.grade, 2);
            this.timeTakenReadable = CoreTimeUtils.instance.formatTime(formattedData.userstats.timetotake);
        }

        // Format pages data.
        formattedData.answerpages.forEach((page) => {
            if (AddonModLesson.instance.answerPageIsContent(page)) {
                page.isContent = true;

                if (page.answerdata?.answers) {
                    page.answerdata.answers.forEach((answer) => {
                        // Content pages only have 1 valid field in the answer array.
                        answer[0] = AddonModLessonHelper.instance.getContentPageAnswerDataFromHtml(answer[0]);
                    });
                }
            } else if (AddonModLesson.instance.answerPageIsQuestion(page)) {
                page.isQuestion = true;

                if (page.answerdata?.answers) {
                    page.answerdata.answers.forEach((answer) => {
                        // Only the first field of the answer array requires to be parsed.
                        answer[0] = AddonModLessonHelper.instance.getQuestionPageAnswerDataFromHtml(answer[0]);
                    });
                }
            }
        });

        return formattedData;
    }

}

/**
 * Student data with some calculated data.
 */
type StudentData = Omit<AddonModLessonAttemptsOverviewsStudentWSData, 'attempts'> & {
    profileimageurl?: string;
    attempts: AttemptWithLabel[];
};

/**
 * Student attempt with a calculated label.
 */
type AttemptWithLabel = AddonModLessonAttemptsOverviewsAttemptWSData & {
    label?: string;
};
/**
 * Retake with calculated data.
 */
type RetakeToDisplay = Omit<AddonModLessonGetUserAttemptWSResponse, 'answerpages'> & {
    answerpages: AnswerPage[];
};

/**
 * Answer page with calculated data.
 */
type AnswerPage = Omit<AddonModLessonUserAttemptAnswerPageWSData, 'answerdata'> & {
    isContent?: boolean;
    isQuestion?: boolean;
    answerdata?: AnswerData;
};

/**
 * Answer data with calculated data.
 */
type AnswerData = Omit<AddonModLessonUserAttemptAnswerData, 'answers'> & {
    answers?: (string[] | AddonModLessonAnswerData)[]; // User answers.
};
