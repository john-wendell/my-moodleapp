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

import { Pipe, PipeTransform } from '@angular/core';
import { CoreLoggerProvider } from '../providers/logger';
import { CoreTextUtilsProvider } from '../providers/utils/text';
import { CoreConstants } from '../core/constants';

/**
 * Pipe to convert a number of seconds to Hours:Minutes:Seconds.
 *
 * This converts a number of seconds to Hours:Minutes:Seconds. If the number of seconds is negative, returns 00:00:00.
 */
@Pipe({
    name: 'coreSecondsToHMS',
})
export class CoreSecondsToHMSPipe implements PipeTransform {
    protected logger;

    constructor(logger: CoreLoggerProvider, private textUtils: CoreTextUtilsProvider) {
        this.logger = logger.getInstance('CoreSecondsToHMSPipe');
    }

    /**
     * Convert a number of seconds to Hours:Minutes:Seconds.
     *
     * @param {number|string} seconds Number of seconds.
     * @return {string} Formatted seconds.
     */
    transform(seconds: string|number) : string {
        let hours,
            minutes;

        if (!seconds || seconds < 0) {
            seconds = 0;
        } else if (typeof seconds == 'string') {
            // Convert the value to a number.
            const numberSeconds = parseInt(seconds, 10);
            if (isNaN(numberSeconds)) {
                this.logger.error('Invalid value received', seconds);
                return seconds;
            }
            seconds = numberSeconds;
        }

        hours = Math.floor(seconds / CoreConstants.secondsHour);
        seconds -= hours * CoreConstants.secondsHour;
        minutes = Math.floor(seconds / CoreConstants.secondsMinute);
        seconds -= minutes * CoreConstants.secondsMinute;

        return this.textUtils.twoDigits(hours) + ':' + this.textUtils.twoDigits(minutes) + ':' + this.textUtils.twoDigits(seconds);
    }
}
