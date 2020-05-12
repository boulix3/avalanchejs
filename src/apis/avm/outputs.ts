/**
 * @module AVMAPI
 */
import {Buffer} from "buffer/";
import BinTools from '../../utils/bintools';
import BN from "bn.js";
import { Address, UnixNow, AVMConstants } from './types';

const bintools = BinTools.getInstance();

/**
 * Takes a buffer representing the output and returns the proper Output instance.
 * 
 * @param outbuffer A {@link https://github.com/feross/buffer|Buffer} containing the Output raw data.
 * 
 * @returns An instance of an [[Output]]-extended class: [[SecpOutput]], [[NFTOutput]].
 */
export const SelectOutputClass = (outputid:number, outbuffer:Buffer, args:Array<any> = []):Output => {
    if(outputid == AVMConstants.SECPOUTPUTID){
        let secpout:SecpOutput = new SecpOutput( ...args);
        secpout.fromBuffer(outbuffer);
        return secpout;
    } else if(outputid == AVMConstants.NFTXFEROUTPUTID){
        let nftout:NFTOutput = new NFTOutput(...args);
        nftout.fromBuffer(outbuffer);
        return nftout;
    }
    throw new Error("Error - SelectOutputClass: unknown outputid " + outputid);
}

export abstract class Output {
    protected locktime:Buffer = Buffer.alloc(8);
    protected threshold:Buffer = Buffer.alloc(4);
    protected numaddrs:Buffer = Buffer.alloc(4);
    protected addresses:Array<Address> = [];

    /**
     * Returns the outputID for the output which tells parsers what type it is
     */
    abstract getOutputID():number;

    /**
     * Returns the threshold of signers required to spend this output.
     */
    getThreshold = ():number => {
        return this.threshold.readUInt32BE(0);
    }

    /**
     * Returns the a {@link https://github.com/indutny/bn.js/|BN} repersenting the UNIX Timestamp when the lock is made available.
     */
    getLocktime = ():BN => {
        return bintools.fromBufferToBN(this.locktime);
    }

        /**
     * Returns an array of {@link https://github.com/feross/buffer|Buffer}s for the addresses.
     */
    getAddresses = ():Array<Buffer> => {
        let result:Array<Buffer> = [];
        for(let i = 0; i < this.addresses.length; i++) {
            result.push(this.addresses[i].toBuffer())
        }
        return result;
    }

    /**
     * Returns the index of the address.
     * 
     * @param address A {@link https://github.com/feross/buffer|Buffer} of the address to look up to return its index.
     * 
     * @returns The index of the address.
     */
    getAddressIdx = (address:Buffer):number => {
        for(let i = 0; i < this.addresses.length; i++){
            if(this.addresses[i].toBuffer().toString("hex") == address.toString("hex")){
                return i
            }
        }
        /* istanbul ignore next */
        return -1;
    }

    /**
     * Returns the address from the index provided.
     * 
     * @param idx The index of the address.
     * 
     * @returns Returns the string representing the address.
     */
    getAddress = (idx:number):Buffer => {
        if(idx < this.addresses.length){
            return this.addresses[idx].toBuffer();
        }
        throw new Error("Error - SecpOutBase.getAddress: idx out of range");
    }

    /**
     * Given an array of address {@link https://github.com/feross/buffer|Buffer}s and an optional timestamp, returns true if the addresses meet the threshold required to spend the output.
     */
    meetsThreshold = (addresses:Array<Buffer>, asOf:BN = undefined):boolean => {
        let now:BN;
        if(typeof asOf === 'undefined'){
            now = UnixNow();
        } else {
            now = asOf;
        }
        let qualified:Array<Buffer> = this.getSpenders(addresses, now);
        let threshold:number = this.threshold.readUInt32BE(0);
        if(qualified.length >= threshold){
            return true;
        }

        return false;
    }

    /**
     * Given an array of addresses and an optional timestamp, select an array of address {@link https://github.com/feross/buffer|Buffer}s of qualified spenders for the output.
     */
    getSpenders = (addresses:Array<Buffer>, asOf:BN = undefined):Array<Buffer> => {
        let qualified:Array<Buffer> = [];
        let now:BN;
        if(typeof asOf === 'undefined') {
            now = UnixNow();
        } else {
            now = asOf;
        }
        let locktime:BN = bintools.fromBufferToBN(this.locktime);
        if(now.lte(locktime)) { //not unlocked, not spendable
            return qualified;
        }

        let threshold:number = this.threshold.readUInt32BE(0);

        for(let i = 0; i < this.addresses.length && qualified.length < threshold; i++) {
            for(let j = 0; j < addresses.length && qualified.length < threshold; j++) {
                if(addresses[j].toString("hex") == this.addresses[i].toBuffer().toString("hex")) {
                    qualified.push(addresses[j]);
                }
            }
        }

        return qualified;
    }
    /**
     * Returns the buffer representing the [[Output]] instance.
     */
    toBuffer():Buffer {
        try {
            this.addresses.sort(Address.comparitor());
            this.numaddrs.writeUInt32BE(this.addresses.length, 0);
            let bsize:number = this.locktime.length + this.threshold.length + this.numaddrs.length;
            let barr:Array<Buffer> = [this.locktime, this.threshold, this.numaddrs];
            for(let i = 0; i < this.addresses.length; i++) {
                let b: Buffer = this.addresses[i].toBuffer();
                barr.push(b);
                bsize += b.length;
            }
            return Buffer.concat(barr,bsize);;
        } catch(e) {
            /* istanbul ignore next */
            let emsg:string = "Error - SecpOutBase.toBuffer: " + e;
            /* istanbul ignore next */
            throw new Error(emsg);
        }
    };

    /**
     * Returns a base-58 string representing the [[Output]].
     */
    fromBuffer(outbuff:Buffer, offset:number):number {
        this.locktime = bintools.copyFrom(outbuff, offset, offset + 8);
        offset += 8;
        this.threshold = bintools.copyFrom(outbuff, offset, offset + 4);
        offset += 4;
        this.numaddrs = bintools.copyFrom(outbuff, offset, offset + 4);
        offset += 4;
        let numaddrs:number = this.numaddrs.readUInt32BE(0);
        this.addresses = [];
        for(let i = 0; i < numaddrs; i++){
            let addr:Address = new Address();
            let offsetEnd:number = offset + addr.getSize();
            let copied:Buffer = bintools.copyFrom(outbuff, offset, offsetEnd);
            addr.fromBuffer(copied);
            this.addresses.push(addr);
            offset = offsetEnd;
        }
        this.addresses.sort(Address.comparitor());
        return offset;
    };

    /**
     * Returns a base-58 string representing the [[Output]].
     */
    toString():string {
        return bintools.bufferToB58(this.toBuffer());
    }

    /**
     * 
     * @param assetID An assetID which is wrapped around the Buffer of the Output
     */
    makeTransferable(assetID:Buffer):TransferableOutput {

    }

    static comparator = ():(a:Output, b:Output) => (1|-1|0) => {
        return function(a:Output, b:Output):(1|-1|0) { 
            return Buffer.compare(a.toBuffer(), b.toBuffer()) as (1|-1|0);
        }
    }

    /**
     * An [[Output]] class which contains locktimes, thresholds, and addresses.
     * 
     * @param locktime A {@link https://github.com/indutny/bn.js/|BN} representing the locktime
     * @param threshold A number representing the the threshold number of signers required to sign the transaction
     * @param addresses An array of {@link https://github.com/feross/buffer|Buffer}s representing addresses
     */
    constructor(locktime:BN = undefined, threshold:number = undefined, addresses:Array<Buffer> = undefined){
        if(addresses){
            let addrs:Array<Address> = [];
            for(let i = 0; i < addresses.length; i++) {
                addrs[i] = new Address();
                addrs[i].fromBuffer(addresses[i]);
            }
            this.addresses = addrs;
            this.addresses.sort(Address.comparitor());
            this.numaddrs.writeUInt32BE(this.addresses.length, 0);
            this.threshold.writeUInt32BE((threshold ? threshold : 1), 0);
            if(!(locktime)){
                /* istanbul ignore next */
                locktime = new BN(0);
            }
            this.locktime = bintools.fromBNToBuffer(locktime, 8);
        }
    }
}

export class TransferableOutput {
    protected assetID:Buffer = Buffer.alloc(AVMConstants.ASSETIDLEN);
    protected output:Output;

    fromBuffer(tranbuff:Buffer, offset:number = 0):number {
        this.assetID = bintools.copyFrom(tranbuff, offset, offset + AVMConstants.ASSETIDLEN);
        offset += AVMConstants.ASSETIDLEN;
        let outputid:number = bintools.copyFrom(tranbuff, offset, offset + 4).readUInt32BE(0);
        this.output = SelectOutputClass(outputid, bintools.copyFrom(tranbuff, offset));
        return offset + this.output.toBuffer().length;
    }

    toBuffer():Buffer {
        let outbuff:Buffer = this.output.toBuffer();
        let outid:Buffer = Buffer.alloc(4)
        outid.writeUInt32BE(this.output.getOutputID(), 0);
        let barr:Array<Buffer> = [this.assetID, outid, outbuff];
        return Buffer.concat(barr, this.assetID.length + outid.length + outbuff.length);
    }
}

/**
 * An [[Output]] class which specifies a token amount .
 */
export abstract class AmountOutput extends Output {
    protected amount:Buffer = Buffer.alloc(8);
    protected amountValue:BN = new BN(0);

    /**
     * Returns the amount as a {@link https://github.com/indutny/bn.js/|BN}.
     */
    getAmount = ():BN => {
        return this.amountValue.clone();
    }

    /**
     * Popuates the instance from a {@link https://github.com/feross/buffer|Buffer} representing the [[AmountOutput]] and returns the size of the output.
     */
    fromBuffer(outbuff:Buffer, offset:number = 0):number {
        this.amount = bintools.copyFrom(outbuff, offset, offset + 8);
        this.amountValue = bintools.fromBufferToBN(this.amount);
        offset += 8;
        return super.fromBuffer(outbuff, offset);
    }

    /**
     * Returns the buffer representing the [[SecpOutBase]] instance.
     */
    toBuffer():Buffer {
        let superbuff:Buffer = super.toBuffer();
        let bsize:number = this.amount.length + superbuff.length;
        this.numaddrs.writeUInt32BE(this.addresses.length, 0);
        let barr:Array<Buffer> = [this.amount,superbuff];
        return Buffer.concat(barr,bsize);
    }

    /**
     * An [[AmountOutput]] class which issues a payment on an assetID.
     * 
     * @param amount A {@link https://github.com/indutny/bn.js/|BN} representing the amount in the output
     * @param locktime A {@link https://github.com/indutny/bn.js/|BN} representing the locktime
     * @param threshold A number representing the the threshold number of signers required to sign the transaction
     * @param addresses An array of {@link https://github.com/feross/buffer|Buffer}s representing addresses
     */
    constructor(amount:BN = undefined, locktime:BN = undefined, threshold:number = undefined, addresses:Array<Buffer> = undefined) {
        super(locktime, threshold, addresses);
        if(amount) {
            this.amountValue = amount.clone();
            this.amount = bintools.fromBNToBuffer(amount, 8);
        }
    }
}

/**
 * An [[Output]] class which specifies an Output that carries an ammount for an assetID and uses secp256k1 signature scheme.
 */
export class SecpOutput extends AmountOutput {
    /**
     * Returns the outputID for this output
     */
    getOutputID():number {
        return AVMConstants.SECPOUTPUTID;
    }
}


/**
 * An [[Output]] class which specifies an NFT.
 */
export abstract class NFTOutBase extends Output {
    protected groupID:Buffer = Buffer.alloc(4);
    protected sizePayload:Buffer = Buffer.alloc(4);
    protected payload:Buffer;

    /**
     * Returns the groupID as a number.
     */
    getGroupID = ():number => {
        return this.groupID.readUInt32BE(0);
    }

    /**
     * Returns the payload as a {@link https://github.com/feross/buffer|Buffer}
     */
    getPayload = ():Buffer => {
        return bintools.copyFrom(this.payload);
    }

    /**
     * Popuates the instance from a {@link https://github.com/feross/buffer|Buffer} representing the [[NFTOutBase]] and returns the size of the output.
     */
    fromBuffer(utxobuff:Buffer, offset:number = 0):number {
        this.groupID = bintools.copyFrom(utxobuff, offset, offset + 4);
        offset += 4;
        this.sizePayload = bintools.copyFrom(utxobuff, offset, offset + 4);
        let psize:number = this.sizePayload.readUInt32BE(0);
        offset += 4;
        this.payload = bintools.copyFrom(utxobuff, offset, offset + psize);
        offset = offset + psize;
        return super.fromBuffer(utxobuff, offset);
    }

    /**
     * Returns the buffer representing the [[NFTOutBase]] instance.
     */
    toBuffer():Buffer {
        let superbuff:Buffer = super.toBuffer();
        let bsize:number = this.groupID.length + this.sizePayload.length + this.payload.length + superbuff.length;
        this.sizePayload.writeUInt32BE(this.payload.length, 0);
        let barr:Array<Buffer> = [this.groupID, this.sizePayload, this.payload, superbuff];
        return Buffer.concat(barr,bsize);
    }

    /**
     * An [[Output]] class which contains an NFT on an assetID.
     * 
     * @param groupID A number representing the amount in the output
     * @param payload A {@link https://github.com/feross/buffer|Buffer} of max length 1024 
     * @param addresses An array of {@link https://github.com/feross/buffer|Buffer}s representing addresses
     * @param locktime A {@link https://github.com/indutny/bn.js/|BN} representing the locktime
     * @param threshold A number representing the the threshold number of signers required to sign the transaction
     */
    constructor(groupID:number = undefined, payload:Buffer = undefined, locktime:BN = undefined, threshold:number = undefined, addresses:Array<Buffer> = undefined){
        super(locktime, threshold, addresses);
        if(typeof groupID !== 'undefined' && typeof payload !== 'undefined') {
            this.groupID.readUInt32BE(groupID);
            this.sizePayload.readUInt32BE(payload.length);
            this.payload = bintools.copyFrom(payload, 0, payload.length);
        }
    }
}

/**
 * An [[Output]] class which specifies an Output that carries an NFT and uses secp256k1 signature scheme.
 */
export class NFTOutput extends NFTOutBase {
    /**
     * Returns the outputID for this output
     */
    getOutputID():number {
        return AVMConstants.NFTXFEROUTPUTID;
    }
}
