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

import { Component } from '@angular/core';
import { CoreSiteInfo } from '@classes/site';
import { CoreSites } from '@services/sites';
import { CoreDomUtils } from '@services/utils/dom';
import { CoreMainMenuUserMenuComponent } from '../user-menu/user-menu';

/**
 * Component to display an avatar on the header to open user menu.
 *
 * Example: <core-user-menu-button></core-user-menu-button>
 */
@Component({
    selector: 'core-user-menu-button',
    templateUrl: 'user-menu-button.html',
})
export class CoreMainMenuUserButtonComponent {

    siteInfo?: CoreSiteInfo;

    constructor() {
        const currentSite = CoreSites.getRequiredCurrentSite();

        // @TODO: Check if the page where I currently am is at level 0.
        this.siteInfo = currentSite.getInfo();
    }

    /**
     * Open User menu
     *
     * @param event Click event.
     */
    openUserMenu(event: Event): void {
        event.preventDefault();
        event.stopPropagation();

        CoreDomUtils.openModal<void>({
            component: CoreMainMenuUserMenuComponent,
        });
    }

}
