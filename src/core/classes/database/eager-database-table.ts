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

import { CoreError } from '@classes/errors/error';
import { SQLiteDBRecordValues } from '@classes/sqlitedb';
import { CoreDatabaseTable, CoreDatabaseConditions, GetDBRecordPrimaryKey, CoreDatabaseReducer } from './database-table';

/**
 * Wrapper used to improve performance by caching all the records for faster read operations.
 *
 * This implementation works best for tables that don't have a lot of records and are read often; for tables with too many
 * records use CoreLazyDatabaseTable instead.
 */
export class CoreEagerDatabaseTable<
    DBRecord extends SQLiteDBRecordValues = SQLiteDBRecordValues,
    PrimaryKeyColumn extends keyof DBRecord = 'id',
    PrimaryKey extends GetDBRecordPrimaryKey<DBRecord, PrimaryKeyColumn> = GetDBRecordPrimaryKey<DBRecord, PrimaryKeyColumn>
> extends CoreDatabaseTable<DBRecord, PrimaryKeyColumn, PrimaryKey> {

    protected records: Record<string, DBRecord> = {};

    /**
     * @inheritdoc
     */
    async initialize(): Promise<void> {
        const records = await super.all();

        this.records = records.reduce((data, record) => {
            const primaryKey = this.serializePrimaryKey(this.getPrimaryKeyFromRecord(record));

            data[primaryKey] = record;

            return data;
        }, {});
    }

    /**
     * @inheritdoc
     */
    async all(conditions?: Partial<DBRecord>): Promise<DBRecord[]> {
        const records = Object.values(this.records);

        return conditions
            ? records.filter(record => this.recordMatches(record, conditions))
            : records;
    }

    /**
     * @inheritdoc
     */
    async find(conditions: Partial<DBRecord>): Promise<DBRecord> {
        const record = Object.values(this.records).find(record => this.recordMatches(record, conditions)) ?? null;

        if (record === null) {
            throw new CoreError('No records found.');
        }

        return record;
    }

    /**
     * @inheritdoc
     */
    async findByPrimaryKey(primaryKey: PrimaryKey): Promise<DBRecord> {
        const record = this.records[this.serializePrimaryKey(primaryKey)] ?? null;

        if (record === null) {
            throw new CoreError('No records found.');
        }

        return record;
    }

    /**
     * @inheritdoc
     */
    async reduce<T>(reducer: CoreDatabaseReducer<DBRecord, T>, conditions?: CoreDatabaseConditions<DBRecord>): Promise<T> {
        return Object
            .values(this.records)
            .reduce(
                (result, record) => (!conditions || conditions.js(record)) ? reducer.js(result, record) : result,
                reducer.jsInitialValue,
            );
    }

    /**
     * @inheritdoc
     */
    async insert(record: DBRecord): Promise<void> {
        await super.insert(record);

        const primaryKey = this.serializePrimaryKey(this.getPrimaryKeyFromRecord(record));

        this.records[primaryKey] = record;
    }

    /**
     * @inheritdoc
     */
    async update(updates: Partial<DBRecord>, conditions?: Partial<DBRecord>): Promise<void> {
        await super.update(updates, conditions);

        for (const record of Object.values(this.records)) {
            if (conditions && !this.recordMatches(record, conditions)) {
                continue;
            }

            Object.assign(record, updates);
        }
    }

    /**
     * @inheritdoc
     */
    async updateWhere(updates: Partial<DBRecord>, conditions: CoreDatabaseConditions<DBRecord>): Promise<void> {
        await super.updateWhere(updates, conditions);

        for (const record of Object.values(this.records)) {
            if (!conditions.js(record)) {
                continue;
            }

            Object.assign(record, updates);
        }
    }

    /**
     * @inheritdoc
     */
    async delete(conditions?: Partial<DBRecord>): Promise<void> {
        await super.delete(conditions);

        if (!conditions) {
            this.records = {};

            return;
        }

        Object.entries(this.records).forEach(([id, record]) => {
            if (!this.recordMatches(record, conditions)) {
                return;
            }

            delete this.records[id];
        });
    }

    /**
     * @inheritdoc
     */
    async deleteByPrimaryKey(primaryKey: PrimaryKey): Promise<void> {
        await super.deleteByPrimaryKey(primaryKey);

        delete this.records[this.serializePrimaryKey(primaryKey)];
    }

}
