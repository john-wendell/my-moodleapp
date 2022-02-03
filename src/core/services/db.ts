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

import { SQLiteDB } from '@classes/sqlitedb';
import { SQLiteDBMock } from '@features/emulator/classes/sqlitedb';
import { makeSingleton, SQLite, Platform } from '@singletons';
import { CoreAppProvider } from './app';

/**
 * This service allows interacting with the local database to store and retrieve data.
 */
@Injectable({ providedIn: 'root' })
export class CoreDbProvider {

    queryLogs: CoreDbQueryLog[] = [];

    protected dbInstances: {[name: string]: SQLiteDB} = {};

    /**
     * Check whether database queries should be logged.
     *
     * @returns Whether queries should be logged.
     */
    loggingEnabled(): boolean {
        return CoreAppProvider.isAutomated();
    }

    /**
     * Print query history in console.
     */
    printHistory(): void {
        const substituteParams = ({ sql, params }: CoreDbQueryLog) =>
            Object.values(params ?? []).reduce((sql: string, param: string) => sql.replace('?', param), sql);

        // eslint-disable-next-line no-console
        console.log(this.queryLogs.map(substituteParams).join('\n'));
    }

    /**
     * Log a query.
     *
     * @param sql Query SQL.
     * @param params Query parameters.
     */
    logQuery(sql: string, duration: number, params?: unknown[]): void {
        this.queryLogs.push({ sql, duration, params });
    }

    /**
     * Get or create a database object.
     *
     * The database objects are cached statically.
     *
     * @param name DB name.
     * @param forceNew True if it should always create a new instance.
     * @return DB.
     */
    getDB(name: string, forceNew?: boolean): SQLiteDB {
        if (this.dbInstances[name] === undefined || forceNew) {
            if (Platform.is('cordova')) {
                this.dbInstances[name] = new SQLiteDB(name);
            } else {
                this.dbInstances[name] = new SQLiteDBMock(name);
            }
        }

        return this.dbInstances[name];
    }

    /**
     * Delete a DB.
     *
     * @param name DB name.
     * @return Promise resolved when the DB is deleted.
     */
    async deleteDB(name: string): Promise<void> {
        if (this.dbInstances[name] !== undefined) {
            // Close the database first.
            await this.dbInstances[name].close();

            const db = this.dbInstances[name];
            delete this.dbInstances[name];

            if (db instanceof SQLiteDBMock) {
                // In WebSQL we cannot delete the database, just empty it.
                return db.emptyDatabase();
            } else {
                return SQLite.deleteDatabase({
                    name,
                    location: 'default',
                });
            }
        } else if (Platform.is('cordova')) {
            return SQLite.deleteDatabase({
                name,
                location: 'default',
            });
        }
    }

}

export const CoreDB = makeSingleton(CoreDbProvider);

/**
 * Database query log entry.
 */
export interface CoreDbQueryLog {
    sql: string;
    duration: number;
    params?: unknown[];
}
