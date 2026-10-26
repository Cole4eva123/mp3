// Run against a server with a disposable database: npm start, then npm test
// (API_URL defaults to http://localhost:3000). Creates test data and deletes it at the end.
var test = require('node:test'),
    assert = require('node:assert');

var API = (process.env.API_URL || 'http://localhost:3000') + '/api';
var created = { users: [], tasks: [] };

async function call(method, path, body) {
    var res = await fetch(API + path, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: body && JSON.stringify(body)
    });
    var json = await res.json();
    assert.ok('message' in json && 'data' in json, method + ' ' + path + ' response format');
    if (method === 'POST' && res.status === 201) created[path.slice(1)].push(json.data._id);
    return { status: res.status, data: json.data };
}

var get = function (path) { return call('GET', path); };
var tag = 'test-' + Date.now();
var user = function (n, extra) { return Object.assign({ name: n, email: n + '@' + tag + '.com' }, extra); };
var task = function (n, extra) { return Object.assign({ name: n, deadline: '2030-01-01' }, extra); };

test.after(async function () {
    for (var id of created.tasks) await call('DELETE', '/tasks/' + id);
    for (var id of created.users) await call('DELETE', '/users/' + id);
});

test('validation and defaults', async function () {
    assert.equal((await call('POST', '/users', { name: 'x' })).status, 400);
    assert.equal((await call('POST', '/tasks', { name: 'x' })).status, 400);
    assert.equal((await call('POST', '/tasks', task('x', { completed: 'maybe' }))).status, 400);
    var a = (await call('POST', '/users', user('dup'))).data;
    assert.deepEqual(a.pendingTasks, []);
    assert.ok(a.dateCreated);
    assert.equal((await call('POST', '/users', user('dup'))).status, 400);
    var t = (await call('POST', '/tasks', task('defaults', { dateCreated: '2000-01-01' }))).data;
    assert.equal(t.description, '');
    assert.equal(t.completed, false);
    assert.equal(t.assignedUser, '');
    assert.equal(t.assignedUserName, 'unassigned');
    assert.notEqual(t.dateCreated.slice(0, 4), '2000');
});

test('ids and select', async function () {
    var a = (await call('POST', '/users', user('sel'))).data;
    assert.equal((await get('/users/nope')).status, 404);
    assert.equal((await get('/users/' + '0'.repeat(24))).status, 404);
    assert.equal((await call('PUT', '/users/' + '0'.repeat(24), user('ghost'))).status, 404);
    assert.equal((await call('PUT', '/tasks/nope', task('ghost'))).status, 404);
    assert.deepEqual(Object.keys((await get('/users/' + a._id + '?select={"name":1}')).data), ['_id', 'name']);
    assert.equal((await get('/users?where={"_id":"' + a._id + '"}')).data.length, 1);
    assert.deepEqual((await get('/users?where={"_id":"' + '0'.repeat(24) + '"}')).data, []);
});

test('query parameters', async function () {
    for (var i = 0; i < 3; i++) await call('POST', '/tasks', task(tag + '-q' + i, { completed: i === 1 }));
    var where = '?where={"name":{"$regex":"^' + tag + '-q"}}';
    assert.equal((await get('/tasks' + where + '&count=true')).data, 3);
    assert.equal((await get('/tasks' + where.replace('}}', '},"completed":true}') + '&count=true')).data, 1);
    var names = (await get('/tasks' + where + '&sort={"name":-1}&skip=1&limit=1&select={"name":1}')).data;
    assert.deepEqual(names.map(function (t) { return t.name; }), [tag + '-q1']);
    assert.equal((await get('/tasks?where={bad')).status, 400);
});

test('two-way references', async function () {
    var a = (await call('POST', '/users', user('alice'))).data;
    var b = (await call('POST', '/users', user('bob'))).data;
    var t1 = (await call('POST', '/tasks', task('t1', { assignedUser: a._id }))).data;
    assert.equal(t1.assignedUserName, 'alice');
    assert.deepEqual((await get('/users/' + a._id)).data.pendingTasks, [t1._id]);

    assert.equal((await call('POST', '/tasks', task('x', { assignedUser: a._id, assignedUserName: 'bob' }))).status, 400);
    assert.equal((await call('POST', '/tasks', task('x', { assignedUser: 'bad' }))).status, 400);
    assert.equal((await call('POST', '/tasks', task('x', { assignedUser: '0'.repeat(24) }))).status, 404);

    // Task moves from alice to bob through PUT /users
    var t2 = (await call('POST', '/tasks', task('t2'))).data;
    assert.equal((await call('PUT', '/users/' + b._id, user('bob', { pendingTasks: [t1._id, t2._id] }))).status, 200);
    assert.deepEqual((await get('/users/' + a._id)).data.pendingTasks, []);
    assert.equal((await get('/tasks/' + t1._id)).data.assignedUserName, 'bob');

    // Rename updates assignedUserName, dropping a task unassigns it
    await call('PUT', '/users/' + b._id, user('bobby', { email: b.email, pendingTasks: [t1._id] }));
    assert.equal((await get('/tasks/' + t1._id)).data.assignedUserName, 'bobby');
    assert.equal((await get('/tasks/' + t2._id)).data.assignedUser, '');

    // Completing keeps the assignment but leaves pendingTasks; reopening adds it back
    var done = task('t1', { assignedUser: b._id, completed: true });
    assert.equal((await call('PUT', '/tasks/' + t1._id, done)).data.assignedUserName, 'bobby');
    assert.deepEqual((await get('/users/' + b._id)).data.pendingTasks, []);
    assert.equal((await call('PUT', '/users/' + a._id, user('alice', { pendingTasks: [t1._id] }))).status, 400);
    await call('PUT', '/tasks/' + t1._id, task('t1', { assignedUser: b._id }));
    assert.deepEqual((await get('/users/' + b._id)).data.pendingTasks, [t1._id]);

    // Failed request changes nothing
    assert.equal((await call('PUT', '/users/' + a._id, user('alice', { pendingTasks: [t1._id, '0'.repeat(24)] }))).status, 404);
    assert.deepEqual((await get('/users/' + b._id)).data.pendingTasks, [t1._id]);

    // Unassign through PUT /tasks, then deletes clean up
    await call('PUT', '/tasks/' + t2._id, task('t2', { assignedUser: a._id }));
    await call('PUT', '/tasks/' + t2._id, task('t2', { assignedUser: '' }));
    assert.deepEqual((await get('/users/' + a._id)).data.pendingTasks, []);
    assert.equal((await call('DELETE', '/tasks/' + t1._id)).status, 200);
    assert.equal((await get('/tasks/' + t1._id)).status, 404);
    assert.deepEqual((await get('/users/' + b._id)).data.pendingTasks, []);
    await call('PUT', '/tasks/' + t2._id, task('t2', { assignedUser: b._id, completed: true }));
    assert.equal((await call('DELETE', '/users/' + b._id)).status, 200);
    assert.equal((await get('/tasks/' + t2._id)).data.assignedUserName, 'unassigned');
    assert.equal((await call('DELETE', '/users/' + b._id)).status, 404);
});
