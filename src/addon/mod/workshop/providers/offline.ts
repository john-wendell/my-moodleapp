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

import { Injectable } from '@angular/core';
import { CoreFileProvider } from '@providers/file';
import { CoreSitesProvider } from '@providers/sites';
import { CoreTextUtilsProvider } from '@providers/utils/text';
import { CoreTimeUtilsProvider } from '@providers/utils/time';

/**
 * Service to handle offline workshop.
 */
@Injectable()
export class AddonModWorkshopOfflineProvider {

    // Variables for database.
    protected SUBMISSIONS_TABLE = 'addon_mod_workshop_submissions';
    protected ASSESSMENTS_TABLE = 'addon_mod_workshop_assessments';
    protected EVALUATE_SUBMISSIONS_TABLE = 'addon_mod_workshop_evaluate_submissions';
    protected EVALUATE_ASSESSMENTS_TABLE = 'addon_mod_workshop_evaluate_assessments';

    protected tablesSchema = [
        {
            name: this.SUBMISSIONS_TABLE,
            columns: [
                {
                    name: 'workshopid',
                    type: 'INTEGER',
                },
                {
                    name: 'submissionid',
                    type: 'INTEGER',
                },
                {
                    name: 'action',
                    type: 'TEXT',
                },
                {
                    name: 'courseid',
                    type: 'INTEGER',
                },
                {
                    name: 'title',
                    type: 'TEXT',
                },
                {
                    name: 'content',
                    type: 'TEXT',
                },
                {
                    name: 'attachmentsid',
                    type: 'TEXT',
                },
                {
                    name: 'timemodified',
                    type: 'INTEGER',
                }
            ],
            primaryKeys: ['workshopid', 'submissionid', 'action']
        },
        {
            name: this.ASSESSMENTS_TABLE,
            columns: [
                {
                    name: 'workshopid',
                    type: 'INTEGER',
                },
                {
                    name: 'assessmentid',
                    type: 'INTEGER',
                },
                {
                    name: 'courseid',
                    type: 'INTEGER',
                },
                {
                    name: 'inputdata',
                    type: 'TEXT',
                },
                {
                    name: 'timemodified',
                    type: 'INTEGER',
                },
            ],
            primaryKeys: ['workshopid', 'assessmentid']
        },
        {
            name: this.EVALUATE_SUBMISSIONS_TABLE,
            columns: [
                {
                    name: 'workshopid',
                    type: 'INTEGER',
                },
                {
                    name: 'submissionid',
                    type: 'INTEGER',
                },
                {
                    name: 'courseid',
                    type: 'INTEGER',
                },
                {
                    name: 'timemodified',
                    type: 'INTEGER',
                },
                {
                    name: 'feedbacktext',
                    type: 'TEXT',
                },
                {
                    name: 'published',
                    type: 'INTEGER',
                },
                {
                    name: 'gradeover',
                    type: 'TEXT',
                },
            ],
            primaryKeys: ['workshopid', 'submissionid']
        },
        {
            name: this.EVALUATE_ASSESSMENTS_TABLE,
            columns: [
                {
                    name: 'workshopid',
                    type: 'INTEGER',
                },
                {
                    name: 'assessmentid',
                    type: 'INTEGER',
                },
                {
                    name: 'courseid',
                    type: 'INTEGER',
                },
                {
                    name: 'timemodified',
                    type: 'INTEGER',
                },
                {
                    name: 'feedbacktext',
                    type: 'TEXT',
                },
                {
                    name: 'weight',
                    type: 'INTEGER',
                },
                {
                    name: 'gradinggradeover',
                    type: 'TEXT',
                },
            ],
            primaryKeys: ['workshopid', 'assessmentid']
        }
    ];

    constructor(private fileProvider: CoreFileProvider,
            private sitesProvider: CoreSitesProvider,
            private textUtils: CoreTextUtilsProvider,
            private timeUtils: CoreTimeUtilsProvider) {
        this.sitesProvider.createTablesFromSchema(this.tablesSchema);
    }

    /**
     * Get all the workshops ids that have something to be synced.
     *
     * @param  {string} [siteId]   Site ID. If not defined, current site.
     * @return {Promise<number[]>} Promise resolved with workshops id that have something to be synced.
     */
    getAllWorkshops(siteId?: string): Promise<number[]> {
        const promises = [
            this.getAllSubmissions(siteId),
            this.getAllAssessments(siteId),
            this.getAllEvaluateSubmissions(siteId),
            this.getAllEvaluateAssessments(siteId)
        ];

        return Promise.all(promises).then((promiseResults) => {
            const workshopIds = {};

            // Get workshops from any offline object all should have workshopid.
            promiseResults.forEach((offlineObjects) => {
                offlineObjects.forEach((offlineObject) => {
                    workshopIds[offlineObject.workshopid] = true;
                });
            });

            return Object.keys(workshopIds).map((workshopId) => parseInt(workshopId, 10));
        });
    }

    /**
     * Check if there is an offline data to be synced.
     *
     * @param  {number} workshopId Workshop ID to remove.
     * @param  {string} [siteId]   Site ID. If not defined, current site.
     * @return {Promise<boolean>}  Promise resolved with boolean: true if has offline data, false otherwise.
     */
    hasWorkshopOfflineData(workshopId: number, siteId?: string): Promise<boolean> {
        const promises = [
            this.getSubmissions(workshopId, siteId),
            this.getAssessments(workshopId, siteId),
            this.getEvaluateSubmissions(workshopId, siteId),
            this.getEvaluateAssessments(workshopId, siteId)
        ];

        return Promise.all(promises).then((results) => {
            return results.some((result) => result && result.length);
        }).catch(() => {
            // No offline data found.
            return false;
        });
    }

    /**
     * Delete workshop submission action.
     *
     * @param  {number} workshopId   Workshop ID.
     * @param  {number} submissionId Submission ID.
     * @param  {string} action       Action to be done.
     * @param  {string} [siteId]     Site ID. If not defined, current site.
     * @return {Promise<any>}        Promise resolved if stored, rejected if failure.
     */
    deleteSubmissionAction(workshopId: number, submissionId: number, action: string, siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const conditions = {
                workshopid: workshopId,
                submissionid: submissionId,
                action: action
            };

            return site.getDb().deleteRecords(this.SUBMISSIONS_TABLE, conditions);
        });
    }

    /**
     * Delete all workshop submission actions.
     *
     * @param  {number} workshopId   Workshop ID.
     * @param  {number} submissionId Submission ID.
     * @param  {string} [siteId]     Site ID. If not defined, current site.
     * @return {Promise<any>}        Promise resolved if stored, rejected if failure.
     */
    deleteAllSubmissionActions(workshopId: number, submissionId: number, siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const conditions = {
                workshopid: workshopId,
                submissionid: submissionId,
            };

            return site.getDb().deleteRecords(this.SUBMISSIONS_TABLE, conditions);
        });
    }

    /**
     * Get the all the submissions to be synced.
     *
     * @param  {string} [siteId] Site ID. If not defined, current site.
     * @return {Promise<any[]>}  Promise resolved with the objects to be synced.
     */
    getAllSubmissions(siteId?: string): Promise<any[]> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            return site.getDb().getRecords(this.SUBMISSIONS_TABLE).then((records) => {
                records.forEach(this.parseSubmissionRecord.bind(this));

                return records;
            });
        });
    }

    /**
     * Get the submissions of a workshop to be synced.
     *
     * @param  {number} workshopId ID of the workshop.
     * @param  {string} [siteId]   Site ID. If not defined, current site.
     * @return {Promise<any>}      Promise resolved with the object to be synced.
     */
    getSubmissions(workshopId: number, siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const conditions = {
                workshopid: workshopId
            };

            return site.getDb().getRecords(this.SUBMISSIONS_TABLE, conditions).then((records) => {
                records.forEach(this.parseSubmissionRecord.bind(this));

                return records;
            });
        });
    }

    /**
     * Get all actions of a submission of a workshop to be synced.
     *
     * @param  {number} workshopId   ID of the workshop.
     * @param  {number} submissionId ID of the submission.
     * @param  {string} [siteId]     Site ID. If not defined, current site.
     * @return {Promise<any[]>}      Promise resolved with the object to be synced.
     */
    getSubmissionActions(workshopId: number, submissionId: number, siteId?: string): Promise<any[]> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const conditions = {
                workshopid: workshopId,
                submissionid: submissionId
            };

            return site.getDb().getRecords(this.SUBMISSIONS_TABLE, conditions).then((records) => {
                records.forEach(this.parseSubmissionRecord.bind(this));

                return records;
            });
        });
    }

    /**
     * Get an specific action of a submission of a workshop to be synced.
     *
     * @param  {number} workshopId   ID of the workshop.
     * @param  {number} submissionId ID of the submission.
     * @param  {string} action       Action to be done.
     * @param  {string} [siteId]     Site ID. If not defined, current site.
     * @return {Promise<any>}        Promise resolved with the object to be synced.
     */
    getSubmissionAction(workshopId: number, submissionId: number, action: string, siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const conditions = {
                workshopid: workshopId,
                submissionid: submissionId,
                action: action
            };

            return site.getDb().getRecord(this.SUBMISSIONS_TABLE, conditions).then((record) => {
                this.parseSubmissionRecord(record);

                return record;
            });
        });
    }

    /**
     * Offline version for adding a submission action to a workshop.
     *
     * @param  {number} workshopId    Workshop ID.
     * @param  {number} courseId      Course ID the workshop belongs to.
     * @param  {string} title         The submission title.
     * @param  {string} content       The submission text content.
     * @param  {any}    attachmentsId Stored attachments.
     * @param  {number} submissionId  Submission Id, if action is add, the time the submission was created.
     *                                If set to 0, current time is used.
     * @param  {string} action        Action to be done. ['add', 'update', 'delete']
     * @param  {string} [siteId]      Site ID. If not defined, current site.
     * @return {Promise<any>}         Promise resolved when submission action is successfully saved.
     */
    saveSubmission(workshopId: number, courseId: number, title: string, content: string, attachmentsId: any,
            submissionId: number, action: string, siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const timemodified = this.timeUtils.timestamp();
            const assessment = {
                workshopid: workshopId,
                courseid: courseId,
                title: title,
                content: content,
                attachmentsid: JSON.stringify(attachmentsId),
                action: action,
                submissionid: submissionId ? submissionId : -timemodified,
                timemodified: timemodified
            };

            return site.getDb().insertRecord(this.SUBMISSIONS_TABLE, assessment);
        });
    }

    /**
     * Parse "attachments" column of a submission record.
     *
     * @param  {any} record Submission record, modified in place.
     */
    protected parseSubmissionRecord(record: any): void {
        record.attachmentsid = this.textUtils.parseJSON(record.attachmentsid);
    }

    /**
     * Delete workshop assessment.
     *
     * @param  {number} workshopId   Workshop ID.
     * @param  {number} assessmentId Assessment ID.
     * @param  {string} [siteId]     Site ID. If not defined, current site.
     * @return {Promise<any>}        Promise resolved if stored, rejected if failure.
     */
    deleteAssessment(workshopId: number, assessmentId: number, siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const conditions = {
                workshopid: workshopId,
                assessmentid: assessmentId
            };

            return site.getDb().deleteRecords(this.ASSESSMENTS_TABLE, conditions);
        });
    }

    /**
     * Get the all the assessments to be synced.
     *
     * @param  {string} [siteId] Site ID. If not defined, current site.
     * @return {Promise<any[]>}  Promise resolved with the objects to be synced.
     */
    getAllAssessments(siteId?: string): Promise<any[]> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            return site.getDb().getRecords(this.ASSESSMENTS_TABLE).then((records) => {
                records.forEach(this.parseAssessmentRecord.bind(this));

                return records;
            });
        });
    }

    /**
     * Get the assessments of a workshop to be synced.
     *
     * @param  {number} workshopId ID of the workshop.
     * @param  {string} [siteId]   Site ID. If not defined, current site.
     * @return {Promise<any[]>}    Promise resolved with the object to be synced.
     */
    getAssessments(workshopId: number, siteId?: string): Promise<any[]> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const conditions = {
                workshopid: workshopId
            };

            return site.getDb().getRecords(this.ASSESSMENTS_TABLE, conditions).then((records) => {
                records.forEach(this.parseAssessmentRecord.bind(this));

                return records;
            });
        });
    }

    /**
     * Get an specific assessment of a workshop to be synced.
     *
     * @param  {number} workshopId   ID of the workshop.
     * @param  {number} assessmentId Assessment ID.
     * @param  {string} [siteId]     Site ID. If not defined, current site.
     * @return {Promise<any>}        Promise resolved with the object to be synced.
     */
    getAssessment(workshopId: number, assessmentId: number, siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const conditions = {
                workshopid: workshopId,
                assessmentid: assessmentId
            };

            return site.getDb().getRecord(this.ASSESSMENTS_TABLE, conditions).then((record) => {
                this.parseAssessmentRecord(record);

                return record;
            });
        });
    }

    /**
     * Offline version for adding an assessment to a workshop.
     *
     * @param  {number} workshopId   Workshop ID.
     * @param  {number} assessmentId Assessment ID.
     * @param  {number} courseId     Course ID the workshop belongs to.
     * @param  {any}    inputData    Assessment data.
     * @param  {string} [siteId]     Site ID. If not defined, current site.
     * @return {Promise<any>}        Promise resolved when assessment is successfully saved.
     */
    saveAssessment(workshopId: number, assessmentId: number, courseId: number, inputData: any, siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const assessment = {
                workshopid: workshopId,
                courseid: courseId,
                inputdata: JSON.stringify(inputData),
                assessmentid: assessmentId,
                timemodified: this.timeUtils.timestamp()
            };

            return site.getDb().insertRecord(this.ASSESSMENTS_TABLE, assessment);
        });
    }

    /**
     * Parse "inpudata" column of an assessment record.
     *
     * @param {any} record Assessnent record, modified in place.
     */
    protected parseAssessmentRecord(record: any): void {
        record.inputdata = this.textUtils.parseJSON(record.inputdata);
    }

    /**
     * Delete workshop evaluate submission.
     *
     * @param  {number} workshopId   Workshop ID.
     * @param  {number} submissionId Submission ID.
     * @param  {string} [siteId]     Site ID. If not defined, current site.
     * @return {Promise<any>}        Promise resolved if stored, rejected if failure.
     */
    deleteEvaluateSubmission(workshopId: number, submissionId: number, siteId?: string): Promise<any> {
        const conditions = {
            workshopid: workshopId,
            submissionid: submissionId
        };

        return this.sitesProvider.getSite(siteId).then((site) => {
            return site.getDb().deleteRecords(this.EVALUATE_SUBMISSIONS_TABLE, conditions);
        });
    }

    /**
     * Get the all the evaluate submissions to be synced.
     *
     * @param  {string} [siteId] Site ID. If not defined, current site.
     * @return {Promise<any[]>}  Promise resolved with the objects to be synced.
     */
    getAllEvaluateSubmissions(siteId?: string): Promise<any[]> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            return site.getDb().getRecords(this.EVALUATE_SUBMISSIONS_TABLE).then((records) => {
                records.forEach(this.parseEvaluateSubmissionRecord.bind(this));

                return records;
            });
        });
    }

    /**
     * Get the evaluate submissions of a workshop to be synced.
     *
     * @param  {number} workshopId ID of the workshop.
     * @param  {string} [siteId]   Site ID. If not defined, current site.
     * @return {Promise<any[]>}    Promise resolved with the object to be synced.
     */
    getEvaluateSubmissions(workshopId: number, siteId?: string): Promise<any[]> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const conditions = {
                workshopid: workshopId
            };

            return site.getDb().getRecords(this.EVALUATE_SUBMISSIONS_TABLE, conditions).then((records) => {
                records.forEach(this.parseEvaluateSubmissionRecord.bind(this));

                return records;
            });
        });
    }

    /**
     * Get an specific evaluate submission of a workshop to be synced.
     *
     * @param  {number} workshopId   ID of the workshop.
     * @param  {number} submissionId Submission ID.
     * @param  {string} [siteId]     Site ID. If not defined, current site.
     * @return {Promise<any>}        Promise resolved with the object to be synced.
     */
    getEvaluateSubmission(workshopId: number, submissionId: number, siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const conditions = {
                workshopid: workshopId,
                submissionid: submissionId
            };

            return site.getDb().getRecord(this.EVALUATE_SUBMISSIONS_TABLE, conditions).then((record) => {
                this.parseEvaluateSubmissionRecord(record);

                return record;
            });
        });
    }

    /**
     * Offline version for evaluation a submission to a workshop.
     *
     * @param  {number}  workshopId   Workshop ID.
     * @param  {number}  submissionId Submission ID.
     * @param  {number}  courseId     Course ID the workshop belongs to.
     * @param  {string}  feedbackText The feedback for the author.
     * @param  {boolean} published    Whether to publish the submission for other users.
     * @param  {any}     gradeOver    The new submission grade (empty for no overriding the grade).
     * @param  {string}  [siteId]     Site ID. If not defined, current site.
     * @return {Promise<any>}         Promise resolved when submission evaluation is successfully saved.
     */
    saveEvaluateSubmission(workshopId: number, submissionId: number, courseId: number, feedbackText: string, published: boolean,
            gradeOver: any, siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const submission = {
                workshopid: workshopId,
                courseid: courseId,
                submissionid: submissionId,
                timemodified: this.timeUtils.timestamp(),
                feedbacktext: feedbackText,
                published: Number(published),
                gradeover: JSON.stringify(gradeOver)
            };

            return site.getDb().insertRecord(this.EVALUATE_SUBMISSIONS_TABLE, submission);
        });
    }

    /**
     * Parse "published" and "gradeover" columns of an evaluate submission record.
     *
     * @param  {any} record Evaluate submission record, modified in place.
     */
    protected parseEvaluateSubmissionRecord(record: any): void {
        record.published = Boolean(record.published);
        record.gradeover = this.textUtils.parseJSON(record.gradeover);
    }

    /**
     * Delete workshop evaluate assessment.
     *
     * @param  {number} workshopId   Workshop ID.
     * @param  {number} assessmentId Assessment ID.
     * @param  {string} [siteId]     Site ID. If not defined, current site.
     * @return {Promise<any>}        Promise resolved if stored, rejected if failure.
     */
    deleteEvaluateAssessment(workshopId: number, assessmentId: number, siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const conditions = {
                workshopid: workshopId,
                assessmentid: assessmentId
            };

            return site.getDb().deleteRecords(this.EVALUATE_ASSESSMENTS_TABLE, conditions);
        });
    }

    /**
     * Get the all the evaluate assessments to be synced.
     *
     * @param  {string} [siteId] Site ID. If not defined, current site.
     * @return {Promise<any[]>}  Promise resolved with the objects to be synced.
     */
    getAllEvaluateAssessments(siteId?: string): Promise<any[]> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            return site.getDb().getRecords(this.EVALUATE_ASSESSMENTS_TABLE).then((records) => {
                records.forEach(this.parseEvaluateAssessmentRecord.bind(this));

                return records;
            });
        });
    }

    /**
     * Get the evaluate assessments of a workshop to be synced.
     *
     * @param  {number} workshopId ID of the workshop.
     * @param  {string} [siteId]   Site ID. If not defined, current site.
     * @return {Promise<any[]>}    Promise resolved with the object to be synced.
     */
    getEvaluateAssessments(workshopId: number, siteId?: string): Promise<any[]> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const conditions = {
                workshopid: workshopId
            };

            return site.getDb().getRecords(this.EVALUATE_ASSESSMENTS_TABLE, conditions).then((records) => {
                records.forEach(this.parseEvaluateAssessmentRecord.bind(this));

                return records;
            });
        });
    }

    /**
     * Get an specific evaluate assessment of a workshop to be synced.
     *
     * @param  {number} workshopId   ID of the workshop.
     * @param  {number} assessmentId Assessment ID.
     * @param  {string} [siteId]     Site ID. If not defined, current site.
     * @return {Promise<any>}        Promise resolved with the object to be synced.
     */
    getEvaluateAssessment(workshopId: number, assessmentId: number, siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const conditions = {
                workshopid: workshopId,
                assessmentid: assessmentId
            };

            return site.getDb().getRecord(this.EVALUATE_ASSESSMENTS_TABLE, conditions).then((record) => {
                this.parseEvaluateAssessmentRecord(record);

                return record;
            });
        });
    }

    /**
     * Offline version for evaluating an assessment to a workshop.
     *
     * @param  {number}  workshopId       Workshop ID.
     * @param  {number}  assessmentId     Assessment ID.
     * @param  {number}  courseId         Course ID the workshop belongs to.
     * @param  {string}  feedbackText     The feedback for the reviewer.
     * @param  {number}  weight           The new weight for the assessment.
     * @param  {any}     gradingGradeOver The new grading grade (empty for no overriding the grade).
     * @param  {string}  [siteId]         Site ID. If not defined, current site.
     * @return {Promise<any>}             Promise resolved when assessment evaluation is successfully saved.
     */
    saveEvaluateAssessment(workshopId: number, assessmentId: number, courseId: number, feedbackText: string, weight: number,
            gradingGradeOver: any, siteId?: string): Promise<any> {
        return this.sitesProvider.getSite(siteId).then((site) => {
            const assessment = {
                workshopid: workshopId,
                courseid: courseId,
                assessmentid: assessmentId,
                timemodified: this.timeUtils.timestamp(),
                feedbacktext: feedbackText,
                weight: weight,
                gradinggradeover: JSON.stringify(gradingGradeOver)
            };

            return site.getDb().insertRecord(this.EVALUATE_ASSESSMENTS_TABLE, assessment);
        });
    }

    /**
     * Parse "gradinggradeover" column of an evaluate assessment record.
     *
     * @param  {any} record Evaluate assessment record, modified in place.
     */
    protected parseEvaluateAssessmentRecord(record: any): void {
        record.gradinggradeover = this.textUtils.parseJSON(record.gradinggradeover);
    }

    /**
     * Get the path to the folder where to store files for offline attachments in a workshop.
     *
     * @param  {number} workshopId Workshop ID.
     * @param  {string} [siteId]   Site ID. If not defined, current site.
     * @return {Promise<string>}   Promise resolved with the path.
     */
    getWorkshopFolder(workshopId: number, siteId?: string): Promise<string> {
        return this.sitesProvider.getSite(siteId).then((site) => {

            const siteFolderPath = this.fileProvider.getSiteFolder(site.getId());
            const workshopFolderPath = 'offlineworkshop/' + workshopId + '/';

            return this.textUtils.concatenatePaths(siteFolderPath, workshopFolderPath);
        });
    }

    /**
     * Get the path to the folder where to store files for offline submissions.
     *
     * @param  {number}  workshopId   Workshop ID.
     * @param  {number}  submissionId If not editing, it will refer to timecreated.
     * @param  {boolean} editing      If the submission is being edited or added otherwise.
     * @param  {string}  [siteId]     Site ID. If not defined, current site.
     * @return {Promise<string>}      Promise resolved with the path.
     */
    getSubmissionFolder(workshopId: number, submissionId: number, editing: boolean, siteId?: string): Promise<string> {
        return this.getWorkshopFolder(workshopId, siteId).then((folderPath) => {
            folderPath += 'submission/';
            const folder = editing ? 'update_' + submissionId : 'add';

            return this.textUtils.concatenatePaths(folderPath, folder);
        });
    }

    /**
     * Get the path to the folder where to store files for offline assessment.
     *
     * @param  {number}  workshopId   Workshop ID.
     * @param  {number}  assessmentId Assessment ID.
     * @param  {string}  [siteId]     Site ID. If not defined, current site.
     * @return {Promise<string>}      Promise resolved with the path.
     */
    getAssessmentFolder(workshopId: number, assessmentId: number, siteId?: string): Promise<string> {
        return this.getWorkshopFolder(workshopId, siteId).then((folderPath) => {
            folderPath += 'assessment/';

            return this.textUtils.concatenatePaths(folderPath, String(assessmentId));
        });
    }
}
