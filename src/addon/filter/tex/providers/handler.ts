
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

import { Injectable } from '@angular/core';
import { CoreFilterDefaultHandler } from '@core/filter/providers/default-filter';

/**
 * Handler to support the TeX notation filter.
 */
@Injectable()
export class AddonFilterTexHandler extends CoreFilterDefaultHandler {
    name = 'AddonFilterTexHandler';
    filterName = 'tex';

    constructor() {
        super();

        // This filter is handled by Moodle, nothing to do in the app.
    }
}
