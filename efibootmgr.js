import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const REGEX_NUMBER_MATCH   = new RegExp('[0-9]+', 'g');
const REGEX_BOOT_CURRENT    = new RegExp('BootCurrent: [0-9]*', '');
const REGEX_BOOT_NEXT       = new RegExp('BootNext: [0-9]*?\\n', 'gm');
const REGEX_BOOT_ENTRIES    = new RegExp('Boot[0-9]+.*?\\n', 'g');
const REGEX_BOOT_ORDER      = new RegExp('BootOrder: [0-9, ]*?\\n', 'gm');

const REGEX_LINE_BOOTNUM = new RegExp('Boot[0-9].*?\\*', '');
const REGEX_LINE_NAME    = new RegExp('\\* .*\\t', '');
const REGEX_LINE_BPATH   = new RegExp('\\t.*', '')
const WIERD_SPACE_CHAR   = "\\t";

export class EFIBootEntry {
    constructor(num, name, path){
        this.number = num;
        this.name = name;
        this.path = path;
    }
}

export class EFIBootMgr {
    constructor() {
        this.boot_entries = {};
        this.current_num = 0;
        this.next_num = null;
        this.diffBoot = false;
        this.boot_order = [];
        this.boot_to_fw_supported = false;
        this.boot_to_fw_active = false;
    }

    mixPipes(out, err, regex) {
        const om = regex.exec(out);
        const em = regex.exec(err);
        if (om !== null){
            return om[0];
        }
        if (em !== null){
            return em[0];
        }
        return null;
    }

    getRegexResultAll(str, regex){
        var matches = [];
        let m;
        while ((m = regex.exec(str)) !== null) {
            // This is necessary to avoid infinite loops with zero-width matches
            if (m.index === regex.lastIndex) {
                regex.lastIndex++;
            }
            
            // The result can be accessed through the `m`-variable.
            m.forEach((match, groupIndex) => {
                console.log(`Found match, group ${groupIndex}: ${match}`);
                matches.push(match)
            });
        }
        return matches;
    }

    mixPipesAll(out, err, regex) {
        const om = this.getRegexResultAll(out, regex);
        const em = this.getRegexResultAll(err, regex);
        if (om !== null && om.length > 0){
            return om;
        }
        if (em !== null && em.length > 0){
            return em;
        }
        return null;
    }

    getNumberFromStr(str, getArray=false){
        if (str == null){
            return NaN;
        }
        if (str instanceof Array){
            return this.getNumberFromStr(str[0]);
        }
        const num = getArray ? str.matchAll(REGEX_NUMBER_MATCH) : str.match(REGEX_NUMBER_MATCH);
        if (num === null){
            return NaN;
        }
        if (getArray){
            let l = [];
            for (const n of num){
                l.push(parseInt(n));
            }
            return l;
        }
        return parseInt(num[0]);
    }

    execBootmgr() {
        const proc = Gio.Subprocess.new(
            ['efibootmgr'],
    
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        this.readEfiBootMgr(proc);

        const bc = Gio.Subprocess.new(
            ['bootctl', 'reboot-to-firmware'],
    
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        this.readBootctl(bc);
    }

    readBootctl(proc) {
        this.boot_to_fw_supported = false;
        this.boot_to_fw_active = false;

        console.log("!! readBootCtl !!");
        try {
            const [stdoutt, stderrr] = proc.communicate_utf8(null, null);
            const stdout = new String(stdoutt);
            const stderr = new String(stderrr);
            const state = proc.get_successful();
            console.log(`out:${stdout}|err:${stderr}|`);
            if (stdout.includes("active") || stderr.includes("active")){
                this.boot_to_fw_active = true;
                this.boot_to_fw_supported = true;
                console.log("fw_restart active!");
            }
            else if (!stdout.includes("not supported") && !stderr.includes("not supported")){
                this.boot_to_fw_supported = true;
                console.log("fw_restart supported!");
            }

        } catch (e) {
            logError(e);
        }
    }

    readEfiBootMgr(proc) {
        try {

            this.boot_entries = {};
            this.current_num = 0;
            this.next_num = null;
            this.diffBoot = false;

            console.log("!! readEfiBootMgr !!")

            const [stdoutt, stderrr] = proc.communicate_utf8(null, null);

            const stdout = new String(stdoutt);
            const stderr = new String(stderrr);

            console.log(stdout);
            console.log(stderr);
    
            if (proc.get_successful()){

                var bootcurr = this.mixPipes(stdout, stderr, REGEX_BOOT_CURRENT);
                if (bootcurr === null){
                    bootcurr = -1;
                    console.warn("bootcurr not found!");
                } else {
                    this.current_num = this.getNumberFromStr(bootcurr);
                    console.log(`bootcur: ${this.current_num}`);
                }

                var bootnext = this.mixPipes(stdout, stderr, REGEX_BOOT_NEXT);
                if (bootnext === null){
                    this.next_num = -1;
                    console.warn("bootnext not found!");
                } else {
                    this.next_num = this.getNumberFromStr(bootnext);
                    this.diffBoot = true;
                    console.info(`bootnext: ${this.next_num}`);
                }

                var m = this.mixPipesAll(stdout, stderr, REGEX_BOOT_ENTRIES);
                if (m === null) {
                    this.boot_entries[-1] = new EFIBootEntry(-1, "efibootmgr err",  "err://")
                    console.warn("not bootentrys found!")
                } else {
                    for (const entry of m){
                        console.log(entry);
                        const bnum = this.getNumberFromStr(entry.match(REGEX_LINE_BOOTNUM));
                        const temp = entry.match(REGEX_LINE_NAME)
                        const bname = temp !== null ? temp[0] : "ERR";
                        const bp = entry.match(REGEX_LINE_BPATH)[0];
                        this.boot_entries[bnum] = new EFIBootEntry(bnum, bname, bp);
                    }
                }
                this.boot_order = this.getNumberFromStr(this.mixPipes(stdout, stderr, REGEX_BOOT_ORDER), true);
            }
            else
                throw new Error(stderr);
        } catch (e) {
            logError(e);
        }
    }

    async setNextBoot(bootnum) {
        try {
            const args = (bootnum === -100) ? 
                ['pkexec', '--disable-internal-agent', 'efibootmgr', '-N'] :
                ['pkexec', '--disable-internal-agent', 'efibootmgr', '-n', String(bootnum)];
            const proc = Gio.Subprocess.new( args,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            const cancellable = new Gio.Cancellable();
            await proc.wait_async(cancellable, () => console.log("setNextBoot done") );
            this.readEfiBootMgr(proc);
        } catch (e) {
            logError(e);
        }
    }

    async changeFwBoot(logical){
        try {
            const args = ['pkexec', '--disable-internal-agent', 'bootctl', 'reboot-to-firmware', logical ? "true" : "false"];
            const proc = Gio.Subprocess.new( args,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            const cancellable = new Gio.Cancellable();
            await proc.wait_async(cancellable, () => console.log("setNextBoot done") );
            this.execBootmgr();
        } catch (e) {
            logError(e);
        }
    }

}