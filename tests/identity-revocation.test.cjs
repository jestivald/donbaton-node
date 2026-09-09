const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the actual service methods; replace network/native integrations only.
const servicePath = path.join(__dirname, '../src/modules/handler/handler.service.ts');
const compiled = ts.transpileModule(fs.readFileSync(servicePath, 'utf8'), {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true,
        esModuleInterop: true,
    },
}).outputText;

async function fixture(flag) {
    const events = [],
        removals = [],
        additions = [],
        lookups = [];
    const Model = class {
        constructor(success, error) {
            Object.assign(this, { success, error });
        }
    };
    const modules = {
        'enhanced-ms': () => '0ms',
        sockdestroy: { hasCapNetAdmin: () => true },
        '@nestjs/common': {
            Injectable: () => (v) => v,
            Logger: class {
                log() {}
                warn() {}
                error() {}
                debug() {}
            },
        },
        '@remnawave/xtls-sdk-nestjs': { InjectXtls: () => () => {} },
        '@common/types': {
            ok: (response) => ({ isOk: true, response }),
            fail: (err) => ({ isOk: false, ...err }),
        },
        '@libs/contracts/constants/errors': {
            ERRORS: { INTERNAL_SERVER_ERROR: { code: 'internal' } },
        },
        '../_plugin/events/drop-connections': {
            DropConnectionsEvent: class {
                constructor(ips) {
                    this.ips = ips;
                }
            },
        },
        './models': {
            AddUserResponseModel: Model,
            RemoveUserResponseModel: Model,
            GenericResponseModel: Model,
        },
    };
    const sandbox = {
        exports: {},
        performance,
        process: { env: { DONBATON_XRAY_IDENTITY_REVOKE: flag } },
        require: (name) => {
            if (!(name in modules)) throw new Error('Unexpected runtime import: ' + name);
            return modules[name];
        },
    };
    vm.runInNewContext(compiled, sandbox, { filename: servicePath });
    const api = {
        handler: {
            removeUser: async (...args) => {
                removals.push(args);
                return { isOk: true };
            },
            addVlessUser: async (data) => {
                additions.push(data);
                return { isOk: true };
            },
        },
        stats: {
            rawClient: {
                getStatsOnlineIpList: async (data) => {
                    lookups.push(data);
                    return { ips: { '203.0.113.12': 1 } };
                },
            },
        },
    };
    const tags = new Set(['lte']);
    const internal = {
        getXtlsConfigInbounds: () => tags,
        addXtlsConfigInbound: (tag) => tags.add(tag),
        removeUserFromInbound: async () => {},
        addUserToInbound: async () => {},
    };
    const service = new sandbox.exports.HandlerService(api, internal, {
        publish: (event) => events.push(event),
    });
    await service.onModuleInit();
    return { service, events, removals, additions, lookups };
}

for (const flag of [undefined, 'false', 'TRUE', 'true']) {
    for (const action of ['single', 'bulk', 'rotation']) {
        test(`${action}: identity flag ${String(flag)} preserves credential removal and isolates automatic IP drop`, async () => {
            const f = await fixture(flag);
            let result;
            if (action === 'single')
                result = await f.service.removeUser({
                    username: 'subject',
                    hashData: { vlessUuid: 'new' },
                });
            if (action === 'bulk')
                result = await f.service.removeUsers({
                    users: [{ userId: 'subject', hashUuid: 'new' }],
                });
            if (action === 'rotation')
                result = await f.service.addUser({
                    data: [
                        { tag: 'lte', type: 'vless', username: 'subject', uuid: 'new', flow: '' },
                    ],
                    hashData: { vlessUuid: 'new', prevVlessUuid: 'old' },
                });
            assert.equal(result.isOk && result.response.success, true);
            assert.equal(f.removals.length, 1);
            assert.deepEqual(f.removals[0], ['lte', 'subject']);
            assert.equal(f.additions.length, action === 'rotation' ? 1 : 0);
            assert.equal(f.events.length, flag === 'true' ? 0 : 1);
            assert.equal(f.lookups.length, flag === 'true' ? 0 : 1);
        });
    }
}

test('explicit operator drop remains available with identity revocation enabled', async () => {
    const f = await fixture('true');
    await f.service.dropUsersConnections({ userIds: ['subject'] });
    await f.service.dropIps({ ips: ['203.0.113.15'] });
    assert.equal(f.lookups.length, 1);
    assert.equal(f.events.length, 2);
    assert.equal(f.events[0].ips[0], '203.0.113.12');
    assert.equal(f.events[1].ips[0], '203.0.113.15');
});

test('identity mode still reports a failed Xray removal', async () => {
    const f = await fixture('true');
    f.service.xtlsApi.handler.removeUser = async () => ({
        isOk: false,
        message: 'inbound unavailable',
    });
    const result = await f.service.removeUser({
        username: 'subject',
        hashData: { vlessUuid: 'new' },
    });
    assert.equal(result.response.success, false);
    assert.equal(result.response.error, 'inbound unavailable');
    assert.equal(f.events.length, 0);
});
