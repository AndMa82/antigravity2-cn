#!/usr/bin/env node
"use strict";

/**
 * scripts/asar_patcher.js
 * 零外部依赖的纯 Node.js 原生 Electron ASAR 极速签名探针与内存级外科手术补丁器
 * - isAsarLocalizedFast(asarPath): <2ms 仅读取 Pickle 头部与 preload.js 尾部校验签名
 * - patchAsarSurgical(asarPath, fileMutators, options): <120ms 内存级替换目标文件并重算 offset/size/SHA256 integrity
 * - packDirToAsar / extractAsarToDir: 纯原生 ASAR 打包与解包（供离线兜底与沙盒自测使用）
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_SIGNATURE_START = "/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */";
const DEFAULT_SIGNATURE_END = "/* --- ANTIGRAVITY CHINESE LOCALIZATION END --- */";
const DEFAULT_BLOCK_SIZE = 4 * 1024 * 1024; // 4MB (Electron ASAR integrity standard)
const WRITEV_BATCH_SIZE = 512; // Safe below POSIX/macOS IOV_MAX (1024)

function sha256Hex(buf) {
    return crypto.createHash("sha256").update(buf).digest("hex");
}

function computeAsarIntegrity(buf, blockSize = DEFAULT_BLOCK_SIZE) {
    const hash = sha256Hex(buf);
    const blocks = [];
    if (buf.length === 0) {
        blocks.push(hash);
    } else {
        for (let offset = 0; offset < buf.length; offset += blockSize) {
            const slice = buf.subarray(offset, Math.min(offset + blockSize, buf.length));
            blocks.push(sha256Hex(slice));
        }
    }
    return {
        algorithm: "SHA256",
        hash,
        blockSize,
        blocks
    };
}

function buildPickleHeader(jsonBuf) {
    const jsonLen = jsonBuf.length;
    const alignedJsonLen = Math.ceil(jsonLen / 4) * 4;
    const headerPayloadLen = 4 + alignedJsonLen;
    const headerPickleSize = 4 + headerPayloadLen;
    const totalHeaderSize = 8 + headerPickleSize;

    const headerBuf = Buffer.alloc(totalHeaderSize, 0);
    headerBuf.writeUInt32LE(4, 0);
    headerBuf.writeUInt32LE(headerPickleSize, 4);
    headerBuf.writeUInt32LE(headerPayloadLen, 8);
    headerBuf.writeUInt32LE(jsonLen, 12);
    jsonBuf.copy(headerBuf, 16);

    return {
        headerBuf,
        headerSha256: sha256Hex(jsonBuf),
        dataOffset: totalHeaderSize
    };
}

function parseAsarHeaderFromFd(fd, fileSize) {
    if (fileSize < 16) {
        throw new Error("Invalid ASAR archive: file smaller than 16 bytes");
    }
    const prefix = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, prefix, 0, 16, 0);
    if (bytesRead !== 16) {
        throw new Error("Invalid ASAR archive: failed to read 16-byte header");
    }
    const sizePayloadLen = prefix.readUInt32LE(0);
    const headerPickleSize = prefix.readUInt32LE(4);
    const headerPayloadLen = prefix.readUInt32LE(8);
    const jsonLen = prefix.readUInt32LE(12);
    const dataOffset = 8 + headerPickleSize;

    if (sizePayloadLen !== 4 || jsonLen <= 0 || 16 + jsonLen > dataOffset || dataOffset > fileSize) {
        throw new Error(
            `Invalid ASAR pickle header: p0=${sizePayloadLen}, pickleSize=${headerPickleSize}, p2=${headerPayloadLen}, jsonLen=${jsonLen}, fileSize=${fileSize}`
        );
    }

    const jsonBuf = Buffer.allocUnsafe(jsonLen);
    const jsonRead = fs.readSync(fd, jsonBuf, 0, jsonLen, 16);
    if (jsonRead !== jsonLen) {
        throw new Error("Invalid ASAR archive: truncated header JSON");
    }

    const tree = JSON.parse(jsonBuf.toString("utf8"));
    return {
        tree,
        jsonBuf,
        jsonLen,
        dataOffset
    };
}

function parseAsarHeaderFromBuffer(asarBuf) {
    if (!Buffer.isBuffer(asarBuf) || asarBuf.length < 16) {
        throw new Error("Invalid ASAR buffer");
    }
    const sizePayloadLen = asarBuf.readUInt32LE(0);
    const headerPickleSize = asarBuf.readUInt32LE(4);
    const jsonLen = asarBuf.readUInt32LE(12);
    const dataOffset = 8 + headerPickleSize;
    if (sizePayloadLen !== 4 || jsonLen <= 0 || 16 + jsonLen > dataOffset || dataOffset > asarBuf.length) {
        throw new Error("Corrupted ASAR pickle header offsets");
    }
    const jsonBuf = asarBuf.subarray(16, 16 + jsonLen);
    const tree = JSON.parse(jsonBuf.toString("utf8"));
    return {
        tree,
        jsonBuf,
        jsonLen,
        dataOffset
    };
}

function getTreeNode(tree, relPath) {
    const parts = relPath.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(Boolean);
    let cur = tree;
    for (const part of parts) {
        if (!cur || !cur.files || !Object.prototype.hasOwnProperty.call(cur.files, part)) {
            return null;
        }
        cur = cur.files[part];
    }
    return cur;
}

function ensureTreeParent(tree, relPath) {
    const parts = relPath.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(Boolean);
    const fileName = parts.pop();
    let cur = tree;
    for (const part of parts) {
        if (!cur.files) cur.files = {};
        if (!cur.files[part]) cur.files[part] = { files: {} };
        cur = cur.files[part];
    }
    if (!cur.files) cur.files = {};
    return { parent: cur.files, fileName };
}

/**
 * 极速检测 ASAR 是否已注入汉化签名（耗时通常 <2ms，不加载完整包体）
 */
function isAsarLocalizedFast(asarPath, options = {}) {
    if (!asarPath || !fs.existsSync(asarPath)) return false;
    const targetFile = options.targetFile || "dist/preload.js";
    const signatureEnd = options.signatureEnd || DEFAULT_SIGNATURE_END;
    const signatureStart = options.signatureStart || DEFAULT_SIGNATURE_START;
    const tailWindow = options.tailBytes || 8192;

    let fd = null;
    try {
        const stat = fs.statSync(asarPath);
        if (!stat.isFile() || stat.size < 32) return false;
        fd = fs.openSync(asarPath, "r");
        const { tree, dataOffset } = parseAsarHeaderFromFd(fd, stat.size);
        const node = getTreeNode(tree, targetFile);
        if (!node || node.unpacked || node.link || typeof node.size !== "number" || node.size <= 0) {
            return false;
        }
        const entryOffset = Number(node.offset);
        if (!Number.isFinite(entryOffset) || dataOffset + entryOffset + node.size > stat.size) {
            return false;
        }

        const readLen = Math.min(node.size, tailWindow);
        const readPos = dataOffset + entryOffset + (node.size - readLen);
        const tailBuf = Buffer.allocUnsafe(readLen);
        fs.readSync(fd, tailBuf, 0, readLen, readPos);
        if (tailBuf.indexOf(Buffer.from(signatureEnd, "utf8")) !== -1) {
            return true;
        }
        if (tailBuf.indexOf(Buffer.from(signatureStart, "utf8")) !== -1) {
            return true;
        }
        // Fallback: if preload.js was modified after our block, check full preload.js (only ~300KB)
        if (node.size > tailWindow) {
            const fullPreload = Buffer.allocUnsafe(node.size);
            fs.readSync(fd, fullPreload, 0, node.size, dataOffset + entryOffset);
            return fullPreload.indexOf(Buffer.from(signatureStart, "utf8")) !== -1;
        }
        return false;
    } catch (e) {
        return false;
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (_) {}
        }
    }
}

/**
 * 读取 ASAR 内单个打包文件（UTF-8 或 Buffer）
 */
function readFileFromAsar(asarPath, relPath, encoding = "utf8") {
    const stat = fs.statSync(asarPath);
    const fd = fs.openSync(asarPath, "r");
    try {
        const { tree, dataOffset } = parseAsarHeaderFromFd(fd, stat.size);
        const node = getTreeNode(tree, relPath);
        if (!node) throw new Error(`File not found in ASAR: ${relPath}`);
        if (node.unpacked) {
            const unpackedPath = path.join(asarPath + ".unpacked", relPath);
            return encoding ? fs.readFileSync(unpackedPath, encoding) : fs.readFileSync(unpackedPath);
        }
        const entryOffset = Number(node.offset);
        const buf = Buffer.allocUnsafe(node.size);
        if (node.size > 0) {
            fs.readSync(fd, buf, 0, node.size, dataOffset + entryOffset);
        }
        return encoding ? buf.toString(encoding) : buf;
    } finally {
        try { fs.closeSync(fd); } catch (_) {}
    }
}

function writeBuffersBatchSync(fd, buffers) {
    for (let i = 0; i < buffers.length; i += WRITEV_BATCH_SIZE) {
        const batch = buffers.slice(i, i + WRITEV_BATCH_SIZE);
        let offsetInBatch = 0;
        while (offsetInBatch < batch.length) {
            const slice = offsetInBatch === 0 ? batch : batch.slice(offsetInBatch);
            const totalExpected = slice.reduce((acc, b) => acc + b.length, 0);
            if (totalExpected === 0) break;
            const written = fs.writevSync(fd, slice);
            if (written === totalExpected) break;
            // Partial writev handling
            let rem = written;
            while (offsetInBatch < batch.length && rem >= batch[offsetInBatch].length) {
                rem -= batch[offsetInBatch].length;
                offsetInBatch++;
            }
            if (rem > 0 && offsetInBatch < batch.length) {
                batch[offsetInBatch] = batch[offsetInBatch].subarray(rem);
            }
        }
    }
}

function atomicReplaceFile(tmpPath, targetPath) {
    try {
        fs.renameSync(tmpPath, targetPath);
    } catch (renameErr) {
        try {
            fs.copyFileSync(tmpPath, targetPath);
            fs.unlinkSync(tmpPath);
        } catch (copyErr) {
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
            throw copyErr;
        }
    }
}

/**
 * 内存级外科手术式修改 ASAR（仅重算变更文件的 SHA256 与全树 offset，耗时 <120ms）
 * @param {string} targetAsarPath 输出目标 app.asar 路径
 * @param {Record<string, (utf8Content: string, rawBuf: Buffer) => string | Buffer | null | undefined>} fileMutators
 * @param {{ sourceAsarPath?: string, allowCreate?: boolean }} [options]
 */
function patchAsarSurgical(targetAsarPath, fileMutators, options = {}) {
    const startMs = Date.now();
    const srcPath = options.sourceAsarPath || targetAsarPath;
    const asarBuf = fs.readFileSync(srcPath);
    const { tree, dataOffset: oldDataOffset } = parseAsarHeaderFromBuffer(asarBuf);

    // Normalize mutator keys
    const mutatorMap = new Map();
    for (const [k, fn] of Object.entries(fileMutators || {})) {
        if (typeof fn === "function") {
            mutatorMap.set(k.replace(/\\/g, "/").replace(/^\/+/, ""), fn);
        }
    }

    const packedEntries = [];
    function collectPacked(dirNode, prefix) {
        if (!dirNode || !dirNode.files) return;
        for (const [name, child] of Object.entries(dirNode.files)) {
            const rel = prefix ? `${prefix}/${name}` : name;
            if (child && child.files) {
                collectPacked(child, rel);
            } else if (child && !child.unpacked && !child.link && child.offset !== undefined) {
                packedEntries.push({ rel, node: child, origOffset: Number(child.offset) });
            }
        }
    }
    collectPacked(tree, "");

    // Preserve original physical archive ordering
    packedEntries.sort((a, b) => a.origOffset - b.origOffset);

    const seenPaths = new Set();
    const payloadBuffers = [];
    const modifiedFiles = [];
    let currentOffset = 0;

    for (const item of packedEntries) {
        const { rel, node, origOffset } = item;
        seenPaths.add(rel);
        const origSize = Number(node.size) || 0;
        if (origOffset < 0 || oldDataOffset + origOffset + origSize > asarBuf.length) {
            throw new Error(`ASAR entry out of bounds: ${rel} (offset=${origOffset}, size=${origSize})`);
        }
        const origSlice = asarBuf.subarray(oldDataOffset + origOffset, oldDataOffset + origOffset + origSize);
        let finalBuf = origSlice;

        if (mutatorMap.has(rel)) {
            const fn = mutatorMap.get(rel);
            const res = fn(origSlice.toString("utf8"), origSlice);
            if (res !== null && res !== undefined) {
                const candidateBuf = Buffer.isBuffer(res) ? res : Buffer.from(String(res), "utf8");
                if (!candidateBuf.equals(origSlice)) {
                    finalBuf = candidateBuf;
                    node.size = finalBuf.length;
                    node.integrity = computeAsarIntegrity(
                        finalBuf,
                        (node.integrity && node.integrity.blockSize) || DEFAULT_BLOCK_SIZE
                    );
                    modifiedFiles.push(rel);
                }
            }
        }

        if (!node.integrity) {
            node.integrity = computeAsarIntegrity(finalBuf, DEFAULT_BLOCK_SIZE);
        }
        node.offset = String(currentOffset);
        currentOffset += finalBuf.length;
        payloadBuffers.push(finalBuf);
    }

    if (options.allowCreate) {
        for (const [rel, fn] of mutatorMap.entries()) {
            if (seenPaths.has(rel)) continue;
            const res = fn("", Buffer.alloc(0));
            if (res === null || res === undefined) continue;
            const finalBuf = Buffer.isBuffer(res) ? res : Buffer.from(String(res), "utf8");
            const { parent, fileName } = ensureTreeParent(tree, rel);
            parent[fileName] = {
                size: finalBuf.length,
                offset: String(currentOffset),
                integrity: computeAsarIntegrity(finalBuf, DEFAULT_BLOCK_SIZE)
            };
            currentOffset += finalBuf.length;
            payloadBuffers.push(finalBuf);
            modifiedFiles.push(rel);
        }
    }

    const newJsonBuf = Buffer.from(JSON.stringify(tree), "utf8");
    const { headerBuf, headerSha256 } = buildPickleHeader(newJsonBuf);

    const tmpPath = `${targetAsarPath}.ag_tmp_${process.pid}_${Date.now()}`;
    let fd = null;
    try {
        fd = fs.openSync(tmpPath, "w", 0o644);
        writeBuffersBatchSync(fd, [headerBuf, ...payloadBuffers]);
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = null;
        atomicReplaceFile(tmpPath, targetAsarPath);
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (_) {}
        }
        try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch (_) {}
    }

    return {
        success: true,
        modifiedFiles,
        headerSha256,
        elapsedMs: Date.now() - startMs
    };
}

/**
 * 纯 Node 目录打包为 ASAR（用于离线兜底及沙盒自动化测试）
 */
function packDirToAsar(srcDir, destAsarPath) {
    const tree = { files: {} };
    const payloadBuffers = [];
    let currentOffset = 0;

    function walkBuild(absDir, treeFilesObj) {
        const entries = fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
        for (const ent of entries) {
            const fullPath = path.join(absDir, ent.name);
            if (ent.isSymbolicLink()) {
                treeFilesObj[ent.name] = { link: fs.readlinkSync(fullPath) };
            } else if (ent.isDirectory()) {
                const sub = { files: {} };
                treeFilesObj[ent.name] = sub;
                walkBuild(fullPath, sub.files);
            } else if (ent.isFile()) {
                const buf = fs.readFileSync(fullPath);
                const st = fs.statSync(fullPath);
                const node = {
                    size: buf.length,
                    offset: String(currentOffset),
                    integrity: computeAsarIntegrity(buf, DEFAULT_BLOCK_SIZE)
                };
                if (process.platform !== "win32" && (st.mode & 0o111) !== 0) {
                    node.executable = true;
                }
                treeFilesObj[ent.name] = node;
                currentOffset += buf.length;
                payloadBuffers.push(buf);
            }
        }
    }

    walkBuild(srcDir, tree.files);
    const jsonBuf = Buffer.from(JSON.stringify(tree), "utf8");
    const { headerBuf, headerSha256 } = buildPickleHeader(jsonBuf);

    fs.mkdirSync(path.dirname(path.resolve(destAsarPath)), { recursive: true });
    const tmpPath = `${destAsarPath}.ag_pack_${process.pid}_${Date.now()}`;
    const fd = fs.openSync(tmpPath, "w", 0o644);
    try {
        writeBuffersBatchSync(fd, [headerBuf, ...payloadBuffers]);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    atomicReplaceFile(tmpPath, destAsarPath);
    return { headerSha256, totalDataBytes: currentOffset };
}

/**
 * 纯 Node 解包 ASAR 到目录（用于离线兜底及完整性校验）
 */
function extractAsarToDir(asarPath, destDir, options = {}) {
    const verifyIntegrity = options.verifyIntegrity !== false;
    const asarBuf = fs.readFileSync(asarPath);
    const { tree, dataOffset } = parseAsarHeaderFromBuffer(asarBuf);

    function walkExtract(dirNode, outDir, relPrefix) {
        fs.mkdirSync(outDir, { recursive: true });
        if (!dirNode || !dirNode.files) return;
        for (const [name, child] of Object.entries(dirNode.files)) {
            const outPath = path.join(outDir, name);
            const rel = relPrefix ? `${relPrefix}/${name}` : name;
            if (child.files) {
                walkExtract(child, outPath, rel);
            } else if (child.link) {
                try {
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
                    fs.symlinkSync(child.link, outPath);
                } catch (_) {}
            } else if (child.unpacked) {
                const unpackedSrc = path.join(asarPath + ".unpacked", rel);
                if (fs.existsSync(unpackedSrc)) {
                    fs.mkdirSync(path.dirname(outPath), { recursive: true });
                    fs.copyFileSync(unpackedSrc, outPath);
                }
            } else {
                const off = Number(child.offset) || 0;
                const sz = Number(child.size) || 0;
                const slice = asarBuf.subarray(dataOffset + off, dataOffset + off + sz);
                if (verifyIntegrity && child.integrity && child.integrity.hash) {
                    const actualHash = sha256Hex(slice);
                    if (actualHash !== child.integrity.hash) {
                        throw new Error(`ASAR integrity mismatch on ${rel}: expected ${child.integrity.hash}, got ${actualHash}`);
                    }
                    const blockSz = child.integrity.blockSize || DEFAULT_BLOCK_SIZE;
                    const expectedBlocks = child.integrity.blocks || [];
                    if (sz === 0) {
                        if (expectedBlocks.length > 0 && expectedBlocks[0] !== actualHash) {
                            throw new Error(`ASAR empty block integrity mismatch on ${rel}`);
                        }
                    } else {
                        let bIdx = 0;
                        for (let p = 0; p < slice.length; p += blockSz, bIdx++) {
                            const bh = sha256Hex(slice.subarray(p, Math.min(p + blockSz, slice.length)));
                            if (expectedBlocks[bIdx] && bh !== expectedBlocks[bIdx]) {
                                throw new Error(`ASAR block[${bIdx}] integrity mismatch on ${rel}`);
                            }
                        }
                    }
                }
                fs.writeFileSync(outPath, slice, { mode: child.executable ? 0o755 : 0o644 });
            }
        }
    }

    walkExtract(tree, destDir, "");
    return true;
}

module.exports = {
    DEFAULT_SIGNATURE_START,
    DEFAULT_SIGNATURE_END,
    computeAsarIntegrity,
    buildPickleHeader,
    parseAsarHeaderFromFd,
    parseAsarHeaderFromBuffer,
    isAsarLocalizedFast,
    readFileFromAsar,
    patchAsarSurgical,
    packDirToAsar,
    extractAsarToDir
};
