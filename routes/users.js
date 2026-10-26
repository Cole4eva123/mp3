var User = require('../models/user'),
    Task = require('../models/task'),
    h = require('./helpers');

var UNASSIGNED = { assignedUser: '', assignedUserName: 'unassigned' };

// Validate everything before the first write, so a failed request changes nothing
async function save(old, body) {
    var user = await h.build(User, old, body);
    var id = user.id;
    var taskIds = [...new Set(user.pendingTasks)];

    if (!taskIds.every(h.isId)) throw h.error(400, 'pendingTasks must contain valid task ids');
    if (await User.exists({ email: user.email, _id: { $ne: id } })) throw h.error(400, 'Email already exists');
    var tasks = await Task.find({ _id: { $in: taskIds } });
    if (tasks.length < taskIds.length) throw h.error(404, 'Task in pendingTasks not found');
    if (tasks.some(function (t) { return t.completed; })) throw h.error(400, 'Completed tasks cannot be pending');

    user.pendingTasks = taskIds;
    // Pending tasks dropped from the list are unassigned; tasks taken from other users leave their lists
    await Task.updateMany({ assignedUser: id, completed: false, _id: { $nin: taskIds } }, UNASSIGNED);
    await User.updateMany({ _id: { $ne: id } }, { $pull: { pendingTasks: { $in: taskIds } } });
    // Covers the new tasks and a name change on all of the user's tasks
    await Task.updateMany({ $or: [{ _id: { $in: taskIds } }, { assignedUser: id }] }, { assignedUser: id, assignedUserName: user.name });
    await (old ? User.replaceOne({ _id: id }, user) : user.save());
    return user;
}

module.exports = function (router) {

    router.route('/users')
        .get(h.list(User))
        .post(async function (req, res) {
            res.status(201).json({ message: 'User created', data: await save(null, req.body) });
        });

    router.route('/users/:id')
        .get(h.one(User))
        .put(async function (req, res) {
            var old = await h.find(User, req.params.id);
            res.json({ message: 'User updated', data: await save(old, req.body) });
        })
        .delete(async function (req, res) {
            var user = await h.find(User, req.params.id);
            await Task.updateMany({ assignedUser: user.id }, UNASSIGNED);
            await user.deleteOne();
            res.json({ message: 'User deleted', data: user });
        });

    return router;
};
