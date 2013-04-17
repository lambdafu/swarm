/*
= Value proposition:
 Good old days: like a local app
* javascript client & server
* distributed generic sync
* automatic persistence
* local calls ~ rpc ~ events ~ data
* comparable to Redis, no serialization - NEED NATIVE MVCC OBJECTS
*/
/* 
 * WebStorage key-val formats
 *  /coll#oid.key!ver  val
 *  /coll#set.oid!ver  /coll1/coll2  -- optional as oid is glob-unique
 *  /coll#doc.pid!ver  :pos string
 *
//   ObjectID: timestamp, source (author), sequence number (randomized)
//   Field may be an object id (for collections)
//   Object ID is a version id by default (create op)
 * Every ID is a version id
 * Version id: ts-src-seq, 1-3 ids, each id is 30 bits (6 base32, 4 bytes, 2 unicode chars)
 *  ts   UNIX second timestamp; epoch shifted to 1 Jan 2010
 *  src  (optional) author of the change, simply some account id
 *  seq  (optional) sequence number of the change; to assign multiple ids within a second
 *
 *  Unicode:  !tssrse !tssr !ts (same length ids, alphanum sortable)
 *  Base32:   !ts-src-seq (variable length ids, not sortable)
 *  Base32-6: !aaaats-aaasrc-aaaseq (const length ids, sortable)
 *  
 *  Field/collection name restrictions:
 *   paymntDue getPaymentDue() - decorate
 *
 *  Storing ids as unicode strings.
//   Pro
//      * most of the time it will sit on the RAM idle
//      * we don't plan for CPU-intensive workloads
//      * we minimize the number of objects for gc
//      * we save on string headers (otherwise >24b per field: pointer plus headers)
//   Contra
//      * we do v8-like binary-field-name optimization
 */
//   Collections
//   May have object ids as keys. Cannot have arbitrary keys (wrap as an object then).
//   Collections are mostly 'lists of objects'.
//   Sorting by the value is a common feature; once the value changes send an RPC to the
//   collection(s), e.g. inboxes (could be many).

/* the mice example
    mice_ssn = new Mice(ssn)
/mice#ssn+open
    mice_ssn.setX(20);
    // c: mice_ssn.x = 20;
    // c: mice_ssn.onX(20);
    // c: for(var e in mice_ssn.events['x']) e(20);
/#!ts@ssn+set,x 20
    // s: mice_ssn.x = 20;
/#!@+,y 20
    var stub = new Stub('/misc/roster');    // sep log syncd on every pipe opend
    stub.invoke('set',ssn,'on');
/misc#roster!ts@ssn+set,ssn  'on'
*/

/**      O P E N  T O D O S
 *
 *    v. loopless synch protocol
 *    1. alphanumeric vid order         OK  (TODO uni)
 *    2. Peer.set => storage
 *    3. on => diff
 *    4. collection
 *      4.1 diff/set
 *      4.2 Array compat (SortedSet)
 *    5. address, PEX
 *
 * */

//  I D  F O R M A T S :  U N I C O D E,  B A S E 3 2,  N U M E R I C
//
//   *peer/objectSet#objectName.field_name!version
//
//   /coll-src-seq#obj-src-seq.field-src-seq!ts-src-seq
//

//  S W A R M  S P E C I F I E R S

function ID (str,src,ssn) {
    if (str.length===7) {
        ID.re_id_lim.lastIndex = 0;
        var m = ID.re_id_lim.exec(str);
        if (!m) throw new Error('malformed id',str);
        this.q = m[1]; // TODO .charCodeAt(0);
        this.ts = ID.uni2int(m[2]);
        this.seq = ID.uni1int(m[3]);
        this.src = ID.uni2int(m[4]);
        this.ssn = ID.uni1int(m[5]);
        this.cache = str;
    } else if (str.length===1) {
        this.q = str;
        this.ts = ((new Date().getTime()/1000)|0) - ID.EPOCH;
        if (this.ts!==ID.lastTs) {
            ID.lastTs = this.ts;
            ID.lastSeq = 0;
        }
        this.seq = ID.lastSeq++;
        this.src = (src||0)&0x3fffffff;
        this.ssn = (ssn||0)&0x7fff;
        this.cache = '';
    } else
        throw new Error('malformed args');
}
ID.rs_id_uni = '([!-,\'\\.\\/])($I{2})($I)($I{2})($I)'.replace(/\$I/g,'[0-\\u802f]');
ID.re_id_lim = new RegExp('^'+ID.rs_id_uni+'$');
ID.re_id_g = new RegExp(ID.rs_id_uni,'g');
ID.EPOCH = 1262275200; // 1 Jan 2010 (seconds)

ID.uni2int = function (uni) {
    return ((uni.charCodeAt(0)-0x30)<<15) | uni.charCodeAt(1)-0x30;
};
ID.uni1int = function (uni) {
    return uni.charCodeAt(0)-0x30;
};
ID.int3uni = function (i2,i1) {
    return String.fromCharCode (0x30+(i2>>15),0x30+(i2&0x7fff),0x30+i1);
};
ID.int3base = function (i2,i1) {
    var ret = [];
    for(var i=0; i<15; i+=5)
        ret.push(ID.base32.charAt((i1>>i)&31));
    for(; i2; i2>>=5)
        ret.push(ID.base32.charAt(i2&31));
    return ret.reverse().join('').replace(/^a+/,'') || 'a';
}
ID.base32uni = function (base32) {
    var ret = [];
    while (base32) {
        var tail = base32.substr(-3);
        base32 = tail.length===3 ? base32.substr(0,base32.length-3) : '';
        var val = 0;
        for(var i=0; i<tail.length; i++) {
            val<<=5;
            val|=ID.base32.indexOf(tail.charAt(i));
        }
        ret.push(String.fromCharCode(0x30+val));
    }
    while (ret.length<3) ret.push('0');
    return ret.reverse().join('');
};
ID.base32 = 'abcdefghijklmnopqrstuvwxyz234567';

ID.prototype.toString = function () {
    return this.cache ||
        (this.cache = this.q + ID.int3uni(this.ts,this.seq) + ID.int3uni(this.src,this.ssn));
};

ID.prototype.toString32 = function () {
    var t1 = ID.int3base(this.ts,this.seq);
    var t2 = ID.int3base(this.src,this.ssn);
    if (t2==='a') t2='';
    function up(str) {
        return str ? str.charAt(0).toUpperCase()+str.substr(1) : '';
    }
    switch (this.q) {
        case '/': return up(t1)+up(t2);
        case ',': ;
        case '.': return t1+up(t2);
        default : return t1+'_'+t2;
    }
};

ID.as = function (str, defQuant) {
    if (str.prototype===ID)
        return str;
    if (str._id)
        return str._id.constructor===String?new ID(str._id):str._id;
    if (str.toString().match(ID.re_id_lim))
        return new ID(str.toString());
    return ID.parse32(defQuant,str);
};

ID.parse32 = function (quant,base32) {
    base32 = base32.replace(/([a-z2-7])([A-Z])/g,'$1-$2');
    base32 = base32.replace(/_/g,'-');
    base32 = base32.toLowerCase();
    if (base32.indexOf('-')===-1)  base32 += '-a';
    var m = base32.match(ID.re_id_32);
    if (!m)
        throw new Error('malformed base32 RFC4648 "9-9" id',base32);
    var tsseq = ID.base32uni(m[1]);
    var srcssn = ID.base32uni(m[2]);
    return new ID(quant+tsseq+srcssn);
};
ID.re_id_32 = /([a-z2-7]{1,9})-([a-z2-7]{1,9})/;

function Spec (spec, scope) {
    var m = spec!==''?spec.match(ID.re_id_g):[], tok;
    if (!m || spec.length!=m.length*7)
        throw new Error('malformed specifier',spec);
    this.type = this.oid = this.field = this.key = 
        this.method = this.version = this.base = this.peer = '';
    this.cache = spec;
    while (tok=m.pop()) {
        switch (tok.charAt(0)) {  // FIXME cycle  order
            case '/': this.type=tok; break;
            case '#': this.oid=tok; break;
            case '.': this.field=tok; break;
            case ',': this.key=tok; break;
            case '\'': this.method=tok; break;
            case '!': this.version=tok; break;
            case '$': this.base+=tok; break; // ^2
            case '*': this.peer+=tok; break;
            default: throw new Error('unknown quant',tok.charAt(0));
        }
    }
    if (scope) {
        scope = Spec.as(scope);
        var ord=Spec.order;
        for(var i=0; i<ord.length; i++)
            if (scope[ord[i]])
                this[ord[i]] = scope[ord[i]];
        this.cache = '';
    }
}

Spec.as = function (spec,defaultQuant,scope) {
    // FIXME implement scope!!!
    if (spec.constructor===Spec)
        return spec;
    if (!spec || spec.toString().match(ID.re_id_g))
        return new Spec(spec.toString(), scope);
    return new Spec(ID.parse32(defaultQuant,spec).toString(), scope);  // TODO ugly
};

Spec.is = function (str) {
    return str.constructor===Spec || str.toString().match(ID.re_id_g);
}

Spec.getPair = function (str,key) {
    str = str || '';
    var i = str.indexOf(key);
    return i===-1 ? '' : str.substr(i+7,7);
};

Spec.setPair = function (str,key,val) {
    var i = str.indexOf(key);
    if (i===-1) return str+key+val;
    return str.substr(0,i) + key + val + str.substr(i+14);
};

Spec.maxVersions = function (specstr,quant) {
    ID.re_id_g.lastIndex = 0;
    var m=[], map={}, ret=[];
    while (m=ID.re_id_g.exec(specstr)) {
        if (quant && m[1]!=quant) continue;
        var src=m[4]+m[5], time=m[2]+m[3];
        if (time>(map[src]||''))
            map[src] = time;
    }
    for(var src in map)
        ret.push('$',map[src],src);
    return ret.join('');
};

function Base(){  // FIXME ugly
}
Base.prototype.toString = function () {
    var ret = [];
    for (var key in this)
        if (this.hasOwnProperty(key)) // FIXME HORROR
            ret.push(this[key]);
    return ret.join('');
};

Spec.prototype.parseBase = function () {
    if (this.base.constructor!==String) return;
    ID.re_id_g.lastIndex = 0;
    var m = [], res = new Base();
    while (m=ID.re_id_g.exec(this.base))
        res[m[4]+m[5]] = m[0];
    this.base = res;
};

Spec.prototype.parse = function (quants) {
    var qlist = quants.match(/./g), quant;
    while (quant=qlist.pop()) {
        if (quant=='$') {
            this.parseBase();
        } else {
            var i = Spec.quants.indexOf(quant);
            var name = Spec.order[i], val = this[name];
            if (!val || val.constructor===ID) continue;
            this[name] = new ID(val);
        }
    }
    return this;
};

Spec.prototype.toString = function () {
    if (this.cache) return this.cache;
    var ret = [], ord=Spec.order;
    for(var i=0; i<ord.length; i++)
        if (this[ord[i]])
            ret.push( this[ord[i]].toString() );
    this.cache = ret.join('');
    if (this.cache.indexOf('function')!==-1)
        throw '!';
    return this.cache;
};

/** debugging only! */
Spec.prototype.toString32 = function () {
    var ret = [], ord=Spec.order;
    for(var i=0; i<ord.length; i++) {
        var v = this[ord[i]];
        if (!v) continue;
        if (ord[i]==='base')
            continue; // FIXME
        if (v.constructor===String)
            this[ord[i]] = v = new ID(v);
        ret.push( v.q, v.toString32() );
    }
    return ret.join('');
};
Spec.order = ['type','oid','field','key','method','version','base'];
Spec.quants = '/#.,\'!$';

function Diff(scope){
    this._scope = scope&&Spec.as(scope) || '';
}

/*Diff.prototype.add = function (spec,val) {
    if (spec.constructor===Diff)
        return this.merge(spec);
    if (this._scope) {
        spec = Spec.as(spec,'.'); // if: manually filled diff
        if (!this._scope.covers(spec))
            this.unscope();
        else
            spec.sco
    }
};

Diff.prototype.merge = function (diff) {
};*/

function svdebug (host,event,spec,val) {
    //var valstr = /*(JSON.stringify(val)||'undef')*/ (val||'').toString().replace(/\n.*/m,'...').substr(0,25);
    var valstr;
    val = val || '';
    spec = spec || '';
    /*if (val._id)
        valstr = '{'+val._id.toString()+'}';
    else
        switch (val.constructor) {
            case undefined: valstr = 'undef'; break;
            case ID:
            case Spec:      valstr = val.toString(); break;
            case Function:  valstr = val.name+'()'; break;
            case Number
            default:        valstr = JSON.stringify(val).replace(/\n.* /m,'...').substr(0,25);
        }*/
    console.log(
            '\t',
            host._id&&ID.as(host._id).toString() || '(no id)',
            event,
            Spec.as(spec).toString()||"''",
            //val._id&&val._id.toString() || val.constructor.name+':'+val.toString().replace(/\n.*/m,'')
            val
        );
}

function SpecValEmitter () {
    this._lstn = [];
}
SpecValEmitter.tokList = ['type','method','oid','field'];
SpecValEmitter._p = SpecValEmitter.prototype;
SpecValEmitter._p._svsrc = true; // flag

SpecValEmitter._p.on = function (spec,fn) {
    if (!this._lstn)
        this._lstn = spec ? {} : [];
    if (!fn && (spec.constructor===Function || spec.set.constructor==Function)) {
        fn = spec;
        spec = '';
    }
    if (!spec && this._lstn.constructor===Array) {
        this._lstn.push(fn); // no filtering
        return;
    }
    spec = Spec.as(spec,this._defQuant);
    svdebug(this,'on',spec,fn);
    var key = spec.oid || spec.field || spec.method; // one parameter only
    if (this._lstn.constructor===Array)
        this._lstn = { '' : this._lstn } ;
    var lstn = this._lstn[key];
    if ( lstn ) {
        if (lstn.constructor!==Array)
            lstn = [lstn];
        lstn.push(fn);
    } else
        lstn = fn;
    this._lstn[key] = lstn;
};

SpecValEmitter._p.off = function (spec,fn) {
    svdebug(this,'off',spec,fn);
    if (this._lstn.constructor===Array) {
        var i = this._lstn.indexOf(fn);   // TODO prettify!!!! FIXME
        if (i===-1) throw new Error('listener unknown');
        this._lstn.splice(i,1);
    } else {
        if (!spec) {
            var catchall = this._lstn[''];
            if (catchall) {
                var i = catchall.indexOf(fn);
                if (i!==-1)
                    catchall.splice(i,1);
            }
            return; // FIXME ugly
        }
        var key = Spec.as(spec,this._defQuant).toString();
        if (key.length!==7) throw new Error('one-token spec only');
        var lstn = this._lstn[key];
        if (lstn.constructor===Array) {
            var i = lstn.indexOf(fn);
            if (i===-1)
                throw new Error('listener unknown');
            lstn.splice(lstn.indexOf(fn),1);
            if (lstn.length===0)
                delete this._lstn[key];
        } else
            delete this._lstn[key];
    }
};

SpecValEmitter._p.emit = function (spec,val,src) {
    if (!this._lstn) return;
    var listeners=[], lstn;
    if (this._lstn.constructor===Array) {
        listeners = this._lstn;
    } else {
        if ('' in this._lstn)
            listeners = listeners.concat(this._lstn['']);
        spec = Spec.as(spec,this._defQuant);
        var tl = SpecValEmitter.tokList;
        for(var i=tl.length-1; i>=0; i--) {
            var tok = spec[tl[i]];
            if (!tok) continue;
            lstn = this._lstn[tok];
            if (!lstn) continue;
            if (lstn.constructor!==Array)
                listeners.push(lstn);
            else
                listeners = listeners.concat(lstn);
        }
    }
    svdebug(this,'emit',spec,val);
    for (var j=0; j<listeners.length; j++) {
        lstn = listeners[j];
        if (lstn===src) continue;
        // FIXME recursive processing safeguard
        try{ 
            if (lstn.constructor===Function)
                lstn(spec,val,src);
            else
                lstn.set(spec,val,src);
        } catch (ex) {
            console.error('error in the listener',ex);
        }
    }
};

/**
 *
 * */
function Peer (id) {
    if (id.constructor===String)
        id = new ID(id);
    this._id = id;
    this._lstn = {};
    this._emitting = null;
    this.peers = {};
    this.hashes = Peer.hashRing(this._id);
    this.storage = new Stub();
}  // TODO: cool, Peer is itself syncd

Peer.prototype.close = function () { // TODO think... 
    /*if (this.peers)
        for(var pid in this.peers)
            this.peers[pid].close(); //off('',this);
    this.peers = null;*/
    //for(var oid in this.objects)
    //    this.objects[oid].off();
    //delete this.objects;
};


// T I M E,  O B J E C T  A N D  V E R S I O N  I D S


// P E E R S,  U P L I N K S,  C O N S I S T E N T  H A S H I N G

/** Note. Use collection peers to track the swarm; the first
 * connected peer is likely the uplink; uplink switches a lot
 * as the peer keeps connecting - this way we test our
 * failover algorithms at each start-connect cycle. */
Peer.prototype.addPeer = function (peer) {
    var self = this;
    var pid = peer._id;
    svdebug(this,'+peer',pid,peer);
    if (pid in self.peers) {
        // FIXME kick it out
        throw new Error('peer was already added: '+pid);
    }
    self.peers[pid] = peer;
    // TODO this.pexes.set(pid,url);
    //    redistribute load to the new peer
    for(var oid in self._lstn) {
        if (oid.charAt(0)!=='#') continue;
        var newup = this.findUplink(oid), oldup;
        if (newup===peer) {
            if (oldup = this.findUplink(oid,newup))
                oldup.off(oid,this);
            var obj = this.findObject(oid);
            newup.on (obj?obj.spec():oid, this);
        }
    }
};

Peer.prototype.removePeer = function (peer) {
    var pid = peer._id&&peer._id.toString() || peer.toString();
    peer = this.peers[pid];
    svdebug(this,'-peer',pid,peer);
    if (!peer)
        throw new Error('peer unknown: '+pid);
    for(var oid in this._lstn) {
        if (oid.charAt(0)!=='#') continue;
        //var obj = this.objects[oid];
        var oldup = this.findUplink(oid);
        if (oldup===peer) {
            var newup = this.findUplink(oid,oldup); // TODO merge
            var obj = this.findObject(oid);
            newup.on(obj?obj.spec():oid,this);
            oldup.off(oid,this);
        }
    }
    delete this.peers[pid];
};

var salts = [0];

// FIXME : src not 0 => no hashes
Peer.hashRing = function (id) {
    var ring = [];
    var hash = ID.as(id).hash();
    for(var i=0; i<salts.length; i++)
        ring.push(hash^salts[i]); // TODO wrong
    return ring;
};

ID.prototype.hash = function () {
    //for (var i = 0; i < len; i++)
    //    res = res * 31 + str.charCodeAt(i);
    //return res&0x7fffffff;
    return this.src ^ this.ssn;
};


Peer.distance = Peer.prototype.distance = function (hash,peer) {
    if (hash.constructor===String) hash = new ID(hash);
    if (hash.constructor===ID) hash = hash.hash();
    peer = peer || this;
    if (!peer._hashes)
        peer._hashes = Peer.hashRing(peer._id);
    var minDist = 0x7fffffff;
    var hashes = peer._hashes;
    for(var i=0; i<hashes.length; i++)
        if ( (hashes[i]^hash) < minDist )
            minDist = hashes[i]^hash;
    return minDist;
};

Peer.prototype.findUplink = function (obj,except) {
    var nopid = except ? (except._id || except) : '';
    var minDist = this.distance(obj),
        minPeer = this.storage;
    var hash = ID.as(obj._id||obj).hash();
    for(var pid in this.peers) {
        if (pid==nopid) continue;
        var peer = this.peers[pid];
        var dist = Peer.distance(hash,peer);
        if (minDist>=dist) 
            if (minDist>dist || peer._id<this._id) {
                minDist = dist;
                minPeer = peer;
            }
    }
    return minPeer;
};

Peer.prototype.findObject = function (spec) {
    spec = Spec.as(spec);
    var oid = spec.oid.toString();
    var o = this._lstn[oid];
    if (o) { 
        if (o.constructor===Array) {
            for(var i=0; i<o.length; i++)
                if (o[i]._id==oid) // ==, not ===
                    return o[i];
        }
        if (o._id==spec.oid) // ==, not ===
            return o;
    }
    return undefined;
};

Peer.prototype.createObject = function(spec,prefab) {
    spec = Spec.as(spec).parse('/');
    var fn = Peer.prototypes[spec.type.toString32()], oid = spec.oid;
    if (!fn)
        throw new Error('unknown type');
    var obj = prefab || new fn(oid);
    obj._id = oid; // just make sure
    obj._host = this; // FIXME kill kill kill
    obj._vmap = obj._vmap || '';
    obj._lstn = [];
    obj.on('',this); // subscribe to the object's changes
    var needUpOn = !(oid in this._lstn);
    this._on(oid,obj); // subscribe the object
    if (needUpOn) {
        var up = this.findUplink(oid);
        up.on(spec.type+oid+'$000000',this); // no base; we need a complete state boot
    }
    return obj;
};

Peer.prototype.createId = function (quant) {
    return new ID(quant||'!',this._id.src,this._id.ssn);
};

//  P E E R'S  3 - M E T H O D  I N T E R F A C E

Peer.prototype.on = function (spec,listener) {
    var obj, ln=listener;
    // get spec
    switch (spec.constructor) {
        case Function:  spec = spec.name; //break;
        case String:    spec = Spec.as(spec,'/'); break;
        case ID:        spec = new Spec(spec.toString()); break;
        case Spec:      break;
        default:        if (typeof(spec)==='object' && spec._id) {
                            ln = spec;
                            spec = Spec.as(ln._id);
                        } else
                            throw new Error('cannot understand parameters');
    }
    if (!spec.tid && ln && ln._tid)
        spec.type = ln._tid;
    // find an existing object
    if (!obj && spec.oid)
        obj = this.findObject(spec);
    if (obj && spec.base) {
        var diff = obj.diff(spec.base);
        if (diff)
            ln.set(obj._id,diff);
    }
    // gen an oid if not yet
    if (!obj && !spec.oid)
        spec.oid = this.createId('#');
    // create and subscribe new obj
    if (!obj && spec.type)
        obj = this.createObject(spec, ln && ln._tid==spec.type ? ln : undefined);

    if (!obj)
        throw new Error('incomplete specifier: '+spec);

    if (ln && ln!==obj)
        this._on(spec.oid,ln);

    if (ln && ln._id && ln._id in this.peers) {
        if (Peer.distance(spec.oid,ln) > Peer.distance(spec.oid,this))  // FIXME  dist==dist
            ln.on(obj.spec(),this);
    }

    return obj;
};

Peer.prototype._on = SpecValEmitter._p.on;
Peer.prototype._off = SpecValEmitter._p.off;
Peer.prototype.emit = SpecValEmitter._p.emit;

/** Remove objects which are not listened to, except by their uplink */
Peer.prototype.gc = function ( ) {
    for(var oid in this._lstn) {
        if (oid.charAt(0)!=='#') continue;
        var obj = this._lstn[oid];
        if (obj.constructor===Array)
            if (obj.length===1)
                obj=obj[0];
            else
                continue;
        if (obj._lstn.constructor===Array) {
            if (obj._lstn.length===1 && obj._lstn[0]===this) {
                obj.off('',this);
                this.off(oid,obj);
                obj._id = null; // dead
            }
        } // TODO {} complex _lstn
    }
};

Peer.prototype.off = function (spec,cb) {
    if (spec._id) {
        if (!cb)
            cb = spec;
        spec = spec._id;
    }
    if (!cb) throw new Error('invalid argument');
    spec = Spec.as(spec);
    
    this._off(spec.oid,cb);
    if (cb._id==spec.oid && cb._tid)
        cb.off('',this);
    
    var ln = this._lstn[spec.oid];
    if (ln && ln.length===1) { // unsubscribe from the uplink, maybe
        var up = this.findUplink(spec.oid);
        if (ln[0]===up)
            up.off(spec.oid,this);
    }

    if (cb._id && cb._id in this.peers) { // unsubscribe from the downlink, maybe
        if (Peer.distance(spec,cb) > Peer.distance(spec,this))  // FIXME  dist==dist
            cb.off(spec.oid,this);
    }

};

Peer.prototype.set = function (spec,val,src) {
    if (this._emitting && spec==this._emitting)
        return; // inf cycle safeguard
    this._emitting = spec;
    spec = Spec.as(spec);
    this.emit(spec,val,src);  // relay
    this._emitting = null;
};

// O B J E C T  P R O T O T Y P E  H A N D L I N G

Peer.prototypes = {};

Peer.extend = function(func,name) {
    name = name || func.name;
    var tid = ID.parse32('/',name);
    if (tid.toString32()!==name)
        throw new Error('not a base32 name',name);
    Peer.prototypes[name] = func;
    var proto = func.prototype;
    proto._fields = []; // compare to {}
    proto._field2name = {};
    proto._tid = tid;
    proto._defQuant = '.';
    // introspect an empty object
    var sample = new func();
    for (var f in sample) {
        if (f.charAt(0)==='_') continue;
        if (!sample.hasOwnProperty(f)) continue;
        var id = ID.parse32('.',f), capcheck=id.toString32();
        if (f!==capcheck)
            throw new Error('malformed base32 name',f);
        proto._fields.push(f);
        proto._field2name[id] = f;
        var capname = f.charAt(0).toUpperCase()+f.substr(1);
        (function def (spec,name,Name) {
            proto['set'+Name] = function (val) {
                this.set(spec,val);
            }
            proto['get'+Name] = function () {
                return this[name];
            }
        }) (id,f,capname);
    }
    // extend the prototype
    for(var method in SwarmObjectProto)
        proto[method] = SwarmObjectProto[method];
    for(var method in SpecValEmitter._p)
        proto[method] = SpecValEmitter._p[method];
};

var SwarmObjectProto = {

    /** Apply a specval diff */
    set: function the_set (spec,val,srcref) {
        if (val && val.constructor===Diff) {
            for(var s in val)
                if (s.charAt(0)!=='_') // FIXME ugly
                    this.set(Spec.as(s,'.',val._scope),val[s],srcref);
            return;
        }
        if (spec.constructor===Object && val===undefined) {
            val = spec;
            spec = '';
        }
        spec = Spec.as(spec,'.',this._tid+this._id); // FIXME reparsing ugly
        svdebug(this,'set',spec,val);
        if (!spec.oid)
            spec.oid = this._id;
        if (!spec.version) {
            spec.version = this._host ? this._host.createId('!') : new ID('!');
            spec.cache = ''; // FIXME automate
            srcref = this;
        }
        if (!spec.field) { 
            for (var s in val)
                if (s.charAt(0)!='_') {
                    spec.field = ID.as(s,'.'); // TODO cached
                    this.set(spec,val[s],srcref);
                }
            return; // BAD
        }

        spec.parse('$.');
        var hasVersion = Spec.getPair(this._vmap,spec.field);
        if ((hasVersion||'') < spec.version) {
            var fname = spec.field.toString32();
            this[fname] = val;
            this._vmap = Spec.setPair(this._vmap,spec.field,spec.version);
            this.emit(spec,val,srcref);
        } else
            console.warn('too old');

    },

    spec: function () { return this._tid + this._id + this.base(); },
    base: function the_base () {
        return Spec.maxVersions(this._vmap) || '$000000';
    },

    /** Create a specval diff from the given version */
    diff: function the_diff (spec,diff) {
        if (!this._vmap) return;
        spec = Spec.as(spec);
        spec.parseBase();
        var versions = this._vmap.match(ID.re_id_g).reverse(), field;
        while (field=versions.pop()) {
            var version = versions.pop();
            var source = version.substr(4); // BAD
            if ( version > (spec.base[source]||'').replace('$','!') ) { // TODO prettify
                diff = diff || new Diff(); //{_id: this._id};
                diff[this._tid+this._id+field+version] = this[this._field2name[field]];
            }
        }
        return diff;
    },

}; // proto

//  N E T W O R K I N G

function Stub () {}
var _p = Stub.prototype;
_p.on = _p.off = _p.set = _p.peer = function(){};


function Pipe (id,sink,host,opts) {
    var self = this;
    opts = opts||{};
    self._id = id;
    self.sink = sink;
    self.host = host;
    self.timer = null;
    self.bundle = {};
    self.timeout = opts.timeout || -1;
    self.serialize = opts.serialize || function (obj) {
        return JSON.stringify(obj);
    };
    self.deserialize = opts.deserialize || function (str) {
        return JSON.parse(str);
    };
    self.sink.on('message',function(msg){
        self.parseBundle(msg.data||msg); // FIXME FIXME FIXME  wrap WebSocket
    });
}
Spec.METHOD_ON = ID.as('on',"'");
Spec.METHOD_OFF = ID.as('off',"'");

Pipe.prototype.on = function (spec,val) {
    spec = Spec.as(spec);
    spec.method = Spec.METHOD_ON;
    spec.cache = null; // TODO sep obj
    this.set(spec,'');
};

Pipe.prototype.off = function (spec,val) {
    spec = Spec.as(spec);
    spec.method = Spec.METHOD_OFF;
    spec.cache = null; // FIXME sep obj
    this.set(spec,'');
};

function versionSort (a,b) {
    return a.version<b.version ? 1 : (a.version===b.version?0:-1);
}

Pipe.prototype.parseBundle = function (msg) {
    var obj = this.deserialize(msg.toString()), keys = [], spec;
    for(var key in obj)
        if (key)
            keys.push(new Spec(key));
    keys.sort(versionSort);
    while (spec = keys.pop()) {
        if (spec.method) {
           if (spec.method==Spec.METHOD_ON)
               this.host.on(spec,this);
           else if (spec.method==Spec.METHOD_OFF)
               this.host.off(spec,this);
           else
               {}
        } else
            this.host.set(spec,obj[spec.cache],this);
    }
};

Pipe.prototype.sendBundle = function () {
    var self = this;
    var sendStr = self.serialize(self.bundle);
    self.bundle = {};
    //console.log('\t\t',this.host._id+' > '+this._id+'',sendStr);
    svdebug(this.host,' > ',this._id,sendStr);
    self.sink.send(sendStr);
};

Pipe.prototype.set = function (spec,val) {
    var self = this;
    if (val && val.constructor===Diff) {
        for(var s in val)
            if (s.charAt(0)!=='_')
                self.bundle[s] = val[s]; // FIXME weird
    } else if (spec)
        self.bundle[spec] = val;
    if (!self.timer) {
        if (self.timeout===-1)
            self.sendBundle();
        else
            self.timer = setTimeout(function(){
                self.sendBundle();
                self.timer = null;
            },self.timeout);
    }
};

Pipe.prototype.close = function pc () {
    this.sink.close();
};

function TestSocket () {
    this.pair = null;
    this.cb = null;
};
TestSocket.prototype.send = function (msg) {
    this.pair.cb(msg);
};
TestSocket.prototype.on = function (ev,fn) {
    this.cb = fn;
};
TestSocket.prototype.close = function () {
    this.pair = {cb: function(){console.error('closed')} };
};

function getTestSocketPair () {
    var a = new TestSocket(), b = new TestSocket();
    a.pair = b;
    b.pair = a;
    return [a,b];
};


function Plumber (peer,urlList) {
    for(var url in urlList)
        this.connect(url);
};

Plumber.prototype.scheduleReconnect = function (uri) {
    var self = this;
    self.reconnCount[uri];
    var delay;
    setTimeout(function(){
        self.connect(uri);
    },delay);
};


Plumber.prototype.connect = function (uri) {
    var self = this;
    var wrap = Plumber.schemes[uri.scheme] (uri,self.host);
    var vocabulary = Plumber.schemes[uri.scheme].vocab || {};
    wrap.on(vocab.connect||'connect',function(err){
        if (err)
            return self.scheduleReconnect(uri);
        var pipe = new Pipe();
        self.host.addPeer(pipe);
        self.reconnCount[uri] = 0;
        wrap.on(vocab.close||'close',function(){
            self.scheduleReconnect(uri);
        });
        wrap.on(vocab.error||'error',function(){
            self.scheduleReconnect(uri);
        });
    });
};


if (typeof(module)!=='undefined') {
    module.exports.Peer = Peer;
    module.exports.Pipe = Pipe;
    module.exports.ID = ID;
    module.exports.Spec = Spec;
    module.exports.Plumber = Plumber;
}