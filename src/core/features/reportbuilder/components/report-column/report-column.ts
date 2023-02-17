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

import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';

@Component({
    selector: 'core-report-builder-report-column',
    templateUrl: './report-column.html',
    styleUrls: ['./report-column.scss'],
})
export class CoreReportBuilderReportColumnComponent implements OnInit {

    @Input() isExpanded = false;
    @Input() isExpandable = false;
    @Input() showFirstTitle = false;
    @Input() columnIndex!: number;
    @Input() rowIndex!: number;
    @Input() column!: string | number;
    @Input() contextId!: number;
    @Input() header!: string;
    @Output() onToggleRow: EventEmitter<number> = new EventEmitter();

    ngOnInit(): void {
        if (typeof this.column === 'number') {
            this.column = this.column.toString();
        }
    }

    /**
     * Emits row click
     */
    toggleRow(): void {
        this.onToggleRow.emit(this.rowIndex);
    }

}
