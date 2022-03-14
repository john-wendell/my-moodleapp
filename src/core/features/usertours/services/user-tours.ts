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
import { asyncInstance } from '@/core/utils/async-instance';
import { Injectable } from '@angular/core';
import { CoreDatabaseTable } from '@classes/database/database-table';
import { CoreDatabaseCachingStrategy, CoreDatabaseTableProxy } from '@classes/database/database-table-proxy';
import { CoreApp } from '@services/app';
import { CoreUtils } from '@services/utils/utils';
import { AngularFrameworkDelegate, makeSingleton } from '@singletons';
import { CoreComponentsRegistry } from '@singletons/components-registry';
import { CoreUserToursUserTourComponent } from '../components/user-tour/user-tour';
import { APP_SCHEMA, CoreUserToursDBEntry, USER_TOURS_TABLE_NAME } from './database/user-tours';

/**
 * Service to manage User Tours.
 */
@Injectable({ providedIn: 'root' })
export class CoreUserToursService {

    protected table = asyncInstance<CoreDatabaseTable<CoreUserToursDBEntry>>();
    protected tours: CoreUserToursUserTourComponent[] = [];
    protected tourReadyCallbacks = new WeakMap<CoreUserToursUserTourComponent, () => void>();

    /**
     * Initialize database.
     */
    async initializeDatabase(): Promise<void> {
        await CoreUtils.ignoreErrors(CoreApp.createTablesFromSchema(APP_SCHEMA));

        this.table.setLazyConstructor(async () => {
            const table = new CoreDatabaseTableProxy<CoreUserToursDBEntry>(
                { cachingStrategy: CoreDatabaseCachingStrategy.Eager },
                CoreApp.getDB(),
                USER_TOURS_TABLE_NAME,
                ['id'],
            );

            await table.initialize();

            return table;
        });
    }

    /**
     * Check whether a User Tour is pending or not.
     *
     * @param id User Tour id.
     * @returns Whether the User Tour is pending or not.
     */
    async isPending(id: string): Promise<boolean> {
        if (CoreConstants.CONFIG.disableUserTours || CoreConstants.CONFIG.disabledUserTours?.includes(id)) {
            return false;
        }

        const isAcknowledged = await this.table.hasAnyByPrimaryKey({ id });

        return !isAcknowledged;
    }

    /**
     * Confirm that a User Tour has been seen by the user.
     *
     * @param id User Tour id.
     */
    async acknowledge(id: string): Promise<void> {
        await this.table.insert({ id, acknowledgedTime: Date.now() });
    }

    /**
     * Show a User Tour if it's pending.
     *
     * @param options User Tour options.
     */
    async showIfPending(options: CoreUserToursBasicOptions): Promise<void>;
    async showIfPending(options: CoreUserToursPopoverFocusedOptions): Promise<void>;
    async showIfPending(options: CoreUserToursOverlayFocusedOptions): Promise<void>;
    async showIfPending(options: CoreUserToursOptions): Promise<void> {
        const isPending = await CoreUserTours.isPending(options.id);

        if (!isPending) {
            return;
        }

        return this.show(options);
    }

    /**
     * Show a User Tour.
     *
     * @param options User Tour options.
     */
    protected async show(options: CoreUserToursBasicOptions): Promise<void>;
    protected async show(options: CoreUserToursPopoverFocusedOptions): Promise<void>;
    protected async show(options: CoreUserToursOverlayFocusedOptions): Promise<void>;
    protected async show(options: CoreUserToursOptions): Promise<void> {
        const { delay, ...componentOptions } = options;

        await CoreUtils.wait(delay ?? 200);

        const container = document.querySelector('ion-app') ?? document.body;
        const element = await AngularFrameworkDelegate.attachViewToDom(
            container,
            CoreUserToursUserTourComponent,
            { ...componentOptions, container },
        );
        const tour = CoreComponentsRegistry.require(element, CoreUserToursUserTourComponent);

        this.tours.push(tour);
        this.tours.length > 1
            ? await new Promise<void>(resolve => this.tourReadyCallbacks.set(tour, resolve))
            : await tour.present();
    }

    /**
     * Dismiss the active User Tour, if any.
     *
     * @param acknowledge Whether to acknowledge that the user has seen this User Tour or not.
     */
    async dismiss(acknowledge: boolean = true): Promise<void> {
        if (this.tours.length === 0) {
            return;
        }

        const activeTour = this.tours.shift() as CoreUserToursUserTourComponent;
        const nextTour = this.tours[0] as CoreUserToursUserTourComponent | undefined;

        await Promise.all([
            activeTour.dismiss(acknowledge),
            nextTour?.present(),
        ]);

        nextTour && this.tourReadyCallbacks.get(nextTour)?.();
    }

}

export const CoreUserTours = makeSingleton(CoreUserToursService);

/**
 * User Tour style.
 */
export const enum CoreUserToursStyle {
    Overlay = 'overlay',
    Popover = 'popover',
}

/**
 * User Tour side.
 */
export const enum CoreUserToursSide {
    Top = 'top',
    Bottom = 'bottom',
    Right = 'right',
    Left = 'left',
    Start = 'start',
    End = 'end',
}

/**
 * User Tour alignment.
 */
export const enum CoreUserToursAlignment {
    Start = 'start',
    Center = 'center',
    End = 'end',
}

/**
 * Basic options to create a User Tour.
 */
export interface CoreUserToursBasicOptions {

    /**
     * Unique identifier.
     */
    id: string;

    /**
     * User Tour component.
     */
    component: unknown;

    /**
     * Properties to pass to the User Tour component.
     */
    componentProps?: Record<string, unknown>;

    /**
     * Milliseconds to wait until the User Tour is shown.
     *
     * Defaults to 200ms.
     */
    delay?: number;

}

/**
 * Options to create a focused User Tour.
 */
export interface CoreUserToursFocusedOptions extends CoreUserToursBasicOptions {

    /**
     * Element to focus.
     */
    focus: HTMLElement;

}

/**
 * Options to create a focused User Tour using the Popover style.
 */
export interface CoreUserToursPopoverFocusedOptions extends CoreUserToursFocusedOptions {

    /**
     * User Tour style.
     */
    style?: CoreUserToursStyle.Popover;

    /**
     * Position relative to the focused element.
     */
    side: CoreUserToursSide;

    /**
     * Alignment relative to the focused element.
     */
    alignment: CoreUserToursAlignment;

}

/**
 * Options to create a focused User Tour using the Overlay style.
 */
export interface CoreUserToursOverlayFocusedOptions extends CoreUserToursFocusedOptions {

    /**
     * User Tour style.
     */
    style: CoreUserToursStyle.Overlay;

}

/**
 * Options to create a User Tour.
 */
export type CoreUserToursOptions =
    CoreUserToursBasicOptions |
    CoreUserToursPopoverFocusedOptions |
    CoreUserToursOverlayFocusedOptions;
