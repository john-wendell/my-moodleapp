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

import { NgModule } from '@angular/core';
import { Platform } from 'ionic-angular';

import { Clipboard } from '@ionic-native/clipboard';
import { File } from '@ionic-native/file';
import { Globalization } from '@ionic-native/globalization';
import { Network } from '@ionic-native/network';
import { Zip } from '@ionic-native/zip';
import { ClipboardMock } from './providers/clipboard';
import { FileMock} from './providers/file';
import { GlobalizationMock } from './providers/globalization';
import { NetworkMock } from './providers/network';
import { ZipMock } from './providers/zip';
import { InAppBrowser } from '@ionic-native/in-app-browser';

import { CoreEmulatorHelper } from './providers/helper';
import { CoreAppProvider } from '../../providers/app';
import { CoreTextUtilsProvider } from '../../providers/utils/text';
import { CoreMimetypeUtilsProvider } from '../../providers/utils/mimetype';
import { CoreInitDelegate } from '../../providers/init';

@NgModule({
    declarations: [
    ],
    imports: [
    ],
    providers: [
        CoreEmulatorHelper,
        ClipboardMock,
        GlobalizationMock,
        {
            provide: Clipboard,
            deps: [CoreAppProvider],
            useFactory: (appProvider: CoreAppProvider) => {
                return appProvider.isMobile() ? new Clipboard() : new ClipboardMock(appProvider);
            }
        },
        {
            provide: File,
            deps: [CoreAppProvider, CoreTextUtilsProvider],
            useFactory: (appProvider: CoreAppProvider, textUtils: CoreTextUtilsProvider) => {
                // Use platform instead of CoreAppProvider to prevent circular dependencies.
                return appProvider.isMobile() ? new File() : new FileMock(appProvider, textUtils);
            }
        },
        {
            provide: Globalization,
            deps: [CoreAppProvider],
            useFactory: (appProvider: CoreAppProvider) => {
                return appProvider.isMobile() ? new Globalization() : new GlobalizationMock(appProvider);
            }
        },
        {
            provide: Network,
            deps: [Platform],
            useFactory: (platform: Platform) => {
                // Use platform instead of CoreAppProvider to prevent circular dependencies.
                return platform.is('cordova') ? new Network() : new NetworkMock();
            }
        },
        {
            provide: Zip,
            deps: [CoreAppProvider, File, CoreMimetypeUtilsProvider, CoreTextUtilsProvider],
            useFactory: (appProvider: CoreAppProvider, file: File, mimeUtils: CoreMimetypeUtilsProvider) => {
                // Use platform instead of CoreAppProvider to prevent circular dependencies.
                return appProvider.isMobile() ? new Zip() : new ZipMock(file, mimeUtils);
            }
        },
        InAppBrowser
    ]
})
export class CoreEmulatorModule {
    constructor(appProvider: CoreAppProvider, initDelegate: CoreInitDelegate, helper: CoreEmulatorHelper) {
        let win = <any>window; // Convert the "window" to "any" type to be able to use non-standard properties.

        // Emulate Custom URL Scheme plugin in desktop apps.
        if (appProvider.isDesktop()) {
            require('electron').ipcRenderer.on('mmAppLaunched', (event, url) => {
                if (typeof win.handleOpenURL != 'undefined') {
                    win.handleOpenURL(url);
                }
            });
        }

        if (!appProvider.isMobile()) {
            // Register an init process to load the Mocks that need it.
            initDelegate.registerProcess(helper);
        }
    }
}
