
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
import { CoreUserProfileFieldHandler, CoreUserProfileFieldHandlerData } from '../../../../core/user/providers/user-profile-field-delegate';
import { AddonUserProfileFieldDatetimeComponent } from '../component/datetime';
import { Platform } from 'ionic-angular';

/**
 * Datetime user profile field handlers.
 */
@Injectable()
export class AddonUserProfileFieldDatetimeHandler implements CoreUserProfileFieldHandler {
    name = 'datetime';

    constructor(private platform: Platform) {}

    /**
     * Whether or not the handler is enabled on a site level.
     *
     * @return {boolean|Promise<boolean>} True or promise resolved with true if enabled.
     */
    isEnabled() : boolean|Promise<boolean> {
        return true;
    }

    /**
     * Get the data to send for the field based on the input data.
     *
     * @param  {any}     field          User field to get the data for.
     * @param  {boolean} signup         True if user is in signup page.
     * @param  {string}  [registerAuth] Register auth method. E.g. 'email'.
     * @param  {any}     model          Model with the input data.
     * @return {CoreUserProfileFieldHandlerData}  Data to send for the field.
     */
    getData(field: any, signup: boolean, registerAuth: string, model: any): CoreUserProfileFieldHandlerData {
        let hasTime = field.param3 && field.param3 !== '0' && field.param3 !== 'false',
            modelName = 'profile_field_' + field.shortname,
            date = JSON.parse(JSON.stringify(model[modelName + '_date'])),
            time;

        if (date) {
            if (hasTime && this.platform.is('ios')) {
                // In iOS the time is in a different input. Add it to the date.
                time = model[modelName + '_time'];
                if (!time) {
                    return;
                }

                date.setHours(time.getHours());
                date.setMinutes(time.getMinutes());
            }

            return {
                type: 'datetime',
                name: 'profile_field_' + field.shortname,
                value: Math.round(date.getTime() / 1000)
            };
        }
    }

    /**
     * Return the Component to use to display the user profile field.
     *
     * @param  {any}     field          User field to get the data for.
     * @param  {boolean} signup         True if user is in signup page.
     * @param  {string}  [registerAuth] Register auth method. E.g. 'email'.
     * @return {any}     The component to use, undefined if not found.
     */
    getComponent(field: any, signup: boolean, registerAuth: string) {
        return AddonUserProfileFieldDatetimeComponent;
    }

}