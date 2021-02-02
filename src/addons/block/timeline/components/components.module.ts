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

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';

import { CoreSharedModule } from '@/core/shared.module';
import { CoreCoursesComponentsModule } from '@features/courses/components/components.module';
import { CoreCourseComponentsModule } from '@features/course/components/components.module';

import { AddonBlockTimelineComponent } from './timeline/timeline';
import { AddonBlockTimelineEventsComponent } from './events/events';

@NgModule({
    declarations: [
        AddonBlockTimelineComponent,
        AddonBlockTimelineEventsComponent,
    ],
    imports: [
        CommonModule,
        IonicModule,
        FormsModule,
        TranslateModule.forChild(),
        CoreSharedModule,
        CoreCoursesComponentsModule,
        CoreCourseComponentsModule,
    ],
    exports: [
        AddonBlockTimelineComponent,
        AddonBlockTimelineEventsComponent,
    ],
    entryComponents: [
        AddonBlockTimelineComponent,
        AddonBlockTimelineEventsComponent,
    ],
})
export class AddonBlockTimelineComponentsModule {}
