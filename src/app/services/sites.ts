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
import { Md5 } from 'ts-md5/dist/md5';
import { timeout } from 'rxjs/operators';

import { CoreApp, CoreAppSchema, CoreStoreConfig } from '@services/app';
import { CoreEvents, CoreEventsProvider } from '@services/events';
import { CoreWS } from '@services/ws';
import { CoreDomUtils } from '@services/utils/dom';
import { CoreTextUtils } from '@services/utils/text';
import { CoreUrlUtils } from '@services/utils/url';
import { CoreUtils } from '@services/utils/utils';
import { CoreConstants } from '@core/constants';
import CoreConfigConstants from '@app/config.json';
import {
    CoreSite, CoreSiteWSPreSets, LocalMobileResponse, CoreSiteConfig, CoreSitePublicConfigResponse, CoreSiteInfoResponse,
} from '@classes/site';
import { SQLiteDB, SQLiteDBTableSchema } from '@classes/sqlitedb';
import { CoreError } from '@classes/errors/error';
import { CoreSiteError } from '@classes/errors/siteerror';
import { makeSingleton, Translate, Http } from '@singletons/core.singletons';
import { CoreLogger } from '@singletons/logger';

const SITES_TABLE = 'sites_2';
const CURRENT_SITE_TABLE = 'current_site';
const SCHEMA_VERSIONS_TABLE = 'schema_versions';

/*
 * Service to manage and interact with sites.
 * It allows creating tables in the databases of all sites. Each service or component should be responsible of creating
 * their own database tables. Example:
 *
 * constructor(sitesProvider: CoreSitesProvider) {
 *     this.sitesProvider.registerSiteSchema(this.tableSchema);
 *
 * This provider will automatically create the tables in the databases of all the instantiated sites, and also to the
 * databases of sites instantiated from now on.
*/
@Injectable()
export class CoreSitesProvider {

    // Variables for the database.
    protected appTablesSchema: CoreAppSchema = {
        name: 'CoreSitesProvider',
        version: 2,
        tables: [
            {
                name: SITES_TABLE,
                columns: [
                    {
                        name: 'id',
                        type: 'TEXT',
                        primaryKey: true,
                    },
                    {
                        name: 'siteUrl',
                        type: 'TEXT',
                        notNull: true,
                    },
                    {
                        name: 'token',
                        type: 'TEXT',
                    },
                    {
                        name: 'info',
                        type: 'TEXT',
                    },
                    {
                        name: 'privateToken',
                        type: 'TEXT',
                    },
                    {
                        name: 'config',
                        type: 'TEXT',
                    },
                    {
                        name: 'loggedOut',
                        type: 'INTEGER',
                    },
                    {
                        name: 'oauthId',
                        type: 'INTEGER',
                    },
                ],
            },
            {
                name: CURRENT_SITE_TABLE,
                columns: [
                    {
                        name: 'id',
                        type: 'INTEGER',
                        primaryKey: true,
                    },
                    {
                        name: 'siteId',
                        type: 'TEXT',
                        notNull: true,
                        unique: true,
                    },
                ],
            },
        ],
        async migrate(db: SQLiteDB, oldVersion: number): Promise<void> {
            if (oldVersion < 2) {
                const newTable = SITES_TABLE;
                const oldTable = 'sites';

                try {
                    // Check if V1 table exists.
                    await db.tableExists(oldTable);

                    // Move the records from the old table.
                    const sites = await db.getAllRecords(oldTable);
                    const promises = [];

                    sites.forEach((site) => {
                        promises.push(db.insertRecord(newTable, site));
                    });

                    await Promise.all(promises);

                    // Data moved, drop the old table.
                    await db.dropTable(oldTable);
                } catch (error) {
                    // Old table does not exist, ignore.
                }
            }
        },
    };

    // Constants to validate a site version.
    protected readonly WORKPLACE_APP = 3;
    protected readonly MOODLE_APP = 2;
    protected readonly VALID_VERSION = 1;
    protected readonly INVALID_VERSION = -1;

    protected isWPApp: boolean;

    protected logger: CoreLogger;
    protected services = {};
    protected sessionRestored = false;
    protected currentSite: CoreSite;
    protected sites: { [s: string]: CoreSite } = {};
    protected appDB: SQLiteDB;
    protected dbReady: Promise<void>; // Promise resolved when the app DB is initialized.
    protected siteSchemasMigration: { [siteId: string]: Promise<void> } = {};

    // Schemas for site tables. Other providers can add schemas in here.
    protected siteSchemas: { [name: string]: CoreRegisteredSiteSchema } = {};
    protected siteTablesSchemas: SQLiteDBTableSchema[] = [
        {
            name: SCHEMA_VERSIONS_TABLE,
            columns: [
                {
                    name: 'name',
                    type: 'TEXT',
                    primaryKey: true,
                },
                {
                    name: 'version',
                    type: 'INTEGER',
                },
            ],
        },
    ];

    // Site schema for this provider.
    protected siteSchema: CoreSiteSchema = {
        name: 'CoreSitesProvider',
        version: 2,
        canBeCleared: [CoreSite.WS_CACHE_TABLE],
        tables: [
            {
                name: CoreSite.WS_CACHE_TABLE,
                columns: [
                    {
                        name: 'id',
                        type: 'TEXT',
                        primaryKey: true,
                    },
                    {
                        name: 'data',
                        type: 'TEXT',
                    },
                    {
                        name: 'key',
                        type: 'TEXT',
                    },
                    {
                        name: 'expirationTime',
                        type: 'INTEGER',
                    },
                    {
                        name: 'component',
                        type: 'TEXT',
                    },
                    {
                        name: 'componentId',
                        type: 'INTEGER',
                    },
                ],
            },
            {
                name: CoreSite.CONFIG_TABLE,
                columns: [
                    {
                        name: 'name',
                        type: 'TEXT',
                        unique: true,
                        notNull: true,
                    },
                    {
                        name: 'value',
                    },
                ],
            },
        ],
        async migrate(db: SQLiteDB, oldVersion: number): Promise<void> {
            if (oldVersion && oldVersion < 2) {
                const newTable = CoreSite.WS_CACHE_TABLE;
                const oldTable = 'wscache';

                try {
                    await db.tableExists(oldTable);
                } catch (error) {
                    // Old table does not exist, ignore.
                    return;
                }
                // Cannot use insertRecordsFrom because there are extra fields, so manually code INSERT INTO.
                await db.execute(
                    'INSERT INTO ' + newTable + ' ' +
                    'SELECT id, data, key, expirationTime, NULL as component, NULL as componentId ' +
                    'FROM ' + oldTable);

                try {
                    await db.dropTable(oldTable);
                } catch (error) {
                    // Error deleting old table, ignore.
                }
            }
        },
    };

    constructor() {
        this.logger = CoreLogger.getInstance('CoreSitesProvider');

        this.appDB = CoreApp.instance.getDB();
        this.dbReady = CoreApp.instance.createTablesFromSchema(this.appTablesSchema).catch(() => {
            // Ignore errors.
        });
        this.registerSiteSchema(this.siteSchema);
    }

    /**
     * Get the demo data for a certain "name" if it is a demo site.
     *
     * @param name Name of the site to check.
     * @return Site data if it's a demo site, undefined otherwise.
     */
    getDemoSiteData(name: string): {[name: string]: CoreSitesDemoSiteData} {
        const demoSites = CoreConfigConstants.demo_sites;
        name = name.toLowerCase();

        if (typeof demoSites != 'undefined' && typeof demoSites[name] != 'undefined') {
            return demoSites[name];
        }
    }

    /**
     * Check if a site is valid and if it has specifics settings for authentication (like force to log in using the browser).
     * It will test both protocols if the first one fails: http and https.
     *
     * @param siteUrl URL of the site to check.
     * @param protocol Protocol to use first.
     * @return A promise resolved when the site is checked.
     */
    checkSite(siteUrl: string, protocol: string = 'https://'): Promise<CoreSiteCheckResponse> {
        // The formatURL function adds the protocol if is missing.
        siteUrl = CoreUrlUtils.instance.formatURL(siteUrl);

        if (!CoreUrlUtils.instance.isHttpURL(siteUrl)) {
            return Promise.reject(new CoreError(Translate.instance.instant('core.login.invalidsite')));
        } else if (!CoreApp.instance.isOnline()) {
            return Promise.reject(new CoreError(Translate.instance.instant('core.networkerrormsg')));
        } else {
            return this.checkSiteWithProtocol(siteUrl, protocol).catch((error: CoreSiteError) => {
                // Do not continue checking if a critical error happened.
                if (error.critical) {
                    return Promise.reject(error);
                }

                // Retry with the other protocol.
                protocol = protocol == 'https://' ? 'http://' : 'https://';

                return this.checkSiteWithProtocol(siteUrl, protocol).catch((secondError: CoreSiteError) => {
                    if (secondError.critical) {
                        return Promise.reject(secondError);
                    }

                    // Site doesn't exist. Return the error message.
                    if (CoreTextUtils.instance.getErrorMessageFromError(error)) {
                        return Promise.reject(error);
                    } else if (CoreTextUtils.instance.getErrorMessageFromError(secondError)) {
                        return Promise.reject(secondError);
                    } else {
                        return Translate.instance.instant('core.cannotconnecttrouble');
                    }
                });
            });
        }
    }

    /**
     * Helper function to check if a site is valid and if it has specifics settings for authentication.
     *
     * @param siteUrl URL of the site to check.
     * @param protocol Protocol to use.
     * @return A promise resolved when the site is checked.
     */
    checkSiteWithProtocol(siteUrl: string, protocol: string): Promise<CoreSiteCheckResponse> {
        let publicConfig: CoreSitePublicConfigResponse;

        // Now, replace the siteUrl with the protocol.
        siteUrl = siteUrl.replace(/^https?:\/\//i, protocol);

        return this.siteExists(siteUrl).catch((error: CoreSiteError) => {
            // Do not continue checking if WS are not enabled.
            if (error.errorcode == 'enablewsdescription') {
                error.critical = true;

                return Promise.reject(error);
            }

            // Site doesn't exist. Try to add or remove 'www'.
            const treatedUrl = CoreUrlUtils.instance.addOrRemoveWWW(siteUrl);

            return this.siteExists(treatedUrl).then(() => {
                // Success, use this new URL as site url.
                siteUrl = treatedUrl;
            }).catch((secondError: CoreSiteError) => {
                // Do not continue checking if WS are not enabled.
                if (secondError.errorcode == 'enablewsdescription') {
                    secondError.critical = true;

                    return Promise.reject(secondError);
                }

                // Return the error.
                if (CoreTextUtils.instance.getErrorMessageFromError(error)) {
                    return Promise.reject(error);
                } else {
                    return Promise.reject(secondError);
                }
            });
        }).then(() => {
            // Create a temporary site to check if local_mobile is installed.
            const temporarySite = new CoreSite(undefined, siteUrl);

            return temporarySite.checkLocalMobilePlugin().then((data) => {
                data.service = data.service || CoreConfigConstants.wsservice;
                this.services[siteUrl] = data.service; // No need to store it in DB.

                if (data.coreSupported ||
                    (data.code != CoreConstants.LOGIN_SSO_CODE && data.code != CoreConstants.LOGIN_SSO_INAPP_CODE)) {
                    // SSO using local_mobile not needed, try to get the site public config.
                    return temporarySite.getPublicConfig().then((config) => {
                        publicConfig = config;

                        // Check that the user can authenticate.
                        if (!config.enablewebservices) {
                            return Promise.reject(new CoreSiteError({
                                message: Translate.instance.instant('core.login.webservicesnotenabled'),
                            }));
                        } else if (!config.enablemobilewebservice) {
                            return Promise.reject(new CoreSiteError({
                                message: Translate.instance.instant('core.login.mobileservicesnotenabled'),
                            }));
                        } else if (config.maintenanceenabled) {
                            let message = Translate.instance.instant('core.sitemaintenance');
                            if (config.maintenancemessage) {
                                message += config.maintenancemessage;
                            }

                            return Promise.reject(new CoreSiteError({
                                message,
                            }));
                        }

                        // Everything ok.
                        if (data.code === 0) {
                            data.code = config.typeoflogin;
                        }

                        return data;
                    }, async (error) => {
                        // Error, check if not supported.
                        if (error.available === 1) {
                            // Service supported but an error happened. Return error.
                            if (error.errorcode == 'codingerror') {
                                // This could be caused by a redirect. Check if it's the case.
                                const redirect = await CoreUtils.instance.checkRedirect(siteUrl);

                                if (redirect) {
                                    error.error = Translate.instance.instant('core.login.sitehasredirect');
                                } else {
                                    // We can't be sure if there is a redirect or not. Display cannot connect error.
                                    error.error = Translate.instance.instant('core.cannotconnecttrouble');
                                }
                            }

                            return Promise.reject(new CoreSiteError({
                                message: error.error,
                                errorcode: error.errorcode,
                                critical: true,
                            }));
                        }

                        return data;
                    });
                }

                return data;
            }, (error: CoreError) =>
                // Local mobile check returned an error. This only happens if the plugin is installed and it returns an error.
                Promise.reject(new CoreSiteError({
                    message: error.message,
                    critical: true,
                })),
            ).then((data: LocalMobileResponse) => {
                siteUrl = temporarySite.getURL();

                return { siteUrl, code: data.code, warning: data.warning, service: data.service, config: publicConfig };
            });
        });
    }

    /**
     * Check if a site exists.
     *
     * @param siteUrl URL of the site to check.
     * @return A promise to be resolved if the site exists.
     */
    async siteExists(siteUrl: string): Promise<void> {
        let data: CoreSitesLoginTokenResponse;

        try {
            data = await Http.instance.post(siteUrl + '/login/token.php', {}).pipe(timeout(CoreWS.instance.getRequestTimeout()))
                .toPromise();
        } catch (error) {
            // Default error messages are kinda bad, return our own message.
            throw new CoreSiteError({
                message: Translate.instance.instant('core.cannotconnecttrouble'),
            });
        }

        if (data === null) {
            // Cannot connect.
            throw new CoreSiteError({
                message: Translate.instance.instant('core.cannotconnect', { $a: CoreSite.MINIMUM_MOODLE_VERSION }),
            });
        }

        if (data.errorcode && (data.errorcode == 'enablewsdescription' || data.errorcode == 'requirecorrectaccess')) {
            throw new CoreSiteError({
                errorcode: data.errorcode,
                message: data.error,
            });
        }

        if (data.error && data.error == 'Web services must be enabled in Advanced features.') {
            throw new CoreSiteError({
                errorcode: 'enablewsdescription',
                message: data.error,
            });
        }

        // Other errors are not being checked because invalid login will be always raised and we cannot differ them.
    }

    /**
     * Gets a user token from the server.
     *
     * @param siteUrl The site url.
     * @param username User name.
     * @param password Password.
     * @param service Service to use. If not defined, it will be searched in memory.
     * @param retry Whether we are retrying with a prefixed URL.
     * @return A promise resolved when the token is retrieved.
     */
    getUserToken(siteUrl: string, username: string, password: string, service?: string, retry?: boolean):
            Promise<CoreSiteUserTokenResponse> {
        if (!CoreApp.instance.isOnline()) {
            return Promise.reject(new CoreError(Translate.instance.instant('core.networkerrormsg')));
        }

        if (!service) {
            service = this.determineService(siteUrl);
        }

        const params = {
            username,
            password,
            service,
        };
        const loginUrl = siteUrl + '/login/token.php';
        const promise = Http.instance.post(loginUrl, params).pipe(timeout(CoreWS.instance.getRequestTimeout())).toPromise();

        return promise.then((data: CoreSitesLoginTokenResponse) => {
            if (typeof data == 'undefined') {
                return Promise.reject(new CoreError(Translate.instance.instant('core.cannotconnecttrouble')));
            } else {
                if (typeof data.token != 'undefined') {
                    return { token: data.token, siteUrl, privateToken: data.privatetoken };
                } else {
                    if (typeof data.error != 'undefined') {
                        // We only allow one retry (to avoid loops).
                        if (!retry && data.errorcode == 'requirecorrectaccess') {
                            siteUrl = CoreUrlUtils.instance.addOrRemoveWWW(siteUrl);

                            return this.getUserToken(siteUrl, username, password, service, true);
                        } else if (data.errorcode == 'missingparam') {
                            // It seems the server didn't receive all required params, it could be due to a redirect.
                            return CoreUtils.instance.checkRedirect(loginUrl).then((redirect) => {
                                if (redirect) {
                                    return Promise.reject(new CoreSiteError({
                                        message: Translate.instance.instant('core.login.sitehasredirect'),
                                    }));
                                } else {
                                    return Promise.reject(new CoreSiteError({
                                        message: data.error,
                                        errorcode: data.errorcode,
                                    }));
                                }
                            });
                        } else {
                            return Promise.reject(new CoreSiteError({
                                message: data.error,
                                errorcode: data.errorcode,
                            }));
                        }
                    } else {
                        return Promise.reject(new CoreError(Translate.instance.instant('core.login.invalidaccount')));
                    }
                }
            }
        }, () => Promise.reject(new CoreError(Translate.instance.instant('core.cannotconnecttrouble'))));
    }

    /**
     * Add a new site to the site list and authenticate the user in this site.
     *
     * @param siteUrl The site url.
     * @param token User's token.
     * @param privateToken User's private token.
     * @param login Whether to login the user in the site. Defaults to true.
     * @param oauthId OAuth ID. Only if the authentication was using an OAuth method.
     * @return A promise resolved with siteId when the site is added and the user is authenticated.
     */
    newSite(siteUrl: string, token: string, privateToken: string = '', login: boolean = true, oauthId?: number): Promise<string> {
        if (typeof login != 'boolean') {
            login = true;
        }

        // Create a "candidate" site to fetch the site info.
        let candidateSite = new CoreSite(undefined, siteUrl, token, undefined, privateToken, undefined, undefined);
        let isNewSite = true;

        return candidateSite.fetchSiteInfo().then((info) => {
            const result = this.isValidMoodleVersion(info);
            if (result == this.VALID_VERSION) {
                const siteId = this.createSiteID(info.siteurl, info.username);

                // Check if the site already exists.
                return this.getSite(siteId).catch(() => {
                    // Not exists.
                }).then((site) => {
                    if (site) {
                        // Site already exists, update its data and use it.
                        isNewSite = false;
                        candidateSite = site;
                        candidateSite.setToken(token);
                        candidateSite.setPrivateToken(privateToken);
                        candidateSite.setInfo(info);
                        candidateSite.setOAuthId(oauthId);
                        candidateSite.setLoggedOut(false);
                    } else {
                        // New site, set site ID and info.
                        isNewSite = true;
                        candidateSite.setId(siteId);
                        candidateSite.setInfo(info);
                        candidateSite.setOAuthId(oauthId);

                        // Create database tables before login and before any WS call.
                        return this.migrateSiteSchemas(candidateSite);
                    }
                }).then(() =>

                    // Try to get the site config.
                    this.getSiteConfig(candidateSite).catch((error) => {
                        // Ignore errors if it's not a new site, we'll use the config already stored.
                        if (isNewSite) {
                            return Promise.reject(error);
                        }
                    }).then((config) => {
                        if (typeof config != 'undefined') {
                            candidateSite.setConfig(config);
                        }

                        // Add site to sites list.
                        this.addSite(siteId, siteUrl, token, info, privateToken, config, oauthId);
                        this.sites[siteId] = candidateSite;

                        if (login) {
                            // Turn candidate site into current site.
                            this.currentSite = candidateSite;
                            // Store session.
                            this.login(siteId);
                        }

                        CoreEvents.instance.trigger(CoreEventsProvider.SITE_ADDED, info, siteId);

                        return siteId;
                    }),
                );
            }

            return this.treatInvalidAppVersion(result, siteUrl);
        }).catch((error) => {
            // Error invaliddevice is returned by Workplace server meaning the same as connecttoworkplaceapp.
            if (error && error.errorcode == 'invaliddevice') {
                return this.treatInvalidAppVersion(this.WORKPLACE_APP, siteUrl);
            }

            return Promise.reject(error);
        });
    }

    /**
     * Having the result of isValidMoodleVersion, it treats the error message to be shown.
     *
     * @param result Result returned by isValidMoodleVersion function.
     * @param siteUrl The site url.
     * @param siteId If site is already added, it will invalidate the token.
     * @return A promise rejected with the error info.
     */
    protected async treatInvalidAppVersion(result: number, siteUrl: string, siteId?: string): Promise<never> {
        let errorCode;
        let errorKey;
        let translateParams;

        switch (result) {
            case this.MOODLE_APP:
                errorKey = 'core.login.connecttomoodleapp';
                errorCode = 'connecttomoodleapp';
                break;
            case this.WORKPLACE_APP:
                errorKey = 'core.login.connecttoworkplaceapp';
                errorCode = 'connecttoworkplaceapp';
                break;
            default:
                errorCode = 'invalidmoodleversion';
                errorKey = 'core.login.invalidmoodleversion';
                translateParams = { $a: CoreSite.MINIMUM_MOODLE_VERSION };
        }

        if (siteId) {
            await this.setSiteLoggedOut(siteId, true);
        }

        throw new CoreSiteError({
            message: Translate.instance.instant(errorKey, translateParams),
            errorcode: errorCode,
            loggedOut: true,
        });
    }

    /**
     * Create a site ID based on site URL and username.
     *
     * @param siteUrl The site url.
     * @param username Username.
     * @return Site ID.
     */
    createSiteID(siteUrl: string, username: string): string {
        return <string> Md5.hashAsciiStr(siteUrl + username);
    }

    /**
     * Function for determine which service we should use (default or extended plugin).
     *
     * @param siteUrl The site URL.
     * @return The service shortname.
     */
    determineService(siteUrl: string): string {
        // We need to try siteUrl in both https or http (due to loginhttps setting).

        // First http://
        siteUrl = siteUrl.replace('https://', 'http://');
        if (this.services[siteUrl]) {
            return this.services[siteUrl];
        }

        // Now https://
        siteUrl = siteUrl.replace('http://', 'https://');
        if (this.services[siteUrl]) {
            return this.services[siteUrl];
        }

        // Return default service.
        return CoreConfigConstants.wsservice;
    }

    /**
     * Check for the minimum required version.
     *
     * @param info Site info.
     * @return Either VALID_VERSION, WORKPLACE_APP, MOODLE_APP or INVALID_VERSION.
     */
    protected isValidMoodleVersion(info: CoreSiteInfoResponse): number {
        if (!info) {
            return this.INVALID_VERSION;
        }

        const version31 = 2016052300;
        const release31 = CoreSite.MINIMUM_MOODLE_VERSION;

        // Try to validate by version.
        if (info.version) {
            const version = parseInt(info.version, 10);
            if (!isNaN(version)) {
                if (version >= version31) {
                    return this.validateWorkplaceVersion(info);
                }
            }
        }

        // We couldn't validate by version number. Let's try to validate by release number.
        const release = this.getReleaseNumber(info.release || '');
        if (release) {
            if (release >= release31) {
                return this.validateWorkplaceVersion(info);
            }
        }

        // Couldn't validate it.
        return this.INVALID_VERSION;
    }

    /**
     * Check if needs to be redirected to specific Workplace App or general Moodle App.
     *
     * @param info Site info.
     * @return Either VALID_VERSION, WORKPLACE_APP or MOODLE_APP.
     */
    protected validateWorkplaceVersion(info: CoreSiteInfoResponse): number {
        const isWorkplace = !!info.functions && info.functions.some((func) => func.name == 'tool_program_get_user_programs');

        if (typeof this.isWPApp == 'undefined') {
            this.isWPApp = false; // @todo
        }

        if (!this.isWPApp && isWorkplace) {
            return this.WORKPLACE_APP;
        }

        if (this.isWPApp && !isWorkplace) {
            return this.MOODLE_APP;
        }

        return this.VALID_VERSION;
    }

    /**
     * Returns the release number from site release info.
     *
     * @param rawRelease Raw release info text.
     * @return Release number or empty.
     */
    getReleaseNumber(rawRelease: string): string {
        const matches = rawRelease.match(/^\d(\.\d(\.\d+)?)?/);
        if (matches) {
            return matches[0];
        }

        return '';
    }

    /**
     * Saves a site in local DB.
     *
     * @param id Site ID.
     * @param siteUrl Site URL.
     * @param token User's token in the site.
     * @param info Site's info.
     * @param privateToken User's private token.
     * @param config Site config (from tool_mobile_get_config).
     * @param oauthId OAuth ID. Only if the authentication was using an OAuth method.
     * @return Promise resolved when done.
     */
    async addSite(id: string, siteUrl: string, token: string, info: CoreSiteInfoResponse, privateToken: string = '',
            config?: CoreSiteConfig, oauthId?: number): Promise<void> {
        await this.dbReady;

        const entry = {
            id,
            siteUrl,
            token,
            info: info ? JSON.stringify(info) : info,
            privateToken,
            config: config ? JSON.stringify(config) : config,
            loggedOut: 0,
            oauthId,
        };

        await this.appDB.insertRecord(SITES_TABLE, entry);
    }

    /**
     * Check the app for a site and show a download dialogs if necessary.
     *
     * @param response Data obtained during site check.
     */
    async checkApplication(response: CoreSiteCheckResponse): Promise<void> {
        await this.checkRequiredMinimumVersion(response.config);
    }

    /**
     * Check the required minimum version of the app for a site and shows a download dialog.
     *
     * @param  config Config object of the site.
     * @param siteId ID of the site to check. Current site id will be used otherwise.
     * @return Resolved with  if meets the requirements, rejected otherwise.
     */
    async checkRequiredMinimumVersion(config: CoreSitePublicConfigResponse, siteId?: string): Promise<void> {
        if (config && config.tool_mobile_minimumversion) {
            const requiredVersion = this.convertVersionName(config.tool_mobile_minimumversion);
            const appVersion = this.convertVersionName(CoreConfigConstants.versionname);

            if (requiredVersion > appVersion) {
                const storesConfig: CoreStoreConfig = {
                    android: config.tool_mobile_androidappid || null,
                    ios: config.tool_mobile_iosappid || null,
                    desktop: config.tool_mobile_setuplink || 'https://download.moodle.org/desktop/',
                    mobile: config.tool_mobile_setuplink || 'https://download.moodle.org/mobile/',
                    default: config.tool_mobile_setuplink,
                };

                const downloadUrl = CoreApp.instance.getAppStoreUrl(storesConfig);

                siteId = siteId || this.getCurrentSiteId();

                // Do not block interface.
                CoreDomUtils.instance.showConfirm(
                    Translate.instance.instant('core.updaterequireddesc', { $a: config.tool_mobile_minimumversion }),
                    Translate.instance.instant('core.updaterequired'),
                    Translate.instance.instant('core.download'),
                    Translate.instance.instant(siteId ? 'core.mainmenu.logout' : 'core.cancel')).then(() => {
                    CoreUtils.instance.openInBrowser(downloadUrl);
                }).catch(() => {
                    // Do nothing.
                });

                if (siteId) {
                    // Logout if it's the currentSite.
                    if (siteId == this.getCurrentSiteId()) {
                        await this.logout();
                    }

                    // Always expire the token.
                    await this.setSiteLoggedOut(siteId, true);
                }

                throw new CoreError('Current app version is lower than required version.');
            }
        }
    }

    /**
     * Convert version name to numbers.
     *
     * @param  name Version name (dot separated).
     * @return Version translated to a comparable number.
     */
    protected convertVersionName(name: string): number {
        let version = 0;

        const parts = name.split('-')[0].split('.', 3);
        parts.forEach((num) => {
            version = (version * 100) + Number(num);
        });

        if (parts.length < 3) {
            version = version * Math.pow(100, 3 - parts.length);
        }

        return version;
    }

    /**
     * Login a user to a site from the list of sites.
     *
     * @param siteId ID of the site to load.
     * @param pageName Name of the page to go once authenticated if logged out. If not defined, site initial page.
     * @param params Params of the page to go once authenticated if logged out.
     * @return Promise resolved with true if site is loaded, resolved with false if cannot login.
     */
    async loadSite(siteId: string, pageName?: string, params?: Record<string, unknown>): Promise<boolean> {
        this.logger.debug(`Load site ${siteId}`);

        const site = await this.getSite(siteId);

        this.currentSite = site;

        if (site.isLoggedOut()) {
            // Logged out, trigger session expired event and stop.
            CoreEvents.instance.trigger(CoreEventsProvider.SESSION_EXPIRED, {
                pageName,
                params,
            }, site.getId());

            return false;
        }

        // Check if local_mobile was installed to Moodle.
        try {
            await site.checkIfLocalMobileInstalledAndNotUsed();

            // Local mobile was added. Throw invalid session to force reconnect and create a new token.
            CoreEvents.instance.trigger(CoreEventsProvider.SESSION_EXPIRED, {
                pageName,
                params,
            }, siteId);

            return false;
        } catch (error) {
            let config: CoreSitePublicConfigResponse;

            try {
                config = await site.getPublicConfig();
            } catch (error) {
                // Error getting config, probably the site doesn't have the WS
            }

            try {
                await this.checkRequiredMinimumVersion(config);

                this.login(siteId);
                // Update site info. We don't block the UI.
                this.updateSiteInfo(siteId);

                return true;
            } catch (error) {
                return false;
            }
        }
    }

    /**
     * Get current site.
     *
     * @return Current site.
     */
    getCurrentSite(): CoreSite {
        return this.currentSite;
    }

    /**
     * Get the site home ID of the current site.
     *
     * @return Current site home ID.
     */
    getCurrentSiteHomeId(): number {
        if (this.currentSite) {
            return this.currentSite.getSiteHomeId();
        } else {
            return 1;
        }
    }

    /**
     * Get current site ID.
     *
     * @return Current site ID.
     */
    getCurrentSiteId(): string {
        if (this.currentSite) {
            return this.currentSite.getId();
        } else {
            return '';
        }
    }

    /**
     * Get current site User ID.
     *
     * @return Current site User ID.
     */
    getCurrentSiteUserId(): number {
        if (this.currentSite) {
            return this.currentSite.getUserId();
        } else {
            return 0;
        }
    }

    /**
     * Check if the user is logged in a site.
     *
     * @return Whether the user is logged in a site.
     */
    isLoggedIn(): boolean {
        return typeof this.currentSite != 'undefined' && typeof this.currentSite.token != 'undefined' &&
            this.currentSite.token != '';
    }

    /**
     * Delete a site from the sites list.
     *
     * @param siteId ID of the site to delete.
     * @return Promise to be resolved when the site is deleted.
     */
    async deleteSite(siteId: string): Promise<void> {
        await this.dbReady;

        this.logger.debug(`Delete site ${siteId}`);

        if (typeof this.currentSite != 'undefined' && this.currentSite.id == siteId) {
            this.logout();
        }

        const site = await this.getSite(siteId);

        await site.deleteDB();

        // Site DB deleted, now delete the app from the list of sites.
        delete this.sites[siteId];

        try {
            await this.appDB.deleteRecords(SITES_TABLE, { id: siteId });
        } catch (err) {
            // DB remove shouldn't fail, but we'll go ahead even if it does.
        }

        // Site deleted from sites list, now delete the folder.
        await site.deleteFolder();

        CoreEvents.instance.trigger(CoreEventsProvider.SITE_DELETED, site, siteId);
    }

    /**
     * Check if there are sites stored.
     *
     * @return Promise resolved with true if there are sites and false if there aren't.
     */
    async hasSites(): Promise<boolean> {
        await this.dbReady;

        const count = await this.appDB.countRecords(SITES_TABLE);

        return count > 0;
    }

    /**
     * Returns a site object.
     *
     * @param siteId The site ID. If not defined, current site (if available).
     * @return Promise resolved with the site.
     */
    async getSite(siteId?: string): Promise<CoreSite> {
        await this.dbReady;

        if (!siteId) {
            if (this.currentSite) {
                return this.currentSite;
            }

            throw new CoreError('No current site found.');
        } else if (this.currentSite && this.currentSite.getId() == siteId) {
            return this.currentSite;
        } else if (typeof this.sites[siteId] != 'undefined') {
            return this.sites[siteId];
        } else {
            // Retrieve and create the site.
            const data = await this.appDB.getRecord(SITES_TABLE, { id: siteId });

            return this.makeSiteFromSiteListEntry(data);
        }
    }

    /**
     * Create a site from an entry of the sites list DB. The new site is added to the list of "cached" sites: this.sites.
     *
     * @param entry Site list entry.
     * @return Promised resolved with the created site.
     */
    makeSiteFromSiteListEntry(entry: any): Promise<CoreSite> {
        let info = entry.info;
        let config = entry.config;

        // Parse info and config.
        info = info ? CoreTextUtils.instance.parseJSON(info) : info;
        config = config ? CoreTextUtils.instance.parseJSON(config) : config;

        const site = new CoreSite(entry.id, entry.siteUrl, entry.token,
            info, entry.privateToken, config, entry.loggedOut == 1);
        site.setOAuthId(entry.oauthId);

        return this.migrateSiteSchemas(site).then(() => {
            // Set site after migrating schemas, or a call to getSite could get the site while tables are being created.
            this.sites[entry.id] = site;

            return site;
        });
    }

    /**
     * Returns if the site is the current one.
     *
     * @param site Site object or siteId to be compared. If not defined, use current site.
     * @return Whether site or siteId is the current one.
     */
    isCurrentSite(site: string | CoreSite): boolean {
        if (!site || !this.currentSite) {
            return !!this.currentSite;
        }

        const siteId = typeof site == 'object' ? site.getId() : site;

        return this.currentSite.getId() === siteId;
    }

    /**
     * Returns the database object of a site.
     *
     * @param siteId The site ID. If not defined, current site (if available).
     * @return Promise resolved with the database.
     */
    getSiteDb(siteId: string): Promise<SQLiteDB> {
        return this.getSite(siteId).then((site) => site.getDb());
    }

    /**
     * Returns the site home ID of a site.
     *
     * @param siteId The site ID. If not defined, current site (if available).
     * @return Promise resolved with site home ID.
     */
    getSiteHomeId(siteId?: string): Promise<number> {
        return this.getSite(siteId).then((site) => site.getSiteHomeId());
    }

    /**
     * Get the list of sites stored.
     *
     * @param ids IDs of the sites to get. If not defined, return all sites.
     * @return Promise resolved when the sites are retrieved.
     */
    async getSites(ids?: string[]): Promise<CoreSiteBasicInfo[]> {
        await this.dbReady;

        const sites = await this.appDB.getAllRecords(SITES_TABLE);

        const formattedSites = [];
        sites.forEach((site) => {
            if (!ids || ids.indexOf(site.id) > -1) {
                // Parse info.
                const siteInfo = site.info ? CoreTextUtils.instance.parseJSON(site.info) : site.info;
                const basicInfo: CoreSiteBasicInfo = {
                    id: site.id,
                    siteUrl: site.siteUrl,
                    fullName: siteInfo && siteInfo.fullname,
                    siteName: CoreConfigConstants.sitename ? CoreConfigConstants.sitename : siteInfo && siteInfo.sitename,
                    avatar: siteInfo && siteInfo.userpictureurl,
                    siteHomeId: siteInfo && siteInfo.siteid || 1,
                };
                formattedSites.push(basicInfo);
            }
        });

        return formattedSites;
    }

    /**
     * Get the list of sites stored, sorted by URL and full name.
     *
     * @param ids IDs of the sites to get. If not defined, return all sites.
     * @return Promise resolved when the sites are retrieved.
     */
    getSortedSites(ids?: string[]): Promise<CoreSiteBasicInfo[]> {
        return this.getSites(ids).then((sites) => {
            // Sort sites by url and ful lname.
            sites.sort((a, b) => {
                // First compare by site url without the protocol.
                let compareA = a.siteUrl.replace(/^https?:\/\//, '').toLowerCase();
                let compareB = b.siteUrl.replace(/^https?:\/\//, '').toLowerCase();
                const compare = compareA.localeCompare(compareB);

                if (compare !== 0) {
                    return compare;
                }

                // If site url is the same, use fullname instead.
                compareA = a.fullName.toLowerCase().trim();
                compareB = b.fullName.toLowerCase().trim();

                return compareA.localeCompare(compareB);
            });

            return sites;
        });
    }

    /**
     * Get the list of IDs of sites stored and not logged out.
     *
     * @return Promise resolved when the sites IDs are retrieved.
     */
    async getLoggedInSitesIds(): Promise<string[]> {
        await this.dbReady;

        const sites = await this.appDB.getRecords(SITES_TABLE, { loggedOut : 0 });

        return sites.map((site) => site.id);
    }

    /**
     * Get the list of IDs of sites stored.
     *
     * @return Promise resolved when the sites IDs are retrieved.
     */
    async getSitesIds(): Promise<string[]> {
        await this.dbReady;

        const sites = await this.appDB.getAllRecords(SITES_TABLE);

        return sites.map((site) => site.id);
    }

    /**
     * Login the user in a site.
     *
     * @param siteid ID of the site the user is accessing.
     * @return Promise resolved when current site is stored.
     */
    async login(siteId: string): Promise<void> {
        await this.dbReady;

        const entry = {
            id: 1,
            siteId,
        };

        await this.appDB.insertRecord(CURRENT_SITE_TABLE, entry);

        CoreEvents.instance.trigger(CoreEventsProvider.LOGIN, {}, siteId);
    }

    /**
     * Logout the user.
     *
     * @return Promise resolved when the user is logged out.
     */
    async logout(): Promise<void> {
        await this.dbReady;

        let siteId;
        const promises = [];

        if (this.currentSite) {
            const siteConfig = <CoreSiteConfig> this.currentSite.getStoredConfig();
            siteId = this.currentSite.getId();

            this.currentSite = undefined;

            if (siteConfig && siteConfig.tool_mobile_forcelogout == '1') {
                promises.push(this.setSiteLoggedOut(siteId, true));
            }

            promises.push(this.appDB.deleteRecords(CURRENT_SITE_TABLE, { id: 1 }));
        }

        try {
            await Promise.all(promises);
        } finally {
            CoreEvents.instance.trigger(CoreEventsProvider.LOGOUT, {}, siteId);
        }
    }

    /**
     * Restores the session to the previous one so the user doesn't has to login everytime the app is started.
     *
     * @return Promise resolved if a session is restored.
     */
    async restoreSession(): Promise<void> {
        if (this.sessionRestored) {
            return Promise.reject(new CoreError('Session already restored.'));
        }

        await this.dbReady;

        this.sessionRestored = true;

        try {
            const currentSite = await this.appDB.getRecord(CURRENT_SITE_TABLE, { id: 1 });
            const siteId = currentSite.siteId;
            this.logger.debug(`Restore session in site ${siteId}`);

            await this.loadSite(siteId);
        } catch (err) {
            // No current session.
        }
    }

    /**
     * Mark or unmark a site as logged out so the user needs to authenticate again.
     *
     * @param siteId ID of the site.
     * @param loggedOut True to set the site as logged out, false otherwise.
     * @return Promise resolved when done.
     */
    async setSiteLoggedOut(siteId: string, loggedOut: boolean): Promise<void> {
        await this.dbReady;

        const site = await this.getSite(siteId);
        const newValues = {
            token: '', // Erase the token for security.
            loggedOut: loggedOut ? 1 : 0,
        };

        site.setLoggedOut(loggedOut);

        await this.appDB.updateRecords(SITES_TABLE, newValues, { id: siteId });
    }

    /**
     * Unset current site.
     */
    unsetCurrentSite(): void {
        this.currentSite = undefined;
    }

    /**
     * Updates a site's token.
     *
     * @param siteUrl Site's URL.
     * @param username Username.
     * @param token User's new token.
     * @param privateToken User's private token.
     * @return A promise resolved when the site is updated.
     */
    async updateSiteToken(siteUrl: string, username: string, token: string, privateToken: string = ''): Promise<void> {
        const siteId = this.createSiteID(siteUrl, username);

        await this.updateSiteTokenBySiteId(siteId, token, privateToken);

        await this.login(siteId);
    }

    /**
     * Updates a site's token using siteId.
     *
     * @param siteId Site Id.
     * @param token User's new token.
     * @param privateToken User's private token.
     * @return A promise resolved when the site is updated.
     */
    async updateSiteTokenBySiteId(siteId: string, token: string, privateToken: string = ''): Promise<void> {
        await this.dbReady;

        const site = await this.getSite(siteId);
        const newValues = {
            token,
            privateToken,
            loggedOut: 0,
        };

        site.token = token;
        site.privateToken = privateToken;
        site.setLoggedOut(false); // Token updated means the user authenticated again, not logged out anymore.

        await this.appDB.updateRecords(SITES_TABLE, newValues, { id: siteId });
    }

    /**
     * Updates a site's info.
     *
     * @param siteid Site's ID.
     * @return A promise resolved when the site is updated.
     */
    async updateSiteInfo(siteId: string): Promise<void> {
        await this.dbReady;

        const site = await this.getSite(siteId);

        try {
            const info = await site.fetchSiteInfo();
            site.setInfo(info);

            const versionCheck = this.isValidMoodleVersion(info);
            if (versionCheck != this.VALID_VERSION) {
                // The Moodle version is not supported, reject.
                return this.treatInvalidAppVersion(versionCheck, site.getURL(), site.getId());
            }

            // Try to get the site config.
            let config;

            try {
                config = await this.getSiteConfig(site);
            } catch (error) {
                // Error getting config, keep the current one.
            }

            const newValues = {
                info: JSON.stringify(info),
                loggedOut: site.isLoggedOut() ? 1 : 0,
                config: undefined,
            };

            if (typeof config != 'undefined') {
                site.setConfig(config);
                newValues.config = JSON.stringify(config);
            }

            try {
                await this.appDB.updateRecords(SITES_TABLE, newValues, { id: siteId });
            } finally {
                CoreEvents.instance.trigger(CoreEventsProvider.SITE_UPDATED, info, siteId);
            }
        } catch (error) {
            // Ignore that we cannot fetch site info. Probably the auth token is invalid.
        }
    }

    /**
     * Updates a site's info.
     *
     * @param siteUrl Site's URL.
     * @param username Username.
     * @return A promise to be resolved when the site is updated.
     */
    updateSiteInfoByUrl(siteUrl: string, username: string): Promise<void> {
        const siteId = this.createSiteID(siteUrl, username);

        return this.updateSiteInfo(siteId);
    }

    /**
     * Get the site IDs a URL belongs to.
     * Someone can have more than one account in the same site, that's why this function returns an array of IDs.
     *
     * @param url URL to check.
     * @param prioritize True if it should prioritize current site. If the URL belongs to current site then it won't
     *                   check any other site, it will only return current site.
     * @param username If set, it will return only the sites where the current user has this username.
     * @return Promise resolved with the site IDs (array).
     */
    async getSiteIdsFromUrl(url: string, prioritize?: boolean, username?: string): Promise<string[]> {
        await this.dbReady;

        // If prioritize is true, check current site first.
        if (prioritize && this.currentSite && this.currentSite.containsUrl(url)) {
            if (!username || this.currentSite.getInfo().username == username) {
                return [this.currentSite.getId()];
            }
        }

        // Check if URL has http(s) protocol.
        if (!url.match(/^https?:\/\//i)) {
            // URL doesn't have http(s) protocol. Check if it has any protocol.
            if (CoreUrlUtils.instance.isAbsoluteURL(url)) {
                // It has some protocol. Return empty array.
                return [];
            } else {
                // No protocol, probably a relative URL. Return current site.
                if (this.currentSite) {
                    return [this.currentSite.getId()];
                } else {
                    return [];
                }
            }
        }

        try {
            const siteEntries = await this.appDB.getAllRecords(SITES_TABLE);
            const ids = [];
            const promises = [];

            siteEntries.forEach((site) => {
                if (!this.sites[site.id]) {
                    promises.push(this.makeSiteFromSiteListEntry(site));
                }

                if (this.sites[site.id].containsUrl(url)) {
                    if (!username || this.sites[site.id].getInfo().username == username) {
                        ids.push(site.id);
                    }
                }
            });

            await Promise.all(promises);

            return ids;
        } catch (error) {
            // Shouldn't happen.
            return [];
        }
    }

    /**
     * Get the site ID stored in DB as current site.
     *
     * @return Promise resolved with the site ID.
     */
    async getStoredCurrentSiteId(): Promise<string> {
        await this.dbReady;

        const currentSite = await this.appDB.getRecord(CURRENT_SITE_TABLE, { id: 1 });

        return currentSite.siteId;
    }

    /**
     * Get the public config of a certain site.
     *
     * @param siteUrl URL of the site.
     * @return Promise resolved with the public config.
     */
    getSitePublicConfig(siteUrl: string): Promise<CoreSitePublicConfigResponse> {
        const temporarySite = new CoreSite(undefined, siteUrl);

        return temporarySite.getPublicConfig();
    }

    /**
     * Get site config.
     *
     * @param site The site to get the config.
     * @return Promise resolved with config if available.
     */
    protected async getSiteConfig(site: CoreSite): Promise<CoreSiteConfig> {
        if (!site.wsAvailable('tool_mobile_get_config')) {
            // WS not available, cannot get config.
            return;
        }

        const config = <CoreSiteConfig> await site.getConfig(undefined, true);

        return config;
    }

    /**
     * Check if a certain feature is disabled in a site.
     *
     * @param name Name of the feature to check.
     * @param siteId The site ID. If not defined, current site (if available).
     * @return Promise resolved with true if disabled.
     */
    isFeatureDisabled(name: string, siteId?: string): Promise<boolean> {
        return this.getSite(siteId).then((site) => site.isFeatureDisabled(name));
    }

    /**
     * Create a table in all the sites databases.
     *
     * @param table Table schema.
     * @deprecated. Please use registerSiteSchema instead.
     */
    createTableFromSchema(table: SQLiteDBTableSchema): void {
        this.createTablesFromSchema([table]);
    }

    /**
     * Create several tables in all the sites databases.
     *
     * @param tables List of tables schema.
     * @deprecated. Please use registerSiteSchema instead.
     */
    createTablesFromSchema(tables: SQLiteDBTableSchema[]): void {
        // Add the tables to the list of schemas. This list is to create all the tables in new sites.
        this.siteTablesSchemas = this.siteTablesSchemas.concat(tables);

        // Now create these tables in current sites.
        for (const id in this.sites) {
            this.sites[id].getDb().createTablesFromSchema(tables);
        }
    }

    /**
     * Check if a WS is available in the current site, if any.
     *
     * @param method WS name.
     * @param checkPrefix When true also checks with the compatibility prefix.
     * @return Whether the WS is available.
     */
    wsAvailableInCurrentSite(method: string, checkPrefix: boolean = true): boolean {
        const site = this.getCurrentSite();

        return site && site.wsAvailable(method, checkPrefix);
    }

    /**
     * Register a site schema.
     *
     * @param schema The schema to register.
     * @return Promise resolved when done.
     */
    async registerSiteSchema(schema: CoreSiteSchema): Promise<void> {
        if (this.currentSite) {
            try {
                // Site has already been created, apply the schema directly.
                const schemas: {[name: string]: CoreRegisteredSiteSchema} = {};
                schemas[schema.name] = schema;

                if (!schema.onlyCurrentSite) {
                    // Apply it to all sites.
                    const siteIds = await this.getSitesIds();

                    await Promise.all(siteIds.map(async (siteId) => {
                        const site = await this.getSite(siteId);

                        return this.applySiteSchemas(site, schemas);
                    }));
                } else {
                    // Apply it to the specified site only.
                    (schema as CoreRegisteredSiteSchema).siteId = this.currentSite.getId();

                    await this.applySiteSchemas(this.currentSite, schemas);
                }
            } finally {
                // Add the schema to the list. It's done in the end to prevent a schema being applied twice.
                this.siteSchemas[schema.name] = schema;
            }
        } else if (!schema.onlyCurrentSite) {
            // Add the schema to the list, it will be applied when the sites are created.
            this.siteSchemas[schema.name] = schema;
        }
    }

    /**
     * Install and upgrade all the registered schemas and tables.
     *
     * @param site Site.
     * @return Promise resolved when done.
     */
    migrateSiteSchemas(site: CoreSite): Promise<void> {
        if (this.siteSchemasMigration[site.id]) {
            return this.siteSchemasMigration[site.id];
        }

        this.logger.debug(`Migrating all schemas of ${site.id}`);

        // First create tables not registerd with name/version.
        const promise = site.getDb().createTablesFromSchema(this.siteTablesSchemas)
            .then(() => this.applySiteSchemas(site, this.siteSchemas));

        this.siteSchemasMigration[site.id] = promise;

        return promise.finally(() => {
            delete this.siteSchemasMigration[site.id];
        });
    }

    /**
     * Install and upgrade the supplied schemas for a certain site.
     *
     * @param site Site.
     * @param schemas Schemas to migrate.
     * @return Promise resolved when done.
     */
    protected async applySiteSchemas(site: CoreSite, schemas: {[name: string]: CoreRegisteredSiteSchema}): Promise<void> {
        const db = site.getDb();

        // Fetch installed versions of the schema.
        const records = await db.getAllRecords(SCHEMA_VERSIONS_TABLE);

        const versions: {[name: string]: number} = {};
        records.forEach((record) => {
            versions[record.name] = record.version;
        });

        const promises = [];
        for (const name in schemas) {
            const schema = schemas[name];
            const oldVersion = versions[name] || 0;
            if (oldVersion >= schema.version || (schema.siteId && site.getId() != schema.siteId)) {
                // Version already applied or the schema shouldn't be registered to this site.
                continue;
            }

            this.logger.debug(`Migrating schema '${name}' of ${site.id} from version ${oldVersion} to ${schema.version}`);

            promises.push(this.applySiteSchema(site, schema, oldVersion));
        }

        await Promise.all(promises);
    }

    /**
     * Install and upgrade the supplied schema for a certain site.
     *
     * @param site Site.
     * @param schema Schema to migrate.
     * @param oldVersion Old version of the schema.
     * @return Promise resolved when done.
     */
    protected async applySiteSchema(site: CoreSite, schema: CoreRegisteredSiteSchema, oldVersion: number): Promise<void> {
        const db = site.getDb();

        if (schema.tables) {
            await db.createTablesFromSchema(schema.tables);
        }
        if (schema.migrate) {
            await schema.migrate(db, oldVersion, site.id);
        }

        // Set installed version.
        await db.insertRecord(SCHEMA_VERSIONS_TABLE, { name, version: schema.version });
    }

    /**
     * Check if a URL is the root URL of any of the stored sites.
     *
     * @param url URL to check.
     * @param username Username to check.
     * @return Promise resolved with site to use and the list of sites that have
     *         the URL. Site will be undefined if it isn't the root URL of any stored site.
     */
    isStoredRootURL(url: string, username?: string): Promise<{site: CoreSite; siteIds: string[]}> {
        // Check if the site is stored.
        return this.getSiteIdsFromUrl(url, true, username).then((siteIds) => {
            const result = {
                siteIds,
                site: undefined,
            };

            if (siteIds.length > 0) {
                // If more than one site is returned it usually means there are different users stored. Use any of them.
                return this.getSite(siteIds[0]).then((site) => {
                    const siteUrl = CoreTextUtils.instance.removeEndingSlash(
                        CoreUrlUtils.instance.removeProtocolAndWWW(site.getURL()));
                    const treatedUrl = CoreTextUtils.instance.removeEndingSlash(CoreUrlUtils.instance.removeProtocolAndWWW(url));

                    if (siteUrl == treatedUrl) {
                        result.site = site;
                    }

                    return result;
                });
            }

            return result;
        });
    }

    /**
     * Returns the Site Schema names that can be cleared on space storage.
     *
     * @param site The site that will be cleared.
     * @return Name of the site schemas.
     */
    getSiteTableSchemasToClear(site: CoreSite): string[] {
        let reset = [];
        for (const name in this.siteSchemas) {
            const schema = this.siteSchemas[name];

            if (schema.canBeCleared && (!schema.siteId || site.getId() == schema.siteId)) {
                reset = reset.concat(this.siteSchemas[name].canBeCleared);
            }
        }

        return reset;
    }

    /**
     * Returns presets for a given reading strategy.
     *
     * @param strategy Reading strategy.
     * @return PreSets options object.
     */
    getReadingStrategyPreSets(strategy: CoreSitesReadingStrategy): CoreSiteWSPreSets {
        switch (strategy) {
            case CoreSitesReadingStrategy.PreferCache:
                return {
                    omitExpires: true,
                };
            case CoreSitesReadingStrategy.OnlyCache:
                return {
                    omitExpires: true,
                    forceOffline: true,
                };
            case CoreSitesReadingStrategy.PreferNetwork:
                return {
                    getFromCache: false,
                };
            case CoreSitesReadingStrategy.OnlyNetwork:
                return {
                    getFromCache: false,
                    emergencyCache: false,
                };
            default:
                return {};
        }
    }

    /**
     * Returns site info found on the backend.
     *
     * @param search Searched text.
     * @return Site info list.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async findSites(search: string): Promise<CoreLoginSiteInfo[]> {
        return [];
    }

}

export class CoreSites extends makeSingleton(CoreSitesProvider) {}

/**
 * Response of checking if a site exists and its configuration.
 */
export type CoreSiteCheckResponse = {
    /**
     * Code to identify the authentication method to use.
     */
    code: number;

    /**
     * Site url to use (might have changed during the process).
     */
    siteUrl: string;

    /**
     * Service used.
     */
    service: string;

    /**
     * Code of the warning message to show to the user.
     */
    warning?: string;

    /**
     * Site public config (if available).
     */
    config?: CoreSitePublicConfigResponse;
};

/**
 * Response of getting user token.
 */
export type CoreSiteUserTokenResponse = {
    /**
     * User token.
     */
    token: string;

    /**
     * Site URL to use.
     */
    siteUrl: string;

    /**
     * User private token.
     */
    privateToken?: string;
};

/**
 * Site's basic info.
 */
export type CoreSiteBasicInfo = {
    /**
     * Site ID.
     */
    id: string;

    /**
     * Site URL.
     */
    siteUrl: string;

    /**
     * User's full name.
     */
    fullName: string;

    /**
     * Site's name.
     */
    siteName: string;

    /**
     * User's avatar.
     */
    avatar: string;

    /**
     * Badge to display in the site.
     */
    badge?: number;

    /**
     * Site home ID.
     */
    siteHomeId?: number;
};

/**
 * Site schema and migration function.
 */
export type CoreSiteSchema = {
    /**
     * Name of the schema.
     */
    name: string;

    /**
     * Latest version of the schema (integer greater than 0).
     */
    version: number;

    /**
     * Names of the tables of the site schema that can be cleared.
     */
    canBeCleared?: string[];

    /**
     * If true, the schema will only be applied to the current site. Otherwise it will be applied to all sites.
     * If you're implementing a site plugin, please set it to true.
     */
    onlyCurrentSite?: boolean;

    /**
     * Tables to create when installing or upgrading the schema.
     */
    tables?: SQLiteDBTableSchema[];

    /**
     * Migrates the schema in a site to the latest version.
     *
     * Called when installing and upgrading the schema, after creating the defined tables.
     *
     * @param db Site database.
     * @param oldVersion Old version of the schema or 0 if not installed.
     * @param siteId Site Id to migrate.
     * @return Promise resolved when done.
     */
    migrate?(db: SQLiteDB, oldVersion: number, siteId: string): Promise<void> | void;
};

/**
 * Data about sites to be listed.
 */
export type CoreLoginSiteInfo = {
    /**
     * Site name.
     */
    name: string;

    /**
     * Site alias.
     */
    alias?: string;

    /**
     * URL of the site.
     */
    url: string;

    /**
     * Image URL of the site.
     */
    imageurl?: string;

    /**
     * City of the site.
     */
    city?: string;

    /**
     * Countrycode of the site.
     */
    countrycode?: string;
};

/**
 * Registered site schema.
 */
export type CoreRegisteredSiteSchema = CoreSiteSchema & {
    /**
     * Site ID to apply the schema to. If not defined, all sites.
     */
    siteId?: string;
};

/**
 * Possible reading strategies (for cache).
 */
export const enum CoreSitesReadingStrategy {
    OnlyCache,
    PreferCache,
    OnlyNetwork,
    PreferNetwork,
}

/**
 * Common options used when calling a WS through CoreSite.
 */
export type CoreSitesCommonWSOptions = {
    readingStrategy?: CoreSitesReadingStrategy; // Reading strategy.
    siteId?: string; // Site ID. If not defined, current site.
};

/**
 * Data about a certain demo site.
 */
export type CoreSitesDemoSiteData = {
    url: string;
    username: string;
    password: string;
};

/**
 * Response of calls to login/token.php.
 */
export type CoreSitesLoginTokenResponse = {
    token?: string;
    privatetoken?: string;
    error?: string;
    errorcode?: string;
    stacktrace?: string;
    debuginfo?: string;
    reproductionlink?: string;
};
