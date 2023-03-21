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
import { CoreFileUploaderStoreFilesResult } from '@features/fileuploader/services/fileuploader';
import { CoreFile } from '@services/file';
import { CoreSites } from '@services/sites';
import { CoreTextUtils } from '@services/utils/text';
import { CoreUtils } from '@services/utils/utils';
import { makeSingleton } from '@singletons';
import { CoreEvents } from '@singletons/events';
import { CorePath } from '@singletons/path';
import { AddonModGlossaryOfflineEntryDBRecord, OFFLINE_ENTRIES_TABLE_NAME } from './database/glossary';
import { AddonModGlossaryEntryOption, GLOSSARY_ENTRY_ADDED } from './glossary';

/**
 * Service to handle offline glossary.
 */
@Injectable({ providedIn: 'root' })
export class AddonModGlossaryOfflineProvider {

    /**
     * Delete a new entry.
     *
     * @param glossaryId Glossary ID.
     * @param concept Glossary entry concept.
     * @param timeCreated The time the entry was created.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved if deleted, rejected if failure.
     */
    async deleteNewEntry(glossaryId: number, concept: string, timeCreated: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        const conditions: Partial<AddonModGlossaryOfflineEntryDBRecord> = {
            glossaryid: glossaryId,
            concept: concept,
            timecreated: timeCreated,
        };

        await site.getDb().deleteRecords(OFFLINE_ENTRIES_TABLE_NAME, conditions);
    }

    /**
     * Get all the stored new entries from all the glossaries.
     *
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved with entries.
     */
    async getAllNewEntries(siteId?: string): Promise<AddonModGlossaryOfflineEntry[]> {
        const site = await CoreSites.getSite(siteId);

        const records = await site.getDb().getRecords<AddonModGlossaryOfflineEntryDBRecord>(OFFLINE_ENTRIES_TABLE_NAME);

        return records.map(record => this.parseRecord(record));
    }

    /**
     * Get a stored new entry.
     *
     * @param glossaryId Glossary ID.
     * @param concept Glossary entry concept.
     * @param timeCreated The time the entry was created.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved with entry.
     */
    async getNewEntry(
        glossaryId: number,
        concept: string,
        timeCreated: number,
        siteId?: string,
    ): Promise<AddonModGlossaryOfflineEntry> {
        const site = await CoreSites.getSite(siteId);

        const conditions: Partial<AddonModGlossaryOfflineEntryDBRecord> = {
            glossaryid: glossaryId,
            concept: concept,
            timecreated: timeCreated,
        };

        const record = await site.getDb().getRecord<AddonModGlossaryOfflineEntryDBRecord>(OFFLINE_ENTRIES_TABLE_NAME, conditions);

        return this.parseRecord(record);
    }

    /**
     * Get all the stored add entry data from a certain glossary.
     *
     * @param glossaryId Glossary ID.
     * @param siteId Site ID. If not defined, current site.
     * @param userId User the entries belong to. If not defined, current user in site.
     * @returns Promise resolved with entries.
     */
    async getGlossaryNewEntries(glossaryId: number, siteId?: string, userId?: number): Promise<AddonModGlossaryOfflineEntry[]> {
        const site = await CoreSites.getSite(siteId);

        const conditions: Partial<AddonModGlossaryOfflineEntryDBRecord> = {
            glossaryid: glossaryId,
            userid: userId || site.getUserId(),
        };

        const records = await site.getDb().getRecords<AddonModGlossaryOfflineEntryDBRecord>(OFFLINE_ENTRIES_TABLE_NAME, conditions);

        return records.map(record => this.parseRecord(record));
    }

    /**
     * Check if a concept is used offline.
     *
     * @param glossaryId Glossary ID.
     * @param concept Concept to check.
     * @param timeCreated Time of the entry we are editing.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved with true if concept is found, false otherwise.
     */
    async isConceptUsed(glossaryId: number, concept: string, timeCreated?: number, siteId?: string): Promise<boolean> {
        try {
            const site = await CoreSites.getSite(siteId);

            const conditions: Partial<AddonModGlossaryOfflineEntryDBRecord> = {
                glossaryid: glossaryId,
                concept: concept,
            };

            const entries =
                await site.getDb().getRecords<AddonModGlossaryOfflineEntryDBRecord>(OFFLINE_ENTRIES_TABLE_NAME, conditions);

            if (!entries.length) {
                return false;
            }

            if (entries.length > 1 || !timeCreated) {
                return true;
            }

            // If there's only one entry, check that is not the one we are editing.
            return CoreUtils.promiseFails(this.getNewEntry(glossaryId, concept, timeCreated, siteId));
        } catch {
            // No offline data found, return false.
            return false;
        }
    }

    /**
     * Save a new entry to be sent later.
     *
     * @param glossaryId Glossary ID.
     * @param concept Glossary entry concept.
     * @param definition Glossary entry concept definition.
     * @param courseId Course ID of the glossary.
     * @param options Options for the entry.
     * @param attachments Result of CoreFileUploaderProvider#storeFilesToUpload for attachments.
     * @param timecreated The time the entry was created. If not defined, current time.
     * @param siteId Site ID. If not defined, current site.
     * @param userId User the entry belong to. If not defined, current user in site.
     * @param discardEntry The entry provided will be discarded if found.
     * @returns Promise resolved if stored, rejected if failure.
     */
    async addNewEntry(
        glossaryId: number,
        concept: string,
        definition: string,
        courseId: number,
        options?: Record<string, AddonModGlossaryEntryOption>,
        attachments?: CoreFileUploaderStoreFilesResult,
        timecreated?: number,
        siteId?: string,
        userId?: number,
        discardEntry?: AddonModGlossaryDiscardedEntry,
    ): Promise<false> {
        const site = await CoreSites.getSite(siteId);
        timecreated = timecreated || Date.now();

        const entry: AddonModGlossaryOfflineEntryDBRecord = {
            glossaryid: glossaryId,
            courseid: courseId,
            concept: concept,
            definition: definition,
            definitionformat: 'html',
            options: JSON.stringify(options || {}),
            attachments: JSON.stringify(attachments),
            userid: userId || site.getUserId(),
            timecreated,
        };

        // If editing an offline entry, delete previous first.
        if (discardEntry) {
            await this.deleteNewEntry(glossaryId, discardEntry.concept, discardEntry.timecreated, site.getId());
        }

        await site.getDb().insertRecord(OFFLINE_ENTRIES_TABLE_NAME, entry);

        CoreEvents.trigger(GLOSSARY_ENTRY_ADDED, { glossaryId, timecreated }, siteId);

        return false;
    }

    /**
     * Get the path to the folder where to store files for offline attachments in a glossary.
     *
     * @param glossaryId Glossary ID.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved with the path.
     */
    async getGlossaryFolder(glossaryId: number, siteId?: string): Promise<string> {
        const site = await CoreSites.getSite(siteId);

        const siteFolderPath = CoreFile.getSiteFolder(site.getId());
        const folderPath = 'offlineglossary/' + glossaryId;

        return CorePath.concatenatePaths(siteFolderPath, folderPath);
    }

    /**
     * Get the path to the folder where to store files for a new offline entry.
     *
     * @param glossaryId Glossary ID.
     * @param concept The name of the entry.
     * @param timeCreated Time to allow duplicated entries.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved with the path.
     */
    async getEntryFolder(glossaryId: number, concept: string, timeCreated: number, siteId?: string): Promise<string> {
        const folderPath = await this.getGlossaryFolder(glossaryId, siteId);

        return CorePath.concatenatePaths(folderPath, 'newentry_' + concept + '_' + timeCreated);
    }

    /**
     * Parse "options" and "attachments" columns of a fetched record.
     *
     * @param record Record object
     * @returns Record object with columns parsed.
     */
    protected parseRecord(record: AddonModGlossaryOfflineEntryDBRecord): AddonModGlossaryOfflineEntry {
        return Object.assign(record, {
            options: <Record<string, AddonModGlossaryEntryOption>> CoreTextUtils.parseJSON(record.options),
            attachments: record.attachments ?
                <CoreFileUploaderStoreFilesResult> CoreTextUtils.parseJSON(record.attachments) : undefined,
        });
    }

}

export const AddonModGlossaryOffline = makeSingleton(AddonModGlossaryOfflineProvider);

/**
 * Glossary offline entry with parsed data.
 */
export type AddonModGlossaryOfflineEntry = Omit<AddonModGlossaryOfflineEntryDBRecord, 'options'|'attachments'> & {
    options: Record<string, AddonModGlossaryEntryOption>;
    attachments?: CoreFileUploaderStoreFilesResult;
};
