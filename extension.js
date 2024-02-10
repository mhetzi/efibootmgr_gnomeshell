/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {QuickToggle, QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {EFIBootMgr} from "./efibootmgr.js";

const ExampleMenuToggle = GObject.registerClass(
    class ExampleMenuToggle extends QuickMenuToggle {
        _init() {
            this._efi = new EFIBootMgr();
            this._efi.execBootmgr();

            super._init({
                title: "EFI Boot",
                subtitle: String(this._efi.current_num),
                iconName: 'application-x-firmware-symbolic',
                toggleMode: true,
            });

            this.connect('clicked', async () => {
                if (this._efi.diffBoot)
                    await this.setNextBoot(-100);
                if (this._efi.boot_to_fw_active){
                    await this.changeFwBoot(false);
                }
            });
    
            this.boot_entries = [];
            this.current_num = 0;
            this.next_num = null;
            this.diffBoot = false;

            this.updateData();
    
            const headerSuffix = new St.Icon({
                iconName: 'application-x-firmware-symbolic',
            });
            this.menu.addHeaderSuffix(headerSuffix);
     
            this._itemsSection = new PopupMenu.PopupMenuSection();

            console.log(this._efi.boot_entries);
            console.log(this._efi.boot_order)

            for (const boot_nr of this._efi.boot_order){
                const item = this._efi.boot_entries[boot_nr];

                console.info(`Adding bootnum ${item.number} with name: ${item.name} to menuSelection...`);

                const f = (num) => this.setNextBoot(num);
                const bound = f.bind(this, item.number)

                this._itemsSection.addAction(`${item.number}: ${item.name}`, bound);
            }
            
            if (this._efi.boot_to_fw_supported){
                this._itemsSection.addAction("To Firmware", () => this.changeFwBoot(true));
            }

            this.menu.addMenuItem(this._itemsSection);
    
            // Add an entry-point for more settings
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        updateData(){
            console.debug("Updating data...");
            var str = String(this._efi.current_num);
            if (this._efi.next_num >= 0){
                str = `${this._efi.current_num} -> ${this._efi.next_num}`;
                this.checked = true;
            }
            if (this._efi.boot_to_fw_active){
                str = `${this._efi.current_num} -> EFI`;
                this.checked = true;
            }
            this.menu.setHeader('application-x-firmware-symbolic', "EFI Bootlist", str);
            console.log(`Setting checked to ${this._efi.diffBoot}`);
            this.checked = this._efi.diffBoot || this._efi.boot_to_fw_active;
            this.subtitle = str;
        }

        async setNextBoot(num){
            await this._efi.setNextBoot(num);
            this.updateData();
        }

        async changeFwBoot(change){
            await this._efi.changeFwBoot(change);
            this.updateData();
        }

    });

const ExampleIndicator = GObject.registerClass(
class ExampleIndicator extends SystemIndicator {
    constructor() {
        super();

        this._indicator = this._addIndicator();
        this._indicator.iconName = 'application-x-firmware-symbolic';

        const toggle = new ExampleMenuToggle();
        toggle.bind_property('checked',
            this._indicator, 'visible',
            GObject.BindingFlags.SYNC_CREATE);
        this.quickSettingsItems.push(toggle);
    }
});

export default class QuickSettingsExampleExtension extends Extension {
    enable() {
        this._indicator = new ExampleIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
    }
}
