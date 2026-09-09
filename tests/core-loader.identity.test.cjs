const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const servicePath = path.join(__dirname, '../src/modules/xray-core/core-loader.service.ts');
const compiled = ts.transpileModule(fs.readFileSync(servicePath, 'utf8'), {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true,
        esModuleInterop: true,
    },
}).outputText;
const corePath = '/usr/local/bin/xray';
const manifestPath = '/usr/local/share/donbaton/identity-core.sha256';
const payload = Buffer.from('fixture paired core');
const hash = crypto.createHash('sha256').update(payload).digest('hex');
const override = { core: { url: 'https://owned.example/core', sha256: 'f'.repeat(64) } };

function fixture(flag, changes = {}) {
    const writes = [];
    const files = new Map([
        [corePath, payload],
        [manifestPath, `${hash}  ${corePath}\n`],
    ]);
    if (changes.manifest !== undefined) files.set(manifestPath, changes.manifest);
    if (changes.missingManifest) files.delete(manifestPath);
    let target = changes.target ?? corePath;
    const missing = () => Object.assign(new Error('missing fixture path'), { code: 'ENOENT' });
    const modules = {
        'node:crypto': crypto,
        'node:fs/promises': {
            readFile: async (name) => {
                if (!files.has(name)) throw missing();
                return files.get(name);
            },
            readlink: async () => target,
            stat: async () => ({ size: 24, mtimeMs: 1 }),
            chmod: async (...args) => writes.push(['chmod', ...args]),
            rename: async (...args) => writes.push(['rename', ...args]),
            rm: async (...args) => writes.push(['rm', ...args]),
            symlink: async (value, name) => {
                writes.push(['symlink', value, name]);
                target = value;
            },
            writeFile: async (...args) => writes.push(['writeFile', ...args]),
        },
        'pretty-bytes': () => 'fixture size',
        zod: require('zod'),
        '@nestjs/common': {
            Injectable: () => (value) => value,
            Logger: class {
                log() {}
                warn() {}
                error() {}
            },
        },
        '@common/utils/download-file': {
            downloadFile: async (...args) => {
                writes.push(['download', ...args]);
                return { sha256: override.core.sha256, size: 24 };
            },
        },
        '@common/utils/get-elapsed-time': {
            getTime: () => 1,
            formatExecutionTime: () => 'fixture duration',
        },
        '@common/utils/read-core-version': {
            readCoreVersion: async () => ({ raw: 'fixture version' }),
        },
    };
    const sandbox = {
        exports: {},
        process: { env: { DONBATON_XRAY_IDENTITY_REVOKE: flag } },
        require: (name) => {
            if (!(name in modules)) throw new Error('Unexpected import: ' + name);
            return modules[name];
        },
    };
    vm.runInNewContext(compiled, sandbox, { filename: servicePath });
    return { service: new sandbox.exports.CoreLoaderService(), writes };
}

test('identity mode verifies the bundled core and leaves its symlink unchanged', async () => {
    const f = fixture('true');
    await f.service.prepare(undefined);
    await f.service.prepare({ geoip: [] });
    assert.deepEqual(f.writes, []);
});

test('panel custom core cannot bypass identity pairing via geodata', async () => {
    const f = fixture('true');
    await assert.rejects(f.service.prepare(override), /does not permit a panel custom core/);
    assert.deepEqual(f.writes, []);
});

test('malformed panel core configuration fails before any installation', async () => {
    const f = fixture('true');
    await assert.rejects(
        f.service.prepare({ core: { url: 'http://invalid' } }),
        /valid bundled-core/,
    );
    assert.deepEqual(f.writes, []);
});

for (const [name, changes] of [
    ['missing manifest', { missingManifest: true }],
    ['wrong hash', { manifest: `${'0'.repeat(64)}  ${corePath}` }],
    ['wrong manifest path', { manifest: `${hash}  /tmp/another-core` }],
    ['custom symlink', { target: '/usr/local/bin/xray-custom' }],
]) {
    test(`identity mode refuses ${name} before a restart can occur`, async () => {
        const f = fixture('true', changes);
        await assert.rejects(f.service.prepare({}));
        assert.deepEqual(f.writes, []);
    });
}

for (const flag of [undefined, 'false', 'TRUE']) {
    test(`legacy mode ${String(flag)} retains panel custom-core loading`, async () => {
        const f = fixture(flag);
        await f.service.prepare(override);
        assert.equal(f.writes.filter(([action]) => action === 'download').length, 1);
        assert.equal(
            f.writes.find(([action]) => action === 'symlink')[1],
            '/usr/local/bin/xray-custom',
        );
    });
}
