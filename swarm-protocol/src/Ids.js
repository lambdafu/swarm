"use strict";
const Id = require('./Id');
const Base64x64 = require('./Base64x64');

/** immutable id array */
class Ids {

    constructor (body) {
        this._body = body || '';
    }

    static fromString (str) {
        return new Ids(str);
    }

    toString() {
        return this._body;
    }

    static as (ids) {
        if (!ids) return new ids();
        if (ids.constructor) return ids;
        return new Ids(ids);
    }

    static is (ids) {
        return Ids.ids_re.test(ids);
    }

    // --- access/edit API ---

    /** @returns {Ids} -- new array */
    splice (offset, del_count, inserts) {
        const b = new Builder();

        const i = this.iterator();
        // append runs
        while (!i.end() && i.runEndOffset()<=offset) {
            body += i.runString();
            i.nextRun();
        }
        // open split run
        // add that many
        while (!i.end() && i.offset<=offset) {
            append(i.id());
            i.next();
        }
        // add new
        inserts.forEach(append);
        // skip the deleted
        for(let i=0; i<del_count && !i.end(); i++)
            i.next();
        // add the rest
        while (!i.end() && i.runOffset<i.runLength) {
            append(i.next());
        }
        // append remaining runs
        while (!i.end()) {
            body += i.runString();
            i.nextRun();
        }
    }

    at (pos) {
        // use regex scan runs
        // parse, .length
    }

    /** @returns {Number} -- the first position the id was found at */
    find (id) {

    }

    append (id) {

    }

    appendRun (run) {

    }

    insert (id, pos) {

    }

    iterator ( ) {

    }

}


class Builder {

    constructor () {
        this.body = [];
        this.last_id = null;
        this.runtype = ' ';
        this.runlen = 0;
        this.tail = '';
        this.prefixlen = 0;
        this.prefix = '';
    }

    _flushRun () {
        if (!this.last_id) return;
        this.body.push('@'+this.last_id.toString());
        if (this.tail) {
            this.body.push(this.runtype + this.tail);
        }
        this.last_id = null;
        this.runtype = ' ';
        this.runlen = 0;
        this.tail = '';
        this.prefixlen = 0;
        this.prefix = '';
    }

    appendRun (runstr) {
        this._flushRun();
        this.body.push(runstr);
    }

    _appendToUniRun (id) {
        if (id.eq(this.last_id)) {
            this.tail = Base64x64.int2base(++this.runlen, 1);
        } else {
            this._flushRun();
            this.append(id);
        }
    }

    _appendToLast2Run (id) {
        const val = id.value;
        if (val.substr(0, this.prefixlen)!==this.prefix ||
            val.length>this.prefixlen+2) {
            this._flushRun();
            return this.append(id);
        }
        let two = val.substr(this.prefixlen, this.prefixlen+2);
        while (two.length<2) two += '0';
        this.tail += two;
        this.runlen++; // vvv
    }

    _appendToEmptyRun (id) {
        // try start a run
        const iv = id.value;
        const liv = this.last_id.value;
        if (iv===liv) {
            this.runtype = Ids.UNI_RUN;
            this.runlen = 1;
            return this._appendToUniRun(id);
        }
        const prefix = Base64x64.commonPrefix(iv, liv);
        if (iv.length<=prefix.length+2 && liv.length<=prefix.length+2) {
            this.runtype = Ids.LAST2_RUN;
            this.prefixlen = prefix.length;
            this.runlen = 1;
            this.prefix = prefix;
            return this._appendToLast2Run(id);
        }
        // if nothing worked
        this._flushRun();
        this.last_id = id;
    }

    append (id) {
        id = Id.as(id);
        if (!this.last_id) {
            this.last_id = id;
            this.runlen = 1;
        } else if (id.origin!==this.last_id.origin) {
            this._flushRun();
            this.last_id = id;
            this.runlen = 1;
        } else if (this.runtype===Ids.LAST2_RUN) {
            this._appendToLast2Run(id);
        } else if (this.runtype===Ids.UNI_RUN) {
            this._appendToUniRun(id);
        } else {
            this._appendToEmptyRun(id);
        }
    }

    toString () {
        this._flushRun();
        return this.body.join('');
    }
}

Ids.UNI_RUN = ';';
Ids.LAST_RUN = ',';
Ids.LAST2_RUN = "'";
Ids.INC_RUN = '"';


class Iterator {
    constructor (id) {
        this.ids;
        this.ids_offset;
        this.head;
        this.method;
        this.body;
        this.run_offset;
        this.id;
    }
    id () {

    }
    next () {

    }
    nextRun () {

    }
    runHas (id) {

    }

    append (id) {

    }
    /** @returns {Id} -- id at the pos */
    at (offset) {

    }
    toString () {

    }
    fromString (str, offset) {
        const pos = offset || 0;

    }
    fromMatch (head, method, body) {

    }
}

Ids.Builder = Builder;
Ids.Iterator = Iterator;
module.exports = Ids;