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
import { CoreComments } from '@features/comments/services/comments';
import { CoreCourseActivityPrefetchHandlerBase } from '@features/course/classes/activity-prefetch-handler';
import { CoreCourse, CoreCourseAnyModuleData } from '@features/course/services/course';
import { CoreUser } from '@features/user/services/user';
import { CoreFilepool } from '@services/filepool';
import { CoreSites, CoreSitesReadingStrategy } from '@services/sites';
import { CoreWSFile } from '@services/ws';
import { makeSingleton } from '@singletons';
import { AddonModGlossary, AddonModGlossaryEntry, AddonModGlossaryGlossary, AddonModGlossaryProvider } from '../glossary';
import { AddonModGlossarySync, AddonModGlossarySyncResult } from '../glossary-sync';

/**
 * Handler to prefetch forums.
 */
@Injectable({ providedIn: 'root' })
export class AddonModGlossaryPrefetchHandlerService extends CoreCourseActivityPrefetchHandlerBase {

    name = 'AddonModGlossary';
    modName = 'glossary';
    component = AddonModGlossaryProvider.COMPONENT;
    updatesNames = /^configuration$|^.*files$|^entries$/;

    /**
     * @inheritdoc
     */
    async getFiles(module: CoreCourseAnyModuleData, courseId: number): Promise<CoreWSFile[]> {
        try {
            const glossary = await AddonModGlossary.getGlossary(courseId, module.id);

            const entries = await AddonModGlossary.fetchAllEntries(
                AddonModGlossary.getEntriesByLetter.bind(AddonModGlossary.instance, glossary.id, 'ALL'),
                {
                    cmId: module.id,
                },
            );

            return this.getFilesFromGlossaryAndEntries(module, glossary, entries);
        } catch {
            // Glossary not found, return empty list.
            return [];
        }
    }

    /**
     * Get the list of downloadable files. It includes entry embedded files.
     *
     * @param module Module to get the files.
     * @param glossary Glossary
     * @param entries Entries of the Glossary.
     * @return List of Files.
     */
    protected getFilesFromGlossaryAndEntries(
        module: CoreCourseAnyModuleData,
        glossary: AddonModGlossaryGlossary,
        entries: AddonModGlossaryEntry[],
    ): CoreWSFile[] {
        let files = this.getIntroFilesFromInstance(module, glossary);

        const getInlineFiles = CoreSites.getCurrentSite()?.isVersionGreaterEqualThan('3.2');

        // Get entries files.
        entries.forEach((entry) => {
            files = files.concat(entry.attachments || []);

            if (getInlineFiles && entry.definitioninlinefiles && entry.definitioninlinefiles.length) {
                files = files.concat(entry.definitioninlinefiles);
            } else if (entry.definition && !getInlineFiles) {
                files = files.concat(CoreFilepool.extractDownloadableFilesFromHtmlAsFakeFileObjects(entry.definition));
            }
        });

        return files;
    }

    /**
     * @inheritdoc
     */
    invalidateContent(moduleId: number, courseId: number): Promise<void> {
        return AddonModGlossary.invalidateContent(moduleId, courseId);
    }

    /**
     * @inheritdoc
     */
    prefetch(module: CoreCourseAnyModuleData, courseId?: number): Promise<void> {
        return this.prefetchPackage(module, courseId, this.prefetchGlossary.bind(this, module, courseId));
    }

    /**
     * Prefetch a glossary.
     *
     * @param module The module object returned by WS.
     * @param courseId Course ID the module belongs to.
     * @param siteId Site ID.
     * @return Promise resolved when done.
     */
    protected async prefetchGlossary(module: CoreCourseAnyModuleData, courseId: number, siteId: string): Promise<void> {
        siteId = siteId || CoreSites.getCurrentSiteId();

        const options = {
            cmId: module.id,
            readingStrategy: CoreSitesReadingStrategy.ONLY_NETWORK,
            siteId,
        };

        // Prefetch the glossary data.
        const glossary = await AddonModGlossary.getGlossary(courseId, module.id, { siteId });

        const promises: Promise<unknown>[] = [];

        glossary.browsemodes.forEach((mode) => {
            switch (mode) {
                case 'letter': // Always done. Look bellow.
                    break;
                case 'cat':
                    promises.push(AddonModGlossary.fetchAllEntries(
                        AddonModGlossary.getEntriesByCategory.bind(
                            AddonModGlossary.instance,
                            glossary.id,
                            AddonModGlossaryProvider.SHOW_ALL_CATEGORIES,
                        ),
                        options,
                    ));
                    break;
                case 'date':
                    promises.push(AddonModGlossary.fetchAllEntries(
                        AddonModGlossary.getEntriesByDate.bind(
                            AddonModGlossary.instance,
                            glossary.id,
                            'CREATION',
                            'DESC',
                        ),
                        options,
                    ));
                    promises.push(AddonModGlossary.fetchAllEntries(
                        AddonModGlossary.getEntriesByDate.bind(
                            AddonModGlossary.instance,
                            glossary.id,
                            'UPDATE',
                            'DESC',
                        ),
                        options,
                    ));
                    break;
                case 'author':
                    promises.push(AddonModGlossary.fetchAllEntries(
                        AddonModGlossary.getEntriesByAuthor.bind(
                            AddonModGlossary.instance,
                            glossary.id,
                            'ALL',
                            'LASTNAME',
                            'ASC',
                        ),
                        options,
                    ));
                    break;
                default:
            }
        });

        // Fetch all entries to get information from.
        promises.push(AddonModGlossary.fetchAllEntries(
            AddonModGlossary.getEntriesByLetter.bind(AddonModGlossary.instance, glossary.id, 'ALL'),
            options,
        ).then((entries) => {
            const promises: Promise<unknown>[] = [];
            const commentsEnabled = !CoreComments.areCommentsDisabledInSite();

            entries.forEach((entry) => {
                // Don't fetch individual entries, it's too many WS calls.
                if (glossary.allowcomments && commentsEnabled) {
                    promises.push(CoreComments.getComments(
                        'module',
                        glossary.coursemodule,
                        'mod_glossary',
                        entry.id,
                        'glossary_entry',
                        0,
                        siteId,
                    ));
                }
            });

            const files = this.getFilesFromGlossaryAndEntries(module, glossary, entries);
            promises.push(CoreFilepool.addFilesToQueue(siteId, files, this.component, module.id));

            // Prefetch user avatars.
            promises.push(CoreUser.prefetchUserAvatars(entries, 'userpictureurl', siteId));

            return Promise.all(promises);
        }));

        // Get all categories.
        promises.push(AddonModGlossary.getAllCategories(glossary.id, options));

        // Prefetch data for link handlers.
        promises.push(CoreCourse.getModuleBasicInfo(module.id, siteId));
        promises.push(CoreCourse.getModuleBasicInfoByInstance(glossary.id, 'glossary', siteId));

        await Promise.all(promises);
    }

    /**
     * @inheritdoc
     */
    async sync(module: CoreCourseAnyModuleData, courseId: number, siteId?: string): Promise<AddonModGlossarySyncResult> {
        const results = await Promise.all([
            AddonModGlossarySync.syncGlossaryEntries(module.instance!, undefined, siteId),
            AddonModGlossarySync.syncRatings(module.id, undefined, siteId),
        ]);

        return {
            updated: results[0].updated || results[1].updated,
            warnings: results[0].warnings.concat(results[1].warnings),
        };
    }

}

export const AddonModGlossaryPrefetchHandler = makeSingleton(AddonModGlossaryPrefetchHandlerService);
