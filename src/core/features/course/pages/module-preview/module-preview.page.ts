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
import { CoreCourse } from '@features/course/services/course';
import { CoreCourseHelper, CoreCourseModule, CoreCourseSection } from '@features/course/services/course-helper';
import { CoreCourseModuleDelegate } from '@features/course/services/module-delegate';
import { IonRefresher } from '@ionic/angular';
import { CoreNavigator } from '@services/navigator';
import { CoreDomUtils } from '@services/utils/dom';
import { CoreUtils } from '@services/utils/utils';

/**
 * Page that displays a module preview.
 */
@Component({
    selector: 'page-core-course-module-preview',
    templateUrl: 'module-preview.html',
})
export class CoreCourseModulePreviewPage implements OnInit {

    title!: string;
    module!: CoreCourseModule;
    section?: CoreCourseSection; // The section the module belongs to.
    courseId!: number;
    loaded = false;
    unsupported = false;
    showManualCompletion = false;

    protected debouncedUpdateModule?: () => void; // Update the module after a certain time.

    /**
     * @inheritdoc
     */
    async ngOnInit(): Promise<void> {
        try {
            this.module = CoreNavigator.getRequiredRouteParam<CoreCourseModule>('module');
            this.courseId = CoreNavigator.getRequiredRouteNumberParam('courseId');
            this.section = CoreNavigator.getRouteParam<CoreCourseSection>('section');
        } catch (error) {
            CoreDomUtils.showErrorModal(error);

            CoreNavigator.back();

            return;
        }

        this.debouncedUpdateModule = CoreUtils.debounce(() => {
            this.doRefresh();
        }, 10000);

        await this.fetchModule();
    }

    /**
     * Fetch module.
     *
     * @return Promise resolved when done.
     */
    protected async fetchModule(refresh = false): Promise<void> {
        if (refresh) {
            this.module = await CoreCourse.getModule(this.module.id, this.courseId);
        }

        CoreCourseHelper.calculateModuleCompletionData(this.module);

        await CoreCourseHelper.loadModuleOfflineCompletion(this.courseId, this.module);

        this.unsupported = !CoreCourseModuleDelegate.getHandlerName(this.module.modname);
        if (!this.unsupported) {
            this.module.handlerData =
                await CoreCourseModuleDelegate.getModuleDataFor(this.module.modname, this.module, this.courseId);
        }

        this.title = this.module.name;

        this.showManualCompletion = await CoreCourseModuleDelegate.manualCompletionAlwaysShown(this.module);

        this.loaded = true;
    }

    /**
     * Refresh the data.
     *
     * @param refresher Refresher.
     * @return Promise resolved when done.
     */
    async doRefresh(refresher?: IonRefresher): Promise<void> {

        await CoreCourse.invalidateModule(this.module.id);

        this.fetchModule(true);

        refresher?.complete();
    }

    /**
     * The completion of the modules has changed.
     *
     * @return Promise resolved when done.
     */
    async onCompletionChange(): Promise<void> {
        // Update the module data after a while.
        this.debouncedUpdateModule?.();
    }

}
